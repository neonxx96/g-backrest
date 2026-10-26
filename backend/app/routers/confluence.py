"""Weighted Confluence API (SRS M2.3).

Exposes per-symbol confluence weight profiles and a scoring endpoint that
returns the weighted score with a per-factor breakdown. Scoring is advisory
and deterministic — no LLM involved (SRS 1.1.2).
"""

from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.config import DATA_DIR
from backend.app.engine.confluence import (
    DEFAULT_REQUIRED,
    DEFAULT_THRESHOLD,
    DEFAULT_WEIGHTS,
    KNOWN_FACTORS,
    ConfluenceConfigError,
    ConfluenceConfigStore,
)

router = APIRouter(prefix="/api/confluence", tags=["confluence"])

_store = ConfluenceConfigStore(DATA_DIR / "confluence_weights.json")


class ConfluenceWeightsPayload(BaseModel):
    weights: Dict[str, float]
    threshold: float = Field(default=DEFAULT_THRESHOLD, gt=0, le=1)
    required: Optional[List[str]] = None


class ConfluenceScorePayload(BaseModel):
    factors: Dict[str, bool]
    observed: Optional[Dict[str, float]] = None


@router.get("/factors")
async def list_factors():
    """Canonical factor set and the SRS default profile."""
    return {
        "factors": list(KNOWN_FACTORS),
        "default_weights": dict(DEFAULT_WEIGHTS),
        "default_threshold": DEFAULT_THRESHOLD,
        "default_required": list(DEFAULT_REQUIRED),
    }


@router.get("/weights")
async def get_weights(symbol: str = "BTCUSDT"):
    """Returns the effective confluence profile for a symbol."""
    return _store.get(symbol)


@router.put("/weights")
async def put_weights(payload: ConfluenceWeightsPayload, symbol: str = "BTCUSDT"):
    """Validates (Σw = 1) and persists a per-symbol confluence profile."""
    try:
        return _store.update(symbol, weights=payload.weights, threshold=payload.threshold, required=payload.required)
    except ConfluenceConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/score")
async def score_factors(payload: ConfluenceScorePayload, symbol: str = "BTCUSDT"):
    """Scores factor states with the symbol's profile; returns score + breakdown."""
    scorer = _store.scorer_for(symbol)
    verdict = scorer.score(payload.factors, observed=payload.observed)
    return {
        "symbol": symbol.strip().upper(),
        "score": verdict.score,
        "threshold": verdict.threshold,
        "qualified": verdict.qualified,
        "failed_required": verdict.failed_required,
        "breakdown": [
            {"name": f.name, "passed": f.passed, "weight": f.weight, "required": f.required, "observed": f.observed}
            for f in verdict.breakdown
        ],
    }
