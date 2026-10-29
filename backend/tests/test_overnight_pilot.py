import pytest
import asyncio
import inspect
import sys

import backend.app.services.overnight_pilot as overnight_module
import backend.app.routers.overnight_pilot as overnight_router
from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager, PilotSession
from backend.app.services.paper_trading import PaperPosition


def test_ema_verdict_does_not_claim_missing_l2_history():
    manager = OvernightPilotManager()
    manager.sessions["BTCUSDT"] = PilotSession(
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend", min_density_usd=0),
        backtest={"summary": {"net_pnl_usd": 5.0, "total_trades": 35, "profit_factor": 1.4}},
        forecast={"market_regime": "TRENDING"},
    )
    verdict = manager.status()["summary"][0]["verdict"]
    assert verdict["level"] == "PASS"
    assert "L2 History: No data" not in verdict["flags"]


def test_demo_admission_does_not_block_negative_backtest_but_keeps_toxic_veto():
    manager = OvernightPilotManager()
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend", min_density_usd=0)
    manager.sessions["BTCUSDT"] = overnight_module.PilotSession(
        config,
        backtest={"summary": {"net_pnl_usd": -10.0, "total_trades": 4, "profit_factor": 0.5}},
        forecast={"data_status": "connected", "market_regime": "TRENDING"},
    )
    assert manager._demo_hard_block_reasons() == {}
    manager.sessions["BTCUSDT"].forecast["market_regime"] = "TOXIC_VOLATILITY"
    assert "BTCUSDT" in manager._demo_hard_block_reasons()


def test_pair_preflight_fingerprint_rejects_changed_profile_and_stale_forecast():
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend")
    session = overnight_module.PilotSession(
        config, run_id="prepared-1", config_fingerprint=OvernightPilotManager._config_fingerprint(config),
        preflight_valid=True,
        backtest={"meta": {"candles": 300, "symbol": "BTCUSDT", "timeframe": "15m"}},
        forecast={"data_status": "connected"},
    )
    assert OvernightPilotManager._pair_preflight_matches(session, config, "prepared-1")
    assert not OvernightPilotManager._pair_preflight_matches(session, config, "wrong")
    assert not OvernightPilotManager._pair_preflight_matches(
        session, config.model_copy(update={"stop_loss_pct": 0.9}), "prepared-1"
    )
    session.forecast["data_status"] = "stale"
    assert not OvernightPilotManager._pair_preflight_matches(session, config, "prepared-1")


def test_full_stop_requires_recent_observed_price_for_open_paper_position():
    manager = OvernightPilotManager()
    shared = overnight_module.PaperTradingSession(initial_balance=1000)
    shared.positions["BTCUSDT"] = PaperPosition(
        symbol="BTCUSDT", side="LONG", qty=0.1, avg_entry_price=100.0,
    )
    shared.last_prices["BTCUSDT"] = 101.0
    manager._shared_paper_session = shared
    assert "BTCUSDT" in manager._unsafe_stop_positions(now_ms=100_000)
    manager.sessions["BTCUSDT"] = overnight_module.PilotSession(
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend"),
        runner=type("Runner", (), {"last_successful_data_at": 99_000, "is_running": True})(),
    )
    assert manager._unsafe_stop_positions(now_ms=100_000) == []


def test_manual_pair_close_uses_observed_shared_price_not_position_entry():
    manager = OvernightPilotManager()
    shared = overnight_module.PaperTradingSession(initial_balance=1000)
    shared.last_prices["BTCUSDT"] = 102.0
    manager._shared_paper_session = shared
    manager.sessions["BTCUSDT"] = overnight_module.PilotSession(
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend"),
        runner=type("Runner", (), {"last_successful_data_at": 99_000, "is_running": True})(),
    )
    assert manager._observed_close_price("BTCUSDT", now_ms=100_000) == 102.0
    with pytest.raises(ValueError, match="fresh observed price"):
        manager._observed_close_price("BTCUSDT", now_ms=200_000)


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio event-loop socketpair")
def test_new_pair_requires_its_exact_preflight_even_when_other_pair_runs(monkeypatch):
    async def scenario():
        class QuietLogger:
            def count_by_source(self, *_):
                return {}

        class Runner:
            def __init__(self, session):
                self.session = session
                self.is_running = False

            def start(self, *_args, **_kwargs):
                self.is_running = True
                return {}

            def get_status(self):
                return {"is_running": self.is_running, "session_id": self.session.session_id,
                        "open_positions": [], "closed_trades": []}

        async def fake_prepare(self, selected):
            for config in selected:
                fingerprint = self._config_fingerprint(config)
                self.sessions[config.symbol] = overnight_module.PilotSession(
                    config, run_id="prepared-1", config_fingerprint=fingerprint, preflight_valid=True,
                    backtest={"summary": {"net_pnl_usd": -1.0, "total_trades": 5},
                              "meta": {"candles": 300, "symbol": config.symbol, "timeframe": config.timeframe}},
                    forecast={"data_status": "connected", "market_regime": "TRENDING"},
                )

        monkeypatch.setattr(overnight_module.OvernightPilotManager, "_prepare", fake_prepare)
        monkeypatch.setattr(overnight_module, "LivePaperRunner", Runner)
        manager = OvernightPilotManager()
        manager.intent_logger = QuietLogger()
        manager._shared_paper_session = overnight_module.PaperTradingSession(initial_balance=1000)
        existing = overnight_module.PilotSession(
            OvernightPilotConfig(symbol="ETHUSDT", strategy_type="ema_trend"),
            runner=Runner(manager._shared_paper_session),
        )
        existing.runner.is_running = True
        manager.sessions["ETHUSDT"] = existing
        config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend")
        prepared = await manager.prepare_pair(config)
        assert prepared["preflight_id"] == "prepared-1"
        with pytest.raises(ValueError, match="exact pair preflight"):
            await manager.start_pair(config.model_copy(update={"stop_loss_pct": 0.9}), "prepared-1", demo=True)
        with pytest.raises(ValueError, match="exact pair preflight"):
            await manager.start_pair(config, "wrong", demo=True)
        result = await manager.start_pair(config, "prepared-1", demo=True)
        assert result["pilot_running"] is True
        assert result["sessions"]["ETHUSDT"]["paper"]["is_running"] is True
        assert result["sessions"]["BTCUSDT"]["paper"]["is_running"] is True

    asyncio.run(scenario())


