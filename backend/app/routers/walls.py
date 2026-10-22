"""Wall settings & auto-density API (SRS M1.3b).

Persists per-symbol wall detection settings, accepts wall observations from the
live DOM/depth pipeline, and exposes the effective density threshold together
with TTL-qualified walls.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.app.config import DATA_DIR
from backend.app.services.wall_settings import (
    AutoDensityCalibrator,
    WallSettings,
    WallSettingsStore,
    WallTracker,
)

router = APIRouter(prefix="/api/walls", tags=["walls"])

_store = WallSettingsStore(DATA_DIR / "wall_settings.json")
_calibrator = AutoDensityCalibrator()
_trackers: Dict[str, WallTracker] = {}
_observations: Dict[str, List[float]] = {}

MAX_OBSERVATIONS_PER_SYMBOL = 5000


class WallSettingsPayload(BaseModel):
    mode: Optional[str] = None
    min_density_usd: Optional[float] = Field(default=None, ge=0)
    wall_ttl_seconds: Optional[float] = Field(default=None, ge=0)
    auto_method: Optional[str] = None
    auto_percentile: Optional[float] = None
    auto_k_median: Optional[float] = None
    auto_window_minutes: Optional[float] = None


class WallObservationPayload(BaseModel):
    usd: float = Field(..., gt=0)


class WallUpdatePayload(BaseModel):
    price: float
    side: str = Field(..., pattern="^(bid|ask)$")
    usd: float


def _settings_dict(settings: WallSettings, symbol: str) -> dict:
    threshold = _calibrator.effective_threshold(settings, _observations.get(symbol, []))
    return {
        "symbol": symbol,
        "mode": settings.mode,
        "min_density_usd": settings.min_density_usd,
        "wall_ttl_seconds": settings.wall_ttl_seconds,
        "auto_method": settings.auto_method,
        "auto_percentile": settings.auto_percentile,
        "auto_k_median": settings.auto_k_median,
        "auto_window_minutes": settings.auto_window_minutes,
        "observations": len(_observations.get(symbol, [])),
        "effective_threshold_usd": threshold,
        "threshold_source": "auto" if (settings.mode == "auto" and _calibrator.compute(settings, _observations.get(symbol, [])) is not None) else "manual",
    }


@router.get("/settings")
async def get_wall_settings(symbol: str = "BTCUSDT"):
    """Returns persisted wall settings and the effective density threshold."""
    key = symbol.strip().upper()
    return _settings_dict(_store.get(key), key)


@router.put("/settings")
async def put_wall_settings(payload: WallSettingsPayload, symbol: str = "BTCUSDT"):
    """Updates wall settings for a symbol (manual/auto mode, TTL, auto params)."""
    key = symbol.strip().upper()
    current = _store.get(key)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    merged = WallSettings(
        symbol=key,
        mode=updates.get("mode", current.mode),
        min_density_usd=updates.get("min_density_usd", current.min_density_usd),
        wall_ttl_seconds=updates.get("wall_ttl_seconds", current.wall_ttl_seconds),
        auto_method=updates.get("auto_method", current.auto_method),
        auto_percentile=updates.get("auto_percentile", current.auto_percentile),
        auto_k_median=updates.get("auto_k_median", current.auto_k_median),
        auto_window_minutes=updates.get("auto_window_minutes", current.auto_window_minutes),
    )
    _store.update(merged)
    return _settings_dict(merged, key)


@router.post("/observe")
async def observe_wall_size(payload: WallObservationPayload, symbol: str = "BTCUSDT"):
    """Feeds a wall-size observation (USD) into the auto-calibration sample."""
    key = symbol.strip().upper()
    sample = _observations.setdefault(key, [])
    sample.append(float(payload.usd))
    if len(sample) > MAX_OBSERVATIONS_PER_SYMBOL:
        del sample[: len(sample) - MAX_OBSERVATIONS_PER_SYMBOL]
    return {"status": "ok", "symbol": key, "observations": len(sample)}


@router.post("/track")
async def track_wall(payload: WallUpdatePayload, symbol: str = "BTCUSDT"):
    """Registers/refreshes a wall level so its lifetime (TTL) is tracked server-side."""
    key = symbol.strip().upper()
    tracker = _trackers.setdefault(key, WallTracker())
    tracker.update(price=payload.price, side=payload.side, usd=payload.usd)
    return {"status": "ok", "symbol": key}


@router.get("/qualified")
async def qualified_walls(symbol: str = "BTCUSDT"):
    """Walls passing both the effective threshold and the TTL rule right now."""
    key = symbol.strip().upper()
    settings = _store.get(key)
    threshold = _calibrator.effective_threshold(settings, _observations.get(key, []))
    tracker = _trackers.get(key)
    walls = tracker.qualified_walls(threshold_usd=threshold, ttl_seconds=settings.wall_ttl_seconds) if tracker else []
    return {
        "symbol": key,
        "threshold_usd": threshold,
        "wall_ttl_seconds": settings.wall_ttl_seconds,
        "walls": [
            {"price": w.price, "side": w.side, "usd": w.usd, "age_seconds": round(w.last_seen - w.first_seen, 3)}
            for w in walls
        ],
    }
