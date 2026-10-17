"""
Indicator Normalization Engine
Supports 4 modes:
1. 'raw': standard indicator output
2. 'atr_pct': expressed as percentage of current ATR volatility
3. 'z_score': statistical standard deviations from rolling mean ((x - mu) / sigma)
4. 'percentile': rolling rank from 0% to 100% within rolling window
"""

import numpy as np
import pandas as pd
from typing import Optional, Dict, Any

def normalize_series(
    series: pd.Series,
    mode: str = "raw",
    atr_series: Optional[pd.Series] = None,
    window: int = 20
) -> pd.Series:
    """Normalizes a pandas Series according to the specified mode."""
    if series.empty:
        return series

    if mode == "raw":
        return series

    elif mode == "atr_pct":
        if atr_series is not None and not atr_series.empty:
            denom = atr_series.replace(0, np.nan)
            return (series / denom) * 100.0
        return series

    elif mode == "z_score":
        rolling_mean = series.rolling(window=window, min_periods=max(2, window // 2)).mean()
        rolling_std = series.rolling(window=window, min_periods=max(2, window // 2)).std()
        rolling_std = rolling_std.replace(0, np.nan)
        z = (series - rolling_mean) / rolling_std
        return z.fillna(0.0)

    elif mode == "percentile":
        # Rolling percentile: percentage of values in window <= current value
        def calc_pct(window_vals):
            cur = window_vals[-1]
            return (np.sum(window_vals <= cur) / len(window_vals)) * 100.0

        pct = series.rolling(window=window, min_periods=max(2, window // 2)).apply(calc_pct, raw=True)
        return pct.fillna(50.0)

    return series

def format_normalized_display(value: float, mode: str) -> str:
    """Returns human-friendly string for display in Signals Feed."""
    if mode == "z_score":
        sign = "+" if value >= 0 else ""
        return f"z: {sign}{value:.1f}σ"
    elif mode == "atr_pct":
        return f"{value:.1f}% ATR"
    elif mode == "percentile":
        return f"pct: {value:.0f}%"
    else:
        return f"{value:.2f}"
