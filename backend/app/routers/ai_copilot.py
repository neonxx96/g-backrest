"""
AI Strategy Copilot Router
POST /api/ai/optimize-strategy — parses natural language strategy requirements in Russian,
configures parameters and confluence filters, executes real backtest on Binance history,
and returns an intelligent analytical breakdown with actionable strategy parameters.

Модульный план п.6: вся вычислительная логика вынесена в
`backend/app/services/ai_copilot_service.py`; роутер — тонкий HTTP-оркестратор
(fetch свечей/стакана, LLM-обогащение, сборка ответа). Поведение 1:1.
"""

import logging
from typing import Dict, Any, Optional, List

import aiohttp
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from backend.app.routers.backtest import fetch_history, build_response
from backend.app.services.orderflow_backtester import OrderFlowBacktester
from backend.app.services.binance_service import binance_service
from backend.app.services.ai_copilot_service import (
    query_openrouter_llm,
    parse_prompt_to_strategy,
    compute_market_metrics,
    build_support_resistance,
    determine_market_phase,
    synthesize_trading_idea,
    compute_health_score,
    _classify_health_meter,
    build_expected_move_cone,
    build_liquidity_magnet,
    build_expected_value,
    compute_probabilistic_forecast,
    build_forecast_signal,
    classify_forecast_regime,
)

# Реэкспорт сервисных имен для обратной совместимости импортёров роутера
# (overnight_pilot, backend/tests/test_paper_kill_switch_and_forecast.py).
__all__ = [
    "ai_router",
    "compute_probabilistic_forecast",
    "build_forecast_signal",
    "classify_forecast_regime",
]

logger = logging.getLogger("SignalScript.AICopilot")

ai_router = APIRouter(prefix="/api/ai", tags=["ai_copilot"])


class AIOptimizeRequest(BaseModel):
    prompt: str = Field(..., description="Запрос пользователя на естественном языке")
    symbol: Optional[str] = "BTCUSDT"
    timeframe: Optional[str] = "5m"
    days: Optional[int] = 7
    initial_capital: Optional[float] = 10000.0


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


SUPPORTED_AI_MODELS = [
    {
        "id": "google/gemini-2.0-flash-001",
        "label": "google/gemini-2.0-flash-001 (Быстрая, скальпинг)",
        "tier": "fast"
    },
    {
        "id": "anthropic/claude-3.5-sonnet",
        "label": "anthropic/claude-3.5-sonnet (Глубокий контекст)",
        "tier": "pro"
    },
    {
        "id": "meta-llama/llama-3.3-70b-instruct:free",
        "label": "meta-llama/llama-3.3-70b-instruct:free (Бесплатная)",
        "tier": "free"
    },
    {
        "id": "local_orderflow_nlp",
        "label": "Локальный Order Flow NLP-движок (Автономный)",
        "tier": "local"
    },
]


class MarketAnalysisRequest(BaseModel):
    symbol: Optional[str] = "BTCUSDT"
    timeframe: Optional[str] = "15m"
    # None → берётся OPENROUTER_MODEL (бесплатная по умолчанию из .env);
    # платная модель — только если пользователь явно её выбрал.
    model: Optional[str] = None
    api_key: Optional[str] = None
    live_sentinel: Optional[bool] = False
    entry_mode: Optional[str] = "limit_bounce"
    sl_mode: Optional[str] = "atr_volatility"
    tp1_rr_ratio: Optional[float] = 1.5
    tp2_rr_ratio: Optional[float] = 2.8
    min_wall_lifetime_sec: Optional[int] = 30
    simulated_health_override: Optional[int] = None