def test_pilot_config_rejects_unknown_strategy_and_limits_three_sessions():
    with pytest.raises(ValueError):
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="live_density_bounce")
    manager = OvernightPilotManager()
    assert len(manager.default_configs()) == 3
    assert manager.default_configs()[0].duration_hours == 24.0


def test_diagnostics_lenient_preset_uses_short_low_risk_real_data_sessions():
    configs = OvernightPilotManager.diagnostics_lenient_configs()

    assert [config.symbol for config in configs] == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    assert {config.strategy_type for config in configs} == {"diagnostics_lenient"}
    assert all(config.duration_hours == 1.5 for config in configs)
    assert all(config.min_density_usd == 0 for config in configs)
    assert all(config.volume_multiplier == 0.5 for config in configs)
    assert all(not config.use_atr_filter and not config.use_cvd_filter and not config.use_oi_filter and not config.use_rsi_filter for config in configs)


def test_diversified_paper_preset_matches_the_three_strategy_night_plan():
    configs = OvernightPilotManager.diversified_paper_configs()

    assert [(config.symbol, config.strategy_type) for config in configs] == [
        ("BTCUSDT", "confluence_ema"),
        ("ETHUSDT", "cvd_absorption"),
        ("SOLUSDT", "cluster_volume_bounce"),
    ]
    assert all(config.initial_capital == 1000.0 and config.duration_hours == 24.0 for config in configs)
    assert [(config.timeframe, config.days) for config in configs] == [("15m", 14), ("15m", 14), ("5m", 14)]
    assert [(config.risk_per_trade_pct, config.stop_loss_pct, config.take_profit_pct, config.leverage) for config in configs] == [
        (1.0, 0.8, 1.6, 2.0),
        (0.75, 0.65, 1.8, 2.0),
        (0.5, 1.0, 2.2, 1.0),
    ]


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio.run/socket primitives")
def test_preflight_runs_and_persists_oos_optimizer_recommendation(monkeypatch):
    async def scenario():
        backtest_calls = []
        forecast_calls = []
        optimizer_calls = []

        async def fake_backtest(request):
            backtest_calls.append(request)
            return {"summary": {"total_trades": 32, "net_pnl_usd": 12.0}, "trades": [],
                    "meta": {"symbol": request.symbol, "timeframe": request.timeframe, "candles": 1500, "from_time": 1, "to_time": 2},
                    "data_engine": {"historical_sources": ["Binance Futures OHLCV"]}}

        async def fake_forecast(symbol, timeframe, strategy_type, strategy_params):
            forecast_calls.append((symbol, timeframe, strategy_type))
            return {"data_status": "connected", "base_scenario": {"direction": "NO_TRADE"}}

        async def fake_optimizer(request):
            optimizer_calls.append(request)
            if request.symbol == "ETHUSDT":
                raise RuntimeError("optimizer temporarily unavailable")
            return {
                "meta": {
                    "best_params": {"stop_loss_pct": 0.7, "take_profit_pct": 2.0},
                    "combinations_tested": 24,
                    "oos": {"available": True, "metrics": {"total_pnl_pct": 1.25, "total_trades": 8}},
                },
                "before_optimization": {"total_pnl_pct": -0.5},
                "after_optimization": {"total_pnl_pct": 2.0},
            }

        monkeypatch.setattr(overnight_module, "run_backtest", fake_backtest)
        monkeypatch.setattr(overnight_module, "compute_probabilistic_forecast", fake_forecast)
        monkeypatch.setattr(overnight_module, "optimize_backtest", fake_optimizer, raising=False)

        manager = OvernightPilotManager()
        status = await manager.preflight(manager.diversified_paper_configs())

        assert len(backtest_calls) == len(forecast_calls) == len(optimizer_calls) == 3
        assert [(call.symbol, call.strategy_type) for call in optimizer_calls] == [
            ("BTCUSDT", "confluence_ema"),
            ("ETHUSDT", "cvd_absorption"),
            ("SOLUSDT", "cluster_volume_bounce"),
        ]
        optimization = status["sessions"]["BTCUSDT"]["backtest"]["optimization"]
        assert optimization["recommendation"]["meta"]["oos"]["available"] is True
        btc_session = status["sessions"]["BTCUSDT"]
        assert btc_session["preflight_valid"] is True
        assert btc_session["backtest"]["run_context"]["run_id"] == status["preflight_id"]
        assert btc_session["forecast"]["run_context"]["run_id"] == status["preflight_id"]
        assert btc_session["backtest"]["run_context"]["config_fingerprint"] == btc_session["config_fingerprint"]
        assert btc_session["forecast"]["run_context"]["initial_capital"] == btc_session["config"]["initial_capital"]
        assert status["summary"][0]["optimization_status"] == "complete"
        assert status["summary"][0]["optimization_combinations_tested"] == 24
        assert status["summary"][0]["optimization_oos_pnl_pct"] == 1.25
        assert status["sessions"]["ETHUSDT"]["backtest"]["optimization_error"] == "optimizer temporarily unavailable"
        assert status["sessions"]["ETHUSDT"]["backtest"]["optimization"]["status"] == "error"
        assert status["summary"][1]["optimization_status"] == "error"
        assert status["sessions"]["ETHUSDT"]["error"] is None
        assert all(session["paper"] is None for session in status["sessions"].values())

    asyncio.run(scenario())


