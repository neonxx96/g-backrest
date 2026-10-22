"""
Adaptive Quant Router: Market Regime Classification & Walk-Forward Strategy Weights
===================================================================================
Provides endpoints for:
1. Real-time Market Regime classification (FLAT_DENSE, TREND_IMPULSE, TOXIC_VOLATILITY).
2. Dynamic Strategy Weights & Portfolio Allocation across market phases.
3. On-demand Walk-Forward optimization on 3-7 days of Parquet data.
"""

from typing import Dict, Any, Optional
import time
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.engine.regime_classifier import MarketRegime, regime_classifier
from backend.app.engine.walk_forward_engine import walk_forward_engine
from backend.app.services.historical_data_loader import historical_loader

adaptive_router = APIRouter(prefix="/api/adaptive", tags=["Adaptive Brain & Regime Classifier"])


class OptimizeWeightsRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT", description="Trading pair symbol")
    days: int = Field(default=3, ge=1, le=14, description="Historical lookback window in days (3-7 recommended)")


@adaptive_router.get("/regime")
async def get_market_regime(
    symbol: str = Query(default="BTCUSDT", description="Trading pair symbol"),
    timeframe: str = Query(default="5m", description="Bar interval")
):
    """
    Classifies the latest market regime for the specified symbol and timeframe.
    Returns ATR, relative order book density, CVD slope, spread metrics, and trading permission.
    """
    sym = symbol.strip().upper()
    tf = timeframe.strip().lower()

    try:
        df = await historical_loader.load_dataset_async(
            symbol=sym,
            timeframe=tf,
            days=2,
            force_refresh=False
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch market data for {sym}: {e}")

    if df is None or len(df) < 5:
        raise HTTPException(status_code=400, detail=f"Insufficient candles for regime classification of {sym}")

    regime, metrics = regime_classifier.classify_current(df)
    last_ts = int(df["timestamp"].iloc[-1]) if "timestamp" in df.columns else int(time.time() * 1000)

    return {
        "status": "ok",
        "symbol": sym,
        "timeframe": tf,
        "regime": regime.value,
        "is_trade_allowed": metrics.get("is_trade_allowed", True),
        "metrics": metrics,
        "timestamp": last_ts
    }


@adaptive_router.get("/weights")
async def get_strategy_weights(
    symbol: str = Query(default="BTCUSDT", description="Trading pair symbol")
):
    """
    Returns the currently active regime, primary strategy, and optimized strategy
    weight distribution for the symbol.
    """
    sym = symbol.strip().upper()

    try:
        df = await historical_loader.load_dataset_async(
            symbol=sym,
            timeframe="5m",
            days=2,
            force_refresh=False
        )
    except Exception:
        df = None

    active_info = walk_forward_engine.get_active_regime_and_weights(sym, df)
    return {
        "status": "ok",
        **active_info
    }


@adaptive_router.post("/optimize")
async def optimize_regime_weights(req: OptimizeWeightsRequest):
    """
    Executes an In-Sample Walk-Forward adaptation pass on historical Parquet data.
    Optimizes candidate strategy parameters and weight vectors across regimes.
    """
    sym = req.symbol.strip().upper()
    hours = req.days * 24

    try:
        results = await walk_forward_engine.train_walk_forward(sym, hours=hours)
        if not results:
            raise HTTPException(
                status_code=400,
                detail=f"Недостаточно исторических данных для оптимизации {sym} за {req.days} дн."
            )
        return {
            "status": "ok",
            "symbol": sym,
            "days": req.days,
            "hours": hours,
            "regimes": results
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Optimization failed: {e}")
