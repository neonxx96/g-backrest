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


class DcaLadderRequest(BaseModel):
    symbol: str = "BTCUSDT"
    side: str = "LONG"
    equity: float = Field(..., gt=0)
    entry_price: float = Field(..., gt=0)
    stop_price: float = Field(..., gt=0)
    leg_offsets_pct: List[float]
    leg_risk_shares: Optional[List[float]] = None
    risk_budget_pct: float = Field(1.0, gt=0, le=10)


class HeatCheckRequest(BaseModel):
    open_risks_usd: List[float] = []
    equity: float = Field(..., gt=0)
    new_risk_usd: float = Field(0.0, ge=0)
    max_heat_pct: Optional[float] = Field(None, gt=0)


@router.post("/position-size")
async def position_size(req: FixedFractionalRequest):
    """Fixed Fractional: qty = (equity × risk_pct%) / |entry - stop|."""
    qty = _sizer.fixed_fractional(req.equity, req.entry_price, req.stop_price, req.risk_pct)
    return {"quantity": qty, "risk_usd": req.equity * req.risk_pct / 100.0}


@router.post("/dca-ladder")
async def dca_ladder(req: DcaLadderRequest):
    """Budgeted DCA-лестница: суммарный риск всех ног до общего стопа ≤ бюджета."""
    try:
        plan = _sizer.budgeted_dca_ladder(
            symbol=req.symbol, side=req.side, equity=req.equity,
            entry_price=req.entry_price, stop_price=req.stop_price,
            leg_offsets_pct=req.leg_offsets_pct, leg_risk_shares=req.leg_risk_shares,
            risk_budget_pct=req.risk_budget_pct,
        )
    except ValueError as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail=str(exc))
    return asdict(plan)


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