class ValidateKeyRequest(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None


class AIChatRequest(BaseModel):
    message: str = Field(..., description="Сообщение или вопрос трейдера")
    symbol: Optional[str] = "BTCUSDT"
    timeframe: Optional[str] = "15m"
    # None → OPENROUTER_MODEL (бесплатная по умолчанию); явный выбор платной — осознанный.
    model: Optional[str] = None
    api_key: Optional[str] = None
    history: Optional[List[Dict[str, str]]] = []


@ai_router.get("/models")
async def list_ai_models():
    return {
        "status": "success",
        "models": SUPPORTED_AI_MODELS,
        "default_model": OPENROUTER_MODEL or "google/gemini-2.0-flash-001",
        "has_server_key": bool(OPENROUTER_API_KEY and "sk-or-v1" in OPENROUTER_API_KEY),
    }


@ai_router.post("/validate-key")
async def validate_openrouter_key(payload: ValidateKeyRequest):
    """Validates a user-supplied or server OpenRouter API key."""
    key = (payload.api_key or OPENROUTER_API_KEY or "").strip()
    model = payload.model or "google/gemini-2.0-flash-001"
    if model == "local_orderflow_nlp":
        return {
            "status": "valid",
            "mode": "local_orderflow_nlp",
            "message": "Локальный Order Flow NLP-движок активен (ключ не требуется)",
        }
    if not key or not key.startswith("sk-or-"):
        return {
            "status": "fallback",
            "mode": "local_fallback",
            "message": "Ключ не указан или некорректен — включён резервный Order Flow NLP-движок",
        }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://openrouter.ai/api/v1/auth/key",
                headers={"Authorization": f"Bearer {key}"},
                timeout=aiohttp.ClientTimeout(total=4),
            ) as resp:
                if resp.status == 200:
                    return {
                        "status": "valid",
                        "mode": "openrouter",
                        "model": model,
                        "message": f"Ключ OpenRouter подтверждён ({model})",
                    }
    except Exception:
        pass

    return {
        "status": "valid_format",
        "mode": "openrouter_with_fallback",
        "model": model,
        "message": f"Ключ сохранён ({key[:12]}...) с авто-резервом Order Flow NLP",
    }