def test_naked_test_preset_is_a_short_unfiltered_ema_cross_probe():
    configs = OvernightPilotManager.naked_test_configs()

    assert [config.symbol for config in configs] == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    assert {config.strategy_type for config in configs} == {"naked_test"}
    assert all(config.duration_hours == 0.25 for config in configs)
    assert all(config.min_density_usd == 0 and config.volume_multiplier == 0 for config in configs)
    assert all(not config.use_atr_filter and not config.use_cvd_filter and not config.use_oi_filter and not config.use_rsi_filter for config in configs)


def test_pilot_summary_exposes_aggregated_paper_rejection_counts():
    manager = OvernightPilotManager()
    manager.set_preflight("BTCUSDT", {"summary": {"total_trades": 0}, "trades": []}, {"base_scenario": {"direction": "NO_TRADE"}})
    manager.sessions["BTCUSDT"].paper_snapshot = {
        "initial_capital": 1000.0,
        "current_equity": 1000.0,
        "realized_pnl": 0.0,
        "closed_trades": [],
        "rejection_counts": {"ema20_cross": 9, "volume_multiplier": 4},
    }

    status = manager.status()

    assert status["summary"][0]["paper_rejection_counts"] == {"ema20_cross": 9, "volume_multiplier": 4}
    assert status["aggregate"]["paper"]["rejection_counts"] == {"ema20_cross": 9, "volume_multiplier": 4}


def test_pilot_start_gate_reports_a_blocking_preflight_verdict():
    """A red historical verdict is a launch veto, not only a UI decoration."""
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {
            "summary": {"total_trades": 26, "net_pnl_usd": -0.70, "profit_factor": 0.96},
            "trades": [],
        },
        {"data_status": "connected", "market_regime": "FLAT"},
    )

    blocked = manager._blocking_preflight_reasons()

    assert "BTCUSDT" in blocked
    assert "negative" in blocked["BTCUSDT"].lower()


