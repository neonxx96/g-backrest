"""
Quant Analytics Router
Exposes endpoints for Order Book Depth, Synthetic Liquidation Estimates,
3 Cores Quant evaluation, One-Click Prompt generator, and Shadow Quarantine journal.
"""

from typing import Optional, List
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel

from backend.app.services.market_data_factory import market_data_provider
from backend.app.services.quant_engine import (
    quant_engine,
    Core3MathReport,
    MarketSnapshotPrompt,
    QuarantineSignalRecord,
)
from backend.app.services.market_data_provider import (
    UnifiedMarketDataResponse,
    OrderBookDepthData,
    LiqEstimatesData,
    MarketSnapshot,
)

router = APIRouter(prefix="/api/quant", tags=["Quant Analytics & 3 Cores"])


@router.get("/unified", response_model=UnifiedMarketDataResponse)
async def get_unified_market_data(symbol: str = Query("BTCUSDT")):
    """Returns single unified schema payload containing depth, liqs, and snapshot"""
    try:
        return await market_data_provider.get_unified_data(symbol=symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch unified market data: {str(e)}")


@router.get("/depth", response_model=OrderBookDepthData)
async def get_orderbook_depth(
    symbol: str = Query("BTCUSDT"),
    limit: int = Query(500),
    wall_mult: float = Query(3.0)
):
    """Returns Spot order book depth, computed limit walls, and depth delta (2.5%, 5%, 10%, 25%)"""
    try:
        return await market_data_provider.get_orderbook_depth(
            symbol=symbol, limit=limit, wall_multiplier=wall_mult
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch depth: {str(e)}")


@router.get("/liquidations", response_model=LiqEstimatesData)
async def get_liquidation_estimates(
    symbol: str = Query("BTCUSDT"),
    timeframe: str = Query("15m"),
    lookback: int = Query(150)
):
    """Returns synthetic liquidation pool map for 25x, 50x, 75x, 100x leverages"""
    try:
        return await market_data_provider.get_liquidation_estimates(
            symbol=symbol, timeframe=timeframe, lookback_bars=lookback
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute liquidations: {str(e)}")


@router.get("/evaluate", response_model=Core3MathReport)
async def evaluate_quant_signal(symbol: str = Query("BTCUSDT")):
    """Core 3 Math evaluation: Depth Skew, Liq Magnets, Entry/SL/TP, R:R validation & Veto"""
    try:
        data = await market_data_provider.get_unified_data(symbol=symbol)
        return quant_engine.evaluate_core3_math(data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quant evaluation failed: {str(e)}")


@router.get("/prompt", response_model=MarketSnapshotPrompt)
async def get_market_prompt(symbol: str = Query("BTCUSDT")):
    """Generates structured Markdown prompt & JSON for LLM (ChatGPT / Perplexity / Copilot)"""
    try:
        data = await market_data_provider.get_unified_data(symbol=symbol)
        core3 = quant_engine.evaluate_core3_math(data)
        return quant_engine.build_snapshot_prompt(data, core3)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build prompt: {str(e)}")


@router.post("/quarantine", response_model=QuarantineSignalRecord)
async def commit_to_quarantine(symbol: str = Query("BTCUSDT")):
    """Commits current market setup into Shadow Quarantine journal for Winrate tracking"""
    try:
        data = await market_data_provider.get_unified_data(symbol=symbol)
        core3 = quant_engine.evaluate_core3_math(data)
        return quant_engine.save_to_quarantine(data, core3)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Quarantine commit failed: {str(e)}")


@router.get("/quarantine/records")
async def list_quarantine_records():
    """Returns list of pending and completed quarantine records"""
    return quant_engine.list_quarantine_records()
