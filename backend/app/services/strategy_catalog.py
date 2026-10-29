"""Versioned, paper-only catalogue of executable historical strategies.

This is metadata, not a strategy generator.  It is deliberately kept separate
from the backtester and runner so selection, admission and UI use one stable
source of truth without changing execution behaviour.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class StrategyDescriptor:
    id: str
    version: str
    family: str
    label: str
    description: str
    supported_timeframes: tuple[str, ...]
    paper_historical: bool = True
    optimizable: bool = False
    selector_candidate: bool = False
    market_entry: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-safe public metadata without executable internals."""
        payload = asdict(self)
        payload["supported_timeframes"] = list(self.supported_timeframes)
        return payload


_CATALOG = (
    StrategyDescriptor(
        id="ema_trend", version="1", family="trend", label="EMA Trend",
        description="Trend continuation after the EMA signal confirms direction.",
        supported_timeframes=("5m", "15m"), optimizable=True,
        selector_candidate=True, market_entry=True,
    ),
    StrategyDescriptor(
        id="ema_trend_window", version="1", family="trend", label="EMA Trend Window",
        description="EMA trend entry constrained to its configured confirmation window.",
        supported_timeframes=("5m", "15m"), optimizable=True,
        selector_candidate=True, market_entry=True,
    ),
    StrategyDescriptor(
        id="ema_pullback", version="1", family="trend", label="EMA Pullback",
        description="Trend-following pullback entry after EMA structure confirms the trend.",
        supported_timeframes=("5m", "15m"), optimizable=True,
        selector_candidate=True, market_entry=True,
    ),
    StrategyDescriptor(
        id="confluence_ema", version="1", family="trend", label="EMA Confluence",
        description="EMA setup evaluated with the terminal confluence filters.",
        supported_timeframes=("5m", "15m"), optimizable=True, market_entry=True,
    ),
    StrategyDescriptor(
        id="cvd_absorption", version="1", family="order_flow", label="CVD Absorption",
        description="Order-flow setup that looks for cumulative-volume-delta absorption.",
        supported_timeframes=("5m", "15m"), optimizable=True, market_entry=True,
    ),
    StrategyDescriptor(
        id="cluster_volume_bounce", version="1", family="order_flow", label="Cluster Volume Bounce",
        description="Volume-cluster reaction setup; its execution model keeps its existing limit behaviour.",
        supported_timeframes=("5m", "15m"), optimizable=True,
        selector_candidate=True,
    ),
    StrategyDescriptor(
        id="diagnostics_lenient", version="1", family="diagnostic", label="Diagnostics Lenient",
        description="Paper-only diagnostic profile for observing signal and feed behaviour.",
        supported_timeframes=("5m", "15m"), market_entry=True,
    ),
    StrategyDescriptor(
        id="naked_test", version="1", family="diagnostic", label="Naked Test",
        description="Paper-only minimal-filter probe used to diagnose strategy and market-data paths.",
        supported_timeframes=("5m", "15m"), market_entry=True,
    ),
)

_BY_ID = {descriptor.id: descriptor for descriptor in _CATALOG}
HISTORICAL_STRATEGY_IDS = frozenset(_BY_ID)
OPTIMIZABLE_STRATEGY_IDS = frozenset(
    descriptor.id for descriptor in _CATALOG if descriptor.optimizable
)
SELECTABLE_STRATEGY_IDS = tuple(
    descriptor.id for descriptor in _CATALOG if descriptor.selector_candidate
)
MARKET_ENTRY_STRATEGY_IDS = frozenset(
    descriptor.id for descriptor in _CATALOG if descriptor.market_entry
)


def get_strategy_catalog() -> list[dict[str, Any]]:
    """Return public strategy metadata in stable display order."""
    return [descriptor.to_dict() for descriptor in _CATALOG]


def get_strategy_descriptor(strategy_id: str) -> StrategyDescriptor:
    """Resolve a configured strategy ID, raising a clear error for unknown IDs."""
    try:
        return _BY_ID[strategy_id]
    except KeyError as exc:
        raise ValueError(f"unknown paper strategy: {strategy_id}") from exc
