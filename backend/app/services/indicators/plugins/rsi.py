"""
RSI (Relative Strength Index) Indicator Plugin
"""

from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
from backend.app.services.indicators.base import BaseIndicator

class RSIIndicator(BaseIndicator):
    @property
    def name(self) -> str:
        return "rsi"

    @property
    def display_name(self) -> str:
        return "RSI (Индекс относительной силы)"

    @property
    def description(self) -> str:
        return "Осциллятор зон перекупленности и перепроданности."

    @property
    def params_schema(self) -> Dict[str, Any]:
        return {
            "period": {
                "type": "int",
                "default": 14,
                "min": 2,
                "max": 100,
                "label": "Период RSI"
            },
            "rsi_min": {
                "type": "float",
                "default": 30.0,
                "min": 5.0,
                "max": 50.0,
                "label": "Нижняя граница (Перепроданность)"
            },
            "rsi_max": {
                "type": "float",
                "default": 70.0,
                "min": 50.0,
                "max": 95.0,
                "label": "Верхняя граница (Перекупленность)"
            }
        }

    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        if df.empty or len(df) < 5:
            return df

        df = df.copy()
        p = {**self.default_params, **(params or {})}
        period = int(p.get("period", 14))

        delta = df["close"].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.ewm(com=period - 1, adjust=False).mean()
        avg_loss = loss.ewm(com=period - 1, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        df["rsi"] = 100 - (100 / (1 + rs))
        return df

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if len(df) < 1 or "rsi" not in df.columns:
            return None

        p = {**self.default_params, **(params or {})}
        rsi_min = float(p.get("rsi_min", 30.0))
        rsi_max = float(p.get("rsi_max", 70.0))
        curr_rsi = df.iloc[-1]["rsi"]

        if pd.isna(curr_rsi):
            return None

        if curr_rsi <= rsi_min:
            return {
                "condition_type": "RSI_EXTREME",
                "direction": "OVERSOLD",
                "description": f"RSI перепродан ({curr_rsi:.1f} <= {rsi_min})",
                "raw_value": float(curr_rsi),
                "metric_name": "rsi"
            }
        elif curr_rsi >= rsi_max:
            return {
                "condition_type": "RSI_EXTREME",
                "direction": "OVERBOUGHT",
                "description": f"RSI перекуплен ({curr_rsi:.1f} >= {rsi_max})",
                "raw_value": float(curr_rsi),
                "metric_name": "rsi"
            }
        return None
