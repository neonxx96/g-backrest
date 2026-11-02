from unittest.mock import patch

from backend.app.services.recorder import OrderFlowRecorder


def _recent_trade(trade_id: int) -> dict:
    return {
        "id": trade_id,
        "price": "65000.0",
        "qty": "0.01",
        "isBuyerMaker": False,
        "time": 1_800_000 + trade_id,
    }


def _run_immediate(coroutine):
    """Drive a coroutine whose test doubles never suspend (Windows sandbox-safe)."""
    try:
        coroutine.send(None)
    except StopIteration as completed:
        return completed.value
    raise AssertionError("test coroutine unexpectedly suspended")


def test_duplicate_aggregate_trade_id_is_ignored():
    recorder = OrderFlowRecorder()

    first = recorder.record_agg_trade(
        "BTCUSDT", 65_000.0, 0.01, False, 1_800_001, trade_id=42
    )
    duplicate = recorder.record_agg_trade(
        "BTCUSDT", 65_000.0, 0.01, False, 1_800_001, trade_id=42
    )

    assert first is True
    assert duplicate is False
    assert recorder.total_trades_recorded == 1
    assert recorder.last_trade_ids == {"BTCUSDT": 42}


class _FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def json(self):
        return self._payload

    async def text(self):
        return str(self._payload)


class _FakeSession:
    def __init__(self, pages):
        self.pages = list(pages)
        self.params = []
        self.urls = []

    def get(self, url, params):
        self.urls.append(url)
        self.params.append(dict(params))
        return _FakeResponse(self.pages.pop(0))


def test_backfill_paginates_from_last_id_through_live_boundary():
    recorder = OrderFlowRecorder()
    recorder.last_trade_ids["BTCUSDT"] = 100
    recent = [_recent_trade(trade_id) for trade_id in range(101, 1100)]
    session = _FakeSession([recent])

    recovered = _run_immediate(
        recorder._backfill_symbol(
            session, "BTCUSDT", through_id=1099, through_time_ms=1_801_099
        )
    )

    assert recovered == 999
    assert recorder.last_trade_ids["BTCUSDT"] == 1099
    assert session.params == [
        {"symbol": "BTCUSDT", "limit": 1000},
    ]
    assert session.urls[0].endswith("/fapi/v1/trades")


def test_flush_runs_off_loop_and_preserves_new_arrivals():
    recorder = OrderFlowRecorder()
    recorder.trade_buffer.append({"trade_id": 1})
    flushed_ids = []

    def snapshot_flush(trades, _depth):
        flushed_ids.extend(item["trade_id"] for item in trades)
        recorder.record_agg_trade(
            "BTCUSDT", 65_001.0, 0.02, False, 1_800_002, trade_id=2
        )

    async def immediate_to_thread(function, *args):
        function(*args)

    recorder._flush_snapshot = snapshot_flush

    with patch("backend.app.services.recorder.asyncio.to_thread", new=immediate_to_thread):
        _run_immediate(recorder._flush_once())

    assert flushed_ids == [1]
    assert [item["trade_id"] for item in recorder.trade_buffer] == [2]


def test_schedule_flush_reuses_active_task():
    recorder = OrderFlowRecorder()

    class _ActiveTask:
        @staticmethod
        def done():
            return False

    active = _ActiveTask()
    recorder.flush_task = active

    assert recorder._schedule_flush() is active

