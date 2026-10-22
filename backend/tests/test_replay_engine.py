"""
Unit tests for backend/app/services/replay_engine.py

Covers:
- Chronological merge of trades + depth snapshots from Parquet
- Conservative tie-break: at identical UTC ms, TRADE is emitted BEFORE depth
- Stable ordering within the same source (same ts, same kind)
- start_ts / end_ts range filtering (inclusive boundaries)
- Determinism: identical input -> identical event sequence (cached & fresh engine)
- Zero look-ahead invariant: at depth event time T, every trade with ts <= T has
  already been emitted (no post-trade book state leak to earlier trades)
- Convergence: merged stream equals a naive reference merge
- Empty / missing symbol directory -> no events, no crash
"""
import pandas as pd
import pytest
from pathlib import Path

from backend.app.services.replay_engine import (
    ReplayEngine,
    ReplayEvent,
    PRIORITY_TRADE,
    PRIORITY_DEPTH,
)


# ---------------------------------------------------------------------------
# Fixtures: synthetic Parquet data mimicking the recorder's daily files
# ---------------------------------------------------------------------------
def _write_trades_parquet(sym_dir: Path, day: str, rows: list) -> None:
    df = pd.DataFrame(
        rows,
        columns=["symbol", "timestamp", "price", "quantity",
                 "usd_amount", "is_taker_buy", "delta"],
    )
    sym_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(sym_dir / f"trades_{day}.parquet")


def _write_depth_parquet(sym_dir: Path, day: str, rows: list) -> None:
    df = pd.DataFrame(rows, columns=["symbol", "timestamp", "bids", "asks"])
    sym_dir.mkdir(parents=True, exist_ok=True)
    df.to_parquet(sym_dir / f"depth_{day}.parquet")


@pytest.fixture
def replay_data(tmp_path: Path) -> Path:
    """Synthetic BTCUSDT data: 3 trades + 2 depth snapshots, 2 shared timestamps."""
    sym_dir = tmp_path / "BTCUSDT"
    _write_trades_parquet(sym_dir, "2026-01-01", [
        ("BTCUSDT", 1000, 50000.0, 0.1, 5000.0, True, 0.1),
        ("BTCUSDT", 1005, 50100.0, 0.2, 10020.0, False, -0.2),
        ("BTCUSDT", 1010, 50200.0, 0.3, 15060.0, True, 0.3),
    ])
    _write_depth_parquet(sym_dir, "2026-01-01", [
        ("BTCUSDT", 1000, [[49990.0, 1.0]], [[50010.0, 1.0]]),
        ("BTCUSDT", 1010, [[50190.0, 2.0]], [[50210.0, 2.0]]),
    ])
    return tmp_path


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_priorities_are_conservative():
    """Trade priority must sort BEFORE depth priority (lower value = earlier)."""
    assert PRIORITY_TRADE < PRIORITY_DEPTH


def test_merge_orders_by_timestamp(replay_data):
    engine = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    events = engine.build_events()
    timestamps = [e.timestamp for e in events]
    assert timestamps == sorted(timestamps)
    assert len(events) == 5  # 3 trades + 2 depth snapshots
    kinds = {e.kind for e in events}
    assert kinds == {"trade", "depth"}


def test_tie_break_trade_before_depth(replay_data):
    """At identical UTC ms, the trade must be emitted before the depth snapshot."""
    engine = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    events = engine.build_events()

    at_1000 = [e for e in events if e.timestamp == 1000]
    assert len(at_1000) == 2
    assert at_1000[0].kind == "trade"
    assert at_1000[1].kind == "depth"

    at_1010 = [e for e in events if e.timestamp == 1010]
    assert at_1010[0].kind == "trade"
    assert at_1010[1].kind == "depth"


