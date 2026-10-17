"""
Indicators Plugin Architecture Package
Provides plugin discovery, registry, calculation, and normalization.
"""

from typing import Dict, Any, Optional
import pandas as pd

from backend.app.services.indicators.base import BaseIndicator
from backend.app.services.indicators.registry import registry, IndicatorRegistry
from backend.app.services.indicators.normalization import normalize_series, format_normalized_display

def compute_indicators(df: pd.DataFrame, overrides: Optional[Dict[str, Dict[str, Any]]] = None) -> pd.DataFrame:
    """Computes all registered indicator plugins (EMA, RSI, Vol MA, ATR, CVD, VWAP)."""
    return registry.compute_all(df, params_overrides=overrides)

def check_ema20_cross(df: pd.DataFrame) -> Optional[str]:
    ind = registry.get("ema")
    if not ind:
        return None
    res = ind.check_signal(df, {"period": 20})
    return res["direction"] if res else None

def check_volume_spike(df: pd.DataFrame, multiplier: float = 2.0) -> bool:
    ind = registry.get("volume_spike")
    if not ind:
        return False
    res = ind.check_signal(df, {"spike_mult": multiplier})
    return res is not None

def check_rsi_condition(df: pd.DataFrame, rsi_min: float = 30.0, rsi_max: float = 70.0) -> Optional[str]:
    ind = registry.get("rsi")
    if not ind:
        return None
    res = ind.check_signal(df, {"rsi_min": rsi_min, "rsi_max": rsi_max})
    return res["direction"] if res else None

def check_cvd_divergence(df: pd.DataFrame) -> Optional[str]:
    ind = registry.get("cvd")
    if not ind:
        return None
    res = ind.check_signal(df)
    return res["direction"] if res else None

def check_vwap_signal(df: pd.DataFrame, deviation_threshold_pct: float = 1.5) -> Optional[Dict[str, Any]]:
    ind = registry.get("vwap")
    if not ind:
        return None
    return ind.check_signal(df, {"deviation_threshold_pct": deviation_threshold_pct})

__all__ = [
    "BaseIndicator",
    "registry",
    "IndicatorRegistry",
    "compute_indicators",
    "check_ema20_cross",
    "check_volume_spike",
    "check_rsi_condition",
    "check_cvd_divergence",
    "check_vwap_signal",
    "normalize_series",
    "format_normalized_display",
]
