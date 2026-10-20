import pytest

from backend.app.services.openrouter_service import OpenRouterModelHub


def test_model_hub_marks_free_models_adds_roles_and_restores_disk_cache(tmp_path):
    hub = OpenRouterModelHub(config_path=tmp_path / "ai_config.json", cache_path=tmp_path / "models.json")
    hub._models = hub._normalize([
        {"id": "deepseek/deepseek-r1:free", "name": "DeepSeek R1 Free", "context_length": 16384, "pricing": {"prompt": "0", "completion": "0"}},
        {"id": "google/gemini-2.0-flash-001", "name": "Gemini Flash", "context_length": 1000000, "pricing": {"prompt": "0.1", "completion": "0.4"}},
    ])
    hub._cached_at = __import__("time").time()
    hub._write_cache()
    restored = OpenRouterModelHub(config_path=tmp_path / "ai_config.json", cache_path=tmp_path / "models.json")

    assert restored._read_cache() is True
    assert restored._models[0]["is_free"] is True
    assert "strategy_reasoning" in restored._models[0]["recommended_for"]
    assert restored._models[1]["is_free"] is False
    assert "fast_signal_tuning" in restored._models[1]["recommended_for"]


def test_model_hub_persists_validated_user_config(tmp_path):
    hub = OpenRouterModelHub(config_path=tmp_path / "ai_config.json", cache_path=tmp_path / "models.json")

    saved = hub.save_config({
        "selected_model": "deepseek/deepseek-r1:free",
        "favorite_models": ["deepseek/deepseek-r1:free", "deepseek/deepseek-r1:free"],
        "fallback_model": "google/gemini-2.0-flash-001",
        "temperature": 0.35,
    })

    assert saved["selected_model"] == "deepseek/deepseek-r1:free"
    assert saved["favorite_models"] == ["deepseek/deepseek-r1:free"]
    assert saved["temperature"] == pytest.approx(0.35)
    assert hub.get_config() == saved