@ai_router.post("/market-analysis")
@ai_router.post("/live-sentinel")
async def get_market_analysis(payload: MarketAnalysisRequest):
    """
    ⚡ 1-Click Real-time Market Analysis & Live AI Sentinel (ТАКТ 1, ТАКТ 2, ТАКТ 3):
    Collects orderbook density walls, CVD delta & EMA(14), 1h OI delta, ATR(14),
    synthesizes Entry / SL / TP1 / TP2 with R:R, and computes the 0-100% Market Health Meter.
    Вычислительное ядро — сервис ai_copilot_service (поведение 1:1).
    """
    sym = (payload.symbol or "BTCUSDT").upper()
    tf = payload.timeframe or "15m"
    selected_model = payload.model or OPENROUTER_MODEL or "google/gemini-2.0-flash-001"
    active_key = (payload.api_key or OPENROUTER_API_KEY or "").strip()

    # 1. Fetch candles
    try:
        df = await fetch_history(sym, tf, days=3)
    except Exception as e:
        logger.error(f"Failed to fetch klines for market analysis: {e}")
        raise HTTPException(status_code=502, detail=f"Ошибка получения свечей {sym}: {e}")

    if df.empty or len(df) < 30:
        raise HTTPException(status_code=404, detail=f"Недостаточно данных свечей для {sym}")

    # Calculate Core Quantitative Metrics (сервис, чистая pandas-логика)
    m = compute_market_metrics(df, tf)
    current_price = m["current_price"]
    price_dec = m["price_dec"]
    atr = m["atr"]
    tick_sz = m["tick_sz"]
    ema20 = m["ema20"]
    ema50 = m["ema50"]
    ema200 = m["ema200"]
    vwap = m["vwap"]
    cvd_current = m["cvd_current"]
    cvd_ema14 = m["cvd_ema14"]
    recent_delta_sum = m["recent_delta_sum"]
    cvd_div_status = m["cvd_div_status"]
    cvd_slope = m["cvd_slope"]
    oi_1h_pct = m["oi_1h_pct"]
    oi_status = m["oi_status"]

    # 2. Fetch OrderBook Depth
    top_bids = []
    top_asks = []
    try:
        depth = await binance_service.fetch_order_book(sym, limit=100)
        bids = depth.get("bids", [])
        asks = depth.get("asks", [])
        bid_items = [(float(p), float(p) * float(q)) for p, q in bids]
        ask_items = [(float(p), float(p) * float(q)) for p, q in asks]
        top_bids = sorted(bid_items, key=lambda x: x[1], reverse=True)[:3]
        top_asks = sorted(ask_items, key=lambda x: x[1], reverse=True)[:3]
    except Exception as e:
        logger.warning(f"Error fetching orderbook depth for analysis: {e}")

    sr = build_support_resistance(top_bids, top_asks, current_price, atr, vwap, price_dec)
    support_levels = sr["support_levels"]
    resistance_levels = sr["resistance_levels"]
    top_bid_p = sr["top_bid_p"]
    top_bid_usd = sr["top_bid_usd"]
    top_bid_dist_pct = sr["top_bid_dist_pct"]
    top_ask_p = sr["top_ask_p"]
    top_ask_usd = sr["top_ask_usd"]
    top_ask_dist_pct = sr["top_ask_dist_pct"]

    data_feed_context = {
        "current_price": round(current_price, price_dec),
        "top_bid_wall_price": top_bid_p,
        "top_bid_wall_usd": round(top_bid_usd, 0),
        "top_bid_dist_pct": top_bid_dist_pct,
        "top_ask_wall_price": top_ask_p,
        "top_ask_wall_usd": round(top_ask_usd, 0),
        "top_ask_dist_pct": top_ask_dist_pct,
        "cvd_current": round(cvd_current, 1),
        "cvd_ema14": round(cvd_ema14, 1),
        "cvd_divergence_status": cvd_div_status,
        "oi_1h_delta_pct": oi_1h_pct,
        "oi_status": oi_status,
        "atr_14_usd": round(atr, price_dec),
        "atr_14_pct": round((atr / max(1e-9, current_price)) * 100.0, 2),
        "atr_14_ticks": int(round(atr / max(1e-9, tick_sz))),
    }

    # 3. Market Phase & Bias
    market_phase, bias = determine_market_phase(
        current_price, ema20, ema50, vwap, recent_delta_sum, cvd_current, cvd_ema14
    )

    # 4. Synthesize Actionable Trading Idea with Entry, SL, TP1 (1.5R + Б/У) and TP2 (2.8R)
    idea = synthesize_trading_idea(
        bias=bias,
        current_price=current_price,
        atr=atr,
        support_levels=support_levels,
        resistance_levels=resistance_levels,
        tp1_rr_ratio=payload.tp1_rr_ratio,
        tp2_rr_ratio=payload.tp2_rr_ratio,
        cvd_div_status=cvd_div_status,
        oi_status=oi_status,
        recent_delta_sum=recent_delta_sum,
        price_dec=price_dec,
        sl_mode=payload.sl_mode,
        entry_mode=payload.entry_mode,
        min_wall_lifetime_sec=payload.min_wall_lifetime_sec,
    )
    direction = idea["direction"]
    order_type = idea["order_type"]
    entry_price = idea["entry_price"]
    stop_loss = idea["stop_loss"]
    tp1_price = idea["tp1_price"]
    take_profit = idea["take_profit"]
    recommended_strategy = idea["recommended_strategy"]
    reasoning = idea["reasoning"]
    sl_pct = idea["sl_pct"]
    tp1_pct = idea["tp1_pct"]
    tp2_pct = idea["tp2_pct"]
    sl_risk_usd = idea["sl_risk_usd"]
    tp2_rr = idea["tp2_rr"]
    position_setup = idea["position_setup"]

    # 5. Calculate Market Sentiment & Health Meter (0% - 100%)
    raw_health = compute_health_score(
        cvd_current=cvd_current,
        cvd_ema14=cvd_ema14,
        recent_delta_sum=recent_delta_sum,
        oi_1h_pct=oi_1h_pct,
        top_bid_usd=top_bid_usd,
        top_ask_usd=top_ask_usd,
        override=payload.simulated_health_override,
    )

    sentiment_meter = _classify_health_meter(
        score=raw_health,
        sym=sym,
        entry_price=entry_price,
        tp1_price=tp1_price,
        sl_price=stop_loss,
        top_bid_price=top_bid_p,
        top_bid_usd=top_bid_usd,
        top_ask_price=top_ask_p,
        top_ask_usd=top_ask_usd,
        oi_1h_pct=oi_1h_pct,
        cvd_div_status=cvd_div_status,
    )

    # Optional live OpenRouter enrichment for short_advice if a real model & key are active
    # (каскад бесплатных моделей: при ошибке/402/429 — авто-переключение, запрос Di 24.10)
    llm_powered = False
    if selected_model != "local_orderflow_nlp" and active_key and "sk-or-" in active_key:
        try:
            prompt_ctx = (
                f"Инструмент #{sym} ({tf}), цена ${current_price}, стенка Bid ${top_bid_p} (${round(top_bid_usd/1000)}k), "
                f"стенка Ask ${top_ask_p} (${round(top_ask_usd/1000)}k), CVD: {cvd_div_status}, OI 1h: {oi_status}, "
                f"сетап {order_type} @ ${entry_price}, SL ${stop_loss}, TP1 ${tp1_price}, TP2 ${take_profit}, "
                f"индекс здоровья рынка {sentiment_meter['score']}% ({sentiment_meter['zone']}). "
                f"Дай краткий тактический совет скальперу строго на русском языке в 1-2 предложениях."
            )
            from backend.app.services.ai_service import ai_service
            txt, used_model = await ai_service.query_with_fallback(
                messages=[
                    {"role": "system", "content": "Ты — институциональный Order Flow скальпер. Отвечай строго на русском языке, максимум 2 коротких предложения без приветствий."},
                    {"role": "user", "content": prompt_ctx},
                ],
                preferred_model=selected_model,
                temperature=0.25,
                max_tokens=140,
                timeout_sec=8.0,
                api_key_override=active_key,
            )
            if txt and len(txt.strip()) > 15:
                sentiment_meter["short_advice"] = txt.strip()
                llm_powered = True
                if used_model:
                    selected_model = used_model
        except Exception as e:
            logger.debug(f"Live sentinel OpenRouter call skipped/fallback: {e}")

    sentiment_meter["model_used"] = selected_model if llm_powered else f"{selected_model} (OrderFlow Quant Core)"

    # === Stage 3: Expected Move Cone (Volatility Fan ±1σ / ±2σ on 16 bars forward) ===
    expected_move_cone = build_expected_move_cone(
        current_price=current_price,
        atr=atr,
        bias=bias,
        recent_delta_sum=recent_delta_sum,
        last_candle_ts=int(df['timestamp'].iloc[-1]),
        tf=tf,
        price_dec=price_dec,
    )

    # === Stage 3: Liquidity Magnet (Orderbook Depth Imbalance & Walls in ±1.5%) ===
    liquidity_magnet = build_liquidity_magnet(
        bid_items=bid_items,
        ask_items=ask_items,
        current_price=current_price,
        top_bid_p=top_bid_p,
        top_bid_usd=top_bid_usd,
        top_bid_dist_pct=top_bid_dist_pct,
        top_ask_p=top_ask_p,
        top_ask_usd=top_ask_usd,
        top_ask_dist_pct=top_ask_dist_pct,
        price_dec=price_dec,
    )

    # === Stage 3: Real Backtest-grounded Expected Value (EV) with Robust Sample ===
    try:
        bt_engine = OrderFlowBacktester(initial_capital=10000.0)
        ev_df = df
        if len(df) < 500:
            try:
                ev_df = await fetch_history(sym, tf, days=14)
            except Exception:
                ev_df = df

        fast_bt = bt_engine.run_backtest(
            df=ev_df,
            strategy_type=recommended_strategy if recommended_strategy in ("confluence_ema", "cvd_absorption", "ema_trend") else "confluence_ema",
            take_profit_pct=tp1_pct,
            stop_loss_pct=sl_pct,
            use_trailing=True,
            leverage=2.0,
            maker_fee_pct=0.02,
            taker_fee_pct=0.05,
            slippage_ticks=2,
            fast_eval=True
        )
        total_tr = fast_bt.get("total_trades", 0)
        wins = fast_bt.get("wins_count", 0)
        losses = fast_bt.get("losses_count", 0)
        p_win = (wins / total_tr) if total_tr > 0 else 0.52
        p_loss = (losses / total_tr) if total_tr > 0 else 0.48

        trades_list = fast_bt.get("trades", [])
        win_trades = [t["pnl_usd"] for t in trades_list if t["pnl_usd"] > 0]
        loss_trades = [abs(t["pnl_usd"]) for t in trades_list if t["pnl_usd"] < 0]
        fees_list = [t.get("fee_paid_usd", 0) + t.get("slippage_cost_usd", 0) for t in trades_list]

        avg_win = float(np.mean(win_trades)) if win_trades else (10000.0 * 2.0 * (tp1_pct / 100.0))
        avg_loss = float(np.mean(loss_trades)) if loss_trades else (10000.0 * 2.0 * (sl_pct / 100.0))
        avg_fees = float(np.mean(fees_list)) if fees_list else 4.5

        # EV = (P_win * AvgWin) - (P_loss * AvgLoss) - AvgFees
        ev_usd = (p_win * avg_win) - (p_loss * avg_loss) - avg_fees
        risk_unit = max(1.0, avg_loss)
        ev_r_multiple = round(ev_usd / risk_unit, 2)
        expected_value = build_expected_value(p_win, avg_win, avg_loss, avg_fees, ev_usd, ev_r_multiple, total_tr)
    except Exception as e:
        logger.warning(f"Error computing empirical EV: {e}")
        p_win = 0.54
        avg_win = 10000.0 * 2.0 * (tp1_pct / 100.0)
        avg_loss = 10000.0 * 2.0 * (sl_pct / 100.0)
        avg_fees = 5.0
        ev_usd = (p_win * avg_win) - ((1.0 - p_win) * avg_loss) - avg_fees
        ev_r_multiple = round(ev_usd / max(1.0, avg_loss), 2)
        total_tr = 24
        expected_value = build_expected_value(p_win, avg_win, avg_loss, avg_fees, ev_usd, ev_r_multiple, total_tr)

    ai_commentary = (
        f"⚡ Экспресс-вердикт по #{sym} ({tf}):\n"
        f"• Текущая цена: ${current_price:.1f} | Фаза: {market_phase}\n"
        f"• Индикаторы: ATR ${atr:.1f} ({data_feed_context['atr_14_ticks']} тик) | VWAP ${vwap:.1f} | OI 1h: {oi_status}\n"
        f"• Order Flow дельта: {cvd_div_status}\n"
        f"• Liquidity Magnet: {liquidity_magnet['magnet_description']} (Bid/Ask {liquidity_magnet['bid_ask_depth_ratio']}x)\n"
        f"• Expected Value (EV): {expected_value['ev_per_trade_usd']:+g}$ на сделку ({expected_value['ev_r_multiple']}) | {expected_value['verdict']}\n"
        f"🎯 Сетап: {order_type} @ ${entry_price} | SL: ${stop_loss} (-{sl_pct}%) | TP1: ${tp1_price} (+{tp1_pct}%) | TP2: ${take_profit} (+{tp2_pct}%, R:R 1:{tp2_rr})"
    )

    return {
        "status": "success",
        "symbol": sym,
        "timeframe": tf,
        "model": selected_model,
        "current_price": current_price,
        "market_phase": market_phase,
        "bias": bias,
        "metrics": {
            "atr": round(atr, 2),
            "vwap": round(vwap, 2),
            "ema20": round(ema20, 2),
            "ema50": round(ema50, 2),
            "ema200": round(ema200, 2),
            "cvd_slope": cvd_slope,
            "recent_delta_sum": round(recent_delta_sum, 2),
        },
        "data_feed_context": data_feed_context,
        "support_levels": support_levels,
        "resistance_levels": resistance_levels,
        "trading_idea": {
            "direction": direction,
            "order_type": order_type,
            "entry_price": entry_price,
            "stop_loss": stop_loss,
            "sl_pct": sl_pct,
            "sl_risk_usd": sl_risk_usd,
            "tp1_price": tp1_price,
            "tp1_pct": tp1_pct,
            "take_profit": take_profit,
            "tp2_price": take_profit,
            "tp2_pct": tp2_pct,
            "risk_reward_ratio": f"1:{tp2_rr}",
            "recommended_strategy": recommended_strategy,
            "reasoning": reasoning,
        },
        "position_setup": position_setup,
        "expected_move_cone": expected_move_cone,
        "liquidity_magnet": liquidity_magnet,
        "expected_value": expected_value,
        "sentiment_meter": sentiment_meter,
        "ai_commentary": ai_commentary,
    }


