"""
AI Copilot Service Layer
========================
Сервисная логика роутера `backend/app/routers/ai_copilot.py` (MODULARIZATION_PLAN п.6).

Сюда вынесены:
- NLP-парсер промптов (`parse_prompt_to_strategy`) и LLM-запрос (`query_openrouter_llm`);
- чистые количественные хелперы market-analysis: ATR(14), синтез дельты, сводка метрик
  свечей, уровни поддержки/сопротивления из стакана, фаза рынка, синтез сетапа
  Entry/SL/TP1/TP2, шкала здоровья 0–100, конус волатильности, Liquidity Magnet,
  сводка Expected Value;
- Probabilistic Forecast: классификация режима, построение UnifiedTradeSignal,
  вычисление конуса ±1σ/±2σ и цен SL/TP, оркестратор `compute_probabilistic_forecast`.

Все тела функций перенесены из роутера дословно (поведение 1:1); роутер остаётся
тонким слоем HTTP-оркестрации (fetch свечей/стакана, LLM-обогащение, сборка ответа).
"""

import re
import math
import json
import logging
from typing import Dict, Any, Optional

import pandas as pd
import numpy as np
from fastapi import HTTPException

from backend.app.config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from backend.app.routers.backtest import fetch_history
from backend.app.services.orderflow_backtester import OrderFlowBacktester

logger = logging.getLogger("SignalScript.AICopilot")


# ==============================================================================
# OpenRouter LLM: запрос и NLP-парсер промпта
# ==============================================================================

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
        '  "strategy_type": "density_bounce" | "delta_absorption" | "confluence_ema" | "ema_pullback" | "ema_trend" | "ema_trend_window",\n'
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

    from backend.app.services.ai_service import ai_service

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Базовый тикер: {base_symbol}, таймфрейм: {base_tf}. Запрос: {prompt}"}
    ]

    try:
        content, used_model = await ai_service.query_with_fallback(
            messages=messages,
            preferred_model=OPENROUTER_MODEL,
            temperature=0.2,
            max_tokens=800,
            timeout_sec=8.0
        )
        if content:
            if content.startswith("```"):
                content = re.sub(r"^```(?:json)?", "", content)
                content = re.sub(r"```$", "", content).strip()
            parsed = json.loads(content)
            if "params" in parsed and "strategy_type" in parsed:
                logger.info(f"Successfully received strategy configuration from OpenRouter LLM ({used_model})")
                return parsed
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


# ==============================================================================
# Чистые количественные хелперы market-analysis
# ==============================================================================

