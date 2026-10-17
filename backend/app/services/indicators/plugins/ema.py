"""
EMA (Exponential Moving Average) Indicator Plugin
"""

from typing import Dict, Any, Optional
import pandas as pd
from backend.app.services.indicators.base import BaseIndicator

class EMAIndicator(BaseIndicator):
    @property
    def name(self) -> str:
        return "ema"

    @property
    def display_name(self) -> str:
        return "EMA (Экспоненциальная средняя)"

    @property
    def description(self) -> str:
        return "Трендовый фильтр и индикатор пересечения цены с EMA."

    @property
    def params_schema(self) -> Dict[str, Any]:
        return {
            "period": {
                "type": "int",
                "default": 20,
                "min": 2,
                "max": 200,
                "label": "Период EMA"
            }
        }

    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        if df.empty or len(df) < 2:
            return df

        df = df.copy()
        p = {**self.default_params, **(params or {})}
        period = int(p.get("period", 20))
        df[f"ema_{period}"] = df["close"].ewm(span=period, adjust=False).mean()
        # Keep alias ema_20 for backwards compatibility if period==20
        if period == 20:
            df["ema_20"] = df["ema_20"]
        return df

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        p = {**self.default_params, **(params or {})}
        period = int(p.get("period", 20))
        col = f"ema_{period}"
        if len(df) < 2 or col not in df.columns:
            return None

        prev = df.iloc[-2]
        curr = df.iloc[-1]

        if prev["close"] <= prev[col] and curr["close"] > curr[col]:
            return {
                "condition_type": "EMA_CROSS",
                "direction": "BULLISH",
                "description": f"Свеча пересекла EMA({period}) снизу вверх (BULLISH)",
                "raw_value": float(curr["close"] - curr[col]),
                "metric_name": "ema_diff"
            }
        elif prev["close"] >= prev[col] and curr["close"] < curr[col]:
            return {
                "condition_type": "EMA_CROSS",
                "direction": "BEARISH",
                "description": f"Свеча пересекла EMA({period}) сверху вниз (BEARISH)",
                "raw_value": float(curr["close"] - curr[col]),
                "metric_name": "ema_diff"
            }
        return None