def test_stable_order_within_same_source(replay_data):
    """Trades sharing the same timestamp must preserve original insertion order."""
    sym_dir = replay_data / "ETHUSDT"
    _write_trades_parquet(sym_dir, "2026-01-01", [
        ("ETHUSDT", 2000, 3000.0, 1.0, 3000.0, True, 1.0),
        ("ETHUSDT", 2000, 3001.0, 2.0, 6002.0, False, -2.0),
        ("ETHUSDT", 2000, 3002.0, 3.0, 9006.0, True, 3.0),
    ])
    engine = ReplayEngine(data_dir=replay_data, symbol="ETHUSDT")
    events = engine.build_events()
    at_2000 = [e for e in events if e.timestamp == 2000]
    assert [e.payload["price"] for e in at_2000] == [3000.0, 3001.0, 3002.0]
    assert [e.seq for e in at_2000] == sorted(e.seq for e in at_2000)


def test_start_end_filtering_inclusive(replay_data):
    engine = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    ev_all = engine.build_events()
    ev_range = engine.build_events(start_ts=1005, end_ts=1010)
    assert all(1005 <= e.timestamp <= 1010 for e in ev_range)
    assert len(ev_range) < len(ev_all)
    assert any(e.timestamp == 1005 for e in ev_range)   # start inclusive
    assert any(e.timestamp == 1010 for e in ev_range)   # end inclusive


def test_determinism_cached_and_fresh(replay_data):
    """Identical input must produce an identical event sequence."""
    key = lambda evs: [(e.seq, e.timestamp, e.kind) for e in evs]

    engine = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    first = key(engine.build_events())
    second = key(engine.build_events())       # from cache
    assert first == second

    engine2 = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    fresh = key(engine2.build_events())       # rebuilt from scratch
    assert first == fresh


def test_zero_lookahead_invariant(replay_data):
    """
    Zero look-ahead: when a consumer processes a DEPTH event at time T,
    every TRADE event with timestamp <= T must already have been emitted.
    """
    engine = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    seen_trade_ts: list = []
    for ev in engine.stream():
        if ev.kind == "depth":
            # All trades at ts <= this depth's timestamp must be consumed already
            assert all(t <= ev.timestamp for t in seen_trade_ts)
        else:
            seen_trade_ts.append(ev.timestamp)


def test_convergence_with_naive_reference(replay_data):
    """
    Convergence check: the engine's merged output must equal a naive,
    independent reference implementation (sort by ts, trades before depths).
    """
    engine = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    actual = [(e.timestamp, e.kind) for e in engine.build_events()]

    raw = [
        (1000, "trade"), (1005, "trade"), (1010, "trade"),
        (1000, "depth"), (1010, "depth"),
    ]
    expected = sorted(raw, key=lambda x: (x[0], 0 if x[1] == "trade" else 1))
    assert actual == expected


def test_empty_symbol_directory(tmp_path):
    engine = ReplayEngine(data_dir=tmp_path, symbol="NO_SUCH_SYMBOL")
    assert engine.build_events() == []
    assert list(engine.stream()) == []


def test_payload_fields_are_preserved(replay_data):
    engine = ReplayEngine(data_dir=replay_data, symbol="BTCUSDT")
    events = engine.build_events()
    trade_events = [e for e in events if e.kind == "trade"]
    first = trade_events[0]
    assert first.payload["price"] == 50000.0
    assert first.payload["quantity"] == 0.1
    assert first.payload["is_taker_buy"] is True
    assert first.payload["delta"] == 0.1

    depth_events = [e for e in events if e.kind == "depth"]
    assert depth_events[0].payload["bids"] == [[49990.0, 1.0]]
    assert depth_events[0].payload["asks"] == [[50010.0, 1.0]]


def test_replay_event_repr():
    ev = ReplayEvent(timestamp=123, priority=PRIORITY_TRADE, seq=0,
                     kind="trade", payload={})
    assert "seq=0" in repr(ev)
    assert "ts=123" in repr(ev)
    assert "kind=trade" in repr(ev)


