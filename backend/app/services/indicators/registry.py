"""
Indicator Registry and Plugin Discovery Engine
Enables dynamic discovery and execution of technical indicator plugins.
"""

import importlib
import inspect
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Type
import pandas as pd

from backend.app.services.indicators.base import BaseIndicator

logger = logging.getLogger(__name__)

class IndicatorRegistry:
    def __init__(self):
        self._plugins: Dict[str, BaseIndicator] = {}
        self.auto_discover()

    def register(self, indicator: BaseIndicator):
        """Registers an indicator instance."""
        self._plugins[indicator.name] = indicator
        logger.debug(f"Registered indicator plugin: {indicator.name}")

    def get(self, name: str) -> Optional[BaseIndicator]:
        return self._plugins.get(name)

    def list_indicators(self) -> List[Dict[str, Any]]:
        """Returns schemas and metadata for all registered indicator plugins."""
        result = []
        for ind in self._plugins.values():
            result.append({
                "name": ind.name,
                "display_name": ind.display_name,
                "description": ind.description,
                "params_schema": ind.params_schema,
                "default_params": ind.default_params
            })
        return result

    def compute_all(self, df: pd.DataFrame, params_overrides: Optional[Dict[str, Dict[str, Any]]] = None) -> pd.DataFrame:
        """Runs compute on all registered indicators in order."""
        if df.empty:
            return df

        overrides = params_overrides or {}
        for name, ind in self._plugins.items():
            ind_params = overrides.get(name, {})
            try:
                df = ind.compute(df, params=ind_params)
            except Exception as e:
                logger.error(f"Error computing indicator {name}: {e}")
        return df

    def auto_discover(self):
        """Automatically scans the plugins directory and registers all BaseIndicator subclasses."""
        plugins_dir = Path(__file__).resolve().parent / "plugins"
        if not plugins_dir.exists():
            return

        for py_file in plugins_dir.glob("*.py"):
            if py_file.name.startswith("__"):
                continue
            module_name = f"backend.app.services.indicators.plugins.{py_file.stem}"
            try:
                mod = importlib.import_module(module_name)
                for attr_name in dir(mod):
                    attr = getattr(mod, attr_name)
                    if (
                        inspect.isclass(attr)
                        and issubclass(attr, BaseIndicator)
                        and attr is not BaseIndicator
                    ):
                        instance = attr()
                        self.register(instance)
            except Exception as e:
                logger.error(f"Failed to load indicator plugin from {py_file.name}: {e}")

registry = IndicatorRegistry()
