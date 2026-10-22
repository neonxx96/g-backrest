"""
Open Interest (OI) Indicator Plugin (SRS M2.1).

Truth-first: OI is NOT derivable from OHLCV klines. When the dataframe has no
OI column (`oi` / `open_interest`), the plugin returns it unchanged — no
synthesis, no proxies. When the column is present (live feed or enriched
historical dataset), it computes OI deltas and buildup/flush signals.
"""

from typing import Dict, Any, Optional

import numpy as np
import pandas as pd

from backend.app.services.indicators.base import BaseIndicator

OI_COLUMN_CANDIDATES = ("oi", "open_interest")


class OpenInterestIndicator(BaseIndicator):
    @property
    def name(self) -> str:
        return "oi"

    @property
    def display_name(self) -> str:
        return "Open Interest (Открытый интерес)"

    @property
    def description(self) -> str:
        return "Дельта открытого интереса: наращивание/сброс позиций. Без реальных данных OI колонка не синтезируется."

    @property
    def params_schema(self) -> Dict[str, Any]:
        return {
            "delta_periods": {
                "type": "int",
                "default": 4,
                "min": 1,
                "max": 100,
                "label": "Окно дельты (баров)"
            },
            "signal_threshold_pct": {
                "type": "float",
                "default": 1.0,
                "min": 0.1,
                "max": 50.0,
                "label": "Порог сигнала (%)"
            }
        }

    @staticmethod
    def _oi_column(df: pd.DataFrame) -> Optional[str]:
        for column in OI_COLUMN_CANDIDATES:
            if column in df.columns:
                return column
        return None

    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        column = self._oi_column(df)
        if df.empty or column is None:
            # Truth-first: nothing to compute, nothing to invent.
            return df

        df = df.copy()
        p = {**self.default_params, **(params or {})}
        periods = max(1, int(p.get("delta_periods", 4)))

        oi = pd.to_numeric(df[column], errors="coerce")
        df["oi"] = oi
        df["oi_delta"] = oi.diff(periods)
        base = oi.shift(periods).replace(0, np.nan)
        df["oi_delta_pct"] = (df["oi_delta"] / base) * 100.0
        return df

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        if len(df) < 2 or "oi_delta_pct" not in df.columns:
            return None

        p = {**self.default_params, **(params or {})}
        threshold = float(p.get("signal_threshold_pct", 1.0))
        current = df.iloc[-1]
        delta_pct = current.get("oi_delta_pct")
        if delta_pct is None or pd.isna(delta_pct):
            return None

        delta_pct = float(delta_pct)
        if delta_pct >= threshold:
            return {
                "condition_type": "OI_BUILDUP",
                "direction": "BULLISH",
                "description": f"Открытый интерес растёт ({delta_pct:+.2f}% ≥ {threshold}%) — наращивание позиций",
                "raw_value": delta_pct,
                "metric_name": "oi_delta_pct"
            }
        if delta_pct <= -threshold:
            return {
                "condition_type": "OI_FLUSH",
                "direction": "BEARISH",
                "description": f"Открытый интерес падает ({delta_pct:+.2f}% ≤ -{threshold}%) — сброс позиций",
                "raw_value": delta_pct,
                "metric_name": "oi_delta_pct"
            }
        return None
