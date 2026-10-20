import pytest
from backend.app.services.openrouter_client import openrouter_client
from backend.app.services.live_paper_runner import LivePaperRunner, live_paper_runner, PAPER_HISTORICAL_STRATEGIES
from backend.app.services.paper_trading import PaperPosition, PaperTradingSession, paper_trading_session


@pytest.mark.anyio
async def test_openrouter_client_fallback_logic(monkeypatch):
    # This contract test must remain offline even when a developer .env has a key.
    monkeypatch.setattr(openrouter_client, "api_key", "")
    # Setup with good R:R and favorable depth delta -> CONFIRM
    setup = {
        "direction": "LONG",
        "entry_price": 80000.0,
        "stop_loss": 79000.0,
        "take_profit": 83000.0,
        "rr_ratio": 3.0,
        "reason": "Bounce off bid wall $1.2M",
    }
    snapshot = {
        "price": 80000.0,
        "depth_delta_pct": 18.5,
        "strongest_magnet": "SHORTS_ABOVE",
        "funding_rate": 0.0001,
        "atr": 300.0,
    }
    eval_res = await openrouter_client.evaluate_trade_risk("BTCUSDT", setup, snapshot)
    assert eval_res["veto"] is False
    assert eval_res["verdict"] == "CONFIRM"
    assert "Квант-фильтр" in eval_res["reason"]

    # Setup with poor R:R (< 1.5) -> VETO
    bad_rr_setup = {
        "direction": "LONG",
        "entry_price": 80000.0,
        "stop_loss": 79500.0,
        "take_profit": 80300.0,
        "rr_ratio": 0.6,
        "reason": "Scalp",
    }
    eval_bad_rr = await openrouter_client.evaluate_trade_risk("BTCUSDT", bad_rr_setup, snapshot)
    assert eval_bad_rr["veto"] is True
    assert eval_bad_rr["verdict"] == "VETO"

    # Setup with adverse depth delta opposing direction -> VETO
    adverse_delta_snapshot = {
        "price": 80000.0,
        "depth_delta_pct": -35.0,  # heavy ask pressure against long
        "strongest_magnet": "LONGS_BELOW",
        "funding_rate": 0.0001,
        "atr": 300.0,
    }
    eval_adverse = await openrouter_client.evaluate_trade_risk("BTCUSDT", setup, adverse_delta_snapshot)
    assert eval_adverse["veto"] is True
    assert eval_adverse["verdict"] == "VETO"


def test_live_paper_runner_start_stop_lifecycle():
    config = {
        "symbol": "BTCUSDT",
        "strategy_type": "live_density_bounce",
        "initial_capital": 10000.0,
        "risk_per_trade_pct": 1.0,
        "min_density_usd": 500000.0,
        "ai_control": True,
        "stop_loss_pct": 0.8,
        "take_profit_pct": 1.6,
        "leverage": 2.0,
    }

    start_res = live_paper_runner.start(config)
    assert start_res["is_running"] is True
    assert start_res["symbol"] == "BTCUSDT"
    assert start_res["initial_capital"] == 10000.0
    assert start_res["ai_control"] is True
    assert len(start_res["equity_curve"]) >= 1
    assert live_paper_runner.session.risk_per_trade_pct == pytest.approx(0.01)
    assert any("Deep Intent Logging: ACTIVE" in item["message"] for item in start_res["logs"])

    status = live_paper_runner.get_status()
    assert status["is_running"] is True
    assert status["current_equity"] >= 0

    stop_res = live_paper_runner.stop()
    assert stop_res["is_running"] is False


def test_live_runner_reuses_historical_filter_contract():
    runner = LivePaperRunner()
    runner.use_atr_filter = True
    runner.use_cvd_filter = True
    runner.use_oi_filter = True
    runner.use_rsi_filter = True
    context = {
        "previous": {"close": 100.0, "cvd": 10.0, "rsi": 35.0},
        "latest": {
            "atr": 1.0,
            "atr_ema20": 1.0,
            "delta": 2.0,
            "cvd": 12.0,
            "cvd_ema14": 11.0,
            "low": 99.0,
            "low_min6": 99.0,
            "cvd_min6": 11.0,
            "close": 101.0,
            "oi_delta": 1.0,
            "rsi": 40.0,
        },
    }
    assert runner._passes_live_indicator_filters(context, 1) is True
    context["latest"]["oi_delta"] = -1.0
    assert runner._passes_live_indicator_filters(context, 1) is False


