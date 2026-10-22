"""Wall settings persistence, TTL tracking and auto-density calibration (SRS M1.3b).

Manual mode: a wall qualifies when usd >= min_density_usd AND it has been
continuously present for at least wall_ttl_seconds (SRS default: >= $500k, TTL >= 15s).

Auto mode: the qualifying threshold is derived from a rolling window of observed
wall sizes, either as the P99 percentile or as K x median. TTL still applies.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class WallSettings:
    symbol: str
    mode: str = "manual"  # "manual" | "auto"
    min_density_usd: float = 500_000.0
    wall_ttl_seconds: float = 15.0
    auto_method: str = "percentile"  # "percentile" | "k_median"
    auto_percentile: float = 99.0
    auto_k_median: float = 3.0
    auto_window_minutes: float = 60.0

    def __post_init__(self) -> None:
        self.symbol = self.symbol.strip().upper()
        if self.mode not in ("manual", "auto"):
            raise ValueError(f"wall settings mode must be 'manual' or 'auto', got {self.mode!r}")
        if self.auto_method not in ("percentile", "k_median"):
            raise ValueError(f"auto_method must be 'percentile' or 'k_median', got {self.auto_method!r}")
        if self.min_density_usd < 0:
            raise ValueError("min_density_usd must be >= 0")
        if self.wall_ttl_seconds < 0:
            raise ValueError("wall_ttl_seconds must be >= 0")
        if not 50.0 <= self.auto_percentile <= 100.0:
            raise ValueError("auto_percentile must be within [50, 100]")
        if self.auto_k_median <= 0:
            raise ValueError("auto_k_median must be > 0")
        if self.auto_window_minutes <= 0:
            raise ValueError("auto_window_minutes must be > 0")


def _percentile(sorted_values: List[float], pct: float) -> float:
    """Nearest-rank percentile over an ascending-sorted sample."""
    if not sorted_values:
        raise ValueError("percentile of empty sample")
    rank = max(1, math.ceil(pct / 100.0 * len(sorted_values)))
    return float(sorted_values[min(rank, len(sorted_values)) - 1])


class AutoDensityCalibrator:
    """Computes the auto density threshold from a rolling observation sample."""

    MIN_SAMPLES = 20

    def compute(self, settings: WallSettings, observations: List[float]) -> Optional[float]:
        """Returns the auto threshold in USD, or None when the sample is too small."""
        sample = sorted(float(v) for v in observations if v and float(v) > 0)
        if len(sample) < self.MIN_SAMPLES:
            return None
        if settings.auto_method == "percentile":
            return _percentile(sample, settings.auto_percentile)
        median = statistics.median(sample)
        return float(median * settings.auto_k_median) if median > 0 else None

    def effective_threshold(self, settings: WallSettings, observations: List[float]) -> float:
        """Auto threshold when computable; falls back to the manual floor honestly."""
        auto = self.compute(settings, observations)
        if auto is None:
            return float(settings.min_density_usd)
        return auto


@dataclass
class TrackedWall:
    price: float
    side: str  # "bid" | "ask"
    usd: float
    first_seen: float
    last_seen: float


class WallTracker:
    """Tracks wall lifetimes per price level and applies the TTL qualification rule."""

    def __init__(self) -> None:
        self._walls: Dict[tuple, TrackedWall] = {}

    def update(self, *, price: float, side: str, usd: float, ts: Optional[float] = None) -> None:
        """Registers a wall observation. usd <= 0 clears the level."""
        now = float(ts if ts is not None else time.time())
        key = (round(float(price), 8), side)
        if usd <= 0:
            self._walls.pop(key, None)
            return
        wall = self._walls.get(key)
        if wall is None:
            self._walls[key] = TrackedWall(price=float(price), side=side, usd=float(usd), first_seen=now, last_seen=now)
        else:
            wall.usd = float(usd)
            wall.last_seen = now

    def qualified_walls(self, *, threshold_usd: float, ttl_seconds: float, now: Optional[float] = None) -> List[TrackedWall]:
        """Walls meeting both the size threshold and the minimum lifetime (SRS M1.3)."""
        ts = float(now if now is not None else time.time())
        return [
            wall
            for wall in self._walls.values()
            if wall.usd >= threshold_usd and (ts - wall.first_seen) >= ttl_seconds
        ]


class WallSettingsStore:
    """JSON persistence of per-symbol wall settings under data/wall_settings.json."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._settings: Dict[str, WallSettings] = {}
        self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._settings = {}
            return
        settings: Dict[str, WallSettings] = {}
        for item in raw.get("settings", []):
            try:
                entry = WallSettings(**item)
            except (TypeError, ValueError):
                logger.warning("skipping invalid wall settings entry: %r", item)
                continue
            settings[entry.symbol] = entry
        self._settings = settings

    def _save(self) -> None:
        payload = {"settings": [asdict(s) for s in sorted(self._settings.values(), key=lambda s: s.symbol)]}
        tmp_path = self.path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self.path)

    def get(self, symbol: str) -> WallSettings:
        key = symbol.strip().upper()
        if key not in self._settings:
            self._settings[key] = WallSettings(symbol=key)
            self._save()
        return self._settings[key]

    def update(self, settings: WallSettings) -> WallSettings:
        self._settings[settings.symbol] = settings
        self._save()
        return settings