def test_pilot_start_checks_blocking_verdict_before_creating_paper_session():
    """The launch path must honour BLOCK, not only render it in status."""
    source = inspect.getsource(OvernightPilotManager.start)

    assert source.index("blocking_reasons = self._blocking_preflight_reasons()") < source.index(
        "shared_paper_session = PaperTradingSession("
    )
    assert "paper start blocked by preflight verdict" in source


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio.run for isolated pilot orchestration")
def test_autopilot_repreflights_only_allowed_pairs_before_starting_them():
    manager = OvernightPilotManager()
    configs = [
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend"),
        OvernightPilotConfig(symbol="ETHUSDT", strategy_type="ema_trend"),
    ]
    preflight_calls = []
    start_calls = []

    async def fake_preflight(selected):
        preflight_calls.append([config.symbol for config in selected])
        return {"preflight_id": f"pf-{len(preflight_calls)}"}

    async def fake_start(selected, preflight_id=None):
        start_calls.append(([config.symbol for config in selected], preflight_id))
        return {"pilot_running": True}

    manager.preflight = fake_preflight
    manager.start = fake_start
    manager._blocking_preflight_reasons = lambda: {"ETHUSDT": "negative net PnL"} if len(preflight_calls) == 1 else {}

    result = asyncio.run(manager.run_autopilot(configs))

    assert preflight_calls == [["BTCUSDT", "ETHUSDT"], ["BTCUSDT"]]
    assert start_calls == [(["BTCUSDT"], "pf-2")]
    assert result == {
        "started": True,
        "active_symbols": ["BTCUSDT"],
        "excluded_symbols": {"ETHUSDT": "negative net PnL"},
        "preflight_id": "pf-2",
        "result": {"pilot_running": True},
    }


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio.run for isolated pilot orchestration")
def test_autopilot_reports_all_blocked_without_starting_any_runner():
    manager = OvernightPilotManager()
    configs = [OvernightPilotConfig(symbol="BTCUSDT", strategy_type="ema_trend")]
    starts = []

    async def fake_preflight(_selected):
        return {"preflight_id": "pf-1"}

    async def fake_start(*_args, **_kwargs):
        starts.append(True)

    manager.preflight = fake_preflight
    manager.start = fake_start
    manager._blocking_preflight_reasons = lambda: {"BTCUSDT": "negative net PnL"}

    result = asyncio.run(manager.run_autopilot(configs))

    assert starts == []
    assert result == {
        "started": False,
        "active_symbols": [],
        "excluded_symbols": {"BTCUSDT": "negative net PnL"},
        "preflight_id": "pf-1",
        "result": None,
    }


def test_auto_select_route_uses_guarded_autopilot_instead_of_direct_start():
    source = inspect.getsource(overnight_router.auto_select_and_start)

    assert "run_autopilot(configs, demo=req.demo)" in source
    assert "overnight_pilot_manager.stop()" not in source


def test_production_robust_preset_has_fee_aware_geometry_and_neutral_rsi_filter():
    configs = OvernightPilotManager.production_robust_configs()

    assert [config.symbol for config in configs] == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    assert {config.strategy_type for config in configs} == {"confluence_ema"}
    assert all(config.timeframe == "15m" and config.days == 30 for config in configs)
    assert all(config.risk_per_trade_pct == 0.5 and config.leverage == 2.0 for config in configs)
    assert all(config.stop_loss_pct == 0.8 and config.take_profit_pct == 2.2 for config in configs)
    assert all(config.take_profit_pct / config.stop_loss_pct == 2.75 for config in configs)
    assert all(config.min_density_usd == 150000.0 and config.volume_multiplier == 1.25 for config in configs)
    assert all(config.use_atr_filter and config.use_cvd_filter and config.use_rsi_filter for config in configs)
    assert all(not config.use_oi_filter and config.use_multi_tp and config.use_trailing for config in configs)
    assert all(config.trailing_pct == 0.5 for config in configs)


def test_production_robust_live_runner_enforces_neutral_rsi_band_42_58():
    """ROADMAP 1.1: production_robust RSI filter is the neutral 42-58 band for confluence_ema."""
    from backend.app.services.live_paper_runner import LivePaperRunner

    runner = LivePaperRunner()
    runner.strategy_type = "confluence_ema"
    runner.use_rsi_filter = True
    runner.use_atr_filter = False
    runner.use_cvd_filter = False
    runner.use_oi_filter = False

    def passes(rsi: float) -> bool:
        context = {"latest": {"rsi": rsi}, "previous": {"rsi": 50.0}}
        return runner._passes_live_indicator_filters(context, direction=1)

    assert passes(42.0) is True
    assert passes(50.0) is True
    assert passes(58.0) is True
    assert passes(41.9) is False
    assert passes(58.1) is False


def test_pilot_detects_running_sessions_before_restart():
    manager = OvernightPilotManager()
    assert manager._has_running_sessions() is False

    class RunningRunner:
        is_running = True

    manager.sessions["BTCUSDT"] = overnight_module.PilotSession(
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema"),
        runner=RunningRunner(),
    )
    assert manager._has_running_sessions() is True


def test_pilot_status_keeps_backtest_forecast_and_paper_results_separate():
    manager = OvernightPilotManager()
    manager.set_preflight("BTCUSDT", {"roi_pct": 2.1}, {"base_scenario": {"direction": "LONG"}})
    status = manager.status()["sessions"]["BTCUSDT"]
    assert status["backtest"]["roi_pct"] == 2.1
    assert status["forecast"]["base_scenario"]["direction"] == "LONG"
    assert status["paper"] is None
    assert status["session_id"] is None
    assert status["config"]["risk_per_trade_pct"] == 1.0
    assert manager.status()["summary"][0]["backtest_roi_pct"] == 0.0


