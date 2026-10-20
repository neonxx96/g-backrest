from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperTradingSession
from backend.app.services.overnight_pilot import OvernightPilotManager


def test_deep_intent_logger_appends_machine_readable_events(tmp_path):
    logger = DeepIntentLogger(path=tmp_path / "deep_intent_log.jsonl")

    logger.record(
        intent="SKIPPED",
        symbol="BTCUSDT",
        session_id="paper-test",
        reason="RSI 62 is outside the configured 42-58 band",
        context={"rsi": 62.0, "volume_ratio": 0.8},
    )

    events = logger.read_recent(limit=5)
    assert len(events) == 1
    assert events[0]["intent"] == "SKIPPED"
    assert events[0]["symbol"] == "BTCUSDT"
    assert events[0]["context"]["rsi"] == 62.0


def test_optimal_live_preset_allocates_1000_and_five_dollar_risk_budget():
    configs = OvernightPilotManager.optimal_live_configs()

    assert [config.symbol for config in configs] == ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    assert all(config.initial_capital == 1000.0 for config in configs)
    assert all(config.risk_per_trade_pct == 0.5 for config in configs)
    assert all(config.initial_capital * config.risk_per_trade_pct / 100.0 == 5.0 for config in configs)
    assert all(config.volume_multiplier == 1.2 for config in configs)
    assert all(config.stop_loss_pct == 0.8 and config.take_profit_pct == 2.2 for config in configs)
    assert all(config.use_trailing and config.trailing_pct == 0.5 for config in configs)
    assert all(config.trailing_activation_pct == 0.5 for config in configs)


def test_live_runner_writes_skip_management_and_close_intents(tmp_path):
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0, session_id="intent-runner"))
    runner.intent_logger = DeepIntentLogger(path=tmp_path / "deep_intent_log.jsonl")
    runner.symbol = "BTCUSDT"
    runner._record_no_entry({
        "reason": "NO_TRADE: filters blocked",
        "failed_checks": ["rsi_filter"],
        "rejections": [{"filter": "rsi_filter", "actual": 62.0, "operator": "within", "threshold": [42.0, 58.0]}],
        "observed": {"rsi": 62.0, "volume_ratio": 0.8},
    })
    runner._record_management_intent("BREAKEVEN", "Price reached +0.5R", {"new_stop_price": 101.0})
    runner.session.closed_trades.append({"symbol": "BTCUSDT", "reason": "TAKE_PROFIT", "net_pnl": 4.25, "fee_drag": 0.10})
    runner._record_new_closed_intents(0)

    intents = [event["intent"] for event in runner.intent_logger.read_recent(limit=10)]
    assert intents == ["SKIPPED", "MANAGED", "CLOSED"]
