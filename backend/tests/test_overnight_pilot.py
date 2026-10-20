import pytest
import asyncio
import sys

import backend.app.services.overnight_pilot as overnight_module
from backend.app.services.overnight_pilot import OvernightPilotConfig, OvernightPilotManager


def test_pilot_config_rejects_unknown_strategy_and_limits_three_sessions():
    with pytest.raises(ValueError):
        OvernightPilotConfig(symbol="BTCUSDT", strategy_type="live_density_bounce")
    manager = OvernightPilotManager()
    assert len(manager.default_configs()) == 3
    assert manager.default_configs()[0].duration_hours == 24.0


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
            return {"summary": {"total_trades": 0, "total_pnl_pct": 0.0}, "trades": []}

        async def fake_forecast(symbol, timeframe, strategy_type, strategy_params):
            forecast_calls.append((symbol, timeframe, strategy_type, strategy_params))
            return {
                "data_status": "connected",
                "base_scenario": {"direction": "NO_TRADE"},
                "unified_signal": None,
            }

        class FakeRunner:
            instances = []

            def __init__(self, session):
                self.session = session
                self.is_running = False
                self.__class__.instances.append(self)

            def start(self, config):
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
        monkeypatch.setattr(overnight_module, "LivePaperRunner", FakeRunner)

        manager = overnight_module.OvernightPilotManager()
        status = await manager.start(manager.default_configs())
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
            return {"summary": {"total_trades": 0, "total_pnl_pct": 0.0}, "trades": []}

        async def fake_forecast(symbol, timeframe, strategy_type, strategy_params):
            return {
                "data_status": "connected",
                "base_scenario": {"direction": "NO_TRADE"},
                "unified_signal": None,
            }

        class FailingRunner:
            instances = []

            def __init__(self, session):
                self.session = session
                self.is_running = False
                self.__class__.instances.append(self)

            def start(self, config):
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
        monkeypatch.setattr(overnight_module, "LivePaperRunner", FailingRunner)

        def fake_create_task(coro, *, name=None):
            coro.close()
            task = asyncio.get_running_loop().create_future()
            task.set_result(None)
            return task

        monkeypatch.setattr(overnight_module.asyncio, "create_task", fake_create_task)

        manager = overnight_module.OvernightPilotManager()
        status = await manager.start(manager.default_configs())

        assert status["sessions"]["ETHUSDT"]["error"] == "ETH data source unavailable"
        assert status["sessions"]["ETHUSDT"]["paper"]["is_running"] is False
        assert status["sessions"]["BTCUSDT"]["paper"]["is_running"] is True
        assert status["sessions"]["SOLUSDT"]["paper"]["is_running"] is True
        assert status["aggregate"]["data"]["error_count"] == 0

        await manager.stop()

    asyncio.run(scenario())
