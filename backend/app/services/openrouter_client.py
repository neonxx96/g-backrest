"""
OpenRouter Client: AI Risk Copilot & Trade Sentinel
Provides consultative second opinion on prospective trade setups using
free high-performance LLMs (Llama 3.1 8B, Gemma 2 9B, Qwen 2.5 7B).
"""

import os
import re
import json
import time
import logging
import asyncio
from typing import Dict, Any, Optional, List
import aiohttp

logger = logging.getLogger("SignalScript.OpenRouter")

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_FREE_MODEL = "meta-llama/llama-3.1-8b-instruct:free"
FALLBACK_FREE_MODELS = [
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2-9b-it:free",
    "qwen/qwen-2.5-7b-instruct:free",
]


class OpenRouterClient:
    """
    OpenRouter API client with free model rotation and cold quant fallback.
    Used by Paper Trading simulator when 'AI Контроль сделок' is enabled.
    """

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (api_key or os.getenv("OPENROUTER_API_KEY", "")).strip()

    def _quant_fallback(self, setup: Dict[str, Any], market_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """Cold math quantitative fallback when API key is missing or network unavailable."""
        rr = float(setup.get("rr_ratio", 0.0) or 0.0)
        delta = float(market_snapshot.get("depth_delta_pct", 0.0) or 0.0)
        direction = str(setup.get("direction", "LONG")).upper()

        if rr < 1.5:
            return {
                "veto": True,
                "verdict": "VETO",
                "reason": f"Квант-фильтр: R:R (1:{rr:.2f}) ниже минимального порога 1:1.5",
                "confidence": 0.95,
                "model": "local_quant_fallback",
                "fallback": True,
            }
        if direction in ("LONG", "BUY") and delta < -25.0:
            return {
                "veto": True,
                "verdict": "VETO",
                "reason": f"Квант-фильтр: Сильное давление асков ({delta:.1f}%) против лонга",
                "confidence": 0.88,
                "model": "local_quant_fallback",
                "fallback": True,
            }
        if direction in ("SHORT", "SELL") and delta > 25.0:
            return {
                "veto": True,
                "verdict": "VETO",
                "reason": f"Квант-фильтр: Мощная поддержка бидов (+{delta:.1f}%) против шорта",
                "confidence": 0.88,
                "model": "local_quant_fallback",
                "fallback": True,
            }

        return {
            "veto": False,
            "verdict": "CONFIRM",
            "reason": f"Квант-фильтр подтверждает вход: R:R 1:{rr:.2f}, дисбаланс стакана {delta:+.1f}%",
            "confidence": 0.90,
            "model": "local_quant_fallback",
            "fallback": True,
        }

    async def evaluate_trade_risk(
        self,
        symbol: str,
        setup: Dict[str, Any],
        market_snapshot: Dict[str, Any],
        model: Optional[str] = None,
        timeout_sec: float = 6.0,
    ) -> Dict[str, Any]:
        """
        Consults OpenRouter model.
        Returns structured VETO decision.
        """
        api_key = self.api_key or os.getenv("OPENROUTER_API_KEY", "").strip()

        # If no key configured, use honest institutional quantitative fallback
        if not api_key:
            return self._quant_fallback(setup, market_snapshot)

        target_model = model or os.getenv("OPENROUTER_MODEL", DEFAULT_FREE_MODEL)

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

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://127.0.0.1:5173",
            "X-Title": "SignalScript Terminal AI Copilot",
        }

        payload = {
            "model": target_model,
            "messages": [
                {"role": "system", "content": "You are a senior quantitative risk manager."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "max_tokens": 180,
        }

        start_t = time.time()
        try:
            timeout = aiohttp.ClientTimeout(total=timeout_sec)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(OPENROUTER_API_URL, headers=headers, json=payload) as resp:
                    if resp.status != 200:
                        logger.warning(f"OpenRouter API returned {resp.status}, switching to quant fallback")
                        return self._quant_fallback(setup, market_snapshot)

                    res_json = await resp.json()
                    content = res_json.get("choices", [{}])[0].get("message", {}).get("content", "")

                    is_veto = "VETO: TRUE" in content.upper()
                    conf_match = re.search(r"CONFIDENCE:\s*([0-9.]+)", content, re.IGNORECASE)
                    conf = float(conf_match.group(1)) if conf_match else 0.85

                    reason_match = re.search(r"REASON:\s*(.+)", content, re.IGNORECASE | re.DOTALL)
                    reason = reason_match.group(1).strip() if reason_match else content.strip()
                    # Clean trailing prompt markers
                    reason = reason.split("\n")[0].strip()

                    return {
                        "veto": is_veto,
                        "verdict": "VETO" if is_veto else "CONFIRM",
                        "reason": reason or ("AI наложил вето на сделку" if is_veto else "AI одобрил параметры сделки"),
                        "confidence": min(max(conf, 0.0), 1.0),
                        "model": target_model,
                        "latency_ms": int((time.time() - start_t) * 1000),
                        "fallback": False,
                    }
        except Exception as e:
            logger.warning(f"OpenRouter request error: {e}, using quant fallback")
            return self._quant_fallback(setup, market_snapshot)


# Global singleton client
openrouter_client = OpenRouterClient()
