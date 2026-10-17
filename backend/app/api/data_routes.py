"""
Data Management, Storage Quota & Backtest API Routes
"""

import os
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.app.services.recorder import recorder
from backend.app.services.binance_service import binance_service
from backend.app.services.orderflow_backtester import orderflow_backtester

data_router = APIRouter(prefix="/api")

class RecorderConfigSchema(BaseModel):
    is_recording: Optional[bool] = None
    max_storage_gb: Optional[float] = None
    focus_symbols: Optional[List[str]] = None
    watchlist_symbols: Optional[List[str]] = None

class BacktestRequestSchema(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "15m"
    days: int = 14
    strategy_type: str = "confluence_ema" # "confluence_ema" | "delta_absorption" | "density_bounce"
    initial_capital: float = 10000.0
    leverage: float = 1.0
    take_profit_pct: float = 1.5
    stop_loss_pct: float = 0.8
    use_trailing: bool = True
    trailing_pct: float = 0.5

@data_router.get("/recorder/status")
async def get_recorder_status():
    """Returns recorder active status, 100GB storage usage, and stats."""
    return recorder.get_storage_stats()

@data_router.post("/recorder/config")
async def update_recorder_config(payload: RecorderConfigSchema):
    """Updates focus symbols, storage limits, or toggle recording."""
    if payload.max_storage_gb is not None:
        recorder.max_storage_gb = payload.max_storage_gb

    if payload.focus_symbols is not None:
        recorder.focus_symbols = [s.strip().upper() for s in payload.focus_symbols if s.strip()]
        # Reset and reload socket stream if running
        if recorder.is_running:
            await recorder.stop()
            await recorder.start()

    if payload.watchlist_symbols is not None:
        recorder.watchlist_symbols = [s.strip().upper() for s in payload.watchlist_symbols if s.strip()]

    if payload.is_recording is not None:
        if payload.is_recording and not recorder.is_running:
            await recorder.start()
        elif not payload.is_recording and recorder.is_running:
            await recorder.stop()

    return recorder.get_storage_stats()

@data_router.get("/recorder/clusters")
async def get_clusters(symbol: str = Query("BTCUSDT"), limit: int = Query(30)):
    """Returns footprint clusters (price buckets with buy/sell volume and delta)."""
    return recorder.get_clusters_for_chart(symbol=symbol.upper(), limit_candles=limit)

@data_router.get("/recorder/export")
async def export_recorded_data(symbol: Optional[str] = None):
    """Packages recorded Parquet data into a ZIP archive for local download."""
    try:
        zip_path = recorder.export_dataset_zip(symbol=symbol)
        if not zip_path.exists():
            raise HTTPException(status_code=404, detail="No recorded data found for export")
        
        return FileResponse(
            path=str(zip_path),
            filename=zip_path.name,
            media_type="application/zip"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export data: {str(e)}")

# NOTE: POST /api/backtest/run now lives in backend/app/routers/backtest.py
