"""Контракт «бесплатная нейронка по умолчанию + авто-переключение при ошибке» (запрос Di 2026-10-24).

До фикса схемы AI-роутеров жёстко дефолтились на платную google/gemini-2.0-flash-001,
из-за чего свободная модель из .env (OPENROUTER_MODEL=recursive/flint-v1.0:free) не
применялась никогда. Теперь: model=None → бэкенд берёт OPENROUTER_MODEL, а при ошибке/
402/429 каскад query_with_fallback переключается на следующую бесплатную модель.
"""
import inspect

from backend.app.config import OPENROUTER_FREE_MODELS, OPENROUTER_MODEL
from backend.app.routers.ai_copilot import (
    AIChatRequest,
    MarketAnalysisRequest,
    ValidateKeyRequest,
    chat_with_copilot,
    get_market_analysis,
)
from backend.app.services.ai_service import ai_service


def test_chat_request_defaults_to_free_env_model():
    assert AIChatRequest(message="привет").model is None


def test_market_analysis_defaults_to_free_env_model():
    assert MarketAnalysisRequest().model is None


def test_validate_key_defaults_to_free_env_model():
    assert ValidateKeyRequest().model is None


def test_chat_routes_through_fallback_cascade():
    src = inspect.getsource(chat_with_copilot)
    assert "query_with_fallback" in src, "чат должен идти через каскад бесплатных моделей"


def test_market_analysis_routes_through_fallback_cascade():
    src = inspect.getsource(get_market_analysis)
    assert "query_with_fallback" in src, "live-sentinel обогащение должно идти через каскад"


def test_free_models_catalog_configured():
    assert OPENROUTER_FREE_MODELS, "каталог бесплатных моделей OpenRouter пуст"
    assert OPENROUTER_MODEL, "OPENROUTER_MODEL не задан"
    assert OPENROUTER_MODEL in OPENROUTER_FREE_MODELS, (
        "модель по умолчанию должна быть бесплатной — иначе тратим деньги Di"
    )


def test_effective_models_prefers_selected_then_free():
    eff = ai_service.get_effective_models("some-model:free")
    assert eff[0] == "some-model:free"
    assert len(eff) > 1, "за выбранной моделью должны следовать запасные бесплатные"
