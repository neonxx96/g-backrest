"""
Screener & Active Coin Monitoring Router
Provides endpoints to inspect, toggle, and stream real-time background
processing statuses (backtests, data ingestion, forecasting) for monitored coins.
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

import time

from backend.app.engine.background_worker import background_worker

SERVER_START_TIME = time.time()

router = APIRouter(prefix="/api/screener/monitoring", tags=["screener-monitoring"])
system_monitoring_router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])


from backend.app.services.paper_trading import paper_trading_session

def _build_monitoring_payload():
    start = getattr(background_worker, "start_time", SERVER_START_TIME) or SERVER_START_TIME
    uptime = max(0.0, round(time.time() - start, 2))
    return {
        "status": "ok",
        "uptime": uptime,
        "active_workers": 1,
        "monitored_tickers": sorted(list(background_worker.monitored_tickers)),
        "statuses": background_worker.task_statuses,
        "paper_trading": paper_trading_session.get_state().to_dict(),
        "active_tasks_count": len([t for t in background_worker.active_tasks.values() if not t.done()]),
        "max_concurrency": background_worker.max_concurrency
    }


class SetMonitoredTickersRequest(BaseModel):
    tickers: List[str] = Field(..., description="List of uppercase symbols to monitor")


class ToggleTickerRequest(BaseModel):
    ticker: str = Field(..., description="Coin symbol (e.g. BTCUSDT)")
    monitored: bool = Field(..., description="True to monitor, False to stop")


@router.get("")
@router.get("/state")
async def get_monitoring_state():
    """Returns the list of monitored tickers and their latest background analysis statuses."""
    return _build_monitoring_payload()


@system_monitoring_router.get("")
@system_monitoring_router.get("/state")
async def get_system_monitoring_state():
    """Returns system monitoring state including uptime, active workers, statuses, and tickers."""
    return _build_monitoring_payload()


@router.post("")
async def set_monitored_tickers(req: SetMonitoredTickersRequest):
    """Updates the active focus list of coins to monitor."""
    background_worker.set_monitored_tickers(req.tickers)
    return {
        "status": "ok",
        "monitored_tickers": sorted(list(background_worker.monitored_tickers)),
        "count": len(background_worker.monitored_tickers)
    }


@router.post("/toggle")
async def toggle_ticker_monitoring(req: ToggleTickerRequest):
    """Toggles monitoring on or off for a specific coin."""
    background_worker.toggle_ticker(req.ticker, req.monitored)
    return {
        "status": "ok",
        "ticker": req.ticker.upper().strip(),
        "monitored": req.monitored,
        "monitored_tickers": sorted(list(background_worker.monitored_tickers))
    }


@router.websocket("/ws")
async def monitoring_websocket_endpoint(websocket: WebSocket):
    """
    WebSocket streaming endpoint.
    Sends an initial snapshot of all monitored coin statuses, then streams
    live progress updates ('fetching' -> 'backtesting' -> 'forecasting' -> 'completed').
    """
    await websocket.accept()
    await background_worker.register_websocket(websocket)
    try:
        while True:
            # Keep socket alive and handle incoming client commands (e.g., toggle)
            data = await websocket.receive_json()
            cmd = data.get("action")
            if cmd == "toggle":
                ticker = data.get("ticker")
                monitored = data.get("monitored", True)
                if ticker:
                    background_worker.toggle_ticker(ticker, monitored)
            elif cmd == "set_tickers":
                tickers = data.get("tickers", [])
                if isinstance(tickers, list):
                    background_worker.set_monitored_tickers(tickers)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        background_worker.unregister_websocket(websocket)
