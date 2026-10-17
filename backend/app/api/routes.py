"""
FastAPI REST API Routes
Provides endpoints for settings, signals, klines, drawings, and manual scans.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.database import get_db
from backend.app.db.models import UserSetting, SignalHistory, DrawingData
from backend.app.services.binance_service import binance_service
from backend.app.services.scanner import scanner
from backend.app.services.bot import broadcast_signal

router = APIRouter(prefix="/api")

# --- Pydantic Schemas ---

class SettingsSchema(BaseModel):
    user_id: str = "0"
    price_change_min: float = 2.0
    price_change_enabled: bool = True
    oi_change_min: float = 3.0
    oi_change_enabled: bool = True
    liquidation_min_usd: float = 50000.0
    liquidation_enabled: bool = False
    mcap_min_usd: float = 50000000.0
    mcap_max_usd: float = 50000000000.0
    mcap_enabled: bool = False
    timeframe: str = "15m"
    ema_cross_enabled: bool = True
    vol_spike_mult: float = 2.0
    vol_spike_enabled: bool = True
    rsi_min: float = 30.0
    rsi_max: float = 70.0
    rsi_filter_enabled: bool = True
    cvd_divergence_enabled: bool = False
    atr_volatility_min_pct: float = 0.5
    atr_filter_enabled: bool = False
    cooldown_minutes: int = 30
    notifications_enabled: bool = True

class DrawingSaveSchema(BaseModel):
    user_id: str = "0"
    symbol: str
    timeframe: str
    elements_json: str

# --- Endpoints ---

@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "top_symbols_count": len(binance_service.top_symbols),
        "is_ws_connected": binance_service.is_ws_running
    }

@router.get("/settings", response_model=SettingsSchema)
async def get_settings(user_id: str = Query("0"), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    setting = res.scalar_one_or_none()
    if not setting:
        # Fallback to default '0'
        res = await db.execute(select(UserSetting).where(UserSetting.user_id == "0"))
        setting = res.scalar_one_or_none()
        if not setting:
            setting = UserSetting(user_id="0")
            db.add(setting)
            await db.commit()
    return setting

@router.post("/settings", response_model=SettingsSchema)
async def update_settings(payload: SettingsSchema, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(UserSetting).where(UserSetting.user_id == payload.user_id))
    setting = res.scalar_one_or_none()
    
    if not setting:
        setting = UserSetting(user_id=payload.user_id)
        db.add(setting)

    for field, value in payload.model_dump().items():
        setattr(setting, field, value)

    setting.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(setting)
    return setting

@router.get("/signals")
async def get_signals(limit: int = Query(50), db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(SignalHistory).order_by(SignalHistory.created_at.desc()).limit(limit))
    records = res.scalars().all()
    return [
        {
            "id": r.id,
            "symbol": r.symbol,
            "timeframe": r.timeframe,
            "price": r.price,
            "condition_type": r.condition_type,
            "direction": r.direction,
            "description": r.description,
            "created_at": r.created_at.strftime("%Y-%m-%d %H:%M:%S")
        }
        for r in records
    ]

@router.get("/klines")
async def get_klines(symbol: str = Query("BTCUSDT"), timeframe: str = Query("15m"), limit: int = Query(200)):
    try:
        df = await binance_service.fetch_klines(symbol=symbol.upper(), timeframe=timeframe, limit=limit)
        if df.empty:
            return []
        
        # Format for KLineChart: [{ timestamp, open, high, low, close, volume, turnover }]
        klines = []
        for _, row in df.iterrows():
            klines.append({
                "timestamp": int(row['timestamp']),
                "open": float(row['open']),
                "high": float(row['high']),
                "low": float(row['low']),
                "close": float(row['close']),
                "volume": float(row['volume']),
                "turnover": float(row['close'] * row['volume'])
            })
        return klines
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/depth")
async def get_depth(symbol: str = Query("BTCUSDT"), limit: int = Query(20)):
    try:
        return await binance_service.fetch_order_book(symbol=symbol.upper(), limit=limit)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/drawings")
async def get_drawings(symbol: str, timeframe: str, user_id: str = "0", db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(DrawingData).where(
        DrawingData.user_id == user_id,
        DrawingData.symbol == symbol.upper(),
        DrawingData.timeframe == timeframe
    ))
    drawing = res.scalar_one_or_none()
    return {"elements_json": drawing.elements_json if drawing else "[]"}

@router.post("/drawings")
async def save_drawings(payload: DrawingSaveSchema, db: AsyncSession = Depends(get_db)):
    sym = payload.symbol.upper()
    res = await db.execute(select(DrawingData).where(
        DrawingData.user_id == payload.user_id,
        DrawingData.symbol == sym,
        DrawingData.timeframe == payload.timeframe
    ))
    drawing = res.scalar_one_or_none()
    
    if drawing:
        drawing.elements_json = payload.elements_json
        drawing.updated_at = datetime.utcnow()
    else:
        drawing = DrawingData(
            user_id=payload.user_id,
            symbol=sym,
            timeframe=payload.timeframe,
            elements_json=payload.elements_json,
            updated_at=datetime.utcnow()
        )
        db.add(drawing)
        
    await db.commit()
    return {"status": "saved"}

@router.post("/scan")
async def run_scan_now():
    """Manual scan trigger."""
    signals = await scanner.scan_market()
    for sig in signals:
        await broadcast_signal(sig)
    return {"found": len(signals), "signals": signals}
