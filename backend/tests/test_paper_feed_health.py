from types import SimpleNamespace

import pytest

from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperPosition, PaperTradingSession


def make_runner(tmp_path):
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000.0, session_id="feed-health"))
    runner.intent_logger = DeepIntentLogger(tmp_path / "feed.jsonl")
    runner.run_id = "feed-run"
    runner.config_fingerprint = "feed-config"
    return runner


def test_feed_error_counter_records_failure_and_fresh_recovery(tmp_path):
    runner = make_runner(tmp_path)
    runner._record_feed_failure("TRANSPORT_ERROR", "socket timed out", source="transport")
    runner._record_feed_failure("TRANSPORT_ERROR", "socket timed out", source="transport")
    failed = runner.get_status()
    assert failed["data_status"] == "disconnected"
    assert failed["data_error_count"] == 2
    assert failed["consecutive_data_errors"] == 2
    assert failed["last_data_error"] == "socket timed out"
    assert failed["last_data_error_at"] is not None

    runner._record_feed_success(1_700_000_000_000)
    recovered = runner.get_status()
    assert recovered["data_status"] == "connected"
    assert recovered["consecutive_data_errors"] == 0
    assert recovered["last_successful_data_at"] is not None
    assert recovered["reconnect_count"] == 1


def test_invalid_and_stale_market_snapshots_are_rejected():
    runner = LivePaperRunner()
    now = 1_700_000_100_000
    invalid = SimpleNamespace(price=float("nan"), timestamp=now)
    stale = SimpleNamespace(price=100.0, timestamp=now - 60_000)
    assert runner._validate_market_snapshot(invalid, now)[0] is False
    assert runner._validate_market_snapshot(stale, now)[0] is False
    assert runner._validate_market_snapshot(SimpleNamespace(price=100.0, timestamp=now), now)[0] is True


def test_invalid_live_price_does_not_manage_an_open_position(tmp_path, monkeypatch):
    runner = make_runner(tmp_path)
    runner.session.positions["BTCUSDT"] = PaperPosition(symbol="BTCUSDT", side="LONG", qty=1.0, avg_entry_price=100.0)
    called = {"market_tick": 0, "manage": 0}
    runner.session.process_market_tick = lambda *args, **kwargs: called.__setitem__("market_tick", called["market_tick"] + 1)
    runner._update_open_positions = lambda price: called.__setitem__("manage", called["manage"] + 1)

    async def invalid_data(_symbol):
        return SimpleNamespace(snapshot=SimpleNamespace(price=0.0, timestamp=int(__import__("time").time() * 1000)))

    monkeypatch.setattr("backend.app.services.live_paper_runner.market_data_provider.get_unified_data", invalid_data)
    cycle = runner.tick_cycle()
    with pytest.raises(StopIteration):
        cycle.send(None)
    assert called == {"market_tick": 0, "manage": 0}
    assert runner.get_status()["data_error_count"] == 1


def test_transport_connected_with_stale_indicators_is_not_entry_ready():
    runner = LivePaperRunner()
    runner.data_status = "connected"
    runner.indicator_data_status = "connected"
    runner.indicator_candle_close_time = 1_700_000_000_000
    assert runner._indicators_are_fresh(1_700_001_000_000) is False


def test_telemetry_write_failure_degrades_telemetry_without_changing_trade_state(tmp_path, monkeypatch):
    runner = make_runner(tmp_path)
    monkeypatch.setattr(runner.intent_logger, "record_event", lambda **_kwargs: (_ for _ in ()).throw(OSError("disk full")))
    runner._record_event("DECISION_SKIPPED", "RSI_FILTER", "blocked")
    status = runner.get_status()
    assert status["telemetry_status"] == "degraded"
    assert status["evaluations"] == 0
    assert status["filter_rejection_total"] == 0