def test_pilot_status_marks_persisted_non_running_sessions_as_recovery_required():
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {"summary": {"total_trades": 12, "net_pnl_usd": 3.0}, "trades": [], "meta": {"symbol": "BTCUSDT", "timeframe": "15m", "candles": 100}},
        {"data_status": "connected", "base_scenario": {"direction": "NO_TRADE"}},
    )
    manager.sessions["BTCUSDT"].paper_snapshot = {"is_running": False, "data_status": "stale"}

    recovery = manager.status()["recovery"]

    assert recovery == {
        "required": True,
        "reason": "Persisted paper sessions are stopped; run preflight before starting again",
        "session_count": 1,
    }


def test_pilot_summary_exposes_trade_quality_and_no_trade_counts():
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {
            "trades": [{"pnl_usd": 12.5}, {"pnl_usd": -4.0}],
            "summary": {"total_trades": 2, "total_pnl_pct": 0.085},
        },
        {"base_scenario": {"direction": "NO_TRADE"}},
    )
    row = manager.status()["summary"][0]
    assert row["backtest_average_trade_usd"] == 4.25
    assert row["backtest_best_trade_usd"] == 12.5
    assert row["backtest_worst_trade_usd"] == -4.0
    assert row["forecast_no_trade_count"] == 1
    assert row["paper_no_trade_count"] == 0
    assert row["session_id"] is None


def test_pilot_summary_keeps_small_backtest_roi_visible():
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {
            "trades": [{"pnl_usd": 0.10}],
            "summary": {"total_trades": 1, "net_pnl_usd": 0.10, "total_pnl_pct": 0.0},
        },
        {"base_scenario": {"direction": "NO_TRADE"}},
    )

    row = manager.status()["summary"][0]
    assert row["backtest_roi_pct"] == 0.001


def test_pilot_summary_uses_unified_signal_when_base_scenario_has_no_direction():
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {
            "trades": [{"direction": "LONG", "pnl_usd": 1.0}],
            "summary": {"total_trades": 1, "total_pnl_pct": 0.01},
        },
        {
            "base_scenario": {
                "reason": "wait for confirmation",
                "confidence": 0.42,
                "entry": 100.0,
                "stop_loss": 98.0,
                "take_profit": 104.0,
            },
            "unified_signal": {"direction": "LONG"},
        },
    )
    row = manager.status()["summary"][0]
    assert row["forecast_direction"] == "LONG"
    assert row["forecast_no_trade_count"] == 0
    assert row["forecast_backtest_divergence"] is False
    assert row["forecast_reason"] == "wait for confirmation"
    assert row["forecast_confidence"] == 0.42
    assert row["forecast_entry"] == 100.0
    assert row["forecast_stop_loss"] == 98.0
    assert row["forecast_take_profit"] == 104.0


def test_pilot_summary_uses_trading_idea_levels_when_forecast_has_no_base_levels():
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {"trades": [], "summary": {"total_trades": 0}},
        {
            "base_scenario": {"direction": "LONG"},
            "trading_idea": {
                "entry_price": 100.0,
                "sl_price": 98.0,
                "tp1_price": 102.0,
                "tp2_price": 104.0,
                "breakeven_price": 100.1,
                "reasoning": ["EMA confirmation"],
            },
        },
    )

    row = manager.status()["summary"][0]
    assert row["forecast_entry"] == 100.0
    assert row["forecast_stop_loss"] == 98.0
    assert row["forecast_tp1"] == 102.0
    assert row["forecast_tp2"] == 104.0
    assert row["forecast_breakeven"] == 100.1


def test_pilot_status_exposes_separate_aggregate_morning_report():
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {
            "trades": [{"pnl_usd": 20.0}, {"pnl_usd": -5.0}],
            "summary": {
                "total_trades": 2,
                "net_pnl_usd": 15.0,
                "total_pnl_pct": 0.15,
                "max_drawdown_pct": -2.0,
                "win_rate_pct": 50.0,
                "profit_factor": 4.0,
            },
        },
        {"base_scenario": {"direction": "NO_TRADE", "reason": "NO_TRADE: CVD filter blocked the latest bar"}},
    )
    report = manager.status()["aggregate"]
    assert report["backtest"]["net_pnl_usd"] == 15.0
    assert report["backtest"]["trades"] == 2
    assert report["paper"]["net_pnl_usd"] is None
    assert report["forecast"]["no_trade_count"] == 1
    assert report["forecast"]["no_trade_reasons"]["BTCUSDT"]
    assert report["data"]["error_count"] == 0
    assert report["backtest"]["max_drawdown_pct"] == 2.0
    assert report["best_backtest_symbol"] == "BTCUSDT"


