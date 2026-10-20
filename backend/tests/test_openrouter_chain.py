"""
Unit tests for resilient OpenRouter model cascade chain:
- 402 Insufficient Balance -> immediate skip to fallback without retries
- 429 Rate Limit -> retry max 2 times with backoff, then cascade to fallback
- Request Timeout (20s) -> cascade to fallback
- Empty response -> cascade to fallback
- Unavailable model (models API 1-hour cache) -> skipped
- Daily budget ceiling -> paid models disabled, fallback used
- No real keys used
"""

import asyncio
from unittest.mock import patch, MagicMock
import pytest
from backend.app.services.openrouter_client import OpenRouterClient


class MockAsyncResponse:
    def __init__(self, status: int, json_data: dict = None, text_data: str = ""):
        self.status = status
        self._json_data = json_data or {}
        self._text_data = text_data

    async def json(self):
        return self._json_data

    async def text(self):
        return self._text_data

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return None


class MockAsyncContext:
    def __init__(self, resp):
        self.resp = resp

    async def __aenter__(self):
        return self.resp

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        return None


@pytest.mark.anyio
async def test_openrouter_402_immediate_skip_without_retries():
    """Requirement 3: 402 (нет баланса) переходит на следующий шаг цепочки сразу."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="deepseek/deepseek-v4.1-flash",
        fallback_model="openrouter/free",
        daily_budget_usd=1.00,
        timeout_sec=5.0,
    )
    # Populate models cache so models are considered available
    client._models_cache = {"deepseek/deepseek-v4.1-flash", "openrouter/free"}
    client._models_cache_timestamp = 10000000000.0

    call_counts = {"primary": 0, "fallback": 0}

    def mock_post(url, headers=None, json=None):
        model = json.get("model")
        if model == "deepseek/deepseek-v4.1-flash":
            call_counts["primary"] += 1
            return MockAsyncContext(MockAsyncResponse(status=402, text_data="Insufficient credits"))
        elif model == "openrouter/free":
            call_counts["fallback"] += 1
            return MockAsyncContext(MockAsyncResponse(
                status=200,
                json_data={
                    "choices": [{"message": {"content": "VETO: FALSE\nCONFIDENCE: 0.90\nREASON: Одобрено free router"}}],
                    "usage": {"prompt_tokens": 50, "completion_tokens": 20, "total_tokens": 70, "total_cost": 0.0}
                }
            ))
        return MockAsyncContext(MockAsyncResponse(status=500))

    with patch("aiohttp.ClientSession.post", side_effect=mock_post):
        res = await client.chat_completion(
            messages=[{"role": "user", "content": "test"}],
            preferred_model="deepseek/deepseek-v4.1-flash",
        )

    # 402 should NOT be retried: primary called exactly once
    assert call_counts["primary"] == 1
    # Fallback model was used immediately
    assert call_counts["fallback"] == 1
    assert res["model"] == "openrouter/free"
    assert res["fallback"] is True
    assert "402 Payment Required" in res["fallback_reason"]
    assert "VETO: FALSE" in res["content"]


@pytest.mark.anyio
async def test_openrouter_429_retries_max_2_times_then_cascades():
    """Requirement 3: 429 повторяется с задержкой не более 2 раз."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="deepseek/deepseek-v4.1-flash",
        fallback_model="openrouter/free",
        daily_budget_usd=1.00,
        timeout_sec=5.0,
    )
    client._models_cache = {"deepseek/deepseek-v4.1-flash", "openrouter/free"}
    client._models_cache_timestamp = 10000000000.0

    call_counts = {"primary": 0, "fallback": 0}

    def mock_post(url, headers=None, json=None):
        model = json.get("model")
        if model == "deepseek/deepseek-v4.1-flash":
            call_counts["primary"] += 1
            return MockAsyncContext(MockAsyncResponse(status=429, text_data="Rate limit exceeded"))
        elif model == "openrouter/free":
            call_counts["fallback"] += 1
            return MockAsyncContext(MockAsyncResponse(
                status=200,
                json_data={
                    "choices": [{"message": {"content": "VETO: TRUE\nCONFIDENCE: 0.85\nREASON: Высокий риск"}}],
                    "usage": {"prompt_tokens": 40, "completion_tokens": 15, "total_tokens": 55, "total_cost": 0.0}
                }
            ))
        return MockAsyncContext(MockAsyncResponse(status=500))

    # Fast forward asyncio.sleep during retry delays
    with patch("aiohttp.ClientSession.post", side_effect=mock_post), \
         patch("asyncio.sleep", return_value=None):
        res = await client.chat_completion(
            messages=[{"role": "user", "content": "test"}],
            preferred_model="deepseek/deepseek-v4.1-flash",
        )

    # 1 initial attempt + 2 retries = 3 attempts total for primary
    assert call_counts["primary"] == 3
    # Then cascade to fallback
    assert call_counts["fallback"] == 1
    assert res["model"] == "openrouter/free"
    assert res["fallback"] is True
    assert "429 Rate Limit exceeded" in res["fallback_reason"]


