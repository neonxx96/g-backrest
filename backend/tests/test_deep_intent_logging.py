from datetime import datetime

import pytest

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


def test_record_event_writes_versioned_identity_and_unique_id(tmp_path):
    logger = DeepIntentLogger(path=tmp_path / "events.jsonl")
    values = {
        "event_type": "DECISION_SKIPPED",
        "source": "paper",
        "symbol": "btcusdt",
        "reason_code": "RSI_OUT_OF_RANGE",
        "reason": "RSI 62 is above 58",
        "run_id": "run-1",
        "session_id": "paper-1",
        "config_fingerprint": "abc123",
        "strategy": "confluence_ema",
        "timeframe": "15m",
        "checks": [{"name": "rsi_filter", "actual": 62, "operator": "<=", "threshold": 58}],
        "observed": {"rsi": 62},
        "trade_id": None,
        "payload": {"candle_close_time": 900000},
    }

    first = logger.record_event(**values)
    second = logger.record_event(**values)
    decoded_timestamp = datetime.fromisoformat(first["timestamp"])

    assert first["schema_version"] == 1
    assert first["event_id"] != second["event_id"]
    assert decoded_timestamp.utcoffset().total_seconds() == 0
    assert first["source"] == "paper"
    assert first["run_id"] == "run-1"
    assert first["config_fingerprint"] == "abc123"
    assert first["symbol"] == "BTCUSDT"
    assert first["checks"][0]["actual"] == 62
    assert first["payload"]["candle_close_time"] == 900000
    assert len((tmp_path / "events.jsonl").read_text(encoding="utf-8").splitlines()) == 2


def test_read_recent_skips_malformed_rows_labels_legacy_and_filters(tmp_path):
    path = tmp_path / "events.jsonl"
    logger = DeepIntentLogger(path=path)
    logger.record(
        intent="SKIPPED",
        symbol="ETHUSDT",
        session_id="legacy-session",
        reason="old row",
        context={"rsi": 62},
    )
    logger.record_event(
        event_type="DECISION_SKIPPED",
        source="paper",
        symbol="BTCUSDT",
        reason_code="LOW_VOLUME",
        reason="volume ratio is too low",
        run_id="run-btc",
        session_id="paper-btc",
        config_fingerprint="fp-btc",
        strategy="confluence_ema",
        timeframe="5m",
        checks=[],
        observed={},
        trade_id=None,
        payload={},
    )
    with path.open("a", encoding="utf-8") as stream:
        stream.write("not valid json\n")

    recent = logger.read_recent(limit=10)
    scoped = logger.read_recent(limit=10, run_id="run-btc", symbol="btcusdt", source="paper")

    assert len(recent) == 2
    assert recent[0]["source"] == "legacy"
    assert recent[0]["run_id"] is None
    assert recent[1]["event_type"] == "DECISION_SKIPPED"
    assert len(scoped) == 1
    assert scoped[0]["run_id"] == "run-btc"


def test_record_event_surfaces_disk_write_failure(tmp_path, monkeypatch):
    logger = DeepIntentLogger(path=tmp_path / "events.jsonl")
    original_open = type(logger.path).open

    def fail_only_target(path, *args, **kwargs):
        if path == logger.path:
            raise OSError("disk is read-only")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(type(logger.path), "open", fail_only_target)

    with pytest.raises(OSError, match="disk is read-only"):
        logger.record_event(
            event_type="RUN_STARTED",
            source="system",
            symbol="BTCUSDT",
            reason_code="RUN_STARTED",
            reason="paper run started",
            run_id="run-1",
            session_id="paper-1",
            config_fingerprint="fp-1",
            strategy="confluence_ema",
            timeframe="15m",
            checks=[],
            observed={},
            trade_id=None,
            payload={},
        )


