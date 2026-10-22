"""
Resilient OpenRouter AI Service with Automatic Free-Model Cascade & 402/429 Fallback.
Provides institutional grade second opinion, prompt parsing, and quantitative regime forecasting.
Guarantees zero crashes on HTTP 402 (Insufficient Funds) by cascading across reliable free models.
"""

import os
import re
import json
import asyncio
import logging
from typing import Dict, List, Optional, Any, Tuple
import aiohttp

from backend.app.config import OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_FREE_MODELS

logger = logging.getLogger("SignalScript.AIService")

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterAIService:
    def __init__(self):
        self.default_model = OPENROUTER_MODEL or "google/gemini-2.5-flash-free"
        self.free_models = list(OPENROUTER_FREE_MODELS)
        if self.default_model not in self.free_models:
            self.free_models.insert(0, self.default_model)

    def get_effective_models(self, preferred_model: Optional[str] = None) -> List[str]:
        """Constructs an ordered list of candidate models starting with preferred, then free fallbacks."""
        candidates = []
        if preferred_model and preferred_model.strip():
            candidates.append(preferred_model.strip())
        for m in self.free_models:
            if m not in candidates:
                candidates.append(m)
        return candidates

    async def query_with_fallback(
        self,
        messages: List[Dict[str, str]],
        preferred_model: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 500,
        api_key_override: Optional[str] = None,
        timeout_sec: float = 8.0,
    ) -> Tuple[Optional[str], Optional[str]]:
        """
        Queries OpenRouter across candidate free models.
        Gracefully catches 402 (Payment Required / Insufficient Funds) and 429 (Rate Limits)
        without raising errors, immediately falling back to the next free model in sequence.
        """
        eff_key = (api_key_override or OPENROUTER_API_KEY or "").strip()
        if not eff_key or "sk-or-v1" not in eff_key:
            return None, None

        headers = {
            "Authorization": f"Bearer {eff_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://127.0.0.1:5173",
            "X-Title": "SignalScript Quantitative Terminal"
        }

        models_to_try = self.get_effective_models(preferred_model)

        for idx, model in enumerate(models_to_try):
            payload = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }

            try:
                timeout = aiohttp.ClientTimeout(total=timeout_sec)
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(OPENROUTER_URL, headers=headers, json=payload) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            content = data["choices"][0]["message"]["content"].strip()
                            if idx > 0:
                                logger.info(f"OpenRouter successfully recovered using fallback free model '{model}'")
                            return content, model
                        
                        elif resp.status == 402:
                            err_msg = await resp.text()
                            logger.warning(
                                f"[WARNING] OpenRouter 402 Insufficient Balance on '{model}': {err_msg[:120]}. "
                                f"Switching to next free model in cascade (attempt {idx + 1}/{len(models_to_try)})..."
                            )
                        elif resp.status == 429:
                            err_msg = await resp.text()
                            logger.warning(
                                f"[WARNING] OpenRouter 429 Rate Limited on '{model}': {err_msg[:120]}. "
                                f"Switching to next free model in cascade..."
                            )
                        else:
                            err_msg = await resp.text()
                            logger.warning(
                                f"[WARNING] OpenRouter HTTP {resp.status} on '{model}': {err_msg[:120]}. "
                                f"Trying next fallback model..."
                            )

            except asyncio.TimeoutError:
                logger.warning(f"[WARNING] OpenRouter request timed out for model '{model}'. Trying next candidate...")
            except Exception as e:
                logger.warning(f"[WARNING] OpenRouter request exception for model '{model}': {e}. Trying next candidate...")

        logger.warning("[WARNING] All OpenRouter models exhausted in fallback cascade. Returning None.")
        return None, None

    async def get_second_opinion(
        self,
        symbol: str,
        price: float,
        indicators: Dict[str, Any],
        proposed_action: str = "LONG",
        api_key_override: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Consultative AI Second Opinion with free model cascade and 402 resilience.
        """
        system_prompt = (
            "Ты — строгий риск-менеджер проп-трейдинговой компании. "
            "Трейдер предлагает сделку. Проверь её по честным фактам индикаторов. "
            "Ответь СТРОГО в формате JSON:\n"
            "{\n"
            '  "verdict": "ЗА" | "ПРОТИВ" | "НЕЙТРАЛЬНО",\n'
            '  "confidence": 0.85,\n'
            '  "reason": "Одно предложение с чётким обоснованием на русском языке"\n'
            "}"
        )
        user_msg = (
            f"Монета: {symbol}, Текущая цена: {price}, Предлагаемый вход: {proposed_action}.\n"
            f"Индикаторы: {json.dumps(indicators, ensure_ascii=False)}"
        )

        content, used_model = await self.query_with_fallback(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg}
            ],
            api_key_override=api_key_override,
            max_tokens=220
        )

        if not content:
            return {
                "ai_available": False,
                "verdict": "AI НЕДОСТУПЕН",
                "reason": "Бесплатные модели OpenRouter временно недоступны. Принимай решение по индикаторам.",
                "model_used": None
            }

        # Clean JSON
        clean_text = content
        if clean_text.startswith("```"):
            clean_text = re.sub(r"^```(?:json)?", "", clean_text)
            clean_text = re.sub(r"```$", "", clean_text).strip()

        try:
            parsed = json.loads(clean_text)
            verdict = str(parsed.get("verdict", "НЕЙТРАЛЬНО")).upper()
            if "ЗА" in verdict and "ПРОТИВ" not in verdict:
                verdict = "ЗА"
            elif "ПРОТИВ" in verdict:
                verdict = "ПРОТИВ"
            else:
                verdict = "НЕЙТРАЛЬНО"
            return {
                "ai_available": True,
                "verdict": verdict,
                "reason": str(parsed.get("reason", content)).strip(),
                "model_used": used_model
            }
        except Exception:
            verdict = "ЗА" if "ЗА" in content.upper()[:25] else ("ПРОТИВ" if "ПРОТИВ" in content.upper()[:25] else "НЕЙТРАЛЬНО")
            return {
                "ai_available": True,
                "verdict": verdict,
                "reason": content[:250],
                "model_used": used_model
            }


ai_service = OpenRouterAIService()
