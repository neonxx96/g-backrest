"""Verdict v2 API (SRS M3.3) — traffic-light safety gateway."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from backend.app.engine.verdict import evaluate_verdict

router = APIRouter(prefix="/api/verdict", tags=["verdict"])


class VerdictRequest(BaseModel):
    net_pnl_usd: float
    trades: int
    profit_factor: Optional[float] = None
    regime: Optional[str] = None
    requires_l2: bool = False
    l2_available: bool = True


@router.post("/evaluate")
async def evaluate(req: VerdictRequest):
    """Evaluates the PASS/WARNING/BLOCK verdict for a backtest or preflight result."""
    verdict = evaluate_verdict(
        net_pnl_usd=req.net_pnl_usd,
        trades=req.trades,
        profit_factor=req.profit_factor,
        regime=req.regime,
        requires_l2=req.requires_l2,
        l2_available=req.l2_available,
    )
    return verdict.to_dict()