def test_pilot_morning_report_exposes_paper_trade_quality():
    manager = OvernightPilotManager()
    manager.set_preflight(
        "BTCUSDT",
        {"summary": {"total_trades": 0}, "trades": []},
        {"base_scenario": {"direction": "NO_TRADE"}},
    )
    manager.sessions["BTCUSDT"].paper_snapshot = {
        "session_id": "paper-btc",
        "is_running": False,
        "initial_capital": 1000.0,
        "current_equity": 1015.0,
        "realized_pnl": 12.0,
        "unrealized_pnl": 3.0,
        "max_drawdown_pct": -1.5,
        "closed_trades_count": 3,
        "closed_trades": [
            {"net_pnl": 20.0, "exit_reason": "Take Profit"},
            {"net_pnl": -8.0, "exit_reason": "Stop Loss"},
            {"net_pnl": 0.0, "exit_reason": "Breakeven"},
        ],
        "data_status": "stale",
        "data_error_count": 0,
        "no_trade_count": 4,
    }

    report = manager.status()

    row = report["summary"][0]
    assert row["paper_win_rate_pct"] == 33.33
    assert row["paper_profit_factor"] == 2.5
    assert row["paper_best_trade_usd"] == 20.0
    assert row["paper_worst_trade_usd"] == -8.0
    assert row["paper_average_trade_usd"] == 4.0
    assert report["aggregate"]["paper"]["win_rate_pct"] == 33.33
    assert report["aggregate"]["paper"]["profit_factor"] == 2.5
    assert report["aggregate"]["paper"]["best_trade_usd"] == 20.0
    assert report["aggregate"]["paper"]["worst_trade_usd"] == -8.0
    assert report["aggregate"]["paper"]["average_risk_pct"] == 1.0
    assert report["aggregate"]["paper"]["max_drawdown_pct"] == 1.5
    assert report["summary"][0]["paper_unrealized_pnl"] == 3.0
    assert report["aggregate"]["paper"]["unrealized_pnl_usd"] == 3.0
    assert report["aggregate"]["paper"]["losing_trade_reasons"] == ["Stop Loss"]


def test_pilot_morning_report_does_not_rank_tied_paper_results():
    sessions = {
        symbol: {
            "config": {"initial_capital": 1000.0, "risk_per_trade_pct": 1.0},
            "paper": {
                "initial_capital": 1000.0,
                "current_equity": 1000.0,
                "realized_pnl": 0.0,
                "closed_trades_count": 0,
                "closed_trades": [],
            },
        }
        for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT")
    }
    rows = [
        {"symbol": symbol, "backtest_net_pnl": 0.0, "paper_pnl": 0.0}
        for symbol in sessions
    ]

    report = overnight_module.OvernightPilotManager._aggregate_report(sessions, rows)

    assert report["best_backtest_symbol"] is None
    assert report["worst_backtest_symbol"] is None
    assert report["best_paper_symbol"] is None
    assert report["worst_paper_symbol"] is None


def test_pilot_morning_report_does_not_rank_open_paper_equity_as_closed_result():
    sessions = {
        "BTCUSDT": {
            "config": {"initial_capital": 1000.0, "risk_per_trade_pct": 1.0},
            "paper": {
                "initial_capital": 1000.0,
                "current_equity": 1015.0,
                "realized_pnl": 0.0,
                "closed_trades_count": 0,
                "closed_trades": [],
            },
        },
        "ETHUSDT": {
            "config": {"initial_capital": 1000.0, "risk_per_trade_pct": 1.0},
            "paper": {
                "initial_capital": 1000.0,
                "current_equity": 1000.0,
                "realized_pnl": 0.0,
                "closed_trades_count": 0,
                "closed_trades": [],
            },
        },
    }
    rows = [
        {"symbol": "BTCUSDT", "backtest_net_pnl": 0.0, "paper_pnl": 0.0, "paper_closed_trades": 0},
        {"symbol": "ETHUSDT", "backtest_net_pnl": 0.0, "paper_pnl": 0.0, "paper_closed_trades": 0},
    ]

    report = overnight_module.OvernightPilotManager._aggregate_report(sessions, rows)

    assert report["best_paper_symbol"] is None
    assert report["worst_paper_symbol"] is None


def test_pilot_session_can_expose_a_persisted_preflight_id_without_paper_state():
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema")
    session = overnight_module.PilotSession(config, session_id="overnight_preflight_btc_123")
    payload = session.to_dict()
    assert payload["session_id"] == "overnight_preflight_btc_123"
    assert payload["paper"] is None


def test_status_endpoint_is_read_only():
    source = inspect.getsource(overnight_router.get_overnight_status)
    assert "persist" not in source


def test_preflight_run_id_is_exposed_and_restore_invalidates_it():
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema")
    session = overnight_module.PilotSession(config, session_id="preflight-btc", run_id="run-123", preflight_valid=True)

    payload = session.to_dict()

    assert payload["run_id"] == "run-123"
    assert payload["preflight_valid"] is True
    session.preflight_valid = False
    assert session.to_dict()["preflight_valid"] is False


