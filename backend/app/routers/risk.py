"""Position Sizer API (SRS M4.2a) — расчёты размера позиции, без ордеров."""

from __future__ import annotations

from dataclasses import asdict
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.app.services.position_sizer import PositionSizer

router = APIRouter(prefix="/api/risk", tags=["risk"])

_sizer = PositionSizer()


class FixedFractionalRequest(BaseModel):
    equity: float = Field(..., gt=0)
    entry_price: float = Field(..., gt=0)
    stop_price: float = Field(..., gt=0)
    risk_pct: float = Field(1.0, gt=0, le=10)
    confluence_score: Optional[float] = Field(None, ge=0, le=1)
    confluence_threshold: float = Field(0.65, gt=0, le=1)


class DcaLadderRequest(BaseModel):
    symbol: str = "BTCUSDT"
    side: str = "LONG"
    equity: float = Field(..., gt=0)
    entry_price: float = Field(..., gt=0)
    stop_price: float = Field(..., gt=0)
    leg_offsets_pct: List[float]
    leg_risk_shares: Optional[List[float]] = None
    risk_budget_pct: float = Field(1.0, gt=0, le=10)
    confluence_score: Optional[float] = Field(None, ge=0, le=1)
    confluence_threshold: float = Field(0.65, gt=0, le=1)


class HeatCheckRequest(BaseModel):
    open_risks_usd: List[float] = []
    equity: float = Field(..., gt=0)
    new_risk_usd: float = Field(0.0, ge=0)
    max_heat_pct: Optional[float] = Field(None, gt=0)


@router.post("/position-size")
async def position_size(req: FixedFractionalRequest):
    """Fixed Fractional: qty = (equity × risk_pct%) / |entry - stop|.
    С переданным confluence_score бюджет масштабируется quality multiplier (0.5–1.2×)."""
    budget, mult = _sizer.adjusted_risk_budget(
        req.equity, req.risk_pct, req.confluence_score, req.confluence_threshold
    )
    qty = budget / abs(req.entry_price - req.stop_price)
    return {"quantity": qty, "risk_usd": budget, "quality_multiplier": mult}


@router.post("/dca-ladder")
async def dca_ladder(req: DcaLadderRequest):
    """Budgeted DCA-лестница: суммарный риск всех ног до общего стопа ≤ бюджета.
    С переданным confluence_score бюджет масштабируется quality multiplier (0.5–1.2×)."""
    budget, mult = _sizer.adjusted_risk_budget(
        req.equity, req.risk_budget_pct, req.confluence_score, req.confluence_threshold
    )
    effective_budget_pct = budget / req.equity * 100.0
    try:
        plan = _sizer.budgeted_dca_ladder(
            symbol=req.symbol, side=req.side, equity=req.equity,
            entry_price=req.entry_price, stop_price=req.stop_price,
            leg_offsets_pct=req.leg_offsets_pct, leg_risk_shares=req.leg_risk_shares,
            risk_budget_pct=effective_budget_pct,
        )
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail=str(exc))
    payload = asdict(plan)
    payload["quality_multiplier"] = mult
    return payload


@router.post("/heat-check")
async def heat_check(req: HeatCheckRequest):
    """Max Portfolio Heat: пропустит ли портфель новый риск (allowed, heat_after)."""
    allowed, heat_after = _sizer.check_heat(
        req.open_risks_usd, req.equity, req.new_risk_usd, req.max_heat_pct
    )
    return {
        "allowed": allowed,
        "heat_after_pct": round(heat_after, 4),
        "current_heat_pct": round(_sizer.portfolio_heat(req.open_risks_usd, req.equity), 4),
    }