@pytest.mark.anyio
async def test_openrouter_timeout_cascades_to_fallback():
    """Requirement 3: таймаут 20 с, переходит к fallback."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="deepseek/deepseek-v4.1-flash",
        fallback_model="openrouter/free",
        daily_budget_usd=1.00,
        timeout_sec=20.0,
    )
    client._models_cache = {"deepseek/deepseek-v4.1-flash", "openrouter/free"}
    client._models_cache_timestamp = 10000000000.0

    call_counts = {"primary": 0, "fallback": 0}

    def mock_post(url, headers=None, json=None):
        model = json.get("model")
        if model == "deepseek/deepseek-v4.1-flash":
            call_counts["primary"] += 1
            raise asyncio.TimeoutError()
        elif model == "openrouter/free":
            call_counts["fallback"] += 1
            return MockAsyncContext(MockAsyncResponse(
                status=200,
                json_data={
                    "choices": [{"message": {"content": "VETO: FALSE\nCONFIDENCE: 0.95\nREASON: Успешно после таймаута"}}],
                    "usage": {"prompt_tokens": 30, "completion_tokens": 10, "total_tokens": 40, "total_cost": 0.0}
                }
            ))
        return MockAsyncContext(MockAsyncResponse(status=500))

    with patch("aiohttp.ClientSession.post", side_effect=mock_post):
        res = await client.chat_completion(
            messages=[{"role": "user", "content": "test"}],
            preferred_model="deepseek/deepseek-v4.1-flash",
        )

    assert call_counts["primary"] == 1
    assert call_counts["fallback"] == 1
    assert res["model"] == "openrouter/free"
    assert res["fallback"] is True
    assert "Timeout" in res["fallback_reason"]


@pytest.mark.anyio
async def test_openrouter_empty_response_cascades_to_fallback():
    """Requirement 7: пустой ответ каскадирует к fallback."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="deepseek/deepseek-v4.1-flash",
        fallback_model="openrouter/free",
        daily_budget_usd=1.00,
        timeout_sec=5.0,
    )
    client._models_cache = {"deepseek/deepseek-v4.1-flash", "openrouter/free"}
    client._models_cache_timestamp = 10000000000.0

    call_counts = {"primary": 0, "fallback": 0}

    def mock_post(url, headers=None, json=None):
        model = json.get("model")
        if model == "deepseek/deepseek-v4.1-flash":
            call_counts["primary"] += 1
            return MockAsyncContext(MockAsyncResponse(status=200, json_data={"choices": []}))
        elif model == "openrouter/free":
            call_counts["fallback"] += 1
            return MockAsyncContext(MockAsyncResponse(
                status=200,
                json_data={
                    "choices": [{"message": {"content": "VETO: FALSE\nCONFIDENCE: 0.90\nREASON: Нормальный ответ"}}],
                    "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30, "total_cost": 0.0}
                }
            ))
        return MockAsyncContext(MockAsyncResponse(status=500))

    with patch("aiohttp.ClientSession.post", side_effect=mock_post):
        res = await client.chat_completion(
            messages=[{"role": "user", "content": "test"}],
            preferred_model="deepseek/deepseek-v4.1-flash",
        )

    assert call_counts["primary"] == 1
    assert call_counts["fallback"] == 1
    assert res["model"] == "openrouter/free"
    assert res["fallback"] is True


