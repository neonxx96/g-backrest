"""
FastAPI REST API Routes
Provides endpoints for settings, signals, klines, drawings, and manual scans.
"""

import json
from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.database import get_db
from backend.app.db.models import UserSetting, SignalHistory, DrawingData, LiquidationEvent
from backend.app.services.binance_service import binance_service
from backend.app.services.scanner import scanner
from backend.app.services.recorder import recorder
from backend.app.services.indicators.registry import registry
from backend.app.services.bot import broadcast_signal
from backend.app.utils import format_kyiv

router = APIRouter(prefix="/api")

# --- Pydantic Schemas ---

class SettingsSchema(BaseModel):
    user_id: str = "0"
    price_change_min: float = 2.5
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

    # Stage 3 additions
    heatmap_enabled: bool = True
    heatmap_min_usd: float = 100000.0
    storage_max_gb: float = 100.0
    storage_retention_days: int = 14
    storage_path: str = "data/recorded"
    normalization_mode: str = "raw"
    coin_overrides: str = "{}"
    orderbook_levels: int = 20
    orderbook_volume_mode: str = "both"
    orderbook_tick_scale: float = 1.0
    theme: str = "tealstreet"
    ui_config: str = "{}"

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

class SignalCreateSchema(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "15m"
    price: float
    condition_type: str = "STRATEGY_SIGNAL"
    direction: str = "BULLISH"
    description: str
    normalized_metric: Optional[str] = None


@router.post("/signals")
async def create_signal(payload: SignalCreateSchema, db: AsyncSession = Depends(get_db)):
    sig = SignalHistory(
        symbol=payload.symbol.upper(),
        timeframe=payload.timeframe,
        price=payload.price,
        condition_type=payload.condition_type,
        direction=payload.direction,
        description=payload.description,
        normalized_metric=payload.normalized_metric,
        created_at=datetime.utcnow()
    )
    db.add(sig)
    await db.commit()
    await db.refresh(sig)
    try:
        await broadcast_signal({
            "symbol": sig.symbol,
            "timeframe": sig.timeframe,
            "price": sig.price,
            "condition_type": sig.condition_type,
            "direction": sig.direction,
            "description": sig.description,
            "normalized_metric": sig.normalized_metric,
        })
    except Exception:
        pass
    return {
        "id": sig.id,
        "symbol": sig.symbol,
        "timeframe": sig.timeframe,
        "price": sig.price,
        "condition_type": sig.condition_type,
        "direction": sig.direction,
        "description": sig.description,
        "normalized_metric": sig.normalized_metric,
        "created_at": format_kyiv(sig.created_at)
    }


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
            "normalized_metric": getattr(r, "normalized_metric", None),
            "created_at": format_kyiv(r.created_at)
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

@router.get("/liquidations")
async def get_liquidations(
    symbol: str = Query("BTCUSDT"),
    min_usd: float = Query(0.0),
    limit: int = Query(100),
    db: AsyncSession = Depends(get_db)
):
    """Returns recent liquidation events filtered by symbol and minimum USD threshold."""
    stmt = select(LiquidationEvent).where(
        LiquidationEvent.symbol == symbol.upper(),
        LiquidationEvent.usd_amount >= min_usd
    ).order_by(LiquidationEvent.timestamp.desc()).limit(limit)
    res = await db.execute(stmt)
    records = res.scalars().all()
    return [
        {
            "id": r.id,
            "symbol": r.symbol,
            "side": r.side,  # BUY (short liq) or SELL (long liq)
            "price": r.price,
            "quantity": r.quantity,
            "usd_amount": r.usd_amount,
            "timestamp": int(r.timestamp.timestamp() * 1000)
        }
        for r in records
    ]

@router.get("/heatmap")
async def get_heatmap(
    symbol: str = Query("BTCUSDT"),
    min_usd: float = Query(50000.0),
    limit: int = Query(400)
):
    """Returns historical orderbook density levels for chart heatmap overlay."""
    return recorder.get_heatmap_data(symbol=symbol.upper(), min_usd=min_usd, limit=limit)

@router.get("/indicators")
async def get_indicators():
    """Returns metadata and schemas of all modular indicator plugins."""
    return registry.list_indicators()

@router.get("/settings/coins")
async def get_coin_settings(user_id: str = "0", db: AsyncSession = Depends(get_db)):
    """Returns JSON dictionary of coin-specific indicator overrides."""
    res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    setting = res.scalar_one_or_none()
    raw = setting.coin_overrides if setting and setting.coin_overrides else "{}"
    try:
        return json.loads(raw)
    except Exception:
        return {}

@router.post("/settings/coins")
async def save_coin_settings(payload: Dict[str, Any], user_id: str = "0", db: AsyncSession = Depends(get_db)):
    """Saves per-coin overrides dictionary into UserSetting."""
    res = await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
    setting = res.scalar_one_or_none()
    if not setting:
        setting = UserSetting(user_id=user_id)
        db.add(setting)
    setting.coin_overrides = json.dumps(payload)
    setting.updated_at = datetime.utcnow()
    await db.commit()
    return {"status": "saved", "coin_overrides": payload}

