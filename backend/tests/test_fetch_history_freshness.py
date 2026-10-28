"""Regression tests for fetch_history require_fresh freshness gate.

Bug (марафон 23.10.2026): fetch_history unconditionally returned the local
Parquet cache, but only 5m caches are refreshed by the background worker.
The 15m marathon frames were ~41h stale, so the paper runner's indicator
freshness gate rejected every evaluation (evaluations=0, data_quality_count
growing). Live consumers must be able to demand a fresh frame.
"""

import time
from unittest.mock import patch

import pandas as pd
import pytest

from backend.app.routers.backtest import fetch_history

TF_MS = 15 * 60 * 1000


def _frame_15m(ending_ago_ms: int, rows: int = 200) -> pd.DataFrame:
    now_ms = int(time.time() * 1000)
    end = now_ms - ending_ago_ms
    start = end - (rows - 1) * TF_MS
    ts = [start + i * TF_MS for i in range(rows)]
    close = [50_000.0 + i for i in range(rows)]
    return pd.DataFrame({
        "timestamp": ts,
        "open": close,
        "high": [c + 10 for c in close],
        "low": [c - 10 for c in close],
        "close": close,
        "volume": [100.0] * rows,
        "taker_buy_base_volume": [60.0] * rows,
        "delta": [20.0] * rows,
    })


STALE_FRAME = _frame_15m(ending_ago_ms=41 * 60 * 60 * 1000)   # ~41h old tail
FRESH_FRAME = _frame_15m(ending_ago_ms=TF_MS)                 # last candle just closed


class _FailingSession:
    """Simulates an unreachable exchange for the network fallback path."""

    def get(self, *args, **kwargs):
        raise ConnectionError("network unreachable in test")


async def _failing_get_session():
    return _FailingSession()


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def test_stale_parquet_returned_when_freshness_not_required():
    """Backtests stay bounded by the recorded period: stale Parquet is valid."""
    with patch("backend.app.routers.backtest._read_cached_history", return_value=STALE_FRAME.copy()), \
         patch("backend.app.routers.backtest.binance_service.adapter.get_session", new=_failing_get_session):
        df = _run(fetch_history("BTCUSDT", "15m", days=2))

    assert not df.empty
    assert int(df["timestamp"].max()) == int(STALE_FRAME["timestamp"].max())


def test_stale_parquet_skipped_when_require_fresh():
    """Live path must NOT silently consume a stale Parquet tail (regression)."""
    with patch("backend.app.routers.backtest._read_cached_history", return_value=STALE_FRAME.copy()), \
         patch("backend.app.routers.backtest.binance_service.adapter.get_session", new=_failing_get_session):
        df = _run(fetch_history("BTCUSDT", "15m", days=2, require_fresh=True))

    # Network unavailable in test → empty frame, but never the stale Parquet.
    assert df.empty


def test_fresh_parquet_returned_when_require_fresh():
    """A fresh Parquet tail is still served from cache for live consumers."""
    with patch("backend.app.routers.backtest._read_cached_history", return_value=FRESH_FRAME.copy()), \
         patch("backend.app.routers.backtest.binance_service.adapter.get_session", new=_failing_get_session):
        df = _run(fetch_history("BTCUSDT", "15m", days=2, require_fresh=True))

    assert not df.empty
    assert int(df["timestamp"].max()) == int(FRESH_FRAME["timestamp"].max())


def test_fetch_history_excludes_an_open_candle_from_historical_consumers():
    """The latest in-progress kline must not leak into backtest or forecast."""
    frame = _frame_15m(ending_ago_ms=0)
    expected_last_closed = int(frame["timestamp"].iloc[-2])

    with patch("backend.app.routers.backtest._read_cached_history", return_value=frame.copy()):
        df = _run(fetch_history("CLOSEDUSDT", "15m", days=3))

    assert int(df["timestamp"].max()) == expected_last_closed


def test_in_memory_cache_not_poisoned_by_stale_frame_when_require_fresh():
    """A stale in-memory entry must not be served to a require_fresh caller."""
    key = ("BTCUSDT", "15m", 2, True)
    from backend.app.routers import backtest as bt
    bt._HISTORY_CACHE[key] = (time.time(), STALE_FRAME.copy())
    try:
        with patch("backend.app.routers.backtest._read_cached_history", return_value=STALE_FRAME.copy()), \
             patch("backend.app.routers.backtest.binance_service.adapter.get_session", new=_failing_get_session):
            df = _run(fetch_history("BTCUSDT", "15m", days=2, require_fresh=True))
        assert df.empty
    finally:
        bt._HISTORY_CACHE.pop(key, None)
