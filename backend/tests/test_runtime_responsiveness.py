import asyncio
import threading
import time
from unittest.mock import patch

import pandas as pd

from backend.app.routers import backtest as backtest_router
from backend.app.routers.overnight_pilot import get_overnight_status
from backend.app.routers.overnight_pilot import get_pairs_status
from backend.app.routers.monitoring import get_system_monitoring_state
from backend.app.routers.paper_trading_router import (
    get_live_paper_status,
    get_paper_trading_status,
)
from backend.app.services.live_paper_runner import LivePaperRunner


def _closed_frame(rows: int = 100) -> pd.DataFrame:
    end = int(time.time() * 1000) - 10 * 60_000
    timestamps = [end - (rows - index) * 5 * 60_000 for index in range(rows)]
    return pd.DataFrame(
        {
            "timestamp": timestamps,
            "open": [100.0] * rows,
            "high": [101.0] * rows,
            "low": [99.0] * rows,
            "close": [100.5] * rows,
            "volume": [10.0] * rows,
            "taker_buy_base_volume": [6.0] * rows,
            "delta": [2.0] * rows,
        }
    )


def test_fetch_history_reads_parquet_off_event_loop_thread():
    loop_thread = threading.get_ident()
    read_threads = []
    frame = _closed_frame()

    def read_cached(*_args):
        read_threads.append(threading.get_ident())
        return frame.copy()

    backtest_router._HISTORY_CACHE.clear()
    with patch.object(backtest_router, "_read_cached_history", side_effect=read_cached):
        result = asyncio.run(backtest_router.fetch_history("BTCUSDT", "5m", 1))

    assert not result.empty
    assert read_threads and read_threads[0] != loop_thread


def test_live_runner_calculates_indicators_off_event_loop_thread():
    loop_thread = threading.get_ident()
    calculation_threads = []
    frame = _closed_frame()
    runner = object.__new__(LivePaperRunner)
    runner._indicator_context = None
    runner._indicator_context_at = 0.0
    runner.symbol = "BTCUSDT"
    runner.timeframe = "5m"
    runner.initial_capital = 1_000.0
    runner.data_status = "connected"
    runner.indicator_data_status = "disconnected"
    runner.last_data_error = None
    runner._record_event = lambda *_args, **_kwargs: None
    runner._record_feed_failure = lambda *_args, **_kwargs: None
    runner._add_log = lambda *_args, **_kwargs: None

    async def fetch_history(*_args, **_kwargs):
        return frame.copy()

    def calculate(_self, source):
        calculation_threads.append(threading.get_ident())
        return source.copy()

    with patch.object(backtest_router, "fetch_history", new=fetch_history), patch(
        "backend.app.services.orderflow_backtester.OrderFlowBacktester.calculate_indicators",
        new=calculate,
    ):
        context = asyncio.run(runner._load_indicator_context())

    assert context is not None
    assert calculation_threads and calculation_threads[0] != loop_thread


def test_overnight_status_report_is_built_off_event_loop_thread():
    loop_thread = threading.get_ident()
    report_threads = []

    def status():
        report_threads.append(threading.get_ident())
        return {"status": "ok"}

    with patch(
        "backend.app.routers.overnight_pilot.overnight_pilot_manager.status",
        side_effect=status,
    ):
        result = asyncio.run(get_overnight_status())

    assert result == {"status": "ok"}
    assert report_threads and report_threads[0] != loop_thread


def test_ui_polling_payloads_are_built_off_event_loop_thread():
    loop_thread = threading.get_ident()
    worker_threads = []

    class _State:
        @staticmethod
        def to_dict():
            worker_threads.append(threading.get_ident())
            return {"balance": 100.0}

    def monitor_payload():
        worker_threads.append(threading.get_ident())
        return {"status": "ok"}

    def unified_status():
        worker_threads.append(threading.get_ident())
        return {"is_running": True}

    def pairs():
        worker_threads.append(threading.get_ident())
        return [{"symbol": "BTCUSDT"}]

    with patch("backend.app.routers.monitoring._build_monitoring_payload", side_effect=monitor_payload), patch(
        "backend.app.routers.paper_trading_router.paper_trading_session.get_state",
        return_value=_State(),
    ), patch(
        "backend.app.services.overnight_pilot.overnight_pilot_manager.get_unified_live_runner_status",
        side_effect=unified_status,
    ), patch(
        "backend.app.routers.overnight_pilot.overnight_pilot_manager.get_pairs",
        side_effect=pairs,
    ):
        monitoring = asyncio.run(get_system_monitoring_state())
        paper = asyncio.run(get_paper_trading_status())
        live = asyncio.run(get_live_paper_status())
        pair_status = asyncio.run(get_pairs_status())

    assert monitoring == {"status": "ok"}
    assert paper["balance"] == 100.0
    assert live["runner"] == {"is_running": True}
    assert pair_status == {"pairs": [{"symbol": "BTCUSDT"}]}
    assert len(worker_threads) == 4
    assert all(thread_id != loop_thread for thread_id in worker_threads)