def compute_atr14(high_s: pd.Series, low_s: pd.Series, close_s: pd.Series,
                  fallback_price: Optional[float] = None) -> float:
    """ATR(14) по свечам; fallback_price используется только если atr <= 0 (как в forecast)."""
    tr1 = high_s - low_s
    tr2 = (high_s - close_s.shift(1)).abs()
    tr3 = (low_s - close_s.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = float(tr.rolling(14, min_periods=1).mean().iloc[-1])
    if atr <= 0 and fallback_price is not None:
        atr = fallback_price * 0.005
    return atr


def get_or_synthesize_delta(df: pd.DataFrame, close_s: pd.Series, high_s: pd.Series,
                            low_s: pd.Series, vol_s: pd.Series) -> pd.Series:
    """Дельта из колонки 'delta' либо синтез из OHLCV (buy-ratio оценка), как в оригинале."""
    if 'delta' in df.columns:
        return df['delta'].astype(float)
    rng_s = (high_s - low_s).replace(0, np.nan)
    buy_ratio_s = ((close_s - low_s) / rng_s).fillna(0.5)
    return (2.0 * buy_ratio_s - 1.0) * vol_s


def compute_market_metrics(df: pd.DataFrame, tf: str) -> Dict[str, Any]:
    """
    Core Quantitative Metrics свечного датафрейма: цена, ATR(14), EMA 20/50/200,
    VWAP, CVD + EMA(14), дивергенции, OI 1h. Чистая pandas-логика (без сети).
    """
    close_s = df['close'].astype(float)
    high_s = df['high'].astype(float)
    low_s = df['low'].astype(float)
    vol_s = df['volume'].astype(float)

    current_price = float(close_s.iloc[-1])
    price_dec = 1 if current_price >= 100 else 4

    # ATR(14)
    atr = compute_atr14(high_s, low_s, close_s)
    tick_sz = OrderFlowBacktester._estimate_tick_size(current_price)

    # EMA 20, 50, 200
    ema20 = float(close_s.ewm(span=20, adjust=False).mean().iloc[-1])
    ema50 = float(close_s.ewm(span=50, adjust=False).mean().iloc[-1])
    ema200 = float(close_s.ewm(span=min(len(close_s), 200), adjust=False).mean().iloc[-1])

    # Session VWAP (typical price * volume)
    typical_price = (high_s + low_s + close_s) / 3.0
    cum_vol = vol_s.sum()
    cum_pv = (typical_price * vol_s).sum()
    vwap = float(cum_pv / max(1e-9, cum_vol))

    # Cumulative Volume Delta (CVD) & EMA(14)
    delta_s = get_or_synthesize_delta(df, close_s, high_s, low_s, vol_s)

    cvd_s = delta_s.cumsum()
    cvd_ema14_s = cvd_s.ewm(span=14, adjust=False).mean()
    cvd_current = float(cvd_s.iloc[-1])
    cvd_ema14 = float(cvd_ema14_s.iloc[-1])
    recent_delta_sum = float(delta_s.iloc[-20:].sum())

    low_min6 = float(low_s.iloc[-7:-1].min()) if len(low_s) >= 7 else float(low_s.min())
    high_max6 = float(high_s.iloc[-7:-1].max()) if len(high_s) >= 7 else float(high_s.max())
    cvd_min6 = float(cvd_s.iloc[-7:-1].min()) if len(cvd_s) >= 7 else float(cvd_s.min())
    cvd_max6 = float(cvd_s.iloc[-7:-1].max()) if len(cvd_s) >= 7 else float(cvd_s.max())

    if current_price <= low_min6 * 1.001 and cvd_current > cvd_min6:
        cvd_div_status = "Бычья дивергенция (Поглощение лимитками Bid)"
    elif current_price >= high_max6 * 0.999 and cvd_current < cvd_max6:
        cvd_div_status = "Медвежья дивергенция (Скрытые продажи Ask)"
    elif cvd_current >= cvd_ema14:
        cvd_div_status = "CVD > EMA(14) (Покупатели доминируют)"
    else:
        cvd_div_status = "CVD < EMA(14) (Давление продавцов)"

    cvd_slope = "ПОЛОЖИТЕЛЬНАЯ (Преобладают рыночные покупки)" if recent_delta_sum >= 0 else "ОТРИЦАТЕЛЬНАЯ (Давление рыночных продаж)"

    # 1h Open Interest Delta
    if 'oi' in df.columns and len(df) >= 6:
        oi_s = df['oi'].astype(float)
        bars_1h = max(1, int(60 / max(1, {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}.get(tf, 15))))
        oi_now = float(oi_s.iloc[-1])
        oi_prev = float(oi_s.iloc[-min(len(oi_s), bars_1h + 1)])
        oi_1h_pct = round(((oi_now - oi_prev) / max(1.0, oi_prev)) * 100.0, 2)
    else:
        oi_1h_pct = round((recent_delta_sum / max(1.0, float(vol_s.iloc[-20:].sum()))) * 2.4, 2)

    if oi_1h_pct > 0.05:
        oi_status = f"Приток капитала (+{oi_1h_pct}%)"
    elif oi_1h_pct < -0.05:
        oi_status = f"Отток капитала ({oi_1h_pct}%)"
    else:
        oi_status = f"Нейтральный баланс ({oi_1h_pct:+.2f}%)"

    return {
        "current_price": current_price,
        "price_dec": price_dec,
        "atr": atr,
        "tick_sz": tick_sz,
        "ema20": ema20,
        "ema50": ema50,
        "ema200": ema200,
        "vwap": vwap,
        "cvd_current": cvd_current,
        "cvd_ema14": cvd_ema14,
        "recent_delta_sum": recent_delta_sum,
        "cvd_div_status": cvd_div_status,
        "cvd_slope": cvd_slope,
        "oi_1h_pct": oi_1h_pct,
        "oi_status": oi_status,
    }


def build_support_resistance(
    top_bids: list,
    top_asks: list,
    current_price: float,
    atr: float,
    vwap: float,
    price_dec: int,
) -> Dict[str, Any]:
    """Уровни поддержки/сопротивления из топ-3 стенок стакана + fallback на ATR/VWAP."""
    support_levels = []
    for p, usd in top_bids:
        if p < current_price:
            usd_fmt = f"${usd/1_000_000:.2f}M" if usd >= 1_000_000 else f"${round(usd/1_000)}k"
            support_levels.append({
                "price": round(p, price_dec),
                "volume_usd": round(usd, 1),
                "label": f"Лимитная плотность Bid {usd_fmt}",
                "type": "support"
            })

    if not support_levels:
        support_levels.append({
            "price": round(min(current_price - 1.1 * atr, vwap), price_dec),
            "volume_usd": 1450000.0,
            "label": "Лимитная плотность Bid $1.45M",
            "type": "support"
        })

    resistance_levels = []
    for p, usd in top_asks:
        if p > current_price:
            usd_fmt = f"${usd/1_000_000:.2f}M" if usd >= 1_000_000 else f"${round(usd/1_000)}k"
            resistance_levels.append({
                "price": round(p, price_dec),
                "volume_usd": round(usd, 1),
                "label": f"Лимитная стенка Ask {usd_fmt}",
                "type": "resistance"
            })

    if not resistance_levels:
        resistance_levels.append({
            "price": round(current_price + 1.3 * atr, price_dec),
            "volume_usd": 1820000.0,
            "label": "Лимитная стенка Ask $1.82M",
            "type": "resistance"
        })

    support_levels.sort(key=lambda x: x["price"], reverse=True)
    resistance_levels.sort(key=lambda x: x["price"])

    top_bid_p = float(support_levels[0]["price"])
    top_bid_usd = float(support_levels[0]["volume_usd"])
    top_bid_dist_pct = round(abs(current_price - top_bid_p) / max(1e-9, current_price) * 100.0, 2)

    top_ask_p = float(resistance_levels[0]["price"])
    top_ask_usd = float(resistance_levels[0]["volume_usd"])
    top_ask_dist_pct = round(abs(top_ask_p - current_price) / max(1e-9, current_price) * 100.0, 2)

    return {
        "support_levels": support_levels,
        "resistance_levels": resistance_levels,
        "top_bid_p": top_bid_p,
        "top_bid_usd": top_bid_usd,
        "top_bid_dist_pct": top_bid_dist_pct,
        "top_ask_p": top_ask_p,
        "top_ask_usd": top_ask_usd,
        "top_ask_dist_pct": top_ask_dist_pct,
    }


def determine_market_phase(
    current_price: float,
    ema20: float,
    ema50: float,
    vwap: float,
    recent_delta_sum: float,
    cvd_current: float,
    cvd_ema14: float,
) -> tuple:
    """Market Phase & Bias по EMA/VWAP/CVD (идентично оригинальному блоку роутера)."""
    is_above_ema = current_price >= ema20 >= ema50
    is_below_ema = current_price <= ema20 <= ema50
    is_near_vwap = abs(current_price - vwap) / current_price < 0.006

    if is_above_ema and recent_delta_sum >= 0:
        market_phase = "Импульс (Бычье расширение тренда)"
        bias = "BULLISH"
    elif is_below_ema and recent_delta_sum < 0:
        market_phase = "Импульс (Медвежье расширение тренда)"
        bias = "BEARISH"
    elif is_near_vwap:
        market_phase = "Накопление у зоны справедливой цены (VWAP)"
        bias = "BULLISH" if recent_delta_sum >= 0 else "BEARISH"
    else:
        market_phase = "Консолидация в границах ликвидности"
        bias = "BULLISH" if cvd_current >= cvd_ema14 else "NEUTRAL"

    return market_phase, bias


def synthesize_trading_idea(
    *,
    bias: str,
    current_price: float,
    atr: float,
    support_levels: list,
    resistance_levels: list,
    tp1_rr_ratio: Optional[float],
    tp2_rr_ratio: Optional[float],
    cvd_div_status: str,
    oi_status: str,
    recent_delta_sum: float,
    price_dec: int,
    sl_mode: Optional[str],
    entry_mode: Optional[str],
    min_wall_lifetime_sec: Optional[int],
) -> Dict[str, Any]:
    """
    Actionable Trading Idea: Entry, SL, TP1 (1.5R + Б/У), TP2 (2.8R) + position_setup.
    Возвращает плоский dict с полями сетапа и вложенным position_setup (1:1 с оригиналом).
    """
    tp1_rr = max(1.0, float(tp1_rr_ratio or 1.5))
    tp2_rr = max(1.8, float(tp2_rr_ratio or 2.8))

    if bias in ["BULLISH", "NEUTRAL"]:
        direction = "LONG"
        order_type = "BUY LIMIT"
        sup_p = support_levels[0]["price"]
        entry_price = round(min(current_price, max(sup_p, current_price - 0.25 * atr)), price_dec)
        stop_loss = round(entry_price - max(current_price * 0.0028, 1.2 * atr), price_dec)
        risk = max(1e-4, entry_price - stop_loss)
        tp1_price = round(entry_price + tp1_rr * risk, price_dec)
        take_profit = round(entry_price + tp2_rr * risk, price_dec)
        recommended_strategy = "delta_absorption" if recent_delta_sum > 0 else "density_bounce"
        reasoning = (
            f"Лимитный вход {order_type} от зоны плотности Bid ${support_levels[0]['price']} ({support_levels[0]['label']}). "
            f"Дельта ({cvd_div_status}) и OI ({oi_status}) подтверждают удержание уровня. "
            f"TP1 (50% объёма + перевод стопа в Б/У) на ${tp1_price} (1:{tp1_rr}), финальная цель TP2 на ${take_profit} (R:R 1:{tp2_rr})."
        )
    else:
        direction = "SHORT"
        order_type = "SELL LIMIT"
        res_p = resistance_levels[0]["price"]
        entry_price = round(max(current_price, min(res_p, current_price + 0.25 * atr)), price_dec)
        stop_loss = round(entry_price + max(current_price * 0.0028, 1.2 * atr), price_dec)
        risk = max(1e-4, stop_loss - entry_price)
        tp1_price = round(entry_price - tp1_rr * risk, price_dec)
        take_profit = round(entry_price - tp2_rr * risk, price_dec)
        recommended_strategy = "density_bounce"
        reasoning = (
            f"Лимитный вход {order_type} от крупной стенки Ask ${resistance_levels[0]['price']} ({resistance_levels[0]['label']}). "
            f"Дельта ({cvd_div_status}) указывает на поглощение покупок лимитным продавцом. "
            f"TP1 (50% + Б/У) на ${tp1_price} (1:{tp1_rr}), финальный тейк TP2 на ${take_profit} (R:R 1:{tp2_rr})."
        )

    sl_pct = round(abs(entry_price - stop_loss) / max(1e-9, entry_price) * 100.0, 2)
    tp1_pct = round(abs(tp1_price - entry_price) / max(1e-9, entry_price) * 100.0, 2)
    tp2_pct = round(abs(take_profit - entry_price) / max(1e-9, entry_price) * 100.0, 2)
    sl_risk_usd = round(10000.0 * 2.0 * (sl_pct / 100.0), 0)

    position_setup = {
        "direction": direction,
        "order_type": order_type,
        "entry_price": entry_price,
        "sl_price": stop_loss,
        "sl_pct": sl_pct,
        "sl_risk_usd": sl_risk_usd,
        "tp1_price": tp1_price,
        "tp1_pct": tp1_pct,
        "tp1_rr": tp1_rr,
        "tp2_price": take_profit,
        "tp2_pct": tp2_pct,
        "rr_ratio": tp2_rr,
        "rr_label": f"1:{tp2_rr}",
        "sl_mode": sl_mode or "atr_volatility",
        "entry_mode": entry_mode or "limit_bounce",
        "min_wall_lifetime_sec": int(min_wall_lifetime_sec or 30),
    }

    return {
        "direction": direction,
        "order_type": order_type,
        "entry_price": entry_price,
        "stop_loss": stop_loss,
        "tp1_price": tp1_price,
        "take_profit": take_profit,
        "recommended_strategy": recommended_strategy,
        "reasoning": reasoning,
        "sl_pct": sl_pct,
        "tp1_pct": tp1_pct,
        "tp2_pct": tp2_pct,
        "sl_risk_usd": sl_risk_usd,
        "tp1_rr": tp1_rr,
        "tp2_rr": tp2_rr,
        "position_setup": position_setup,
    }


def compute_health_score(
    cvd_current: float,
    cvd_ema14: float,
    recent_delta_sum: float,
    oi_1h_pct: float,
    top_bid_usd: float,
    top_ask_usd: float,
    override: Optional[int] = None,
) -> int:
    """Market Sentiment & Health Meter (0–100): raw score до классификации."""
    if override is not None:
        return int(override)
    base_score = 62
    if cvd_current >= cvd_ema14:
        base_score += 12
    else:
        base_score -= 10
    if recent_delta_sum > 0:
        base_score += 8
    else:
        base_score -= 6
    if oi_1h_pct > 0:
        base_score += 7
    elif oi_1h_pct < -0.2:
        base_score -= 9
    if top_bid_usd >= top_ask_usd * 0.9:
        base_score += 6
    else:
        base_score -= 5
    return max(12, min(96, base_score))


def _classify_health_meter(
    score: int,
    sym: str,
    entry_price: float,
    tp1_price: float,
    sl_price: float,
    top_bid_price: float,
    top_bid_usd: float,
    top_ask_price: float,
    top_ask_usd: float,
    oi_1h_pct: float,
    cvd_div_status: str,
) -> Dict[str, Any]:
    s = max(0, min(100, int(score)))
    bid_fmt = f"${top_bid_usd/1_000_000:.2f}M" if top_bid_usd >= 1_000_000 else f"${round(top_bid_usd/1_000)}k"
    ask_fmt = f"${top_ask_usd/1_000_000:.2f}M" if top_ask_usd >= 1_000_000 else f"${round(top_ask_usd/1_000)}k"

    if s >= 80:
        zone = "GREEN"
        color = "#10b981"
        status_label = "Идеальные условия для Лонга (Стенка удержана + приток OI + поглощение дельты)"
        short_advice = (
            f"Держим позицию по #{sym}: плотность Bid {bid_fmt} на ${top_bid_price} удерживает спред, "
            f"цель TP1 (${tp1_price}) близка. Приток OI ({oi_1h_pct:+.2f}%) подтверждает силу покупателей."
        )
    elif s >= 50:
        zone = "BLUE"
        color = "#38bdf8"
        status_label = "Позиция в безопасности / Удерживать / Флэт"
        short_advice = (
            f"Позиция в безопасности около ${entry_price}: баланс кластеров стабилен ({cvd_div_status}). "
            f"Удерживаем до TP1 (${tp1_price}), внимание на лимитную стенку Ask {ask_fmt} на ${top_ask_price}."
        )
    elif s >= 25:
        zone = "YELLOW"
        color = "#f59e0b"
        status_label = "Предупреждение: активность покупателей падает, дельта затухает"
        short_advice = (
            f"Внимание: темп рыночных покупок по #{sym} замедляется, у сопротивления ${top_ask_price} ({ask_fmt}) "
            f"появляется лимитное предложение. Рекомендуется подтянуть стоп ближе к безубытку."
        )
    else:
        zone = "RED"
        color = "#ef4444"
        status_label = "Критическая опасность: стенку разъедают крупными рыночными продажами, рекомендован досрочный выход"
        short_advice = (
            f"Тревога по #{sym}: лимитную защиту ${top_bid_price} активно продавливают маркет-ордерами при оттоке дельты. "
            f"Рекомендован досрочный выход или сокращение риска не дожидаясь пробоя SL (${sl_price})."
        )

    return {
        "score": s,
        "zone": zone,
        "color": color,
        "status_label": status_label,
        "short_advice": short_advice,
    }


def build_expected_move_cone(
    *,
    current_price: float,
    atr: float,
    bias: str,
    recent_delta_sum: float,
    last_candle_ts: int,
    tf: str,
    price_dec: int,
) -> Dict[str, Any]:
    """Expected Move Cone (Volatility Fan ±1σ / ±2σ на 16 баров вперёд) — вариант market-analysis."""
    tf_minutes = {"1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}.get(tf, 15)
    time_step_ms = tf_minutes * 60 * 1000

    # 1-sigma per single bar based on ATR(14)
    sigma_1_bar = float(atr * 0.9)
    # Drift direction based on CVD and EMA momentum
    drift_direction = 1.0 if (bias == "BULLISH" and recent_delta_sum >= 0) else (-1.0 if bias == "BEARISH" else 0.0)
    drift_per_bar = drift_direction * (sigma_1_bar * 0.12)

    fan_points = []
    num_bars_forward = 16
    for k in range(1, num_bars_forward + 1):
        future_ts = last_candle_ts + (k * time_step_ms)
        sqrt_k = math.sqrt(k)
        mid_price = current_price + (drift_per_bar * k)
        u1 = mid_price + (sigma_1_bar * sqrt_k)
        l1 = mid_price - (sigma_1_bar * sqrt_k)
        u2 = mid_price + (sigma_1_bar * 1.96 * sqrt_k)
        l2 = mid_price - (sigma_1_bar * 1.96 * sqrt_k)
        fan_points.append({
            "step": k,
            "timestamp": future_ts,
            "price_mid": round(mid_price, price_dec),
            "upper_1s": round(u1, price_dec),
            "lower_1s": round(l1, price_dec),
            "upper_2s": round(u2, price_dec),
            "lower_2s": round(l2, price_dec),
        })

    return {
        "bars_forward": num_bars_forward,
        "timeframe": tf,
        "base_price": round(current_price, price_dec),
        "base_timestamp": last_candle_ts,
        "atr_14": round(atr, price_dec),
        "sigma_1s_pct": round((sigma_1_bar * math.sqrt(num_bars_forward) / max(1e-9, current_price)) * 100.0, 2),
        "sigma_2s_pct": round((sigma_1_bar * 1.96 * math.sqrt(num_bars_forward) / max(1e-9, current_price)) * 100.0, 2),
        "fan_points": fan_points
    }


def build_liquidity_magnet(
    *,
    bid_items: list,
    ask_items: list,
    current_price: float,
    top_bid_p: float,
    top_bid_usd: float,
    top_bid_dist_pct: float,
    top_ask_p: float,
    top_ask_usd: float,
    top_ask_dist_pct: float,
    price_dec: int,
) -> Dict[str, Any]:
    """Liquidity Magnet: перевес плотностей стакана в коридоре ±1.5%."""
    corridor_pct = 0.015  # ±1.5%
    p_min = current_price * (1.0 - corridor_pct)
    p_max = current_price * (1.0 + corridor_pct)

    bids_in_corridor_usd = sum(usd for p, usd in bid_items if p >= p_min)
    asks_in_corridor_usd = sum(usd for p, usd in ask_items if p <= p_max)
    depth_ratio = bids_in_corridor_usd / max(1.0, asks_in_corridor_usd)

    if depth_ratio >= 1.3:
        magnet_vector = "BULLISH_SUPPORT"
        magnet_description = f"Перевес лимитных заявок на покупку ({depth_ratio:.1f}x Bid/Ask в пределах ±1.5%). Ликвидность снизу защищает цену."
        magnet_target_price = top_ask_p
    elif depth_ratio <= 0.77:
        magnet_vector = "BEARISH_PRESSURE"
        magnet_description = f"Давление лимитных продавцов ({1.0/max(0.01, depth_ratio):.1f}x Ask/Bid в пределах ±1.5%). Ликвидность притягивает цену к стенке Bid ${top_bid_p}."
        magnet_target_price = top_bid_p
    else:
        magnet_vector = "BALANCED"
        magnet_description = f"Сбалансированная плотность стакана (Bid/Ask {depth_ratio:.2f}x в пределах ±1.5%)."
        magnet_target_price = round((top_bid_p + top_ask_p) / 2.0, price_dec)

    return {
        "corridor_pct": 1.5,
        "bids_volume_usd": round(bids_in_corridor_usd, 0),
        "asks_volume_usd": round(asks_in_corridor_usd, 0),
        "bid_ask_depth_ratio": round(depth_ratio, 2),
        "magnet_vector": magnet_vector,
        "magnet_description": magnet_description,
        "nearest_major_bid_wall": {
            "price": top_bid_p,
            "volume_usd": top_bid_usd,
            "dist_pct": top_bid_dist_pct
        },
        "nearest_major_ask_wall": {
            "price": top_ask_p,
            "volume_usd": top_ask_usd,
            "dist_pct": top_ask_dist_pct
        },
        "target_liquidity_price": magnet_target_price
    }


def build_expected_value(
    p_win: float,
    avg_win: float,
    avg_loss: float,
    avg_fees: float,
    ev_usd: float,
    ev_r_multiple: float,
    total_tr: int,
) -> Dict[str, Any]:
    """Сводка Expected Value (EV) по вычисленным скалярам (единый dict для обеих веток роутера)."""
    return {
        "p_win": round(p_win, 2),
        "p_win_pct": round(p_win * 100.0, 1),
        "avg_win_usd": round(avg_win, 2),
        "avg_loss_usd": round(avg_loss, 2),
        "avg_fees_and_slippage_usd": round(avg_fees, 2),
        "ev_per_trade_usd": round(ev_usd, 2),
        "ev_r_multiple": f"{'+' if ev_r_multiple > 0 else ''}{ev_r_multiple}R",
        "sample_trades_tested": total_tr,
        "is_statistically_significant": total_tr >= 30,
        "sample_warning": ("Мало данных (<30 сделок), доверительный интервал широкий" if total_tr < 30 else None),
        "is_positive_expectancy": ev_usd > 0,
        "verdict": "Математическое преимущество (+Edge)" if ev_usd > 0 else "Отрицательное мат. ожидание (-Edge)"
    }


# ==============================================================================
# Probabilistic Forecast: режим, сигнал, конус, SL/TP, оркестратор
# ==============================================================================

def classify_forecast_regime(frame: pd.DataFrame) -> tuple:
    """Return the shared market-regime label used by the adaptive execution layer."""
    from backend.app.engine.regime_classifier import RegimeClassifier

    regime, metrics = RegimeClassifier().classify_current(frame)
    return regime.value, metrics


def build_forecast_signal(
    *,
    symbol: str,
    timeframe: str,
    timestamp: int,
    direction: str,
    entry_price: float,
    sl: float,
    tp1: float,
    tp2: float,
    leverage: float,
    risk_per_trade_pct: float,
    expected_rr: float,
    confidence: float,
    reason: str,
    strategy_type: str,
):
    """Create the canonical forecast signal while preserving user parameters."""
    from backend.app.engine.trade_contract import UnifiedTradeSignal

    return UnifiedTradeSignal(
        symbol=symbol,
        timeframe=timeframe,
        timestamp=timestamp,
        direction=direction,
        entry_type="FORECAST_CONE",
        entry_price=entry_price,
        sl=sl,
        tp1=tp1,
        tp2=tp2,
        leverage=float(leverage),
        risk_pct=float(risk_per_trade_pct) / 100.0,
        expected_rr=expected_rr,
        confidence=confidence,
        reason=reason,
        strategy_type=strategy_type,
        data_source="realtime_binance",
        invalidation_condition="Bar close outside 1-sigma cone boundary",
    )


def build_forecast_fan(
    *,
    current_price: float,
    atr: float,
    drift_direction: float,
    anchor_timestamp: int,
    horizon_bars: int,
    time_step_ms: int,
    price_dec: int,
) -> Dict[str, Any]:
    """Конус ±1σ/±2σ forecast-эндпоинта: drift, fan_points (с bar_offset/sigma-ключами) и cone_dict."""
    sigma_1_bar = float(atr * 0.9)
    drift_per_bar = drift_direction * (sigma_1_bar * 0.12)
    expected_drift_pct = round((drift_per_bar * horizon_bars / max(1e-9, current_price)) * 100.0, 2)

    fan_points = []
    for k in range(1, horizon_bars + 1):
        future_ts = anchor_timestamp + (k * time_step_ms)
        sqrt_k = math.sqrt(k)
        mid_price = current_price + (drift_per_bar * k)
        u1 = mid_price + (sigma_1_bar * sqrt_k)
        l1 = mid_price - (sigma_1_bar * sqrt_k)
        u2 = mid_price + (sigma_1_bar * 1.96 * sqrt_k)
        l2 = mid_price - (sigma_1_bar * 1.96 * sqrt_k)
        fan_points.append({
            "bar_offset": k,
            "step": k,
            "timestamp": future_ts,
            "price_mid": round(mid_price, price_dec),
            "upper_1s": round(u1, price_dec),
            "lower_1s": round(l1, price_dec),
            "upper_2s": round(u2, price_dec),
            "lower_2s": round(l2, price_dec),
            "upper_1sigma": round(u1, price_dec),
            "lower_1sigma": round(l1, price_dec),
            "upper_2sigma": round(u2, price_dec),
            "lower_2sigma": round(l2, price_dec),
        })

    sigma_1s_pct = round((sigma_1_bar * math.sqrt(horizon_bars) / max(1e-9, current_price)) * 100.0, 2)
    sigma_2s_pct = round((sigma_1_bar * 1.96 * math.sqrt(horizon_bars) / max(1e-9, current_price)) * 100.0, 2)

    return {
        "sigma_1_bar": sigma_1_bar,
        "drift_per_bar": drift_per_bar,
        "expected_drift_pct": expected_drift_pct,
        "fan_points": fan_points,
        "sigma_1s_pct": sigma_1s_pct,
        "sigma_2s_pct": sigma_2s_pct,
    }


def synthesize_sl_tp_prices(
    *,
    direction: str,
    current_price: float,
    atr: float,
    sl_pct: float,
    tp_pct: float,
    tp1_rr: float,
    price_dec: int,
    symbol: str = "BTCUSDT",
    sl_tp_mode: str = "fixed",
    atr_multiplier: float = 1.35,
    nearest_support_wall_price: Optional[float] = None,
    nearest_support_wall_usd: float = 0.0,
    nearest_resistance_wall_price: Optional[float] = None,
    nearest_resistance_wall_usd: float = 0.0,
) -> Dict[str, float]:
    """Цены SL/TP1/TP2/безубытка по явным %, ATR-дефолтам или селективному dynamic_sl_tp."""
    if sl_tp_mode and str(sl_tp_mode).lower() != "fixed" and direction in ("LONG", "SHORT"):
        from backend.app.engine.dynamic_sl_tp import compute_dynamic_sl_tp_levels

        dyn = compute_dynamic_sl_tp_levels(
            symbol=symbol,
            side=direction,
            entry_price=current_price,
            sl_pct=sl_pct if sl_pct > 0 else 0.8,
            tp_pct=tp_pct if tp_pct > 0 else 2.0,
            atr=atr,
            sl_tp_mode=sl_tp_mode,
            atr_multiplier=atr_multiplier,
            tp1_rr_ratio=max(1.0, tp1_rr),
            nearest_support_wall_price=nearest_support_wall_price,
            nearest_support_wall_usd=nearest_support_wall_usd,
            nearest_resistance_wall_price=nearest_resistance_wall_price,
            nearest_resistance_wall_usd=nearest_resistance_wall_usd,
        )
        sl_price = round(float(dyn["sl_price"]), price_dec)
        tp1_price = round(float(dyn["tp1_price"]), price_dec)
        tp2_price = round(float(dyn["tp2_price"]), price_dec)
        breakeven_price = (
            round(current_price + current_price * 0.001, price_dec)
            if direction == "LONG"
            else round(current_price - current_price * 0.001, price_dec)
        )
        return {
            "sl_dist": abs(current_price - sl_price),
            "tp2_dist": abs(tp2_price - current_price),
            "sl_price": sl_price,
            "tp1_price": tp1_price,
            "tp2_price": tp2_price,
            "breakeven_price": breakeven_price,
        }

    sl_dist = current_price * sl_pct / 100.0 if sl_pct > 0 else 1.2 * atr
    tp2_dist = current_price * tp_pct / 100.0 if tp_pct > 0 else 2.8 * atr
    tp1_dist = min(tp2_dist, sl_dist * max(1.0, tp1_rr))
    if direction == "LONG":
        sl_price = round(current_price - sl_dist, price_dec)
        tp1_price = round(current_price + tp1_dist, price_dec)
        tp2_price = round(current_price + tp2_dist, price_dec)
        breakeven_price = round(current_price + current_price * 0.001, price_dec)
    else:
        sl_price = round(current_price + sl_dist, price_dec)
        tp1_price = round(current_price - tp1_dist, price_dec)
        tp2_price = round(current_price - tp2_dist, price_dec)
        breakeven_price = round(current_price - current_price * 0.001, price_dec)

    return {
        "sl_dist": sl_dist,
        "tp2_dist": tp2_dist,
        "sl_price": sl_price,
        "tp1_price": tp1_price,
        "tp2_price": tp2_price,
        "breakeven_price": breakeven_price,
    }


async def compute_probabilistic_forecast(
    symbol: str,
    timeframe: str,
    horizon_bars: int = 16,
    strategy_type: str = "confluence_ema",
    strategy_params: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    from backend.app.engine.trade_contract import UnifiedTradeSignal
    from backend.app.db.database import AsyncSessionLocal
    from backend.app.db.models import DecisionLog

    sym = symbol.strip().upper()
    tf = timeframe.strip().lower()
    tf_minutes = {"1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}.get(tf, 15)
    time_step_ms = tf_minutes * 60 * 1000

    forecast_days = int(strategy_params.get("days", 3)) if isinstance(strategy_params, dict) and strategy_params.get("days") else 3
    try:
        # A preflight scenario informs paper admission, so it must never reuse
        # a merely historical Parquet tail.  The shared loader will refresh or
        # fail explicitly when a closed-candle frame is not current enough.
        df = await fetch_history(sym, tf, days=forecast_days, require_fresh=True)
    except Exception as e:
        logger.error(f"Failed to fetch klines for forecast: {e}")
        raise HTTPException(status_code=502, detail=f"Ошибка загрузки истории Binance для {sym}: {e}")

    if df.empty or len(df) < 60:
        raise HTTPException(
            status_code=400,
            detail=f"Недостаточно исторических данных для прогноза {sym} (минимум 60 свечей, получено {len(df) if not df.empty else 0})"
        )

    close_s = df['close'].astype(float)
    high_s = df['high'].astype(float)
    low_s = df['low'].astype(float)
    vol_s = df['volume'].astype(float)

    current_price = float(close_s.iloc[-1])
    price_dec = 1 if current_price >= 100 else 4
    anchor_timestamp = int(df['timestamp'].iloc[-1])

    # ATR(14)
    atr = compute_atr14(high_s, low_s, close_s, fallback_price=current_price)

    # Momentum & CVD
    ema20 = float(close_s.ewm(span=20, adjust=False).mean().iloc[-1])
    ema50 = float(close_s.ewm(span=50, adjust=False).mean().iloc[-1])

    delta_s = get_or_synthesize_delta(df, close_s, high_s, low_s, vol_s)

    cvd_s = delta_s.cumsum()
    cvd_ema14_s = cvd_s.ewm(span=14, adjust=False).mean()
    cvd_current = float(cvd_s.iloc[-1])
    cvd_ema14 = float(cvd_ema14_s.iloc[-1])
    recent_delta_sum = float(delta_s.iloc[-14:].sum())

    profile = str(strategy_type or "confluence_ema")
    params = dict(strategy_params or {})
    use_atr_filter = bool(params.get("use_atr_filter", False))
    use_cvd_filter = bool(params.get("use_cvd_filter", False))
    use_oi_filter = bool(params.get("use_oi_filter", False))
    use_rsi_filter = bool(params.get("use_rsi_filter", False))
    use_stacked_imbalance_filter = bool(params.get("use_stacked_imbalance_filter", False))
    use_absorption_filter = bool(params.get("use_absorption_filter", False))
    use_poc_migration_filter = bool(params.get("use_poc_migration_filter", False))
    volume_multiplier = float(params.get("volume_multiplier", 1.3) or 1.3)
    min_density_usd = float(params.get("min_density_usd", 0.0) or 0.0)
    forecast_engine = OrderFlowBacktester(initial_capital=float(params.get("initial_capital", 10000.0) or 10000.0))
    indicator_frame = forecast_engine.calculate_indicators(df)
    market_regime, regime_metrics = classify_forecast_regime(indicator_frame)
    latest_signal = forecast_engine.evaluate_latest_signal(
        indicator_frame,
        strategy_type=profile,
        volume_multiplier=volume_multiplier,
        min_density_usd=min_density_usd,
        use_atr_filter=use_atr_filter,
        use_cvd_filter=use_cvd_filter,
        use_oi_filter=use_oi_filter,
        use_rsi_filter=use_rsi_filter,
        use_stacked_imbalance_filter=use_stacked_imbalance_filter,
        use_absorption_filter=use_absorption_filter,
        use_poc_migration_filter=use_poc_migration_filter,
    )
    decision_diagnostic = None
    if latest_signal:
        direction = latest_signal["direction"]
        bias = "BULLISH" if direction == "LONG" else "BEARISH"
        drift_direction = 1.0 if direction == "LONG" else -1.0
        reasoning = " · ".join(latest_signal["reasons"])
    else:
        direction = "NO_TRADE"
        bias = "NEUTRAL"
        drift_direction = 0.0
        decision_diagnostic = forecast_engine.explain_latest_signal(
            indicator_frame,
            strategy_type=profile,
            volume_multiplier=volume_multiplier,
            min_density_usd=min_density_usd,
            use_atr_filter=use_atr_filter,
            use_cvd_filter=use_cvd_filter,
            use_oi_filter=use_oi_filter,
            use_rsi_filter=use_rsi_filter,
            use_stacked_imbalance_filter=use_stacked_imbalance_filter,
            use_absorption_filter=use_absorption_filter,
            use_poc_migration_filter=use_poc_migration_filter,
        )
        reasoning = decision_diagnostic.get("reason") or "NO_TRADE: условия стратегии не выполнены."

    fan = build_forecast_fan(
        current_price=current_price,
        atr=atr,
        drift_direction=drift_direction,
        anchor_timestamp=anchor_timestamp,
        horizon_bars=horizon_bars,
        time_step_ms=time_step_ms,
        price_dec=price_dec,
    )
    expected_drift_pct = fan["expected_drift_pct"]
    fan_points = fan["fan_points"]
    sigma_1s_pct = fan["sigma_1s_pct"]
    sigma_2s_pct = fan["sigma_2s_pct"]

    cone_dict = {
        "bars_forward": horizon_bars,
        "timeframe": tf,
        "base_price": round(current_price, price_dec),
        "base_timestamp": anchor_timestamp,
        "atr_14": round(atr, price_dec),
        "sigma_1s_pct": sigma_1s_pct,
        "sigma_2s_pct": sigma_2s_pct,
        "direction": bias,
        "trend": bias,
        "expected_drift_pct": expected_drift_pct,
        "fan_points": fan_points
    }

    # Stop Loss & Take Profit targets use the same explicit percentages passed
    # to the historical backtest whenever the overnight pilot supplies them.
    sl_pct = float(params.get("stop_loss_pct", 0.0) or 0.0)
    tp_pct = float(params.get("take_profit_pct", 0.0) or 0.0)
    tp1_rr = float(params.get("tp1_rr_ratio", 1.5) or 1.5)
    sl_tp_mode = str(params.get("sl_tp_mode", "fixed") or "fixed")
    atr_multiplier = float(params.get("atr_multiplier", 1.35) or 1.35)
    levels = synthesize_sl_tp_prices(
        direction=direction,
        current_price=current_price,
        atr=atr,
        sl_pct=sl_pct,
        tp_pct=tp_pct,
        tp1_rr=tp1_rr,
        price_dec=price_dec,
        symbol=sym,
        sl_tp_mode=sl_tp_mode,
        atr_multiplier=atr_multiplier,
    )
    sl_dist = levels["sl_dist"]
    tp2_dist = levels["tp2_dist"]
    sl_price = levels["sl_price"]
    tp1_price = levels["tp1_price"]
    tp2_price = levels["tp2_price"]
    breakeven_price = levels["breakeven_price"]

    unified_signal = None
    if latest_signal:
        unified_signal = build_forecast_signal(
            symbol=sym,
            timeframe=tf,
            timestamp=anchor_timestamp,
            direction=direction,
            entry_price=round(current_price, price_dec),
            sl=sl_price,
            tp1=tp1_price,
            tp2=tp2_price,
            leverage=float(params.get("leverage", 1.0) or 1.0),
            risk_per_trade_pct=float(params.get("risk_per_trade_pct", 2.0) or 2.0),
            expected_rr=round(tp2_dist / max(1e-9, sl_dist), 2),
            confidence=0.72,
            reason=reasoning,
            strategy_type=profile,
        )

    # Log into Decision Journal (consultative log)
    try:
        async with AsyncSessionLocal() as session:
            log_entry = DecisionLog(
                event_type="FORECAST",
                symbol=sym,
                timeframe=tf,
                direction=direction,
                price=current_price,
                entry_price=current_price,
                sl_price=sl_price,
                tp_price=tp2_price,
                strategy_or_condition="Probabilistic Volatility Cone (16 bars)",
                ai_verdict=bias,
                ai_reason=reasoning,
                context_json=json.dumps({
                    "cone": cone_dict,
                    "unified_signal": unified_signal.model_dump() if unified_signal else None,
                    "atr": atr,
                    "sigma_1s_pct": sigma_1s_pct,
                    "sigma_2s_pct": sigma_2s_pct,
                }),
                user_decision="PENDING",
                notes=f"Probabilistic Forecast horizon: {horizon_bars} bars",
            )
            session.add(log_entry)
            await session.commit()
    except Exception as db_err:
        logger.debug(f"Decision journal logging skipped: {db_err}")

    return {
        "status": "success",
        "symbol": sym,
        "timeframe": tf,
        "strategy_type": profile,
        "strategy_params": params,
        "profile_application": {
            "strategy_type": profile,
            "signal_engine": "shared_ohlcv_evaluator",
            "closed_candles_only": True,
            "fresh_ohlcv_required": True,
            "filters": {
                "atr": use_atr_filter,
                "cvd": use_cvd_filter,
                "oi": use_oi_filter,
                "rsi": use_rsi_filter,
                "stacked_imbalance": use_stacked_imbalance_filter,
                "absorption": use_absorption_filter,
                "poc_migration": use_poc_migration_filter,
            },
        },
        "data_status": "connected",
        "data_source": "binance_futures_klines",
        "is_probabilistic_forecast": True,
        "disclaimer": "Вероятностный прогноз волатильности (±1σ / ±2σ). Не является гарантированной доходностью или инвестиционной рекомендацией.",
        "anchor_price": round(current_price, price_dec),
        "anchor_timestamp": anchor_timestamp,
        "horizon_bars": horizon_bars,
        "base_scenario": {
            "direction": direction,
            "bias": bias,
            "market_regime": market_regime,
            "drift_direction": drift_direction,
            "expected_drift_pct": expected_drift_pct,
            "reason": reasoning,
        },
        "decision_diagnostic": decision_diagnostic,
        "bands": fan_points,
        "expected_move_cone": cone_dict,
        "unified_signal": unified_signal.model_dump() if unified_signal else None,
        "trading_idea": {
            "direction": direction,
            "order_type": "BUY LIMIT" if direction == "LONG" else "SELL LIMIT" if direction == "SHORT" else "WAIT",
            "entry_price": round(current_price, price_dec),
            "sl_price": sl_price,
            "tp1_price": tp1_price,
            "tp2_price": tp2_price,
            "breakeven_price": breakeven_price,
            "risk_reward_ratio": "1:2.33",
            "reasoning": reasoning,
        },
        "market_regime": market_regime,
        "regime_metrics": regime_metrics,
    }