@pytest.mark.anyio
async def test_openrouter_unavailable_model_skipped_via_models_cache():
    """Requirement 2: Проверка модели через models API (кэш на час). Недоступную модель пропускать."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="non_existent/model-xyz",
        fallback_model="openrouter/free",
        daily_budget_usd=1.00,
        timeout_sec=5.0,
    )
    # Cache does NOT include non_existent/model-xyz
    client._models_cache = {"meta-llama/llama-3.1-8b-instruct:free"}
    client._models_cache_timestamp = 10000000000.0

    called_models = []

    def mock_post(url, headers=None, json=None):
        model = json.get("model")
        called_models.append(model)
        return MockAsyncContext(MockAsyncResponse(
            status=200,
            json_data={
                "choices": [{"message": {"content": "VETO: FALSE\nCONFIDENCE: 0.88\nREASON: Рабочая модель"}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30, "total_cost": 0.0}
            }
        ))

    with patch("aiohttp.ClientSession.post", side_effect=mock_post):
        res = await client.chat_completion(
            messages=[{"role": "user", "content": "test"}],
            preferred_model="non_existent/model-xyz",
        )

    # non_existent/model-xyz was never called over HTTP
    assert "non_existent/model-xyz" not in called_models
    assert res["fallback"] is True
    assert "not present in OpenRouter models catalog" in res["fallback_reason"]


@pytest.mark.anyio
async def test_openrouter_daily_spending_ceiling_disables_paid_models():
    """Requirement 5: Суточный потолок расходов: при превышении платные модели отключаются."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="deepseek/deepseek-v4.1-flash",
        fallback_model="openrouter/free",
        daily_budget_usd=0.50,
        timeout_sec=5.0,
    )
    client._models_cache = {"deepseek/deepseek-v4.1-flash", "openrouter/free"}
    client._models_cache_timestamp = 10000000000.0

    # Simulate already spent $0.51 today
    client.daily_spent_usd = 0.51

    called_models = []

    def mock_post(url, headers=None, json=None):
        model = json.get("model")
        called_models.append(model)
        return MockAsyncContext(MockAsyncResponse(
            status=200,
            json_data={
                "choices": [{"message": {"content": "VETO: FALSE\nCONFIDENCE: 0.85\nREASON: Ответ бесплатного роутера"}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30, "total_cost": 0.0}
            }
        ))

    with patch("aiohttp.ClientSession.post", side_effect=mock_post):
        res = await client.chat_completion(
            messages=[{"role": "user", "content": "test"}],
            preferred_model="deepseek/deepseek-v4.1-flash",
        )

    # Paid model deepseek/deepseek-v4.1-flash was never called
    assert "deepseek/deepseek-v4.1-flash" not in called_models
    # Free router was called directly
    assert called_models == ["openrouter/free"]
    assert res["model"] == "openrouter/free"
    assert res["fallback"] is True
    assert "Daily budget ceiling reached" in res["fallback_reason"]


@pytest.mark.anyio
async def test_openrouter_complete_failure_engages_quant_fallback():
    """Requirement 1 & 6: При полном отказе работает детерминированный quant fallback."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="deepseek/deepseek-v4.1-flash",
        fallback_model="openrouter/free",
        daily_budget_usd=1.00,
        timeout_sec=5.0,
    )
    client._models_cache = {"deepseek/deepseek-v4.1-flash", "openrouter/free"}
    client._models_cache_timestamp = 10000000000.0

    def mock_post(url, headers=None, json=None):
        return MockAsyncContext(MockAsyncResponse(status=500, text_data="Internal Server Error"))

    setup = {
        "direction": "LONG",
        "entry_price": 80000.0,
        "stop_loss": 79000.0,
        "take_profit": 83000.0,
        "rr_ratio": 3.0,
        "reason": "Wall bounce",
    }
    snapshot = {
        "price": 80000.0,
        "depth_delta_pct": 15.0,
        "strongest_magnet": "SHORTS_ABOVE",
        "funding_rate": 0.0001,
        "atr": 300.0,
    }

    with patch("aiohttp.ClientSession.post", side_effect=mock_post):
        eval_res = await client.evaluate_trade_risk("BTCUSDT", setup, snapshot)

    assert eval_res["model"] == "local_quant_fallback"
    assert eval_res["fallback"] is True
    assert eval_res["verdict"] == "CONFIRM"
    assert "Квант-фильтр" in eval_res["reason"]


@pytest.mark.anyio
async def test_openrouter_telemetry_logging():
    """Requirement 4: Каждый вызов логируется: модель, задержка, токены, стоимость, статус, fallback."""
    client = OpenRouterClient(
        api_key="sk-or-v1-mock-test-key",
        primary_model="deepseek/deepseek-v4.1-flash",
        daily_budget_usd=1.00,
        timeout_sec=5.0,
    )
    client._models_cache = {"deepseek/deepseek-v4.1-flash"}
    client._models_cache_timestamp = 10000000000.0

    def mock_post(url, headers=None, json=None):
        return MockAsyncContext(MockAsyncResponse(
            status=200,
            json_data={
                "choices": [{"message": {"content": "VETO: TRUE\nCONFIDENCE: 0.92\nREASON: Превышен риск"}}],
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 30,
                    "total_tokens": 150,
                    "total_cost": 0.000021
                }
            }
        ))

    with patch("aiohttp.ClientSession.post", side_effect=mock_post):
        setup = {"direction": "SHORT", "entry_price": 80000.0, "stop_loss": 81000.0, "take_profit": 77000.0, "rr_ratio": 3.0}
        snapshot = {"price": 80000.0, "depth_delta_pct": 5.0, "strongest_magnet": "LONGS_BELOW", "funding_rate": 0.0, "atr": 200.0}
        res = await client.evaluate_trade_risk("BTCUSDT", setup, snapshot)

    assert len(client.call_history) >= 1
    last_log = client.call_history[-1]
    assert last_log["model"] == "deepseek/deepseek-v4.1-flash"
    assert last_log["total_tokens"] == 150
    assert last_log["cost"] == 0.000021
    assert last_log["status"] == "SUCCESS"
    assert last_log["fallback"] is False
    assert last_log["latency_ms"] >= 0
