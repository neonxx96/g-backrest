"""
VWAP (Volume Weighted Average Price) Indicator Plugin
Calculates benchmark order flow price based on volume weighting.
"""

from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
from backend.app.services.indicators.base import BaseIndicator

class VWAPIndicator(BaseIndicator):
    @property
    def name(self) -> str:
        return "vwap"

    @property
    def display_name(self) -> str:
        return "VWAP (Volume Weighted Avg Price)"

    @property
    def description(self) -> str:
        return "Средневзвешенная по объему цена институционального порядка."

    @property
    def params_schema(self) -> Dict[str, Any]:
        return {
            "window": {
                "type": "int",
                "default": 0,  # 0 means cumulative session/whole df, >0 means rolling
                "min": 0,
                "max": 200,
                "label": "Окно (0=полное/сессия)"
            },
            "deviation_threshold_pct": {
                "type": "float",
                "default": 1.5,
                "min": 0.1,
                "max": 10.0,
                "label": "Порог отклонения (%)"
            }
        }

    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        if df.empty or len(df) < 2:
            return df

        df = df.copy()
        p = {**self.default_params, **(params or {})}
        window = int(p.get("window", 0))

        typical_price = (df["high"] + df["low"] + df["close"]) / 3.0
        pv = typical_price * df["volume"]

        if window > 0:
            cum_pv = pv.rolling(window=window, min_periods=1).sum()
            cum_vol = df["volume"].rolling(window=window, min_periods=1).sum()
        else:
            cum_pv = pv.cumsum()
            cum_vol = df["volume"].cumsum()

        df["vwap"] = cum_pv / cum_vol.replace(0, np.nan)
        df["vwap_deviation_pct"] = ((df["close"] - df["vwap"]) / df["vwap"]) * 100.0
        return df

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if len(df) < 2 or "vwap" not in df.columns:
            return None

        p = {**self.default_params, **(params or {})}
        prev = df.iloc[-2]
        curr = df.iloc[-1]

        # Bullish cross above VWAP
        if prev["close"] <= prev["vwap"] and curr["close"] > curr["vwap"]:
            return {
                "condition_type": "VWAP_CROSS",
                "direction": "BULLISH",
                "description": f"Цена пробила VWAP снизу вверх ({curr['close']:.2f} > {curr['vwap']:.2f})",
                "raw_value": float(curr["vwap_deviation_pct"]),
                "metric_name": "vwap_dev"
            }
        # Bearish cross below VWAP
        elif prev["close"] >= prev["vwap"] and curr["close"] < curr["vwap"]:
            return {
                "condition_type": "VWAP_CROSS",
                "direction": "BEARISH",
                "description": f"Цена пробила VWAP сверху вниз ({curr['close']:.2f} < {curr['vwap']:.2f})",
                "raw_value": float(curr["vwap_deviation_pct"]),
                "metric_name": "vwap_dev"
            }

        # Check extreme deviation
        thresh = float(p.get("deviation_threshold_pct", 1.5))
        dev = curr["vwap_deviation_pct"]
        if abs(dev) >= thresh:
            direction = "OVEREXTENDED_HIGH" if dev > 0 else "OVEREXTENDED_LOW"
            return {
                "condition_type": "VWAP_DEV",
                "direction": direction,
                "description": f"Отклонение от VWAP {dev:+.2f}% превысило порог {thresh}%",
                "raw_value": float(dev),
                "metric_name": "vwap_dev"
            }

        return None
