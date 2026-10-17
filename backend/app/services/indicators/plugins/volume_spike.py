"""
Volume Spike Indicator Plugin
"""

from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
from backend.app.services.indicators.base import BaseIndicator

class VolumeSpikeIndicator(BaseIndicator):
    @property
    def name(self) -> str:
        return "volume_spike"

    @property
    def display_name(self) -> str:
        return "Volume Spike (Всплеск объема)"

    @property
    def description(self) -> str:
        return "Выявляет аномальные всплески объема относительно скользящей средней."

    @property
    def params_schema(self) -> Dict[str, Any]:
        return {
            "ma_period": {
                "type": "int",
                "default": 20,
                "min": 5,
                "max": 100,
                "label": "Период MA объема"
            },
            "spike_mult": {
                "type": "float",
                "default": 2.0,
                "min": 1.2,
                "max": 10.0,
                "label": "Множитель всплеска (xN)"
            }
        }

    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        if df.empty or len(df) < 2:
            return df

        df = df.copy()
        p = {**self.default_params, **(params or {})}
        period = int(p.get("ma_period", 20))

        df["vol_ma20"] = df["volume"].rolling(window=period).mean()
        df["vol_ratio"] = df["volume"] / df["vol_ma20"].replace(0, np.nan)
        return df

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if len(df) < 1 or "vol_ratio" not in df.columns:
            return None

        p = {**self.default_params, **(params or {})}
        mult = float(p.get("spike_mult", 2.0))
        val = df.iloc[-1]["vol_ratio"]

        if not pd.isna(val) and val >= mult:
            return {
                "condition_type": "VOL_SPIKE",
                "direction": "ALERT",
                "description": f"Всплеск объема в {val:.1f}x выше среднего MA",
                "raw_value": float(val),
                "metric_name": "vol_ratio"
            }
        return None
