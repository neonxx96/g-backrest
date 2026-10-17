"""
ATR (Average True Range) Indicator Plugin
"""

from typing import Dict, Any, Optional
import pandas as pd
from backend.app.services.indicators.base import BaseIndicator

class ATRIndicator(BaseIndicator):
    @property
    def name(self) -> str:
        return "atr"

    @property
    def display_name(self) -> str:
        return "ATR (Средний истинный диапазон)"

    @property
    def description(self) -> str:
        return "Оценка рыночной волатильности цены."

    @property
    def params_schema(self) -> Dict[str, Any]:
        return {
            "period": {
                "type": "int",
                "default": 14,
                "min": 2,
                "max": 100,
                "label": "Период ATR"
            },
            "min_volatility_pct": {
                "type": "float",
                "default": 0.5,
                "min": 0.1,
                "max": 10.0,
                "label": "Мин. волатильность (% цены)"
            }
        }

    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        if df.empty or len(df) < 2:
            return df

        df = df.copy()
        p = {**self.default_params, **(params or {})}
        period = int(p.get("period", 14))

        high_low = df["high"] - df["low"]
        high_close = (df["high"] - df["close"].shift()).abs()
        low_close = (df["low"] - df["close"].shift()).abs()
        tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        df["atr"] = tr.rolling(window=period).mean()
        df["atr_pct"] = (df["atr"] / df["close"]) * 100.0
        return df

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if len(df) < 1 or "atr_pct" not in df.columns:
            return None

        p = {**self.default_params, **(params or {})}
        min_pct = float(p.get("min_volatility_pct", 0.5))
        val = df.iloc[-1]["atr_pct"]

        if not pd.isna(val) and val >= min_pct:
            return {
                "condition_type": "HIGH_VOLATILITY",
                "direction": "VOLATILE",
                "description": f"Повышенная волатильность ATR {val:.2f}% >= {min_pct}%",
                "raw_value": float(val),
                "metric_name": "atr_pct"
            }
        return None
