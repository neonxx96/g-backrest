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


def test_pending_limit_reserves_margin_and_full_trade_risk():
    session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.005)
    order = session.place_order(
        "SOLUSDT", "BUY", "LIMIT", 100.0, 5.0,
        stop_price=99.0, target_price=102.0, leverage=2.0, signal_ts=1000,
    )
    state = session.get_state()
    assert order["status"] == "PENDING"
    assert state.available_margin == pytest.approx(750.0)
    assert state.locked_margin == pytest.approx(250.0)
    assert state.reserved_margin == pytest.approx(250.0)
    assert state.reserved_risk == pytest.approx(5.0)
    assert state.balance == pytest.approx(1000.0)


def test_direct_entry_cannot_exceed_position_risk_or_free_margin():
    session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.005)
    with pytest.raises(ValueError, match="risk_budget_exceeded"):
        session.place_order("SOLUSDT", "BUY", "LIMIT", 100.0, 6.0, stop_price=99.0, signal_ts=1000)
    with pytest.raises(ValueError, match="insufficient_margin"):
        session.place_order("SOLUSDT", "BUY", "LIMIT", 300.0, 5.0, stop_price=299.0, signal_ts=1000)
    assert session.orders == {}
    assert session.available_margin == pytest.approx(1000.0)


def test_partial_fill_transfers_only_filled_reservation_and_cancel_releases_rest():
    session = PaperTradingSession(
        initial_balance=1000.0, risk_per_trade_pct=0.005,
        signal_lag_ms=0, order_rtt_ms=0,
    )
    order = session.place_order(
        "SOLUSDT", "BUY", "LIMIT", 100.0, 5.0,
        stop_price=99.0, target_price=102.0, leverage=2.0, signal_ts=1000,
    )
    session.process_event(SimpleNamespace(
        timestamp=1000, kind="depth", symbol="SOLUSDT",
        payload={"bids": [(99.9, 5.0)], "asks": [(101.0, 5.0)]},
    ))
    # Supply a real trade print with exactly 2 contracts; this exercises the
    # partial-fill accounting without relying on the live tick adapter's volume.
    session.process_event(SimpleNamespace(
        timestamp=1001, kind="trade", symbol="SOLUSDT",
        payload={"price": 100.0, "quantity": 2.0},
    ))
    state = session.get_state()
    assert state.positions[0]["qty"] == pytest.approx(2.0)
    assert state.positions[0]["risk_amount"] == pytest.approx(2.0)
    assert state.reserved_risk == pytest.approx(3.0)
    assert state.reserved_margin == pytest.approx(150.0)
    assert state.locked_margin == pytest.approx(250.0)

    session.cancel_order(order["order_id"])
    state = session.get_state()
    assert state.available_margin == pytest.approx(900.0)
    assert state.locked_margin == pytest.approx(100.0)
    assert state.reserved_margin == pytest.approx(0.0)
    assert state.reserved_risk == pytest.approx(0.0)
    assert state.positions[0]["qty"] == pytest.approx(2.0)


def test_rejected_entry_releases_reserved_margin():
    session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.005,
                                  signal_lag_ms=0, order_rtt_ms=0)
    session.place_order("SOLUSDT", "BUY", "LIMIT", 100.0, 5.0,
                        stop_price=99.0, leverage=2.0, signal_ts=1000)
    # Crossing the ask makes a post-only simulated limit order unplaceable.
    session.process_event(SimpleNamespace(
        timestamp=1000, kind="depth", symbol="SOLUSDT",
        payload={"bids": [(99.9, 5.0)], "asks": [(100.0, 5.0)]},
    ))
    state = session.get_state()
    assert state.active_orders == []
    assert state.available_margin == pytest.approx(1000.0)
    assert state.locked_margin == pytest.approx(0.0)
    assert state.reserved_risk == pytest.approx(0.0)


def test_kill_switch_releases_pending_and_filled_margin_at_leverage():
    session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.005,
                                  signal_lag_ms=0, order_rtt_ms=0)
    session.place_order("SOLUSDT", "BUY", "LIMIT", 100.0, 5.0,
                        stop_price=99.0, leverage=2.0, signal_ts=1000)
    session.process_event(SimpleNamespace(
        timestamp=1000, kind="depth", symbol="SOLUSDT",
        payload={"bids": [(99.9, 5.0)], "asks": [(101.0, 5.0)]},
    ))
    session.process_event(SimpleNamespace(
        timestamp=1001, kind="trade", symbol="SOLUSDT",
        payload={"price": 100.0, "quantity": 2.0},
    ))
    result = session.kill_switch("test stop")
    state = session.get_state()
    assert result["cancelled_orders"] == 1
    assert result["closed_positions"] == 1
    assert state.reserved_margin == pytest.approx(0.0)
    assert state.locked_margin == pytest.approx(0.0)
    assert state.available_margin == pytest.approx(state.balance)
    assert state.balance == pytest.approx(1000.0 - 2 * 100 * (session.maker_fee + session.taker_fee))


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
    events = []
    monkeypatch.setattr(runner, "_record_event", lambda *args, **kwargs: events.append((args, kwargs)))

    asyncio.run(runner.tick_cycle())
    assert len(session.orders) == 1
    entry_event = next(kwargs for args, kwargs in events if args[0] == "POSITION_OPENED")
    assert entry_event["payload"]["risk_budget_usdt"] == pytest.approx(5.0)
    first = next(iter(session.orders.values()))
    # A completed/cancelled order does not itself block admission. The
    # closed-candle token must still prevent a second decision on that candle.
    first.sim.state.status = OrderStatus.CANCELLED
    runner._last_signal_time = 0
    asyncio.run(runner.tick_cycle())
    assert len(session.orders) == 1
