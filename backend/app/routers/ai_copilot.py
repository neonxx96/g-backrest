"""
AI Strategy Copilot Router
POST /api/ai/optimize-strategy — parses natural language strategy requirements in Russian,
configures parameters and confluence filters, executes real backtest on Binance history,
and returns an intelligent analytical breakdown with actionable strategy parameters.
"""

import re
import json
import logging
import asyncio
import aiohttp
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from backend.app.routers.backtest import fetch_history, build_response, BacktestParams
from backend.app.services.orderflow_backtester import OrderFlowBacktester

logger = logging.getLogger("SignalScript.AICopilot")

ai_router = APIRouter(prefix="/api/ai", tags=["ai_copilot"])


class AIOptimizeRequest(BaseModel):
    prompt: str = Field(..., description="Запрос пользователя на естественном языке")
    symbol: Optional[str] = "BTCUSDT"
    timeframe: Optional[str] = "5m"
    days: Optional[int] = 7
    initial_capital: Optional[float] = 10000.0


async def query_openrouter_llm(prompt: str, base_symbol: str = "BTCUSDT", base_tf: str = "5m") -> Optional[Dict[str, Any]]:
    """
    Calls OpenRouter LLM (Gemini / LLaMA) with fallback.
    Returns structured strategy parameters if successful, else None.
    """
    if not OPENROUTER_API_KEY or "sk-or-v1" not in OPENROUTER_API_KEY:
        return None

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY.strip()}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "SignalScript Quantitative Terminal"
    }

    system_prompt = (
        "Ты — Lead Quantitative Trader и эксперт по Order Flow & Footprint торговым стратегиям. "
        "Пользователь описывает торговую идею или требования к бэктесту на русском языке. "
        "Тебе необходимо извлечь параметры и вернуть СТРОГО валидный JSON следующего формата:\n"
        "{\n"
        '  "symbol": "BTCUSDT",\n'
        '  "timeframe": "5m",\n'
        '  "strategy_type": "density_bounce" | "delta_absorption" | "confluence_ema" | "ema_trend",\n'
        '  "reasoning": "Краткое обоснование стратегии на русском языке",\n'
        '  "params": {\n'
        '    "stop_loss_pct": 0.6,\n'
        '    "take_profit_pct": 1.5,\n'
        '    "min_density_usd": 1000000.0,\n'
        '    "volume_multiplier": 1.2,\n'
        '    "leverage": 2.0,\n'
        '    "use_atr_filter": true,\n'
        '    "use_atr_sl": false,\n'
        '    "atr_multiplier": 1.5,\n'
        '    "use_cvd_filter": true,\n'
        '    "use_oi_filter": false,\n'
        '    "use_rsi_filter": true\n'
        "  }\n"
        "}\n"
        "Верни ТОЛЬКО JSON без markdown-тегов и пояснений."
    )

    payload = {
        "model": OPENROUTER_MODEL or "google/gemini-2.0-flash-001",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Базовый тикер: {base_symbol}, таймфрейм: {base_tf}. Запрос: {prompt}"}
        ],
        "temperature": 0.2,
        "max_tokens": 800
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    # Clean markdown if present
                    if content.startswith("```"):
                        content = re.sub(r"^```(?:json)?", "", content)
                        content = re.sub(r"```$", "", content).strip()
                    parsed = json.loads(content)
                    if "params" in parsed and "strategy_type" in parsed:
                        logger.info("Successfully received strategy configuration from OpenRouter LLM")
                        return parsed
                else:
                    err_text = await resp.text()
                    logger.warning(f"OpenRouter returned status {resp.status}: {err_text[:120]}")
    except Exception as e:
        logger.warning(f"OpenRouter query failed or timed out: {e}")

    return None