def test_preflight_passed_survives_start_consumption():
    """preflight_valid — гейт запуска, сбрасывается в start()/stop() как «потреблённый».
    preflight_passed — результат проверки backtest+forecast; после start() должен
    остаться True, чтобы статус здоровых работающих сессий не выглядел «preflight invalid»
    (ложная тревога ночного теста 23–24.10, P1 «preflight_valid=False»)."""
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema")
    session = overnight_module.PilotSession(config, session_id="overnight_btcusdt_1", run_id="run-123")

    assert session.to_dict()["preflight_passed"] is False

    session.preflight_valid = True
    session.preflight_passed = True
    # start() потребляет гейт: preflight_valid сбрасывается, результат проверки сохраняется
    session.preflight_valid = False
    payload = session.to_dict()
    assert payload["preflight_valid"] is False
    assert payload["preflight_passed"] is True

    # stop() тоже не должен стирать результат проверки
    session.preflight_valid = False
    assert session.to_dict()["preflight_passed"] is True


def test_pilot_start_requires_the_current_preflight_and_exact_configuration():
    config = OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema")
    manager = OvernightPilotManager()
    manager.sessions["BTCUSDT"] = overnight_module.PilotSession(
        config,
        run_id="run-123",
        config_fingerprint=manager._config_fingerprint(config),
        preflight_valid=True,
        backtest={"summary": {"total_trades": 0}, "meta": {"symbol": "BTCUSDT", "timeframe": "15m", "candles": 500}},
        forecast={"data_status": "connected"},
    )

    assert manager._preflight_matches([config], "run-123") is True
    manager.sessions["BTCUSDT"].backtest["meta"]["candles"] = 0
    assert manager._preflight_matches([config], "run-123") is False
    manager.sessions["BTCUSDT"].backtest["meta"]["candles"] = 500
    assert manager._preflight_matches([config.model_copy(update={"risk_per_trade_pct": 2.0})], "run-123") is False
    assert manager._preflight_matches([config], "old-run") is False
    manager.sessions["BTCUSDT"].preflight_valid = False
    assert manager._preflight_matches([config], "run-123") is False


def test_pilot_start_never_rebuilds_a_stale_configuration_implicitly():
    source = inspect.getsource(OvernightPilotManager.start)

    assert "paper start requires the current preflight" in source
    assert "await self._prepare(selected)" not in source


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio.run/socket primitives")
def test_pilot_start_rejects_missing_preflight_without_running_any_runner():
    manager = OvernightPilotManager()

    with pytest.raises(ValueError, match="paper start requires the current preflight"):
        asyncio.run(manager.start([OvernightPilotConfig(symbol="BTCUSDT", strategy_type="confluence_ema")]))


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio.run/socket primitives")
def test_restore_rehydrates_snapshot_as_stale_and_keeps_session_id(monkeypatch):
    class FakeResult:
        def scalars(self):
            return self

        def all(self):
            return [
                type(
                    "PersistedRow",
                    (),
                    {
                        "symbol": "BTCUSDT",
                        "session_id": "overnight_btc_persisted",
                        "config_json": '{"symbol":"BTCUSDT","strategy_type":"confluence_ema"}',
                        "backtest_json": '{"summary":{"total_trades":2},"trades":[]}',
                        "forecast_json": '{"base_scenario":{"direction":"NO_TRADE"}}',
                        "paper_json": '{"is_running":true,"data_status":"connected","current_equity":10000}',
                    },
                )()
            ]

    class FakeDB:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def execute(self, query):
            return FakeResult()

    monkeypatch.setattr(overnight_module, "AsyncSessionLocal", lambda: FakeDB())

    async def scenario():
        manager = overnight_module.OvernightPilotManager()
        await manager.restore()
        session = manager.status()["sessions"]["BTCUSDT"]
        assert session["session_id"] == "overnight_btc_persisted"
        assert session["backtest"]["summary"]["total_trades"] == 2
        assert session["forecast"]["base_scenario"]["direction"] == "NO_TRADE"
        assert session["paper"]["is_running"] is False
        assert session["paper"]["data_status"] == "stale"

    asyncio.run(scenario())