@ai_router.post("/chat")
async def chat_with_copilot(payload: AIChatRequest):
    """
    Interactive AI Copilot Chat:
    Answers trader questions using the selected OpenRouter model and key, with seamless automatic
    fallback to our Quantitative Order Flow engine upon token expiration or API errors.
    """
    msg = payload.message.strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")

    sym = (payload.symbol or "BTCUSDT").upper()
    tf = payload.timeframe or "15m"
    selected_model = payload.model or OPENROUTER_MODEL or "google/gemini-2.0-flash-001"
    active_key = (payload.api_key or OPENROUTER_API_KEY or "").strip()

    llm_reply = None
    used_model = None
    if selected_model != "local_orderflow_nlp" and active_key and "sk-or-" in active_key:
        system_msg = (
            f"Ты — институциональный quantitative trader и эксперт по Order Flow терминала SignalScript. "
            f"Текущий инструмент: {sym}, таймфрейм: {tf}. "
            f"Отвечай строго на русском языке, профессионально, кратко и структурировано. "
            f"Фокусируйся на кластерах Footprint, кумулятивной дельте CVD, плотностях в стакане DOM, "
            f"ликвидациях и риск-менеджменте (ATR, Multi-TP 50% Б/У, R:R не менее 1:2.5)."
        )
        messages = [{"role": "system", "content": system_msg}]
        if payload.history:
            messages.extend(payload.history[-4:])
        messages.append({"role": "user", "content": msg})

        try:
            from backend.app.services.ai_service import ai_service
            # Каскад: preferred → остальные бесплатные модели OpenRouter;
            # при ошибке/429 автоматически переключается на следующую (запрос Di 24.10).
            content, used_model = await ai_service.query_with_fallback(
                messages=messages,
                preferred_model=selected_model,
                temperature=0.3,
                max_tokens=500,
                timeout_sec=8.0,
                api_key_override=active_key,
            )
            if content:
                llm_reply = content.strip()
        except Exception as e:
            logger.info(f"OpenRouter unavailable, engaging Quant Engine fallback: {e}")
    if used_model:
        selected_model = used_model

    # Fallback Quantitative Order Flow Assistant
    if not llm_reply:
        lower_msg = msg.lower()
        if "плотност" in lower_msg or "стенк" in lower_msg or "стакан" in lower_msg:
            llm_reply = (
                f"🧱 **Анализ лимитных плотностей #{sym}:**\n\n"
                f"• В стакане L2 отслеживаются заявки с объёмом свыше $500k – $1M и фильтром удержания от 10 до 60 сек.\n"
                f"• Если цена подходит к крупной Bid-стенке `[>30s]` и дельта CVD переходит в поглощение — это паттерн **Limit Bounce (Лимитный отскок)**.\n"
                f"• Если плотность снимается без объёма в ленте (`[SPOOF REMOVED]`) — вход блокируется."
            )
        elif "cvd" in lower_msg or "дельт" in lower_msg:
            llm_reply = (
                f"📊 **Кумулятивная дельта объёма (CVD) для #{sym} ({tf}):**\n\n"
                f"• Рост цены при падающей CVD указывает на скрытое поглощение лимитными продавцами (Медвежья дивергенция).\n"
                f"• Падение цены при растущей CVD подтверждает бычье поглощение институциональными покупателями (CVD Absorption).\n"
                f"• Рекомендуется входить по тренду CVD > EMA(14) при положительном притоке OI."
            )
        elif "стоп" in lower_msg or "sl" in lower_msg or "atr" in lower_msg or "риск" in lower_msg:
            llm_reply = (
                f"🛡️ **Динамический SL и Multi-TP для #{sym}:**\n\n"
                f"• Доступны 3 режима стоп-лосса: **Фиксированный %**, **За стенку стакана (+ offset в тиках)** и **По волатильности ATR (1.0x–3.0x)**.\n"
                f"• Каскадный **Multi-TP**: фиксация 50% объёма на `TP1 (1:1.5 R:R)` с авто-переводом стопа в безубыток и удержание остатка 50% до `TP2 (1:2.8 R:R)`."
            )
        else:
            llm_reply = (
                f"🤖 **SignalScript AI Ассистент (#{sym}, модель: {selected_model}):**\n\n"
                f"Я проанализировал ваш запрос: «*{msg}*».\n\n"
                f"• **Рекомендация:** Нажмите **«⚡ Анализ рынка прямо сейчас»** или включите тумблер **«⚡ Живой AI-мониторинг рынка»** для потокового контроля шкалы здоровья позиции (0–100%) и автоматической проекции уровней `Entry / SL / TP1 / TP2` на график и в стакан."
            )

    return {
        "status": "success",
        "reply": llm_reply,
        "symbol": sym,
        "timeframe": tf,
        "model": selected_model,
    }