def test_live_runner_routes_diagnostics_lenient_through_historical_signal_adapter():
    assert "diagnostics_lenient" in PAPER_HISTORICAL_STRATEGIES


def test_live_runner_trailing_stop_only_tightens_an_open_long_position():
    runner = LivePaperRunner()
    runner.symbol = "BTCUSDT"
    runner.use_trailing = True
    runner.trailing_pct = 0.5
    runner.session.positions["BTCUSDT"] = PaperPosition(
        symbol="BTCUSDT",
        side="LONG",
        qty=1.0,
        avg_entry_price=100.0,
        stop_price=99.0,
        initial_stop_price=99.0,
        target_price=200.0,
    )

    runner._update_open_positions(102.0)

    assert runner.session.positions["BTCUSDT"].stop_price == pytest.approx(101.49)


def test_live_runner_trailing_waits_for_configured_activation_threshold():
    session = PaperTradingSession(initial_balance=1000.0, session_id="trailing-activation")
    runner = LivePaperRunner(session=session)
    runner.start({"symbol": "BTCUSDT", "use_trailing": True, "trailing_pct": 0.5, "trailing_activation_pct": 0.5})
    session.positions["BTCUSDT"] = PaperPosition(
        symbol="BTCUSDT", side="LONG", qty=1.0, avg_entry_price=100.0,
        stop_price=99.2, initial_stop_price=99.2, target_price=102.2,
    )

    runner._update_open_positions(100.3)

    assert session.positions["BTCUSDT"].stop_price == pytest.approx(99.2)


def test_live_runner_status_exposes_margin_and_funding_accounting():
    session = PaperTradingSession(initial_balance=1000.0, session_id="status-contract")
    runner = LivePaperRunner(session=session)
    runner.start({"symbol": "BTCUSDT", "initial_capital": 1000.0, "duration_hours": 1.0})
    runner._last_funding_rate = 0.0001

    status = runner.get_status()

    assert status["available_margin"] == pytest.approx(1000.0)
    assert status["used_margin"] == pytest.approx(0.0)
    assert status["funding_rate"] == pytest.approx(0.0001)
    assert status["closed_trades"] == []
    assert status["last_decision_reason"] is None
    assert status["last_decision_checks"] == []
    assert status["started_at"] is not None
    assert status["duration_remaining_seconds"] is not None
    assert status["duration_remaining_seconds"] > 0
    runner.stop()


def test_live_runner_records_structured_no_entry_reason(caplog):
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0, session_id="trace-contract"))
    diagnostic = {
        "reason": "NO_TRADE: не пройдены условия — volume_multiplier",
        "failed_checks": ["volume_multiplier"],
        "rejections": [
            {"filter": "volume_multiplier", "actual": 0.2, "operator": ">=", "threshold": 0.5}
        ],
        "observed": {"close": 100.0},
    }

    with caplog.at_level("INFO", logger="SignalScript.LivePaperRunner"):
        runner._record_no_entry(diagnostic)

    assert runner.logs[0]["category"] == "NO_ENTRY"
    assert "volume_multiplier (0.20 < 0.50)" in runner.logs[0]["message"]
    assert runner.logs[0]["meta"]["rejections"] == diagnostic["rejections"]
    assert "Blocked by: volume_multiplier (0.20 < 0.50)" in caplog.text


def test_live_runner_aggregates_rejection_counts_for_runtime_telemetry():
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0, session_id="rejection-counts"))
    diagnostic = {
        "reason": "NO_TRADE",
        "failed_checks": ["ema20_cross", "volume_multiplier"],
        "rejections": [
            {"filter": "ema20_cross", "actual": 99.0, "operator": "crosses", "threshold": 100.0},
            {"filter": "volume_multiplier", "actual": 0.2, "operator": ">=", "threshold": 1.25},
        ],
    }

    runner._record_no_entry(diagnostic)
    runner._record_no_entry(diagnostic)

    assert runner.get_status()["rejection_counts"] == {"ema20_cross": 1, "volume_multiplier": 1}
