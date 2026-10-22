"""Cached OpenRouter model catalog and user-selectable AI configuration."""

import json
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

import aiohttp

from backend.app.config import BASE_DIR, OPENROUTER_API_KEY


OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
CACHE_TTL_SECONDS = 6 * 60 * 60
DEFAULT_AI_CONFIG = {
    "selected_model": "google/gemini-2.0-flash-001",
    "favorite_models": [],
    "fallback_model": "google/gemini-2.0-flash-001",
    "temperature": 0.2,
}
CURATED_ROLES = {
    "deepseek/deepseek-r1": ["strategy_reasoning", "quant_copilot"],
    "anthropic/claude-3.7-sonnet": ["strategy_reasoning", "quant_copilot"],
    "openai/o3-mini": ["strategy_reasoning", "quant_copilot"],
    "google/gemini-2.0-flash-001": ["fast_signal_tuning", "low_latency"],
    "meta-llama/llama-3.3-70b-instruct": ["fast_signal_tuning", "low_latency"],
    "deepseek/deepseek-r1:free": ["strategy_reasoning", "free"],
    "meta-llama/llama-3.3-70b-instruct:free": ["fast_signal_tuning", "free"],
    "google/gemini-2.0-flash-lite:free": ["fast_signal_tuning", "free"],
}


class OpenRouterModelHub:
    def __init__(self, config_path: Optional[Path] = None, cache_path: Optional[Path] = None) -> None:
        storage_dir = BASE_DIR / "backend" / "data"
        self.config_path = config_path or storage_dir / "ai_config.json"
        self.cache_path = cache_path or storage_dir / "openrouter_models_cache.json"
        self._models: List[Dict[str, Any]] = []
        self._cached_at = 0.0

    @staticmethod
    def _is_free(model: Dict[str, Any]) -> bool:
        pricing = model.get("pricing") or {}
        try:
            zero_pricing = float(pricing.get("prompt", 1)) == 0 and float(pricing.get("completion", 1)) == 0
        except (TypeError, ValueError):
            zero_pricing = False
        return zero_pricing or str(model.get("id", "")).lower().endswith(":free")

    @classmethod
    def _normalize(cls, models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        rows = []
        for model in models:
            model_id = str(model.get("id", "")).strip()
            if not model_id:
                continue
            rows.append({
                "id": model_id,
                "name": str(model.get("name") or model_id),
                "context_length": int(model.get("context_length") or 0),
                "pricing": model.get("pricing") or {},
                "is_free": cls._is_free(model),
                "recommended_for": CURATED_ROLES.get(model_id, []),
            })
        return sorted(rows, key=lambda item: (not item["is_free"], item["name"].lower()))

    def _read_cache(self) -> bool:
        try:
            cached = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if time.time() - float(cached.get("cached_at", 0)) < CACHE_TTL_SECONDS:
                self._models = list(cached.get("models") or [])
                self._cached_at = float(cached["cached_at"])
                return bool(self._models)
        except (OSError, ValueError, TypeError):
            pass
        return False

    def _write_cache(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps({"cached_at": self._cached_at, "models": self._models}, ensure_ascii=False), encoding="utf-8")

    async def fetch_available_models(
        self,
        *,
        force_refresh: bool = False,
        fetcher: Optional[Callable[[], Awaitable[List[Dict[str, Any]]]]] = None,
    ) -> List[Dict[str, Any]]:
        if not force_refresh and self._models and time.time() - self._cached_at < CACHE_TTL_SECONDS:
            return self._models
        if not force_refresh and self._read_cache():
            return self._models
        try:
            if fetcher:
                raw_models = await fetcher()
            else:
                headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}"} if OPENROUTER_API_KEY else {}
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12)) as session:
                    async with session.get(OPENROUTER_MODELS_URL, headers=headers) as response:
                        response.raise_for_status()
                        raw_models = (await response.json()).get("data", [])
            self._models = self._normalize(raw_models)
            self._cached_at = time.time()
            self._write_cache()
        except Exception:
            # Settings remain usable offline with the last known in-memory/disk catalog.
            if not self._models:
                self._read_cache()
        return self._models

    def get_config(self) -> Dict[str, Any]:
        try:
            loaded = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            loaded = {}
        return {**DEFAULT_AI_CONFIG, **{key: loaded[key] for key in DEFAULT_AI_CONFIG if key in loaded}}

    def save_config(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        config = {**self.get_config(), **{key: payload[key] for key in DEFAULT_AI_CONFIG if key in payload}}
        config["selected_model"] = str(config["selected_model"]).strip()
        config["fallback_model"] = str(config["fallback_model"]).strip()
        config["favorite_models"] = list(dict.fromkeys(str(item).strip() for item in config["favorite_models"] if str(item).strip()))
        config["temperature"] = min(2.0, max(0.0, float(config["temperature"])))
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        return config


openrouter_model_hub = OpenRouterModelHub()
