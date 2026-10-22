"""Recovery tests use controlled transport/clock boundaries, never market prices in production."""
from types import SimpleNamespace
import pytest

from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperTradingSession


def test_feed_outage_backs_off_and_resets_after_valid_data(tmp_path, monkeypatch):
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000))
    runner.intent_logger = DeepIntentLogger(tmp_path / "recovery.jsonl")
    runner.is_running = True
    delays = []
    attempts = 0

    async def tick():
        nonlocal attempts
        attempts += 1
        if attempts <= 6:
            raise OSError("getaddrinfo failed")
        runner._record_feed_success(1_700_000_000_000)
        runner.is_running = False

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(runner, "tick_cycle", tick)
    monkeypatch.setattr("backend.app.services.live_paper_runner.asyncio.sleep", sleep)
    with pytest.raises(StopIteration):
        runner._runner_loop().send(None)
    assert delays == [8, 16, 32, 60, 60, 60, 4]
    assert runner.data_error_count == 6
    assert runner.consecutive_data_errors == 0
    assert runner.reconnect_count == 1


def test_snapshot_freshness_is_checked_at_receipt_after_slow_request(tmp_path, monkeypatch):
    runner = LivePaperRunner(session=PaperTradingSession(initial_balance=1000))
    runner.intent_logger = DeepIntentLogger(tmp_path / "latency.jsonl")
    now = [1_700_000_000.0]
    processed = []

    async def data(_symbol):
        now[0] += 9.0  # Valid exchange response is newer than request-start time.
        return SimpleNamespace(snapshot=SimpleNamespace(price=100.0, timestamp=int(now[0] * 1000), funding_rate=0), orderbook_depth=SimpleNamespace(bids=[], asks=[]))

    monkeypatch.setattr("backend.app.services.live_paper_runner.time.time", lambda: now[0])
    monkeypatch.setattr("backend.app.services.live_paper_runner.market_data_provider.get_unified_data", data)
    monkeypatch.setattr(runner.session, "process_market_tick", lambda *a, **kw: processed.append(kw["timestamp"]))
    monkeypatch.setattr(runner, "_update_open_positions", lambda _price: None)
    monkeypatch.setattr(runner.session, "get_state", lambda: SimpleNamespace(to_dict=lambda: {"balance": 1000, "positions": [{"symbol": runner.symbol}]}))
    with pytest.raises(StopIteration):
        runner.tick_cycle().send(None)
    assert processed == [1_700_000_009_000]
    assert runner.data_error_count == 0