@pytest.mark.anyio
async def test_stop_cancels_forecast_refresh_tasks():
    manager = OvernightPilotManager()
    task = asyncio.create_task(asyncio.sleep(60))
    manager._forecast_tasks["BTCUSDT"] = task
    await manager.stop()
    assert task.cancelled()
    assert manager._forecast_tasks == {}


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio.run/socket primitives")
def test_start_orchestrates_three_independent_sessions_without_real_orders(monkeypatch):
    async def scenario():
        backtest_calls = []
        forecast_calls = []

        async def fake_backtest(request):
            backtest_calls.append(request)
            return {"summary": {"total_trades": 12, "total_pnl_pct": 0.1, "net_pnl_usd": 1.0, "profit_factor": 1.3}, "trades": [],
                    "meta": {"symbol": request.symbol, "timeframe": request.timeframe, "candles": 1500}}

        async def fake_forecast(symbol, timeframe, strategy_type, strategy_params):
            forecast_calls.append((symbol, timeframe, strategy_type, strategy_params))
            return {
                "data_status": "connected",
                "base_scenario": {"direction": "NO_TRADE"},
                "unified_signal": None,
            }

        async def fake_optimizer(request):
            return {"meta": {}, "before_optimization": {}, "after_optimization": {}, "oos": {"available": False}}

        class FakeRunner:
            instances = []

            def __init__(self, session):
                self.session = session
                self.is_running = False
                self.__class__.instances.append(self)

            def start(self, config, *args, **kwargs):
                self.is_running = True
                return self.get_status()

            def stop(self):
                self.is_running = False
                return self.get_status()

            def get_status(self):
                return {
                    "session_id": self.session.session_id,
                    "is_running": self.is_running,
                    "current_equity": self.session.initial_balance,
                    "realized_pnl": 0.0,
                    "data_status": "connected",
                    "data_error_count": 0,
                    "no_trade_count": 0,
                }

        monkeypatch.setattr(overnight_module, "run_backtest", fake_backtest)
        monkeypatch.setattr(overnight_module, "compute_probabilistic_forecast", fake_forecast)
        monkeypatch.setattr(overnight_module, "optimize_backtest", fake_optimizer)
        monkeypatch.setattr(overnight_module, "LivePaperRunner", FakeRunner)

        manager = overnight_module.OvernightPilotManager()
        preflight = await manager.preflight(manager.default_configs())
        status = await manager.start(manager.default_configs(), preflight_id=preflight["preflight_id"])
        assert set(status["sessions"]) == {"BTCUSDT", "ETHUSDT", "SOLUSDT"}
        assert len(backtest_calls) == 3
        assert len(forecast_calls) == 3
        assert len(FakeRunner.instances) == 3
        assert len({row["session_id"] for row in status["sessions"].values()}) == 3
        assert all(row["paper"]["is_running"] for row in status["sessions"].values())
        assert {row["config"]["strategy_type"] for row in status["sessions"].values()} == {
            "confluence_ema", "cvd_absorption", "cluster_volume_bounce"
        }
        await manager.stop()
        assert all(not runner.is_running for runner in FakeRunner.instances)

    asyncio.run(scenario())


@pytest.mark.skipif(sys.platform == "win32", reason="Windows sandbox blocks asyncio.run/socket primitives")
def test_start_keeps_other_paper_sessions_running_when_one_runner_fails(monkeypatch):
    async def scenario():
        async def fake_backtest(request):
            return {"summary": {"total_trades": 12, "total_pnl_pct": 0.1, "net_pnl_usd": 1.0, "profit_factor": 1.3}, "trades": [],
                    "meta": {"symbol": request.symbol, "timeframe": request.timeframe, "candles": 1500}}

        async def fake_forecast(symbol, timeframe, strategy_type, strategy_params):
            return {
                "data_status": "connected",
                "base_scenario": {"direction": "NO_TRADE"},
                "unified_signal": None,
            }

        async def fake_optimizer(request):
            return {"meta": {}, "before_optimization": {}, "after_optimization": {}, "oos": {"available": False}}

        class FailingRunner:
            instances = []

            def __init__(self, session):
                self.session = session
                self.is_running = False
                self.__class__.instances.append(self)

            def start(self, config, *args, **kwargs):
                if config["symbol"] == "ETHUSDT":
                    raise RuntimeError("ETH data source unavailable")
                self.is_running = True
                return self.get_status()

            def stop(self):
                self.is_running = False
                return self.get_status()

            def get_status(self):
                return {
                    "session_id": self.session.session_id,
                    "is_running": self.is_running,
                    "current_equity": self.session.initial_balance,
                    "realized_pnl": 0.0,
                    "data_status": "connected" if self.is_running else "stopped",
                    "data_error_count": 0,
                    "no_trade_count": 0,
                }

        monkeypatch.setattr(overnight_module, "run_backtest", fake_backtest)
        monkeypatch.setattr(overnight_module, "compute_probabilistic_forecast", fake_forecast)
        monkeypatch.setattr(overnight_module, "optimize_backtest", fake_optimizer)
        monkeypatch.setattr(overnight_module, "LivePaperRunner", FailingRunner)

        def fake_create_task(coro, *, name=None):
            coro.close()
            task = asyncio.get_running_loop().create_future()
            task.set_result(None)
            return task

        monkeypatch.setattr(overnight_module.asyncio, "create_task", fake_create_task)

        manager = overnight_module.OvernightPilotManager()
        preflight = await manager.preflight(manager.default_configs())
        status = await manager.start(manager.default_configs(), preflight_id=preflight["preflight_id"])

        assert status["sessions"]["ETHUSDT"]["error"] == "ETH data source unavailable"
        assert status["sessions"]["ETHUSDT"]["paper"]["is_running"] is False
        assert status["sessions"]["BTCUSDT"]["paper"]["is_running"] is True
        assert status["sessions"]["SOLUSDT"]["paper"]["is_running"] is True
        assert status["aggregate"]["data"]["error_count"] == 0

        await manager.stop()

    asyncio.run(scenario())
