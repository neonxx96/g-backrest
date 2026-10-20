"""
Quant Analytics Router
Exposes endpoints for Order Book Depth, Synthetic Liquidation Estimates,
3 Cores Quant evaluation, One-Click Prompt generator, and Shadow Quarantine journal.
"""

from typing import Optional, List, Any, Dict, Literal
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field

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
from backend.app.services.design_contracts import DesignOverlayPayload, build_design_overlay
from backend.app.services.think_optimizer import analyze_post_mortem
from backend.app.routers.backtest import OptimizeRequest, optimize_backtest

router = APIRouter(prefix="/api/quant", tags=["Quant Analytics & 3 Cores"])


class ThinkOptimizeRequest(BaseModel):
    mode: Literal["pre_run", "post_mortem"] = "pre_run"
    symbol: str = "BTCUSDT"
    timeframe: str = "5m"
    days: int = 7
    strategy_type: str = "confluence_ema"
    current: Dict[str, Any] = Field(default_factory=dict)
    trades: List[Dict[str, Any]] = Field(default_factory=list)


def build_think_optimize_request(req: ThinkOptimizeRequest) -> OptimizeRequest:
    """Translate the user's current strategy settings into the existing optimizer.

    The optimizer remains the single implementation of the search. This adapter
    only forwards the shared baseline/filter settings so AI Think cannot silently
    optimize a different strategy configuration than the one shown in the UI.
    """
    current = req.current or {}
    allowed = {
        "optimizer_mode", "sl_min", "sl_max", "sl_step", "tp_min", "tp_max", "tp_step",
        "tp_pct", "wall_min_usd", "wall_max_usd", "wall_step_usd", "volume_multiplier",
        "leverage", "initial_capital", "maker_fee_pct", "taker_fee_pct", "slippage_ticks",
        "use_multi_tp", "current_sl_pct", "current_tp_pct", "current_wall_usd",
        "use_atr_filter", "use_atr_sl", "atr_multiplier", "use_cvd_filter", "use_oi_filter",
        "use_rsi_filter", "population_size", "generations",
    }
    values = {key: value for key, value in current.items() if key in allowed and value is not None}
    # Night Pilot/backtest configs use the user-facing names; the optimizer's
    # comparison baseline uses explicit ``current_*`` names.
    aliases = {
        "stop_loss_pct": "current_sl_pct",
        "take_profit_pct": "current_tp_pct",
        "min_density_usd": "current_wall_usd",
    }
    for source, target in aliases.items():
        if target not in values and current.get(source) is not None:
            values[target] = current[source]
    return OptimizeRequest(
        symbol=req.symbol,
        timeframe=req.timeframe,
        days=req.days,
        strategy_type=req.strategy_type,
        **values,
    )


@router.post("/think-optimize")
async def think_optimize(req: ThinkOptimizeRequest):
    """Runs existing historical optimizer or an explainable post-mortem patch."""
    if req.mode == "post_mortem":
        return analyze_post_mortem(req.model_dump())
    optimize_request = build_think_optimize_request(req)
    result = await optimize_backtest(optimize_request)
    return {"mode": "pre_run", "symbol": req.symbol.upper(), "recommendation": result, "disclaimer": "Консультативный режим; реальные ордера не отправляются."}


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


@router.get("/design-overlay", response_model=DesignOverlayPayload)
async def get_design_overlay(symbol: str = Query("BTCUSDT")):
    """Normalized LiqLevel/DepthWall/DepthDeltas payload for design overlays."""
    try:
        data = await market_data_provider.get_unified_data(symbol=symbol)
        return build_design_overlay(data.orderbook_depth, data.liq_estimates)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to build design overlay: {str(e)}")


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
