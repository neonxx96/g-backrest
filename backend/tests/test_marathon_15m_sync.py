"""Contract tests for the background 15m parquet sync of marathon symbols.

The live paper runner (15m) used to read a stale parquet cache because the
background worker refreshed only 5m datasets. The worker now tail-syncs
MARATHON_SYNC_SYMBOLS on 15m once per master cycle via load_dataset_async.
"""

import asyncio
import sys
from unittest.mock import AsyncMock, patch

import pandas as pd

from backend.app.engine.background_worker import (
    BackgroundWorker,
    MARATHON_SYNC_DAYS,
    MARATHON_SYNC_SYMBOLS,
    MARATHON_SYNC_TIMEFRAME,
)

LOADER_TARGET = "backend.app.engine.background_worker.historical_loader"


def _df(rows: int = 3) -> pd.DataFrame:
    return pd.DataFrame({"timestamp": range(rows), "close": [1.0] * rows})


def _run(coro):
    if sys.platform == "win32":
        # All dependencies in these fixtures complete without scheduling.
        # Avoid Windows event-loop socketpair creation in the sandbox.
        try:
            coro.send(None)
        except StopIteration as completed:
            return completed.value
        raise AssertionError("marathon-sync fixture unexpectedly suspended")
    return asyncio.run(coro)


def test_marathon_sync_covers_all_symbols_with_15m():
    async def scenario():
        worker = BackgroundWorker()
        loader_mock = AsyncMock(side_effect=lambda **_: _df())

        with patch(f"{LOADER_TARGET}.load_dataset_async", loader_mock):
            await worker._sync_marathon_history()

        assert loader_mock.await_count == len(MARATHON_SYNC_SYMBOLS)
        seen_symbols = set()
        for call in loader_mock.await_args_list:
            kw = call.kwargs
            assert kw["timeframe"] == MARATHON_SYNC_TIMEFRAME == "15m"
            assert kw["days"] == MARATHON_SYNC_DAYS
            assert kw["force_refresh"] is False
            seen_symbols.add(kw["symbol"])
        assert seen_symbols == set(MARATHON_SYNC_SYMBOLS)

    _run(scenario())


def test_marathon_sync_includes_eth_and_sol_not_just_focus_list():
    # ETHUSDT is NOT in the default 5m focus list but IS a marathon symbol;
    # without the dedicated sync its 15m parquet goes stale.
    assert "ETHUSDT" in MARATHON_SYNC_SYMBOLS
    assert "BTCUSDT" in MARATHON_SYNC_SYMBOLS
    assert "SOLUSDT" in MARATHON_SYNC_SYMBOLS


def test_marathon_sync_failure_of_one_symbol_does_not_block_others():
    async def scenario():
        worker = BackgroundWorker()

        async def flaky_loader(symbol, **_):
            if symbol == "ETHUSDT":
                raise RuntimeError("binance 418")
            return _df()

        loader_mock = AsyncMock(side_effect=flaky_loader)
        with patch(f"{LOADER_TARGET}.load_dataset_async", loader_mock):
            # Must not raise despite ETHUSDT failing.
            await worker._sync_marathon_history()

        attempted = [c.kwargs["symbol"] for c in loader_mock.await_args_list]
        assert attempted == list(MARATHON_SYNC_SYMBOLS)

    _run(scenario())


def test_master_cycle_invokes_marathon_sync_once():
    async def scenario():
        worker = BackgroundWorker(cycle_interval_sec=0)
        worker._running = True

        async def sync_and_stop():
            worker._running = False  # end the loop after the first cycle

        sync_mock = AsyncMock(side_effect=sync_and_stop)

        with patch.object(BackgroundWorker, "_sync_marathon_history", sync_mock), patch.object(
            BackgroundWorker, "auto_optimize_strategies", AsyncMock(return_value={})
        ), patch.object(BackgroundWorker, "_process_ticker_safely", AsyncMock()), patch(
            "backend.app.engine.background_worker.asyncio.sleep", new=AsyncMock()
        ):
            # Empty monitoring set keeps the gather block instant.
            worker.monitored_tickers = set()
            if sys.platform == "win32":
                await worker._run_periodic_loop()
            else:
                await asyncio.wait_for(worker._run_periodic_loop(), timeout=5)

        assert sync_mock.await_count == 1

    _run(scenario())