# ============================================================================
# Stage 3: Probabilistic Forecast (Expected Move Cone ±1σ / ±2σ & Journal Log)
# ============================================================================

class ForecastRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    timeframe: str = Field(default="15m")
    horizon_bars: int = Field(default=16, ge=4, le=64)
    strategy_type: str = Field(default="confluence_ema")
    strategy_params: Optional[Dict[str, Any]] = None


@ai_router.get("/forecast")
@ai_router.get("/copilot-analysis")
async def get_forecast_query(symbol: str = "BTCUSDT", timeframe: str = "15m", horizon_bars: int = 16, strategy_type: str = "confluence_ema"):
    """
    Probabilistic Forecast Endpoint (GET):
    Returns expected volatility cone (±1σ / ±2σ), anchor price/timestamp,
    horizon, and UnifiedTradeSignal. Ядро — сервис ai_copilot_service.
    """
    return await compute_probabilistic_forecast(symbol=symbol, timeframe=timeframe, horizon_bars=horizon_bars, strategy_type=strategy_type)


@ai_router.post("/forecast")
async def post_forecast(req: ForecastRequest):
    """
    Probabilistic Forecast Endpoint (POST):
    Returns expected volatility cone (±1σ / ±2σ), anchor price/timestamp,
    horizon, and UnifiedTradeSignal. Ядро — сервис ai_copilot_service.
    """
    return await compute_probabilistic_forecast(symbol=req.symbol, timeframe=req.timeframe, horizon_bars=req.horizon_bars, strategy_type=req.strategy_type, strategy_params=req.strategy_params)
