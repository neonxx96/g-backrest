"""Regression tests for virtual order admission and reserved risk."""

import asyncio
import time
from types import SimpleNamespace

import pytest

from backend.app.services.execution_simulator import OrderStatus
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.services.paper_trading import PaperTradingSession


def test_pending_entry_blocks_second_entry_for_same_symbol():
    session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.005)
    first = session.place_order(
        "SOLUSDT", "BUY", "LIMIT", 100.0, 5.0,
        stop_price=99.0, target_price=102.0, signal_ts=1000,
    )
    assert first["status"] == "PENDING"

    with pytest.raises(ValueError, match="entry_already_working"):
        session.place_order(
            "SOLUSDT", "BUY", "LIMIT", 100.0, 5.0,
            stop_price=99.0, target_price=102.0, signal_ts=1030,
        )
    assert len(session.orders) == 1


def test_runner_does_not_resubmit_signal_from_same_closed_candle(monkeypatch):
    session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.005)
    runner = LivePaperRunner(session=session)
    runner.symbol = "SOLUSDT"
    runner.initial_capital = 1000.0
    runner.risk_per_trade_pct = 0.5
    runner.leverage = 2.0
    runner.indicator_candle_close_time = int(time.time() * 1000) - 30_000
    runner.indicator_last_update = runner.indicator_candle_close_time - 300_000
    snapshot = SimpleNamespace(timestamp=int(time.time() * 1000), price=100.0, funding_rate=0.0)
    data = SimpleNamespace(
        snapshot=snapshot,
        orderbook_depth=SimpleNamespace(bids=[], asks=[], depth_deltas={}),
    )

    async def get_data(_symbol):
        snapshot.timestamp = int(time.time() * 1000)
        return data

    async def indicators():
        return {"frame": object()}

    async def signal(_data, _indicators):
        return {
            "direction": "LONG", "entry_price": 100.0, "sl": 99.0,
            "tp1": 102.0, "tp2": 102.8, "expected_rr": 2.0,
            "reason": ["test signal"],
        }

    monkeypatch.setattr("backend.app.services.live_paper_runner.market_data_provider.get_unified_data", get_data)
    monkeypatch.setattr(runner, "_validate_market_snapshot", lambda *_: (True, None, None))
    monkeypatch.setattr(runner, "_indicators_are_fresh", lambda *_: True)
    monkeypatch.setattr(runner, "_load_indicator_context", indicators)
    monkeypatch.setattr(runner, "_detect_setup", signal)
    monkeypatch.setattr(runner, "_record_event", lambda *_, **__: None)

    asyncio.run(runner.tick_cycle())
    assert len(session.orders) == 1
    first = next(iter(session.orders.values()))
    # A completed/cancelled order does not itself block admission. The
    # closed-candle token must still prevent a second decision on that candle.
    first.sim.state.status = OrderStatus.CANCELLED
    runner._last_signal_time = 0
    asyncio.run(runner.tick_cycle())
    assert len(session.orders) == 1