def parse_prompt_to_strategy(prompt: str, base_symbol: str = "BTCUSDT", base_tf: str = "5m") -> Dict[str, Any]:
    """
    Intelligent NLP parser for trading requirements in Russian/English.
    Extracts coin, timeframe, strategy profile, risk profile, and indicator filters.
    """
    text = prompt.lower()

    # 1. Symbol detection
    detected_symbol = base_symbol.upper()
    if any(w in text for w in ["btc", "биткоин", "биток"]):
        detected_symbol = "BTCUSDT"
    elif any(w in text for w in ["eth", "эфир", "эфириум"]):
        detected_symbol = "ETHUSDT"
    elif any(w in text for w in ["sol", "солана"]):
        detected_symbol = "SOLUSDT"
    elif any(w in text for w in ["doge", "доги"]):
        detected_symbol = "DOGEUSDT"
    elif any(w in text for w in ["xrp", "риппл"]):
        detected_symbol = "XRPUSDT"
    elif any(w in text for w in ["sui", "суи"]):
        detected_symbol = "SUIUSDT"
    elif any(w in text for w in ["near", "ниар"]):
        detected_symbol = "NEARUSDT"
    elif any(w in text for w in ["bnb", "бнб"]):
        detected_symbol = "BNBUSDT"

    # 2. Timeframe detection
    detected_tf = base_tf if base_tf in ["1m", "5m", "15m", "30m", "1h"] else "5m"
    if re.search(r'\b(1m|1м|1\s*мин|минутк)', text):
        detected_tf = "1m"
    elif re.search(r'\b(5m|5м|5\s*мин)', text):
        detected_tf = "5m"
    elif re.search(r'\b(15m|15м|15\s*мин)', text):
        detected_tf = "15m"
    elif re.search(r'\b(30m|30м|30\s*мин)', text):
        detected_tf = "30m"
    elif re.search(r'\b(1h|1ч|1\s*час|часовик)', text):
        detected_tf = "1h"

    # 3. Strategy Type detection
    strategy_type = "density_bounce"
    if any(w in text for w in ["поглощен", "дельта", "delta", "absorption", "айсберг"]):
        strategy_type = "delta_absorption"
    elif any(w in text for w in ["ema", "тренд", "скользящ", "trend"]):
        strategy_type = "ema_trend"
    elif any(w in text for w in ["конфлюенс", "confluence", "комплекс"]):
        strategy_type = "confluence_ema"
    elif any(w in text for w in ["плотност", "стенк", "стакан", "отскок", "bounce", "density"]):
        strategy_type = "density_bounce"

    # 4. Risk Profile & Aggression
    is_conservative = any(w in text for w in ["консервативн", "низк", "минимальн", "безопасн", "safe", "low risk", "аккуратн", "защит"])
    is_aggressive = any(w in text for w in ["агрессивн", "высок", "максимальн", "быстр", "разгон", "high risk", "aggressive", "импульс"])

    # Default parameters based on coin and timeframe
    is_high_cap = detected_symbol in ["BTCUSDT", "ETHUSDT"]
    default_wall = 1200000.0 if detected_symbol == "BTCUSDT" else 600000.0 if detected_symbol == "ETHUSDT" else 250000.0

    if is_conservative:
        sl = 0.4 if detected_tf in ["1m", "5m"] else 0.6
        tp = 1.0 if detected_tf in ["1m", "5m"] else 1.6
        leverage = 2.0
        min_density = default_wall * 1.2
        use_atr_filter = True
        use_atr_sl = True
        atr_multiplier = 1.4
        use_cvd_filter = True
        use_oi_filter = True
        use_rsi_filter = True
        vol_mult = 1.2
        reasoning = (
            f"Консервативный скальпинг-профиль для {detected_symbol} ({detected_tf}): "
            f"активирован динамический ATR-стоп ({sl}%), подтверждение набором открытого интереса (OI) "
            f"и фильтр поглощения объёма по кумулятивной дельте (CVD). Отсекаются ложные импульсы."
        )
    elif is_aggressive:
        sl = 0.9 if detected_tf in ["1m", "5m"] else 1.2
        tp = 2.5 if detected_tf in ["1m", "5m"] else 3.5
        leverage = 5.0
        min_density = default_wall * 0.7
        use_atr_filter = False
        use_atr_sl = False
        atr_multiplier = 1.5
        use_cvd_filter = True
        use_oi_filter = False
        use_rsi_filter = False
        vol_mult = 1.0
        reasoning = (
            f"Агрессивный профиль с расширенным Take Profit ({tp}%) и коротким стопом ({sl}%): "
            f"вход на опережение по крупным плотностям и импульсам CVD с кредитным плечом 5x."
        )
    else:
        # Balanced / Default Scalping
        sl = 0.6 if detected_tf in ["1m", "5m"] else 0.8
        tp = 1.5 if detected_tf in ["1m", "5m"] else 2.2
        leverage = 2.0
        min_density = default_wall
        use_atr_filter = True
        use_atr_sl = False
        atr_multiplier = 1.5
        use_cvd_filter = True
        use_oi_filter = False
        use_rsi_filter = True
        vol_mult = 1.1
        reasoning = (
            f"Сбалансированный сетап Order Flow для {detected_symbol} ({detected_tf}): "
            f"соотношение риск/прибыль 1:{round(tp/sl, 1)}, фильтрация зон перекупленности/перепроданности по RSI "
            f"и контроль дельты покупателей/продавцов."
        )

    # 5. Regex value extraction overrides if user specified explicit numbers
    sl_match = re.search(r'(?:sl|стоп|стоп-лосс|stop loss)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%?', text)
    if sl_match:
        try:
            sl = float(sl_match.group(1).replace(',', '.'))
        except Exception:
            pass

    tp_match = re.search(r'(?:tp|тейк|тейк-профит|take profit)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*%?', text)
    if tp_match:
        try:
            tp = float(tp_match.group(1).replace(',', '.'))
        except Exception:
            pass

    lev_match = re.search(r'(?:плечо|leverage|x)\s*[:=]?\s*(\d+)', text)
    if lev_match:
        try:
            leverage = float(lev_match.group(1))
        except Exception:
            pass

    return {
        "symbol": detected_symbol,
        "timeframe": detected_tf,
        "strategy_type": strategy_type,
        "reasoning": reasoning,
        "params": {
            "stop_loss_pct": round(sl, 2),
            "take_profit_pct": round(tp, 2),
            "min_density_usd": round(min_density, 0),
            "volume_multiplier": round(vol_mult, 2),
            "leverage": round(leverage, 1),
            "use_atr_filter": use_atr_filter,
            "use_atr_sl": use_atr_sl,
            "atr_multiplier": atr_multiplier,
            "use_cvd_filter": use_cvd_filter,
            "use_oi_filter": use_oi_filter,
            "use_rsi_filter": use_rsi_filter
        }
    }


