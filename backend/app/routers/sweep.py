"""Quant Sweep API (SRS M5.1) — grid-оптимизация с Top-10 leaderboard артефактом."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.engine.optimizer import WalkForwardOptimizer
from backend.app.engine.sweep_leaderboard import SweepLeaderboardStore

router = APIRouter(prefix="/api/sweep", tags=["sweep"])

_store = SweepLeaderboardStore(Path("data/sweep_leaderboard.json"))

DEFAULT_GRID: Dict[str, List[Any]] = {
    "fast_period": [8, 12, 21],
    "slow_period": [26, 50, 100],
}


class SweepRunRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "15m"
    days: int = Field(30, ge=7, le=180)
    strategy_type: str = "ema_cross"
    train_ratio: float = Field(0.7, gt=0.5, lt=0.95)
    top_n: int = Field(10, ge=1, le=10)
    param_grid: Optional[Dict[str, List[Any]]] = None


@router.post("/run")
async def run_sweep(req: SweepRunRequest):
    """Grid + пермутации параметров: Train/OOS оптимизация, Top-N (≤10) записей
    с вердиктами ROBUST/MODERATE/OVERFITTED; артефакт персистится в data/."""
    from backend.app.routers.backtest import fetch_history

    frame = await fetch_history(req.symbol.upper(), req.timeframe, days=req.days)
    if frame is None or len(frame) < 120:
        raise HTTPException(status_code=422, detail="insufficient_history")

    grid = req.param_grid or DEFAULT_GRID
    optimizer = WalkForwardOptimizer()
    result = optimizer.optimize_train_oos(
        frame, grid, strategy_type=req.strategy_type,
        train_ratio=req.train_ratio, top_k=req.top_n,
    )
    return _store.record_run(result, req.symbol, req.timeframe, top_n=req.top_n)


@router.get("/leaderboard")
async def get_leaderboard(
    symbol: Optional[str] = Query(None),
    timeframe: Optional[str] = Query(None),
    strategy_type: Optional[str] = Query(None),
):
    """Последний Top-10 артефакт по фильтрам. Пусто → {found: false}, без синтетики."""
    artifact = _store.latest(symbol=symbol, timeframe=timeframe, strategy_type=strategy_type)
    if artifact is None:
        return {"found": False, "artifact": None}
    return {"found": True, "artifact": artifact}


@router.get("/runs")
async def list_runs():
    """Индекс всех сохранённых прогонов без тел записей."""
    return {"runs": _store.list_runs()}
