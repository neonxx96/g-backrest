"""
OpenRouter Client: Institutional AI Risk Copilot & Model Cascade Sentinel

Architecture:
- Dynamic model cascade: Primary (cost-effective paid model) -> Fallback (Free Models Router / free pool) -> Cold Quant Fallback
- Models catalog validation via OpenRouter models API (1-hour cache)
- Graceful 402 handling: immediately skips paid model without retries
- 429 rate-limit resilience: exponential backoff retry at most 2 times
- Strict 20s request timeout
- Telemetry & structured logging: model, latency, prompt/completion tokens, cost, status, fallback flag
- Daily spending budget ceiling: automatically disables paid models when daily threshold is exceeded
"""

import os
import re
import json
import time
import logging
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Set, Tuple
import aiohttp

from backend.app.config import (
    OPENROUTER_API_KEY,
    OPENROUTER_PRIMARY_MODEL,
    OPENROUTER_FALLBACK_MODEL,
    OPENROUTER_FREE_MODELS,
    OPENROUTER_DAILY_BUDGET_USD,
    OPENROUTER_TIMEOUT_SEC,
)

logger = logging.getLogger("SignalScript.OpenRouter")

OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


class OpenRouterClient:
    """
    Resilient OpenRouter client for AI Copilot, Sentinel and Live Paper Trading.
    Guarantees zero crashes and continuous operation via multi-layer model cascading.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        primary_model: Optional[str] = None,
        fallback_model: Optional[str] = None,
        free_models: Optional[List[str]] = None,
        daily_budget_usd: Optional[float] = None,
        timeout_sec: Optional[float] = None,
    ):
        self.api_key = (api_key or OPENROUTER_API_KEY or os.getenv("OPENROUTER_API_KEY", "")).strip()
        self.primary_model = primary_model or OPENROUTER_PRIMARY_MODEL or "deepseek/deepseek-v4.1-flash"
        self.fallback_model = fallback_model or OPENROUTER_FALLBACK_MODEL or "openrouter/free"
        self.free_models = list(free_models or OPENROUTER_FREE_MODELS or ["openrouter/free"])
        self.daily_budget_usd = float(daily_budget_usd if daily_budget_usd is not None else OPENROUTER_DAILY_BUDGET_USD)
        self.timeout_sec = float(timeout_sec if timeout_sec is not None else OPENROUTER_TIMEOUT_SEC)

        # Models API cache (TTL: 1 hour = 3600s)
        self._models_cache: Set[str] = set()
        self._models_cache_timestamp: float = 0.0
        self.models_cache_ttl_sec: float = 3600.0

        # Daily spending tracker (UTC day)
        self.current_spending_date: str = self._get_current_utc_date()
        self.daily_spent_usd: float = 0.0

        # Telemetry call history ring buffer (last 100 calls)
        self.call_history: List[Dict[str, Any]] = []

    def _get_current_utc_date(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _refresh_daily_budget_if_needed(self):
        """Resets daily spending at UTC midnight."""
        now_date = self._get_current_utc_date()
        if now_date != self.current_spending_date:
            logger.info(
                f"New UTC day detected ({now_date} vs {self.current_spending_date}). "
                f"Resetting daily spending from ${self.daily_spent_usd:.4f} to $0.00"
            )
            self.current_spending_date = now_date
            self.daily_spent_usd = 0.0

    def is_paid_model(self, model_id: str) -> bool:
        """Determines whether a model is paid or free."""
        clean = (model_id or "").strip().lower()
        if ":free" in clean or clean == "openrouter/free" or clean.startswith("openrouter/free"):
            return False
        return True

    def can_use_paid_models(self) -> bool:
        """Checks whether daily spending is within the configured budget ceiling."""
        self._refresh_daily_budget_if_needed()
        return self.daily_spent_usd < self.daily_budget_usd

    async def get_available_models(
        self,
        session: Optional[aiohttp.ClientSession] = None,
        force_refresh: bool = False,
    ) -> Set[str]:
        """
        Fetches the active model IDs from OpenRouter models API.
        Caches results for 1 hour (3600 seconds).
        """
        now = time.time()
        if (
            not force_refresh
            and self._models_cache
            and (now - self._models_cache_timestamp) < self.models_cache_ttl_sec
        ):
            return self._models_cache

        headers = {
            "Content-Type": "application/json",
            "HTTP-Referer": "http://127.0.0.1:5173",
            "X-Title": "SignalScript Terminal AI Sentinel",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        should_close = False
        if session is None:
            session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8.0))
            should_close = True

        try:
            async with session.get(OPENROUTER_MODELS_URL, headers=headers) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    model_list = data.get("data", [])
                    models_set = {
                        item["id"]
                        for item in model_list
                        if isinstance(item, dict) and "id" in item
                    }
                    if models_set:
                        self._models_cache = models_set
                        self._models_cache_timestamp = now
                        logger.info(f"OpenRouter models catalog cached: {len(models_set)} active models (TTL 1h)")
                        return self._models_cache
                else:
                    logger.warning(f"OpenRouter models API returned HTTP {resp.status}, retaining previous cache")
        except Exception as e:
            logger.warning(f"Failed to fetch OpenRouter models API: {e}, retaining previous cache")
        finally:
            if should_close:
                await session.close()

        return self._models_cache

    def is_model_available(self, model_id: str, available_models: Set[str]) -> bool:
        """
        Validates if model_id is present in OpenRouter's active catalog.
        Router meta-slugs (like openrouter/free) are always allowed if catalog is reachable.
        """
        if not available_models:
            # If models API couldn't be loaded, do not aggressively block
            return True

        clean = (model_id or "").strip()
        if clean in available_models:
            return True

        # Router meta-slugs
        if clean == "openrouter/free" or clean.startswith("openrouter/"):
            return True

        return False

    def build_candidate_chain(
        self,
        preferred_model: Optional[str] = None,
        available_models: Optional[Set[str]] = None,
    ) -> List[Tuple[str, bool, Optional[str]]]:
        """
        Builds the cascade model chain:
        Returns list of tuples: (model_id, is_paid, skip_reason)
        """
        candidates: List[str] = []

        # 1. Primary / preferred
        primary = (preferred_model or self.primary_model).strip()
        if primary and primary not in candidates:
            candidates.append(primary)

        # 2. Fallback router
        fallback = self.fallback_model.strip()
        if fallback and fallback not in candidates:
            candidates.append(fallback)

        # 3. Additional free models
        for fm in self.free_models:
            clean = fm.strip()
            if clean and clean not in candidates:
                candidates.append(clean)

        chain: List[Tuple[str, bool, Optional[str]]] = []
        avail = available_models if available_models is not None else self._models_cache

        for model in candidates:
            is_paid = self.is_paid_model(model)
            skip_reason = None

            # Check 1: Daily budget ceiling for paid models
            if is_paid and not self.can_use_paid_models():
                skip_reason = f"Daily budget ceiling reached (${self.daily_spent_usd:.4f} >= ${self.daily_budget_usd:.2f})"

            # Check 2: Model availability in OpenRouter models catalog (1-hr cache)
            # 'openrouter/free' — маршрутизатор бесплатных моделей, его ID нет в
            # каталоге, но API его принимает: не отсекаем проверкой каталога.
            elif (
                avail
                and model != "openrouter/free"
                and not self.is_model_available(model, avail)
            ):
                skip_reason = f"Model '{model}' not present in OpenRouter models catalog"

            chain.append((model, is_paid, skip_reason))

        return chain

    def _record_call(
        self,
        model: str,
        latency_ms: int,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        cost: float,
        status: str,
        fallback: bool,
        fallback_reason: Optional[str] = None,
    ):
        """Logs structured telemetry and records call in history ring buffer."""
        self._refresh_daily_budget_if_needed()
        self.daily_spent_usd += max(0.0, cost)

        entry = {
            "timestamp": int(time.time() * 1000),
            "model": model,
            "latency_ms": latency_ms,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "cost": round(cost, 6),
            "status": status,
            "fallback": fallback,
            "fallback_reason": fallback_reason,
            "daily_spent_usd": round(self.daily_spent_usd, 6),
        }
        self.call_history.append(entry)
        if len(self.call_history) > 100:
            self.call_history = self.call_history[-100:]

        logger.info(
            f"[OpenRouter Call] model={model} status={status} latency={latency_ms}ms "
            f"tokens={total_tokens} cost=${cost:.6f} fallback={fallback}"
            + (f" reason='{fallback_reason}'" if fallback_reason else "")
        )

    def _quant_fallback(
        self,
        setup: Dict[str, Any],
        market_snapshot: Dict[str, Any],
        fallback_reason: str = "Квант-контроль (AI недоступен)",
    ) -> Dict[str, Any]:
        """
        Deterministic cold quantitative fallback when API is unavailable,
        unresponsive, rate-limited, or budget-capped.
        """
        rr = float(setup.get("rr_ratio", 0.0) or 0.0)
        delta = float(market_snapshot.get("depth_delta_pct", 0.0) or 0.0)
        direction = str(setup.get("direction", "LONG")).upper()

        if rr < 1.5:
            res = {
                "veto": True,
                "verdict": "VETO",
                "reason": f"Квант-фильтр: R:R (1:{rr:.2f}) ниже минимального порога 1:1.5",
                "confidence": 0.95,
                "model": "local_quant_fallback",
                "fallback": True,
                "fallback_reason": fallback_reason,
                "cost": 0.0,
                "tokens": {"total": 0},
                "latency_ms": 0,
            }
        elif direction in ("LONG", "BUY") and delta < -25.0:
            res = {
                "veto": True,
                "verdict": "VETO",
                "reason": f"Квант-фильтр: Сильное давление асков ({delta:.1f}%) против лонга",
                "confidence": 0.88,
                "model": "local_quant_fallback",
                "fallback": True,
                "fallback_reason": fallback_reason,
                "cost": 0.0,
                "tokens": {"total": 0},
                "latency_ms": 0,
            }
        elif direction in ("SHORT", "SELL") and delta > 25.0:
            res = {
                "veto": True,
                "verdict": "VETO",
                "reason": f"Квант-фильтр: Мощная поддержка бидов (+{delta:.1f}%) против шорта",
                "confidence": 0.88,
                "model": "local_quant_fallback",
                "fallback": True,
                "fallback_reason": fallback_reason,
                "cost": 0.0,
                "tokens": {"total": 0},
                "latency_ms": 0,
            }
        else:
            res = {
                "veto": False,
                "verdict": "CONFIRM",
                "reason": f"Квант-фильтр подтверждает вход: R:R 1:{rr:.2f}, дисбаланс стакана {delta:+.1f}%",
                "confidence": 0.90,
                "model": "local_quant_fallback",
                "fallback": True,
                "fallback_reason": fallback_reason,
                "cost": 0.0,
                "tokens": {"total": 0},
                "latency_ms": 0,
            }

        self._record_call(
            model="local_quant_fallback",
            latency_ms=0,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cost=0.0,
            status=res["verdict"],
            fallback=True,
            fallback_reason=fallback_reason,
        )
        return res

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        preferred_model: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 220,
        api_key_override: Optional[str] = None,
        timeout_sec: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Executes a chat completion across the resilient model cascade:
        1. Primary (paid) -> 2. Fallback (Free Models Router / free pool) -> 3. Local fallback.

        - Catches 402 (Insufficient balance): immediately skips to next candidate.
        - Catches 429 (Rate limit): retries at most 2 times with delay.
        - Catches timeout: default 20s.
        - Validates models against OpenRouter models catalog (1-hr cache).
        - Enforces daily budget cutoff.
        """
        eff_key = (api_key_override or self.api_key or os.getenv("OPENROUTER_API_KEY", "")).strip()
        eff_timeout = float(timeout_sec if timeout_sec is not None else self.timeout_sec)

        if not eff_key:
            return {
                "content": None,
                "model": "local_quant_fallback",
                "fallback": True,
                "fallback_reason": "OPENROUTER_API_KEY missing",
                "tokens": {"prompt": 0, "completion": 0, "total": 0},
                "cost": 0.0,
                "latency_ms": 0,
            }

        # 1. Ensure models catalog is cached
        available_models = await self.get_available_models()

        # 2. Build candidate chain
        chain = self.build_candidate_chain(preferred_model, available_models)

        headers = {
            "Authorization": f"Bearer {eff_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://127.0.0.1:5173",
            "X-Title": "SignalScript Terminal AI Sentinel",
        }

        is_fallback_hop = False
        last_failure_reason = "No candidate models available"

        session_timeout = aiohttp.ClientTimeout(total=eff_timeout)
        async with aiohttp.ClientSession(timeout=session_timeout) as session:
            for idx, (model, is_paid, skip_reason) in enumerate(chain):
                if skip_reason:
                    logger.warning(f"Skipping model candidate '{model}': {skip_reason}")
                    last_failure_reason = skip_reason
                    is_fallback_hop = True
                    self._record_call(
                        model=model,
                        latency_ms=0,
                        prompt_tokens=0,
                        completion_tokens=0,
                        total_tokens=0,
                        cost=0.0,
                        status="UNAVAILABLE",
                        fallback=True,
                        fallback_reason=skip_reason,
                    )
                    continue

                payload = {
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }

                retries_429 = 0
                max_429_retries = 2

                while retries_429 <= max_429_retries:
                    start_t = time.time()
                    try:
                        async with session.post(OPENROUTER_CHAT_URL, headers=headers, json=payload) as resp:
                            elapsed_ms = int((time.time() - start_t) * 1000)

                            if resp.status == 200:
                                res_json = await resp.json()
                                choices = res_json.get("choices", [])
                                if not choices:
                                    logger.warning(f"OpenRouter returned empty choices for model '{model}'")
                                    self._record_call(
                                        model=model,
                                        latency_ms=elapsed_ms,
                                        prompt_tokens=0,
                                        completion_tokens=0,
                                        total_tokens=0,
                                        cost=0.0,
                                        status="EMPTY_RESPONSE",
                                        fallback=is_fallback_hop,
                                        fallback_reason="Empty choices in response",
                                    )
                                    last_failure_reason = "Empty response choices"
                                    is_fallback_hop = True
                                    break  # Try next model

                                msg = choices[0].get("message", {})
                                content = msg.get("content", "")
                                if not content or not content.strip():
                                    # Reasoning-модели (flint, nemotron и др.) возвращают
                                    # рассуждение в поле `reasoning`, а content=None.
                                    # Решение (CONFIRM/VETO/JSON) извлекается из reasoning.
                                    reasoning = msg.get("reasoning", "")
                                    if reasoning and reasoning.strip():
                                        content = reasoning.strip()
                                        logger.info(
                                            f"Model '{model}' returned reasoning instead of content; using reasoning as content"
                                        )
                                    else:
                                        logger.warning(f"OpenRouter returned empty content for model '{model}'")
                                        self._record_call(
                                            model=model,
                                            latency_ms=elapsed_ms,
                                            prompt_tokens=0,
                                            completion_tokens=0,
                                            total_tokens=0,
                                            cost=0.0,
                                            status="EMPTY_RESPONSE",
                                            fallback=is_fallback_hop,
                                            fallback_reason="Empty message content",
                                        )
                                        last_failure_reason = "Empty content"
                                        is_fallback_hop = True
                                        break  # Try next model

                                usage = res_json.get("usage", {})
                                p_tok = int(usage.get("prompt_tokens", 0))
                                c_tok = int(usage.get("completion_tokens", 0))
                                t_tok = int(usage.get("total_tokens", p_tok + c_tok))
                                cost = float(usage.get("total_cost", 0.0) or 0.0)
                                if cost <= 0.0 and is_paid:
                                    # Fallback estimate for paid models (e.g. ~$0.14 per 1M tokens)
                                    cost = t_tok * 0.00000014

                                self._record_call(
                                    model=model,
                                    latency_ms=elapsed_ms,
                                    prompt_tokens=p_tok,
                                    completion_tokens=c_tok,
                                    total_tokens=t_tok,
                                    cost=cost,
                                    status="SUCCESS",
                                    fallback=is_fallback_hop,
                                    fallback_reason=last_failure_reason if is_fallback_hop else None,
                                )

                                return {
                                    "content": content.strip(),
                                    "model": model,
                                    "latency_ms": elapsed_ms,
                                    "tokens": {"prompt": p_tok, "completion": c_tok, "total": t_tok},
                                    "cost": cost,
                                    "fallback": is_fallback_hop,
                                    "fallback_reason": last_failure_reason if is_fallback_hop else None,
                                }

                            elif resp.status == 402:
                                # 402 (Insufficient balance): immediately skip to next model in cascade
                                err_text = await resp.text()
                                logger.warning(
                                    f"OpenRouter 402 Payment Required for model '{model}': {err_text[:120]}. "
                                    f"Immediately skipping to next candidate..."
                                )
                                self._record_call(
                                    model=model,
                                    latency_ms=elapsed_ms,
                                    prompt_tokens=0,
                                    completion_tokens=0,
                                    total_tokens=0,
                                    cost=0.0,
                                    status="ERROR_402",
                                    fallback=True,
                                    fallback_reason=f"HTTP 402: {err_text[:100]}",
                                )
                                last_failure_reason = f"402 Payment Required on {model}"
                                is_fallback_hop = True
                                break  # Do NOT retry 402, advance to next model!

                            elif resp.status == 429:
                                # 429 (Rate limit): retry at most 2 times with delay
                                err_text = await resp.text()
                                retries_429 += 1
                                self._record_call(
                                    model=model,
                                    latency_ms=elapsed_ms,
                                    prompt_tokens=0,
                                    completion_tokens=0,
                                    total_tokens=0,
                                    cost=0.0,
                                    status="ERROR_429",
                                    fallback=True,
                                    fallback_reason=f"HTTP 429 attempt {retries_429}/{max_429_retries}",
                                )

                                if retries_429 <= max_429_retries:
                                    backoff = 1.0 * retries_429
                                    logger.warning(
                                        f"OpenRouter 429 Rate Limited on '{model}'. "
                                        f"Retrying {retries_429}/{max_429_retries} in {backoff:.1f}s..."
                                    )
                                    await asyncio.sleep(backoff)
                                    continue
                                else:
                                    logger.warning(
                                        f"OpenRouter 429 Rate Limit exceeded {max_429_retries} retries on '{model}'. "
                                        f"Proceeding to next model in cascade..."
                                    )
                                    last_failure_reason = f"429 Rate Limit exceeded retries on {model}"
                                    is_fallback_hop = True
                                    break

                            else:
                                err_text = await resp.text()
                                logger.warning(f"OpenRouter HTTP {resp.status} on model '{model}': {err_text[:120]}")
                                self._record_call(
                                    model=model,
                                    latency_ms=elapsed_ms,
                                    prompt_tokens=0,
                                    completion_tokens=0,
                                    total_tokens=0,
                                    cost=0.0,
                                    status=f"ERROR_{resp.status}",
                                    fallback=True,
                                    fallback_reason=f"HTTP {resp.status}",
                                )
                                last_failure_reason = f"HTTP {resp.status} on {model}"
                                is_fallback_hop = True
                                break

                    except asyncio.TimeoutError:
                        elapsed_ms = int((time.time() - start_t) * 1000)
                        logger.warning(f"OpenRouter request timed out ({eff_timeout}s) for model '{model}'")
                        self._record_call(
                            model=model,
                            latency_ms=elapsed_ms,
                            prompt_tokens=0,
                            completion_tokens=0,
                            total_tokens=0,
                            cost=0.0,
                            status="TIMEOUT",
                            fallback=True,
                            fallback_reason=f"Timeout after {eff_timeout}s",
                        )
                        last_failure_reason = f"Timeout ({eff_timeout}s) on {model}"
                        is_fallback_hop = True
                        break

                    except Exception as e:
                        elapsed_ms = int((time.time() - start_t) * 1000)
                        logger.warning(f"OpenRouter exception on model '{model}': {e}")
                        self._record_call(
                            model=model,
                            latency_ms=elapsed_ms,
                            prompt_tokens=0,
                            completion_tokens=0,
                            total_tokens=0,
                            cost=0.0,
                            status="EXCEPTION",
                            fallback=True,
                            fallback_reason=str(e)[:100],
                        )
                        last_failure_reason = f"Exception: {str(e)[:80]}"
                        is_fallback_hop = True
                        break

        # All models in cascade exhausted
        return {
            "content": None,
            "model": "local_quant_fallback",
            "fallback": True,
            "fallback_reason": f"All models exhausted: {last_failure_reason}",
            "tokens": {"prompt": 0, "completion": 0, "total": 0},
            "cost": 0.0,
            "latency_ms": 0,
        }

    async def evaluate_trade_risk(
        self,
        symbol: str,
        setup: Dict[str, Any],
        market_snapshot: Dict[str, Any],
        model: Optional[str] = None,
        timeout_sec: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Consults OpenRouter model cascade to evaluate trade risk.
        Returns structured VETO decision with model metadata and fallback status.
        """
        prompt = f"""You are the Chief Risk Officer for an institutional crypto trading desk.
Evaluate the following prospective trade setup for {symbol.upper()}:

PROPOSED SETUP:
- Direction: {setup.get('direction', 'LONG')}
- Entry Price: ${float(setup.get('entry_price', 0)):,.2f}
- Stop Loss: ${float(setup.get('stop_loss', 0)):,.2f}
- Take Profit: ${float(setup.get('take_profit', 0)):,.2f}
- Risk/Reward Ratio: 1:{float(setup.get('rr_ratio', 0)):.2f}
- Entry Reason: {setup.get('reason', 'N/A')}

MARKET SNAPSHOT (Order Book & Liquidations):
- Current Price: ${float(market_snapshot.get('price', 0)):,.2f}
- Spot Depth Delta (2.5%): {float(market_snapshot.get('depth_delta_pct', 0)):+.2f}%
- Strongest Liquidation Magnet: {market_snapshot.get('strongest_magnet', 'N/A')}
- Funding Rate: {float(market_snapshot.get('funding_rate', 0)):+.6f}
- Volatility (ATR): {float(market_snapshot.get('atr', 0)):.2f}

DECISION CRITERIA:
1. Reject (VETO: TRUE) if:
   - Risk/Reward is below 1:1.5.
   - Long entry faces severe limit ask resistance or adverse depth delta.
   - Short entry faces massive bid absorption wall or short squeeze cascade threat.
2. Approve (VETO: FALSE) if:
   - Sided with prevailing order flow and liquidation pool magnets.

YOUR RESPONSE MUST BE STRICTLY IN THIS FORMAT:
VETO: [TRUE or FALSE]
CONFIDENCE: [0.0 to 1.0]
REASON: [1-2 concise sentences in Russian explaining the liquidity mechanics]
"""

        messages = [
            {"role": "system", "content": "You are a senior quantitative risk manager."},
            {"role": "user", "content": prompt},
        ]

        chat_res = await self.chat_completion(
            messages=messages,
            preferred_model=model,
            temperature=0.1,
            max_tokens=180,
            timeout_sec=timeout_sec,
        )

        content = chat_res.get("content")
        if not content:
            # Full cascade failure -> engagement of local cold quant fallback
            return self._quant_fallback(
                setup,
                market_snapshot,
                fallback_reason=chat_res.get("fallback_reason") or "All AI models unavailable",
            )

        is_veto = "VETO: TRUE" in content.upper()
        conf_match = re.search(r"CONFIDENCE:\s*([0-9.]+)", content, re.IGNORECASE)
        conf = float(conf_match.group(1)) if conf_match else 0.85

        reason_match = re.search(r"REASON:\s*(.+)", content, re.IGNORECASE | re.DOTALL)
        reason = reason_match.group(1).strip() if reason_match else content.strip()
        reason = reason.split("\n")[0].strip()

        return {
            "veto": is_veto,
            "verdict": "VETO" if is_veto else "CONFIRM",
            "reason": reason or ("AI наложил вето на сделку" if is_veto else "AI одобрил параметры сделки"),
            "confidence": min(max(conf, 0.0), 1.0),
            "model": chat_res.get("model", self.primary_model),
            "latency_ms": chat_res.get("latency_ms", 0),
            "cost": chat_res.get("cost", 0.0),
            "tokens": chat_res.get("tokens", {}),
            "fallback": chat_res.get("fallback", False),
            "fallback_reason": chat_res.get("fallback_reason"),
        }

    def _sentinel_quant_fallback(
        self,
        symbol: str,
        position_info: Dict[str, Any],
        market_snapshot: Dict[str, Any],
        fallback_reason: str = "Local Cold Quant Sentinel",
    ) -> Dict[str, Any]:
        """
        Детерминированный Cold Quant Sentinel для сопровождения открытой позиции,
        когда LLM-модели недоступны или отключены (Block 3).
        """
        from backend.app.services.early_exit_engine import clamp_protective_stop

        side = str(position_info.get("side", "LONG")).upper()
        sign = 1 if side == "LONG" else -1
        entry = float(position_info.get("entry_price", 0.0) or 0.0)
        cur_sl = float(position_info.get("stop_price", 0.0) or 0.0)
        price = float(market_snapshot.get("price", position_info.get("current_price", entry)) or entry)
        mfe_r = float(position_info.get("mfe_r", 0.0) or 0.0)
        pnl_r = float(position_info.get("current_pnl_r", 0.0) or 0.0)
        depth_delta = float(market_snapshot.get("depth_delta_pct", 0.0) or 0.0)
        opposing_absorption = bool(market_snapshot.get("opposing_absorption", False))
        r_dist = abs(entry - float(position_info.get("initial_stop_price", cur_sl) or cur_sl))
        if r_dist <= 0 and entry > 0:
            r_dist = entry * 0.008

        adverse_flow = opposing_absorption or (
            (sign == 1 and depth_delta <= -15.0) or (sign == -1 and depth_delta >= 15.0)
        )

        action = "HOLD"
        suggested_sl = cur_sl
        reason = "Cold Quant Sentinel: импульс сохраняется, позиция удерживается по плану."

        if mfe_r >= 0.8 and pnl_r <= mfe_r * 0.5 and adverse_flow:
            action = "PARTIAL_CLOSE_50"
            raw_sl = entry + sign * (r_dist * max(0.25, pnl_r * 0.5))
            suggested_sl = clamp_protective_stop(side, cur_sl, raw_sl, price)
            reason = (
                f"Cold Quant Sentinel: MFE Bleed с +{mfe_r:.2f}R до +{pnl_r:.2f}R при встречном дисбалансе "
                f"({depth_delta:+.1f}%) — фиксация 50% и подтяжка стопа."
            )
        elif mfe_r >= 1.2:
            action = "TIGHTEN_SL"
            lock_r = 0.9 if mfe_r >= 1.8 else 0.4
            raw_sl = entry + sign * (r_dist * lock_r)
            suggested_sl = clamp_protective_stop(side, cur_sl, raw_sl, price)
            reason = f"Cold Quant Sentinel: MFE достиг +{mfe_r:.2f}R — защита +{lock_r:.1f}R прибыли."
        elif mfe_r >= 0.8:
            action = "TIGHTEN_SL"
            raw_sl = entry * (1.0 + sign * 0.0012)
            suggested_sl = clamp_protective_stop(side, cur_sl, raw_sl, price)
            reason = f"Cold Quant Sentinel: MFE +{mfe_r:.2f}R — перевод стопа в безубыток с запасом на комиссию."

        return {
            "action": action,
            "suggested_sl": suggested_sl,
            "reason": reason,
            "confidence": 0.88,
            "model": "local_quant_sentinel",
            "fallback": True,
            "fallback_reason": fallback_reason,
        }

    async def evaluate_open_position_sentinel(
        self,
        symbol: str,
        position_info: Dict[str, Any],
        market_snapshot: Dict[str, Any],
        model: Optional[str] = None,
        timeout_sec: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Tier-2 Event-Driven AI Position Sentinel (Block 3):
        Evaluates an already open position during MFE excursions, profit bleed, or order-flow shifts.
        Enforces `clamp_protective_stop` so AI can NEVER widen the stop-loss or cross current price.
        """
        from backend.app.services.early_exit_engine import clamp_protective_stop

        side = str(position_info.get("side", "LONG")).upper()
        entry = float(position_info.get("entry_price", 0.0) or 0.0)
        cur_sl = float(position_info.get("stop_price", 0.0) or 0.0)
        tp_price = float(position_info.get("target_price", 0.0) or 0.0)
        mfe_r = float(position_info.get("mfe_r", 0.0) or 0.0)
        pnl_r = float(position_info.get("current_pnl_r", 0.0) or 0.0)
        time_sec = float(position_info.get("time_in_trade_sec", 0.0) or 0.0)
        price = float(market_snapshot.get("price", position_info.get("current_price", entry)) or entry)

        prompt = f"""You are an institutional Position Sentinel managing an OPEN crypto futures trade on {symbol.upper()}.
Your goal is PROFIT RETENTION (preventing MFE bleed where winning trades turn into losses).

OPEN POSITION STATE:
- Side: {side}
- Entry Price: ${entry:,.4f}
- Current Price: ${price:,.4f}
- Current Stop-Loss: ${cur_sl:,.4f}
- Take-Profit Target: ${tp_price:,.4f}
- Current Unrealized PnL (R-multiples): {pnl_r:+.2f}R
- Peak MFE Reached: +{mfe_r:.2f}R
- Time in Trade: {time_sec:.0f}s

LIVE ORDER-FLOW SNAPSHOT:
- L2 Depth Delta (2.5%): {float(market_snapshot.get('depth_delta_pct', 0.0)):+.2f}%
- Opposing Cluster Absorption Detected: {bool(market_snapshot.get('opposing_absorption', False))}
- Active Tactical Alerts: {market_snapshot.get('active_alerts', [])}

RULES:
1. Choose ONE action from: HOLD, TIGHTEN_SL, PARTIAL_CLOSE_50, EARLY_EXIT_MARKET
2. You may ONLY tighten the stop-loss in the direction of profit (for LONG: above current SL and below current price; for SHORT: below current SL and above current price). Never widen SL.

RESPOND STRICTLY IN THIS FORMAT:
ACTION: [HOLD | TIGHTEN_SL | PARTIAL_CLOSE_50 | EARLY_EXIT_MARKET]
SUGGESTED_SL: [numeric price or {cur_sl}]
CONFIDENCE: [0.0 to 1.0]
REASON: [1 concise sentence in Russian explaining why]
"""
        messages = [
            {"role": "system", "content": "You are a quantitative position sentinel focused on profit retention."},
            {"role": "user", "content": prompt},
        ]

        chat_res = await self.chat_completion(
            messages=messages,
            preferred_model=model,
            temperature=0.1,
            max_tokens=160,
            timeout_sec=timeout_sec,
        )

        content = chat_res.get("content")
        if not content:
            return self._sentinel_quant_fallback(
                symbol,
                position_info,
                market_snapshot,
                fallback_reason=chat_res.get("fallback_reason") or "All AI models unavailable",
            )

        act_match = re.search(
            r"ACTION:\s*(HOLD|TIGHTEN_SL|PARTIAL_CLOSE_50|EARLY_EXIT_MARKET)",
            content,
            re.IGNORECASE,
        )
        action = act_match.group(1).upper() if act_match else "HOLD"

        sl_match = re.search(r"SUGGESTED_SL:\s*\$?([0-9]+(?:\.[0-9]+)?)", content, re.IGNORECASE)
        proposed_sl = float(sl_match.group(1)) if sl_match else cur_sl
        safe_sl = clamp_protective_stop(side, cur_sl, proposed_sl, price)

        conf_match = re.search(r"CONFIDENCE:\s*([0-9.]+)", content, re.IGNORECASE)
        conf = float(conf_match.group(1)) if conf_match else 0.85

        reason_match = re.search(r"REASON:\s*(.+)", content, re.IGNORECASE | re.DOTALL)
        reason = reason_match.group(1).strip().split("\n")[0].strip() if reason_match else content.strip()

        return {
            "action": action,
            "suggested_sl": safe_sl,
            "reason": reason or f"AI Sentinel: {action}",
            "confidence": min(max(conf, 0.0), 1.0),
            "model": chat_res.get("model", self.primary_model),
            "latency_ms": chat_res.get("latency_ms", 0),
            "cost": chat_res.get("cost", 0.0),
            "fallback": chat_res.get("fallback", False),
            "fallback_reason": chat_res.get("fallback_reason"),
        }

    def get_spending_status(self) -> Dict[str, Any]:
        """Returns current daily spending metrics and budget ceiling status."""
        self._refresh_daily_budget_if_needed()
        return {
            "date_utc": self.current_spending_date,
            "daily_spent_usd": round(self.daily_spent_usd, 6),
            "daily_budget_usd": self.daily_budget_usd,
            "budget_remaining_usd": round(max(0.0, self.daily_budget_usd - self.daily_spent_usd), 6),
            "paid_models_allowed": self.can_use_paid_models(),
            "primary_model": self.primary_model,
            "fallback_model": self.fallback_model,
            "models_cache_size": len(self._models_cache),
            "recent_calls_count": len(self.call_history),
        }


# Global singleton client
openrouter_client = OpenRouterClient()