@ai_router.post("/optimize-strategy")
async def optimize_strategy(payload: AIOptimizeRequest):
    """
    Parses user prompt in natural language, configures orderflow strategy,
    fetches Binance history and executes instant backtest validation.
    """
    if not payload.prompt or not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Промпт не может быть пустым")

    # 1. Parse prompt via OpenRouter LLM or smart fallback
    parsed = None
    try:
        parsed = await query_openrouter_llm(
            prompt=payload.prompt,
            base_symbol=payload.symbol or "BTCUSDT",
            base_tf=payload.timeframe or "5m"
        )
    except Exception as e:
        logger.warning(f"Error querying OpenRouter: {e}")

    if not parsed:
        parsed = parse_prompt_to_strategy(
            prompt=payload.prompt,
            base_symbol=payload.symbol or "BTCUSDT",
            base_tf=payload.timeframe or "5m"
        )

    sym = parsed["symbol"]
    tf = parsed["timeframe"]
    strat = parsed["strategy_type"]
    p_dict = parsed["params"]
    days = payload.days or 7

    # 2. Fetch history
    try:
        df = await fetch_history(sym, tf, days)
    except Exception as e:
        logger.error(f"Failed to fetch history for AI copilot: {e}")
        raise HTTPException(status_code=502, detail=f"Ошибка получения свечей Binance: {e}")

    if df.empty or len(df) < 50:
        raise HTTPException(status_code=404, detail=f"Недостаточно исторических данных для {sym} {tf}")

    # 3. Instantiate OrderFlowBacktester & execute
    engine = OrderFlowBacktester(initial_capital=payload.initial_capital or 10000.0)
    raw = engine.run_backtest(
        df,
        strat,
        p_dict["take_profit_pct"],
        p_dict["stop_loss_pct"],
        False,  # use_trailing
        0.5,
        float(p_dict["leverage"]),
        100000.0,
        float(p_dict["volume_multiplier"]),
        float(p_dict["min_density_usd"]),
        p_dict["use_atr_filter"],
        p_dict["use_atr_sl"],
        float(p_dict["atr_multiplier"]),
        p_dict["use_cvd_filter"],
        p_dict["use_oi_filter"],
        p_dict["use_rsi_filter"]
    )

    meta = {
        "symbol": sym,
        "timeframe": tf,
        "days": days,
        "strategy": strat,
        "candles": len(df),
        "ai_prompt": payload.prompt
    }

    result = build_response(raw, payload.initial_capital or 10000.0, meta)

    # 4. Synthesize AI Recommendation Report
    s = result.get("summary", {})
    win_rate = s.get("win_rate_pct", 0.0)
    pnl = s.get("total_pnl_pct", 0.0)
    trades = s.get("total_trades", 0)
    pf = s.get("profit_factor", 0.0)
    max_dd = s.get("max_drawdown_pct", 0.0)

    ai_verdict = (
        f"🤖 AI Анализ стратегии '{strat}' для #{sym} ({tf}):\n"
        f"• Результат за {days} дней: PnL {pnl:+.2f}% | WinRate {win_rate:.1f}% | Profit Factor {pf:.2f}\n"
        f"• Количество сделок: {trades} | Макс. просадка: {max_dd:.2f}%\n"
        f"• Обоснование: {parsed['reasoning']}"
    )

    return {
        "status": "success",
        "prompt": payload.prompt,
        "parsed_strategy": {
            "symbol": sym,
            "timeframe": tf,
            "strategy_type": strat,
            "params": p_dict,
        },
        "ai_summary": ai_verdict,
        "summary": s,
        "trades": result.get("trades", []),
        "signals": result.get("signals", []),
        "equity_curve": result.get("equity_curve", []),
        "confluence_matrix": result.get("confluence_matrix", []),
        "meta": meta
    }

