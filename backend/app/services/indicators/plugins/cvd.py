"""
CVD (Cumulative Volume Delta) Indicator Plugin
"""

from typing import Dict, Any, Optional
import pandas as pd
from backend.app.services.indicators.base import BaseIndicator

class CVDIndicator(BaseIndicator):
    @property
    def name(self) -> str:
        return "cvd"

    @property
    def display_name(self) -> str:
        return "CVD (Кумулятивная дельта объема)"

    @property
    def description(self) -> str:
        return "Накопленная разница рыночных покупок и продаж, поиск дивергенций."

    @property
    def params_schema(self) -> Dict[str, Any]:
        return {
            "lookback_bars": {
                "type": "int",
                "default": 3,
                "min": 2,
                "max": 10,
                "label": "Баров для дивергенции"
            }
        }

    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        if df.empty:
            return df

        df = df.copy()
        if "cvd" not in df.columns and "delta" in df.columns:
            df["cvd"] = df["delta"].cumsum()
        return df

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if len(df) < 3 or "cvd" not in df.columns:
            return None

        p1, p2, p3 = df["close"].iloc[-3], df["close"].iloc[-2], df["close"].iloc[-1]
        c1, c2, c3 = df["cvd"].iloc[-3], df["cvd"].iloc[-2], df["cvd"].iloc[-1]

        # Bullish divergence: price falling (lower lows) but CVD rising (higher highs/lows)
        if (p3 < p2 < p1 or p3 < p1) and (c3 > c2 > c1 or c3 > c1):
            return {
                "condition_type": "CVD_DIV",
                "direction": "BULLISH",
                "description": "Бычья дивергенция CVD: цена падает, но объемная дельта растет",
                "raw_value": float(c3 - c1),
                "metric_name": "cvd_delta"
            }
        # Bearish divergence: price rising (higher highs) but CVD falling (lower delta)
        elif (p3 > p2 > p1 or p3 > p1) and (c3 < c2 < c1 or c3 < c1):
            return {
                "condition_type": "CVD_DIV",
                "direction": "BEARISH",
                "description": "Медвежья дивергенция CVD: цена растет, но объемная дельта падает",
                "raw_value": float(c3 - c1),
                "metric_name": "cvd_delta"
            }
        return None