def test_paper_runner_events_are_correlated_to_run_and_configuration(tmp_path):
    from backend.app.services.deep_intent_logger import DeepIntentLogger
    from backend.app.services.live_paper_runner import LivePaperRunner
    from backend.app.services.paper_trading import PaperTradingSession

    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0))
    runner.intent_logger = DeepIntentLogger(tmp_path / "runner.jsonl")
    status = runner.start(
        {"symbol": "BTCUSDT", "timeframe": "5m", "strategy_type": "confluence_ema"},
        run_id="run-7",
        config_fingerprint="fingerprint-7",
    )
    assert status["run_id"] == "run-7"
    assert status["config_fingerprint"] == "fingerprint-7"

    runner._last_tick_time = 123456
    runner.indicator_candle_close_time = 1_700_000_300_000
    runner._record_no_entry({
        "reason": "RSI blocked",
        "failed_checks": ["rsi_filter"],
        "rejections": [{"filter": "rsi_filter", "actual": 62, "operator": "<=", "threshold": 58}],
        "observed": {"rsi": 62},
    })
    runner.stop()

    events = runner.intent_logger.read_recent(10)
    assert [event["event_type"] for event in events] == ["RUN_STARTED", "DECISION_SKIPPED", "RUN_STOPPED"]
    assert all(event["run_id"] == "run-7" for event in events)
    assert all(event["config_fingerprint"] == "fingerprint-7" for event in events)
    skipped = events[1]
    assert skipped["reason_code"] == "RSI_FILTER"
    assert skipped["checks"] == ["rsi_filter"]
    assert skipped["observed"] == {"rsi": 62}


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
    runner.indicator_candle_close_time = 1_700_000_300_000
    runner._record_no_entry({
        "reason": "NO_TRADE: filters blocked",
        "failed_checks": ["rsi_filter"],
        "rejections": [{"filter": "rsi_filter", "actual": 62.0, "operator": "within", "threshold": [42.0, 58.0]}],
        "observed": {"rsi": 62.0, "volume_ratio": 0.8},
    })
    runner._record_management_intent("BREAKEVEN", "Price reached +0.5R", {"new_stop_price": 101.0})
    runner.session.closed_trades.append({"symbol": "BTCUSDT", "reason": "TAKE_PROFIT", "net_pnl": 4.25, "fee_drag": 0.10})
    runner._record_new_closed_intents(0)

    events = runner.intent_logger.read_recent(limit=10)
    assert [event["event_type"] for event in events] == [
        "DECISION_SKIPPED", "POSITION_UPDATED", "POSITION_CLOSED",
    ]
    assert events[0]["reason_code"] == "RSI_FILTER"
    assert events[1]["payload"]["action"] == "BREAKEVEN"
    assert events[2]["payload"]["net_pnl"] == 4.25


def test_paper_run_lifecycle_links_events_and_closed_trade_accounting(tmp_path):
    from backend.app.services.deep_intent_logger import DeepIntentLogger
    from backend.app.services.live_paper_runner import LivePaperRunner
    from backend.app.services.paper_trading import PaperTradingSession
    from backend.app.services.execution import PaperSandboxProvider

    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0, session_id="lifecycle-session"))
    runner.intent_logger = DeepIntentLogger(tmp_path / "lifecycle.jsonl")
    runner.start(
        {"symbol": "BTCUSDT", "timeframe": "5m", "strategy_type": "confluence_ema", "risk_per_trade_pct": 0.5},
        run_id="lifecycle-run",
        config_fingerprint="lifecycle-fingerprint",
    )
    runner.indicator_candle_close_time = 1_700_000_300_000
    runner._record_no_entry({
        "reason": "RSI blocked",
        "failed_checks": ["rsi_filter"],
        "rejections": [{"filter": "rsi_filter", "actual": 62, "operator": "within", "threshold": [42, 58]}],
        "observed": {"rsi": 62},
    })

    provider = PaperSandboxProvider(initial_balance=1000.0, default_leverage=2.0)
    provider.open_position("BTCUSDT", "LONG", entry_price=100.0, quantity=0.1)
    trade_id = "BTCUSDT:1700000300000"
    runner._active_trade_ids["BTCUSDT"] = trade_id
    runner._record_event(
        "POSITION_OPENED", "SIGNAL_ACCEPTED", "EMA cross confirmed", trade_id=trade_id,
        payload={"entry_price": 100.0, "risk_budget_usdt": 5.0},
    )
    trade = provider.close_position("BTCUSDT", 110.0)
    runner.session.closed_trades.append({
        "symbol": trade.symbol,
        "entry_price": trade.entry_price,
        "exit_price": trade.exit_price,
        "gross_pnl": trade.gross_pnl,
        "fee_drag": trade.total_fees,
        "net_pnl": trade.net_pnl,
        "reason": "TAKE_PROFIT",
    })
    runner._record_new_closed_intents(0)
    runner.stop()

    events = runner.intent_logger.read_recent(20, run_id="lifecycle-run")
    lifecycle = [event for event in events if event["trade_id"] == trade_id]
    assert [event["event_type"] for event in lifecycle] == ["POSITION_OPENED", "POSITION_CLOSED"]
    assert all(event["run_id"] == "lifecycle-run" for event in events)
    assert all(event["config_fingerprint"] == "lifecycle-fingerprint" for event in events)
    closed = lifecycle[-1]["payload"]
    assert closed["gross_pnl"] == pytest.approx(trade.gross_pnl)
    assert closed["net_pnl"] == pytest.approx(trade.net_pnl)
    assert closed["net_pnl"] == pytest.approx(closed["gross_pnl"] - closed["total_fees"])


