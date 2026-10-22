"""Read/write endpoints for user-selectable OpenRouter models."""

import time
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.openrouter_client import openrouter_client
from backend.app.services.openrouter_service import openrouter_model_hub


router = APIRouter(prefix="/api/ai", tags=["ai-settings"])


class AIConfigRequest(BaseModel):
    selected_model: str = Field(min_length=1, max_length=200)
    favorite_models: List[str] = Field(default_factory=list, max_length=50)
    fallback_model: str = Field(default="google/gemini-2.0-flash-001", min_length=1, max_length=200)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)


@router.get("/models")
async def get_models(force_refresh: bool = False):
    return {"models": await openrouter_model_hub.fetch_available_models(force_refresh=force_refresh)}


@router.get("/config")
async def get_config():
    return openrouter_model_hub.get_config()


@router.post("/config")
async def save_config(payload: AIConfigRequest):
    config = openrouter_model_hub.save_config(payload.model_dump())
    openrouter_client.primary_model = config["selected_model"]
    openrouter_client.fallback_model = config["fallback_model"]
    return config


@router.post("/test-connection")
async def test_connection():
    config = openrouter_model_hub.get_config()
    started = time.perf_counter()
    result = await openrouter_client.chat_completion(
        messages=[{"role": "user", "content": "pong"}],
        preferred_model=config["selected_model"],
        temperature=config["temperature"],
        max_tokens=8,
    )
    return {
        "status": "ok" if not result.get("fallback") else "fallback",
        "model": result.get("model"),
        "latency_ms": int((time.perf_counter() - started) * 1000),
        "fallback_reason": result.get("fallback_reason"),
    }
