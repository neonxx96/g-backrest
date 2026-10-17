"""
Base Plugin Interface for Technical & Order Flow Indicators.
Allows hot-plugging new indicators without modifying core scanning or chart logic.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import pandas as pd

class BaseIndicator(ABC):
    """Abstract Base Class for an Indicator Plugin."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique identifier key, e.g. 'vwap', 'ema', 'rsi'."""
        pass

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable display name, e.g. 'VWAP (Volume Weighted Avg Price)'."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Short summary of what the indicator calculates and indicates."""
        pass

    @property
    @abstractmethod
    def params_schema(self) -> Dict[str, Any]:
        """
        JSON schema-like description of parameters:
        {
            "period": {"type": "int", "default": 14, "min": 2, "max": 200, "label": "Период"},
            ...
        }
        """
        pass

    @property
    def default_params(self) -> Dict[str, Any]:
        """Extracts default values from params_schema."""
        return {k: v.get("default") for k, v in self.params_schema.items() if "default" in v}

    @abstractmethod
    def compute(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> pd.DataFrame:
        """
        Computes indicator columns and appends them to df.
        Must return df with new columns.
        """
        pass

    def check_signal(self, df: pd.DataFrame, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """
        Evaluates trigger condition on the last completed candle.
        Returns None or signal dict:
        {
            "condition_type": "VWAP_CROSS",
            "direction": "BULLISH" | "BEARISH",
            "description": "...",
            "raw_value": float,
            "metric_name": "vwap_deviation_pct"
        }
        """
        return None