def test_paper_rejection_counts_once_per_closed_candle_and_per_filter(tmp_path):
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0, session_id="counter-run"))
    runner.intent_logger = DeepIntentLogger(path=tmp_path / "counter.jsonl")
    runner.run_id = "run-counter"
    runner.config_fingerprint = "fp-counter"
    runner.timeframe = "5m"
    runner.indicator_candle_close_time = 1_700_000_300_000

    diagnostic = {
        "reason": "NO_TRADE: filters blocked",
        "failed_checks": ["rsi_filter", "volume_multiplier"],
        "rejections": [
            {"filter": "rsi_filter", "actual": 62, "operator": "within", "threshold": [42, 58]},
            {"filter": "volume_multiplier", "actual": 0.8, "operator": ">=", "threshold": 1.2},
        ],
        "observed": {"rsi": 62, "volume_ratio": 0.8},
    }
    runner.indicator_candle_close_time = 1_700_000_300_000
    runner._record_no_entry(diagnostic)
    runner._record_no_entry(diagnostic)
    first = runner.get_status()
    assert first["evaluations"] == 1
    assert first["blocked_evaluations"] == 1
    assert first["filter_rejection_total"] == 2
    assert first["rejection_counts"] == {"rsi_filter": 1, "volume_multiplier": 1}

    runner.indicator_candle_close_time += 300_000
    runner._record_no_entry(diagnostic)
    second = runner.get_status()
    assert second["evaluations"] == 2
    assert second["blocked_evaluations"] == 2
    assert second["filter_rejection_total"] == 4


def test_paper_data_quality_rejection_does_not_pollute_strategy_filter_counts(tmp_path):
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0, session_id="data-run"))
    runner.intent_logger = DeepIntentLogger(path=tmp_path / "data.jsonl")
    runner.indicator_candle_close_time = 1_700_000_300_000
    runner._record_no_entry({
        "reason": "OHLCV integrity failed",
        "failed_checks": ["data_integrity"],
        "rejections": [{"filter": "data_integrity", "actual": "NaN close", "operator": "valid", "threshold": True}],
        "observed": {},
    })
    status = runner.get_status()
    assert status["evaluations"] == 0
    assert status["blocked_evaluations"] == 0
    assert status["filter_rejection_total"] == 0
    assert status["rejection_counts"] == {}
    event = runner.intent_logger.read_recent(1)[0]
    assert event["reason_code"] == "DATA_INTEGRITY"


def test_live_runner_excludes_currently_forming_candle_from_signal_history():
    import pandas as pd

    frame = pd.DataFrame({"timestamp": [0, 300_000, 600_000], "close": [100, 101, 102]})
    closed = LivePaperRunner._closed_candle_history(frame, "5m", now_ms=899_999)
    assert closed["timestamp"].tolist() == [0, 300_000]

    at_boundary = LivePaperRunner._closed_candle_history(frame, "5m", now_ms=900_000)
    assert at_boundary["timestamp"].tolist() == [0, 300_000, 600_000]
