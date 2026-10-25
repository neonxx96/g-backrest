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
async def get_clusters(
    symbol: str = Query("BTCUSDT"),
    limit: int = Query(30, ge=1, le=100),
    scale: float = Query(1.0, ge=1.0, le=50.0, description="Price bucket multiplier (1x, 2x, 5x, 10x)"),
    imbalance_ratio: float = Query(3.0, ge=1.2, le=10.0, description="Imbalance threshold ratio (e.g. 3.0 = 300%)"),
    stacked_min: int = Query(3, ge=2, le=10, description="Minimum consecutive levels for stacked imbalance"),
):
    """Returns footprint clusters (price buckets with buy/sell volume, delta, POC, Value Area and imbalance)."""
    return recorder.get_clusters_for_chart(
        symbol=symbol.upper(),
        limit_candles=limit,
        scale=scale,
        imbalance_ratio=imbalance_ratio,
        stacked_min=stacked_min,
    )

@data_router.get("/profile/tpo")
async def get_tpo_profile(
    symbol: str = Query("BTCUSDT"),
    date: Optional[str] = Query(None, description="YYYY-MM-DD; default — today (UTC)"),
    tick_size: Optional[float] = Query(None, description="Price bucket; default — auto (~200 rows)"),
    period_minutes: int = Query(30, ge=1),
    value_area: float = Query(0.70, gt=0, le=1),
):
    """TPO / Volume Profile (SRS M1.2a): TPOC/TVAH/TVAL + POC/VAH/VAL из записанных
    aggTrades. При отсутствии принтов — poc/tpoc/VA-границы = null (ничего не синтезируется)."""
    from datetime import datetime, timezone

    from backend.app.services import tpo_profile as tpo

    sym = symbol.upper()
    date_str = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    trades = tpo.load_recorded_trades(recorder.data_dir, sym, date_str)
    if trades is None:
        profile = tpo.build_tpo_profile(
            None, symbol=sym, date=date_str, tick_size=tick_size or 1.0,
            period_minutes=period_minutes, value_area_fraction=value_area,
        )
    else:
        effective_tick = tick_size or tpo.infer_tick_size(trades["price"])
        profile = tpo.build_tpo_profile(
            trades, symbol=sym, date=date_str, tick_size=effective_tick,
            period_minutes=period_minutes, value_area_fraction=value_area,
        )
    payload = profile.to_dict()
    payload["available_dates"] = tpo.list_recorded_dates(recorder.data_dir, sym)
    return payload

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
