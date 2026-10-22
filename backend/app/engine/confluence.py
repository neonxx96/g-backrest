"""Weighted Confluence engine (SRS M2.3).

Combines a Strict-AND layer for mandatory gates with a weighted score for
soft confirmation factors:

- Required factors (e.g. the liquidity wall) must ALL pass — a single failure
  vetoes the signal regardless of the weighted score.
- Soft factors contribute their weight when they pass; weights are validated
  to sum to 1.0 (Σw = 1). A signal qualifies when score >= threshold
  (SRS default ≈ 0.65).

The score is attached to UnifiedTradeSignal.confluence_score so History,
Walk-Forward/OOS and Live Paper all see the same number (SRS 1.1.3).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Canonical factor set, mirroring the historical backtest filter suite.
KNOWN_FACTORS = (
    "wall",               # liquidity wall / density gate (required by default)
    "ema20_cross",        # EMA20 structure cross
    "volume_multiplier",  # volume spike vs moving average
    "delta_sign",         # trade delta aligned with direction
    "cvd_filter",         # CVD trend/divergence confirmation
    "rsi_filter",         # RSI band confirmation
    "atr_filter",         # volatility sanity gate
)

DEFAULT_THRESHOLD = 0.65
_WEIGHT_SUM_TOLERANCE = 1e-6

DEFAULT_WEIGHTS: Dict[str, float] = {
    "wall": 0.25,
    "ema20_cross": 0.20,
    "volume_multiplier": 0.15,
    "delta_sign": 0.10,
    "cvd_filter": 0.15,
    "rsi_filter": 0.10,
    "atr_filter": 0.05,
}

DEFAULT_REQUIRED = ("wall",)


@dataclass(frozen=True)
class FactorOutcome:
    name: str
    passed: bool
    weight: float
    required: bool
    observed: Optional[float] = None


@dataclass(frozen=True)
class ConfluenceVerdict:
    score: float
    threshold: float
    qualified: bool
    failed_required: List[str]
    breakdown: List[FactorOutcome]


class ConfluenceConfigError(ValueError):
    pass


def validate_weights(weights: Dict[str, float]) -> Dict[str, float]:
    """Validates the weight map: known factors only, non-negative, Σw = 1."""
    if not isinstance(weights, dict) or not weights:
        raise ConfluenceConfigError("confluence weights must be a non-empty mapping")
    unknown = sorted(set(weights) - set(KNOWN_FACTORS))
    if unknown:
        raise ConfluenceConfigError(f"unknown confluence factors: {unknown}")
    cleaned: Dict[str, float] = {}
    for name, value in weights.items():
        weight = float(value)
        if weight < 0:
            raise ConfluenceConfigError(f"weight for {name!r} must be >= 0")
        cleaned[name] = weight
    total = sum(cleaned.values())
    if abs(total - 1.0) > _WEIGHT_SUM_TOLERANCE:
        raise ConfluenceConfigError(f"confluence weights must sum to 1.0, got {total:.6f}")
    return cleaned


class WeightedConfluenceScorer:
    """Strict-AND + weighted confluence scoring (SRS M2.3)."""

    def __init__(
        self,
        weights: Optional[Dict[str, float]] = None,
        *,
        threshold: float = DEFAULT_THRESHOLD,
        required: tuple = DEFAULT_REQUIRED,
    ) -> None:
        self.weights = validate_weights(dict(weights or DEFAULT_WEIGHTS))
        if not 0.0 < threshold <= 1.0:
            raise ConfluenceConfigError(f"confluence threshold must be within (0, 1], got {threshold}")
        unknown_required = sorted(set(required) - set(self.weights))
        if unknown_required:
            raise ConfluenceConfigError(f"required factors missing from weights: {unknown_required}")
        self.threshold = float(threshold)
        self.required = tuple(required)

    def score(
        self,
        factors: Dict[str, bool],
        *,
        observed: Optional[Dict[str, float]] = None,
    ) -> ConfluenceVerdict:
        """Scores factor states. Missing soft factors count as failed."""
        breakdown: List[FactorOutcome] = []
        total = 0.0
        failed_required: List[str] = []
        observed = observed or {}
        for name, weight in self.weights.items():
            passed = bool(factors.get(name, False))
            is_required = name in self.required
            if passed:
                total += weight
            elif is_required:
                failed_required.append(name)
            breakdown.append(
                FactorOutcome(name=name, passed=passed, weight=weight, required=is_required, observed=observed.get(name))
            )
        qualified = not failed_required and total >= self.threshold
        return ConfluenceVerdict(
            score=round(total, 6),
            threshold=self.threshold,
            qualified=qualified,
            failed_required=failed_required,
            breakdown=breakdown,
        )


class ConfluenceConfigStore:
    """JSON persistence of per-symbol confluence profiles (data/confluence_weights.json)."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._profiles: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self._profiles = {}
            return
        profiles: Dict[str, Dict[str, Any]] = {}
        for item in raw.get("profiles", []):
            try:
                symbol = str(item["symbol"]).strip().upper()
                profiles[symbol] = {
                    "weights": validate_weights(dict(item["weights"])),
                    "threshold": float(item.get("threshold", DEFAULT_THRESHOLD)),
                    "required": tuple(item.get("required", DEFAULT_REQUIRED)),
                }
            except (KeyError, TypeError, ValueError) as exc:
                logger.warning("skipping invalid confluence profile %r: %s", item, exc)
        self._profiles = profiles

    def _save(self) -> None:
        payload = {
            "profiles": [
                {
                    "symbol": symbol,
                    "weights": profile["weights"],
                    "threshold": profile["threshold"],
                    "required": list(profile["required"]),
                }
                for symbol, profile in sorted(self._profiles.items())
            ]
        }
        tmp_path = self.path.with_suffix(".json.tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self.path)

    def scorer_for(self, symbol: str) -> WeightedConfluenceScorer:
        profile = self._profiles.get(symbol.strip().upper())
        if profile is None:
            return WeightedConfluenceScorer()
        return WeightedConfluenceScorer(profile["weights"], threshold=profile["threshold"], required=profile["required"])

    def get(self, symbol: str) -> Dict[str, Any]:
        key = symbol.strip().upper()
        profile = self._profiles.get(key)
        if profile is None:
            return {"symbol": key, "weights": dict(DEFAULT_WEIGHTS), "threshold": DEFAULT_THRESHOLD, "required": list(DEFAULT_REQUIRED), "custom": False}
        return {"symbol": key, "weights": dict(profile["weights"]), "threshold": profile["threshold"], "required": list(profile["required"]), "custom": True}

    def update(self, symbol: str, *, weights: Dict[str, float], threshold: float = DEFAULT_THRESHOLD, required: Optional[List[str]] = None) -> Dict[str, Any]:
        key = symbol.strip().upper()
        # Validate eagerly by constructing the scorer.
        scorer = WeightedConfluenceScorer(weights, threshold=threshold, required=tuple(required or DEFAULT_REQUIRED))
        self._profiles[key] = {"weights": scorer.weights, "threshold": scorer.threshold, "required": scorer.required}
        self._save()
        return self.get(key)
