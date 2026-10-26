"""
Stage 1, 2 & 3 Router:
- Stage 1: SQLite Decision Journal (`/api/journal/logs`, `/api/journal/log`, `/api/journal/export-csv`)
- Stage 2: Consultative AI Second Opinion (`/api/journal/second-opinion`) via OpenRouter with strict non-hallucination prompt and honest unavailability fallback
- Stage 3: 1-Click Strategy Parameter Presets (`/api/journal/presets`)
"""

import io
import csv
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List

import aiohttp
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, desc, asc

from backend.app.config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from backend.app.db.database import AsyncSessionLocal
from backend.app.db.models import DecisionLog, StrategyPreset, SignalHistory
from backend.app.services.binance_service import binance_service
from backend.app.services.paper_trading import paper_trading_session
from backend.app.services.overnight_pilot import overnight_pilot_manager
from backend.app.services.session_review import (
    DEFAULT_MAX_LAG_MS,
    build_session_review,
    collect_review_trades,
)
from backend.app.services.indicators import compute_indicators
from backend.app.services.orderflow_backtester import OrderFlowBacktester

logger = logging.getLogger("SignalScript.Journal")

journal_router = APIRouter(prefix="/api/journal", tags=["journal"])

ALLOWED_JOURNAL_TYPES = ["SIGNAL", "MANUAL_ENTRY", "AI_OPINION", "ORDER", "MANUAL_EXIT", "MANUAL_SKIP"]


# ============================================================================
# Pydantic Schemas
# ============================================================================

class DecisionLogCreateRequest(BaseModel):
    event_type: str = Field(default="MANUAL_ENTRY", description="SIGNAL | AI_OPINION | MANUAL_ENTRY | MANUAL_EXIT | MANUAL_SKIP")
    symbol: str = Field(..., description="Trading pair e.g. BTCUSDT")
    timeframe: str = Field(default="5m")
    direction: str = Field(default="LONG")
    price: float = Field(default=0.0)
    entry_price: Optional[float] = None
    sl_price: Optional[float] = None
    tp_price: Optional[float] = None
    strategy_or_condition: str = Field(default="Ручная сделка")
    ai_verdict: Optional[str] = None
    ai_reason: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    user_decision: str = Field(default="ENTERED", description="ENTERED | SKIPPED | EXITED | PENDING")
    notes: str = Field(default="")


class DecisionLogUpdateRequest(BaseModel):
    user_decision: Optional[str] = None
    notes: Optional[str] = None
    price: Optional[float] = None


class SecondOpinionRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    timeframe: str = Field(default="5m")
    direction: str = Field(default="LONG")
    price: Optional[float] = None
    entry_price: Optional[float] = None
    sl_price: Optional[float] = None
    tp_price: Optional[float] = None
    stop_loss_pct: Optional[float] = 0.6
    take_profit_pct: Optional[float] = 1.5
    strategy_type: str = Field(default="density_bounce")
    openrouter_api_key: Optional[str] = None
    simulate_unavailable: bool = Field(default=False, description="Used only to verify fallback if needed")


class StrategyPresetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    symbol: str = Field(default="ANY")
    timeframe: str = Field(default="5m")
    strategy_type: str = Field(default="density_bounce")
    params: Dict[str, Any] = Field(default_factory=dict)


# ============================================================================
# Helpers
# ============================================================================

def serialize_log(row: DecisionLog) -> Dict[str, Any]:
    try:
        ctx = json.loads(row.context_json) if row.context_json else {}
    except Exception:
        ctx = {}
    return {
        "id": row.id,
        "timestamp": row.timestamp.isoformat() + "Z" if row.timestamp else None,
        "event_type": row.event_type,
        "symbol": row.symbol,
        "timeframe": row.timeframe,
        "direction": row.direction,
        "price": row.price,
        "entry_price": row.entry_price,
        "sl_price": row.sl_price,
        "tp_price": row.tp_price,
        "strategy_or_condition": row.strategy_or_condition,
        "ai_verdict": row.ai_verdict,
        "ai_reason": row.ai_reason,
        "context": ctx,
        "user_decision": row.user_decision,
        "notes": row.notes or "",
        "updated_at": row.updated_at.isoformat() + "Z" if row.updated_at else None,
    }


def serialize_preset(row: StrategyPreset) -> Dict[str, Any]:
    try:
        params = json.loads(row.params_json) if row.params_json else {}
    except Exception:
        params = {}
    return {
        "id": row.id,
        "name": row.name,
        "symbol": row.symbol,
        "timeframe": row.timeframe,
        "strategy_type": row.strategy_type,
        "params": params,
        "created_at": row.created_at.isoformat() + "Z" if row.created_at else None,
    }


DEFAULT_PRESETS = [
    {
        "name": "Скальп от плотности (Базовый 5m)",
        "symbol": "ANY",
        "timeframe": "5m",
        "strategy_type": "density_bounce",
        "params": {
            "stop_loss_pct": 0.5,
            "take_profit_pct": 1.2,
            "leverage": 2,
            "entryMode": "density_bounce",
            "slMode": "behind_wall",
            "use_atr_filter": True,
            "use_cvd_filter": True,
            "use_oi_filter": False,
            "use_rsi_filter": True,
            "min_density_usd": 800000,
        }
    },
    {
        "name": "Поглощение дельты + CVD (Импульс)",
        "symbol": "ANY",
        "timeframe": "5m",
        "strategy_type": "delta_absorption",
        "params": {
            "stop_loss_pct": 0.7,
            "take_profit_pct": 1.8,
            "leverage": 3,
            "entryMode": "cvd_div",
            "slMode": "fixed_pct",
            "use_atr_filter": False,
            "use_cvd_filter": True,
            "use_oi_filter": True,
            "use_rsi_filter": False,
            "min_density_usd": 500000,
        }
    },
    {
        "name": "Консервативный ATR-Тренд (Защитный)",
        "symbol": "ANY",
        "timeframe": "15m",
        "strategy_type": "confluence_ema",
        "params": {
            "stop_loss_pct": 0.4,
            "take_profit_pct": 1.1,
            "leverage": 2,
            "entryMode": "ema_cross",
            "slMode": "atr_15",
            "use_atr_filter": True,
            "use_atr_sl": True,
            "atr_multiplier": 1.5,
            "use_cvd_filter": True,
            "use_oi_filter": True,
            "use_rsi_filter": True,
            "min_density_usd": 1000000,
        }
    }
]


_seed_data_ensured = False

async def ensure_seed_data(db):
    """
    If decision_logs is empty, backfill recent SignalHistory items so existing scanner signals
    appear immediately in the trader's journal.
    Also seeds 3 default strategy presets if strategy_presets is empty.
    """
    global _seed_data_ensured
    if _seed_data_ensured:
        return
    count_res = await db.execute(select(DecisionLog).limit(1))
    if count_res.scalar_one_or_none() is None:
        sig_res = await db.execute(select(SignalHistory).order_by(desc(SignalHistory.created_at)).limit(15))
        signals = sig_res.scalars().all()
        for sig in reversed(signals):
            dir_mapped = (
                "LONG" if sig.direction in ("BULLISH", "OVERSOLD", "LONG")
                else ("SHORT" if sig.direction in ("BEARISH", "OVERBOUGHT", "SHORT") else "NEUTRAL")
            )
            db.add(DecisionLog(
                timestamp=sig.created_at or datetime.utcnow(),
                event_type="SIGNAL",
                symbol=sig.symbol,
                timeframe=sig.timeframe or "15m",
                direction=dir_mapped,
                price=float(sig.price or 0.0),
                strategy_or_condition=f"{sig.condition_type}: {sig.description}",
                context_json=json.dumps({
                    "condition_type": sig.condition_type,
                    "normalized_metric": sig.normalized_metric
                }, ensure_ascii=False),
                user_decision="PENDING",
                notes=""
            ))
        if signals:
            await db.commit()

    preset_res = await db.execute(select(StrategyPreset).limit(1))
    if preset_res.scalar_one_or_none() is None:
        for p in DEFAULT_PRESETS:
            db.add(StrategyPreset(
                name=p["name"],
                symbol=p["symbol"],
                timeframe=p["timeframe"],
                strategy_type=p["strategy_type"],
                params_json=json.dumps(p["params"], ensure_ascii=False)
            ))
        await db.commit()
    _seed_data_ensured = True


# ============================================================================
# Stage 1 Endpoints: Decision Journal
# ============================================================================

@journal_router.get("/logs")
async def get_decision_logs(
    symbol: Optional[str] = Query(None, description="Filter by symbol e.g. BTCUSDT"),
    event_type: Optional[str] = Query(None, description="Filter by event_type"),
    limit: int = Query(200, ge=1, le=1000)
):
    async with AsyncSessionLocal() as db:
        await ensure_seed_data(db)
        stmt = select(DecisionLog).order_by(desc(DecisionLog.timestamp), desc(DecisionLog.id))
        if symbol and symbol.upper() != "ALL":
            clean_sym = symbol.upper().replace(".P", "").replace("-PERP", "")
            stmt = stmt.where(DecisionLog.symbol == clean_sym)
        if event_type and event_type.upper() != "ALL":
            stmt = stmt.where(DecisionLog.event_type == event_type.upper())
        else:
            stmt = stmt.where(DecisionLog.event_type.in_(ALLOWED_JOURNAL_TYPES))
        stmt = stmt.limit(limit)
        res = await db.execute(stmt)
        rows = res.scalars().all()
        return {
            "status": "ok",
            "count": len(rows),
            "logs": [serialize_log(r) for r in rows]
        }


@journal_router.get("/session-review")
async def get_session_review(
    hours: int = Query(24, ge=1, le=24 * 30, description="Окно decision_logs, часов"),
    max_lag_ms: int = Query(DEFAULT_MAX_LAG_MS, ge=1_000, le=3_600_000,
                            description="Макс. разрыв решение→вход, мс"),
    source: str = Query("all", description="Источник сделок: all | demo | marathon"),
):
    """Пост-сессионный разбор (задача 7.3): закрытые сделки paper-сессии,
    связанные с decision_logs за окном. Читает demo paper-сессию, марафонные
    сессии overnight-pilot и SQLite — строго read-only, на торговлю не влияет.
    """
    source = (source or "all").strip().lower()
    if source not in ("all", "demo", "marathon"):
        raise HTTPException(status_code=422, detail="source must be one of: all, demo, marathon")

    demo_state = paper_trading_session.get_state()
    collected = collect_review_trades(
        source,
        demo_trades=list(getattr(demo_state, "closed_trades", None) or []),
        marathon_items=[s.to_dict() for s in overnight_pilot_manager.sessions.values()],
    )
    trades = collected["trades"]

    now_utc = datetime.now(timezone.utc)
    since_naive = (now_utc - timedelta(hours=hours)).replace(tzinfo=None)  # БД хранит naive-UTC
    async with AsyncSessionLocal() as db:
        stmt = (
            select(DecisionLog)
            .where(
                DecisionLog.timestamp >= since_naive,
                DecisionLog.event_type.in_(["SIGNAL", "MANUAL_ENTRY", "AI_OPINION", "ORDER"]),
            )
            .order_by(asc(DecisionLog.timestamp), asc(DecisionLog.id))
            .limit(2000)
        )
        rows = (await db.execute(stmt)).scalars().all()
        decisions = [
            {
                "id": r.id,
                # naive datetime = UTC по конвенции проекта (datetime.utcnow)
                "timestamp_ms": int(r.timestamp.replace(tzinfo=timezone.utc).timestamp() * 1000),
                "symbol": r.symbol,
                "event_type": r.event_type,
                "user_decision": r.user_decision,
                "direction": r.direction,
                "price": r.price,
                "notes": r.notes,
            }
            for r in rows
        ]

    review = build_session_review(trades, decisions, max_lag_ms=max_lag_ms)
    review["window_hours"] = hours
    review["paper_session_id"] = getattr(demo_state, "session_id", None)
    review["marathon_session_ids"] = collected["marathon_session_ids"]
    review["trades_by_source"] = collected["trades_by_source"]
    review["source"] = source
    review["decisions_in_window"] = len(decisions)
    return review


@journal_router.post("/log")
async def create_decision_log(req: DecisionLogCreateRequest):
    clean_sym = req.symbol.upper().replace(".P", "").replace("-PERP", "")
    async with AsyncSessionLocal() as db:
        row = DecisionLog(
            timestamp=datetime.utcnow(),
            event_type=req.event_type.upper(),
            symbol=clean_sym,
            timeframe=req.timeframe,
            direction=req.direction.upper(),
            price=float(req.price or 0.0),
            entry_price=req.entry_price,
            sl_price=req.sl_price,
            tp_price=req.tp_price,
            strategy_or_condition=req.strategy_or_condition,
            ai_verdict=req.ai_verdict,
            ai_reason=req.ai_reason,
            context_json=json.dumps(req.context or {}, ensure_ascii=False),
            user_decision=req.user_decision.upper(),
            notes=req.notes or ""
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return {"status": "ok", "log": serialize_log(row)}


@journal_router.patch("/log/{log_id}")
async def update_decision_log(log_id: int, req: DecisionLogUpdateRequest):
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(DecisionLog).where(DecisionLog.id == log_id))
        row = res.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail=f"Запись #{log_id} не найдена в журнале")
        if req.user_decision is not None:
            row.user_decision = req.user_decision.upper()
        if req.notes is not None:
            row.notes = req.notes
        if req.price is not None and req.price > 0:
            row.price = float(req.price)
        row.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(row)
        return {"status": "ok", "log": serialize_log(row)}


@journal_router.get("/export-csv")
async def export_decision_logs_csv(
    symbol: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None)
):
    async with AsyncSessionLocal() as db:
        await ensure_seed_data(db)
        stmt = select(DecisionLog).order_by(desc(DecisionLog.timestamp), desc(DecisionLog.id))
        if symbol and symbol.upper() != "ALL":
            clean_sym = symbol.upper().replace(".P", "").replace("-PERP", "")
            stmt = stmt.where(DecisionLog.symbol == clean_sym)
        if event_type and event_type.upper() != "ALL":
            stmt = stmt.where(DecisionLog.event_type == event_type.upper())
        else:
            stmt = stmt.where(DecisionLog.event_type.in_(ALLOWED_JOURNAL_TYPES))
        res = await db.execute(stmt)
        rows = res.scalars().all()

    output = io.StringIO()
    # Write UTF-8 BOM so Excel opens Cyrillic characters properly
    output.write("\ufeff")
    writer = csv.writer(output, delimiter=";")
    writer.writerow([
        "ID", "Время (UTC)", "Тип события", "Монета", "Таймфрейм",
        "Направление", "Цена", "Entry", "Stop Loss", "Take Profit",
        "Стратегия / Условие", "Вердикт AI", "Причина AI",
        "Решение трейдера", "Заметки", "Контекст (JSON)"
    ])
    for r in rows:
        writer.writerow([
            r.id,
            r.timestamp.strftime("%Y-%m-%d %H:%M:%S") if r.timestamp else "",
            r.event_type,
            r.symbol,
            r.timeframe,
            r.direction,
            r.price,
            r.entry_price if r.entry_price is not None else "",
            r.sl_price if r.sl_price is not None else "",
            r.tp_price if r.tp_price is not None else "",
            r.strategy_or_condition or "",
            r.ai_verdict or "",
            r.ai_reason or "",
            r.user_decision or "PENDING",
            r.notes or "",
            r.context_json or "{}"
        ])

    output.seek(0)
    filename = f"signalscript_journal_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# ============================================================================
# Stage 2 Endpoint: Consultative AI "Second Opinion"
# ============================================================================

async def gather_market_context(req: SecondOpinionRequest) -> Dict[str, Any]:
    """
    Collects strictly factual market data for the symbol & timeframe:
    - Live price, EMA20/EMA50 trend, RSI(14), ATR%, Volume spike ratio, CVD delta
    - 24h Open Interest change %
    - Nearest L2 Bid/Ask liquidity walls from Binance orderbook
    - Historical Expected Value (EV), WinRate, and sample size from OrderFlowBacktester
    """
    clean_sym = req.symbol.upper().replace(".P", "").replace("-PERP", "")
    tf = req.timeframe if req.timeframe in ("1m", "5m", "15m", "30m", "1h", "4h") else "5m"

    ctx: Dict[str, Any] = {
        "symbol": clean_sym,
        "timeframe": tf,
        "direction": req.direction.upper(),
        "strategy_type": req.strategy_type,
        "entry_price": req.entry_price or req.price,
        "sl_price": req.sl_price,
        "tp_price": req.tp_price,
    }

    # 1. Fetch live klines & compute indicators
    try:
        df = await binance_service.fetch_klines(clean_sym, timeframe=tf, limit=120)
        if not df.empty and len(df) >= 20:
            df = compute_indicators(df)
            last = df.iloc[-1]
            cur_price = float(last["close"])
            ctx["price"] = round(cur_price, 4)
            if not ctx["entry_price"]:
                ctx["entry_price"] = ctx["price"]

            ema20 = float(last.get("ema_20", cur_price))
            ema50 = float(df["close"].ewm(span=50, adjust=False).mean().iloc[-1])
            ctx["ema20"] = round(ema20, 4)
            ctx["ema50"] = round(ema50, 4)
            if cur_price > ema20 > ema50:
                ctx["trend"] = "ВОСХОДЯЩИЙ (Цена > EMA20 > EMA50)"
            elif cur_price < ema20 < ema50:
                ctx["trend"] = "НИСХОДЯЩИЙ (Цена < EMA20 < EMA50)"
            else:
                ctx["trend"] = "БОКОВИК / КОНСОЛИДАЦИЯ"

            ctx["rsi_14"] = round(float(last.get("rsi", 50.0)), 1)
            ctx["atr_pct"] = round(float(last.get("atr_pct", 0.3)), 3)
            ctx["vol_ratio_ma20"] = round(float(last.get("vol_ratio", 1.0)), 2)

            # CVD delta over last 10 candles
            if "cvd" in df.columns and len(df) >= 10:
                cvd_now = float(df["cvd"].iloc[-1])
                cvd_prev = float(df["cvd"].iloc[-10])
                cvd_diff = cvd_now - cvd_prev
                ctx["cvd_delta_10bars"] = round(cvd_diff, 2)
                ctx["cvd_bias"] = "ПОКУПАТЕЛИ (+CVD)" if cvd_diff > 0 else "ПРОДАВЦЫ (-CVD)"

            # Compute historical EV on these klines
            sl_pct = float(req.stop_loss_pct or 0.6)
            tp_pct = float(req.take_profit_pct or 1.5)
            if ctx["entry_price"] and ctx["sl_price"] and ctx["entry_price"] > 0:
                sl_pct = round(abs(ctx["entry_price"] - ctx["sl_price"]) / ctx["entry_price"] * 100.0, 3)
            if ctx["entry_price"] and ctx["tp_price"] and ctx["entry_price"] > 0:
                tp_pct = round(abs(ctx["tp_price"] - ctx["entry_price"]) / ctx["entry_price"] * 100.0, 3)

            ctx["stop_loss_pct"] = sl_pct
            ctx["take_profit_pct"] = tp_pct
            ctx["rr_ratio"] = round(tp_pct / sl_pct, 2) if sl_pct > 0 else 0.0

            bt = OrderFlowBacktester(initial_capital=10000.0)
            bt_res = bt.run_backtest(df.copy(), strategy_type=req.strategy_type, params={
                "stop_loss_pct": sl_pct,
                "take_profit_pct": tp_pct,
                "leverage": 2.0,
                "use_atr_filter": True,
                "use_cvd_filter": True,
            })
            total_trades = int(bt_res.get("total_trades", 0))
            win_rate = float(bt_res.get("win_rate", 0.0))
            total_pnl = float(bt_res.get("total_pnl_usd", 0.0))
            ev_usd = round(total_pnl / total_trades, 2) if total_trades > 0 else 0.0
            ctx["historical_ev_usd"] = ev_usd
            ctx["historical_win_rate_pct"] = round(win_rate, 1)
            ctx["historical_trades_count"] = total_trades
            ctx["low_sample_warning"] = total_trades < 30
    except Exception as e:
        logger.warning(f"Context kline/backtest gather error for {clean_sym}: {e}")

    # 2. Open Interest 24h change
    try:
        oi_chg = await binance_service.fetch_open_interest_24h_change(clean_sym)
        ctx["oi_change_24h_pct"] = oi_chg
    except Exception:
        ctx["oi_change_24h_pct"] = 0.0

    # 3. Nearest L2 Liquidity Walls from Orderbook
    try:
        ob = await binance_service.fetch_order_book(clean_sym, limit=20)
        bids = ob.get("bids", [])
        asks = ob.get("asks", [])
        if bids:
            max_bid = max(bids, key=lambda x: float(x[0]) * float(x[1]))
            ctx["nearest_bid_wall"] = {
                "price": float(max_bid[0]),
                "usd": round(float(max_bid[0]) * float(max_bid[1]), 0)
            }
        if asks:
            max_ask = max(asks, key=lambda x: float(x[0]) * float(x[1]))
            ctx["nearest_ask_wall"] = {
                "price": float(max_ask[0]),
                "usd": round(float(max_ask[0]) * float(max_ask[1]), 0)
            }
    except Exception:
        pass

    return ctx


async def ask_openrouter_second_opinion(
    ctx: Dict[str, Any],
    api_key_override: Optional[str] = None,
    simulate_unavailable: bool = False
) -> Dict[str, Any]:
    """
    Sends gathered factual context to OpenRouter with strict prompt:
    'Дай короткую рекомендацию: за / против / нейтрально, и одна причина почему.
     Не придумывай цифры, используй только переданные данные.'
    If key is missing or OpenRouter fails/times out, returns honest unavailable status.
    """
    if simulate_unavailable:
        return {
            "ai_available": False,
            "verdict": "AI НЕДОСТУПЕН",
            "reason": "AI недоступен, принимай решение сам"
        }

    eff_key = (api_key_override or OPENROUTER_API_KEY or "").strip()
    if not eff_key or len(eff_key) < 10:
        return {
            "ai_available": False,
            "verdict": "AI НЕДОСТУПЕН",
            "reason": "AI недоступен, принимай решение сам"
        }

    from backend.app.services.ai_service import ai_service

    system_prompt = (
        "Ты — консультативный риск-менеджер торгового терминала SignalScript. "
        "Дай короткую рекомендацию: за / против / нейтрально, и одна причина почему. "
        "Не придумывай цифры, используй только переданные данные. "
        "Ответь в формате JSON: "
        '{"verdict": "ЗА" | "ПРОТИВ" | "НЕЙТРАЛЬНО", "reason": "Одна конкретная причина на основе переданных цифр"}'
    )

    user_message = (
        f"Данные сетапа и рынка (JSON):\n{json.dumps(ctx, ensure_ascii=False, indent=2)}\n\n"
        "Дай короткую рекомендацию: за / против / нейтрально, и одна причина почему. "
        "Не придумывай цифры, используй только переданные данные."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message}
    ]

    try:
        raw_text, used_model = await ai_service.query_with_fallback(
            messages=messages,
            preferred_model=OPENROUTER_MODEL,
            api_key_override=eff_key,
            temperature=0.1,
            max_tokens=220,
            timeout_sec=6.0
        )
        if raw_text:
            clean_text = raw_text
            if clean_text.startswith("```"):
                clean_text = clean_text.strip("`").replace("json", "", 1).strip()
            try:
                parsed = json.loads(clean_text)
                verdict = str(parsed.get("verdict", "НЕЙТРАЛЬНО")).upper()
                if "ЗА" in verdict and "ПРОТИВ" not in verdict:
                    verdict = "ЗА"
                elif "ПРОТИВ" in verdict:
                    verdict = "ПРОТИВ"
                else:
                    verdict = "НЕЙТРАЛЬНО"
                reason = str(parsed.get("reason", raw_text)).strip()
                from backend.app.config import OPENROUTER_PRIMARY_MODEL
                return {
                    "ai_available": True,
                    "verdict": verdict,
                    "reason": reason,
                    "model_used": used_model,
                    "fallback": bool(used_model != OPENROUTER_PRIMARY_MODEL)
                }
            except Exception:
                from backend.app.config import OPENROUTER_PRIMARY_MODEL
                upper = raw_text.upper()
                verdict = "ЗА" if "ЗА" in upper[:25] else ("ПРОТИВ" if "ПРОТИВ" in upper[:25] else "НЕЙТРАЛЬНО")
                return {
                    "ai_available": True,
                    "verdict": verdict,
                    "reason": raw_text[:280],
                    "model_used": used_model,
                    "fallback": bool(used_model != OPENROUTER_PRIMARY_MODEL)
                }
    except Exception as e:
        logger.warning(f"OpenRouter Second Opinion error: {e}")

    return {
        "ai_available": False,
        "verdict": "AI НЕДОСТУПЕН",
        "reason": "AI недоступен (бесплатные модели OpenRouter исчерпаны), принимай решение сам",
        "model_used": "local_quant_fallback",
        "fallback": True
    }


@journal_router.post("/second-opinion")
async def request_second_opinion(req: SecondOpinionRequest):
    """
    Stage 2: Gathers real market context, requests consultative Second Opinion from OpenRouter
    (or returns honest 'AI недоступен, принимай решение сам' if unconfigured/unreachable),
    and logs the request & response in the SQLite Decision Journal.
    """
    ctx = await gather_market_context(req)
    ai_res = await ask_openrouter_second_opinion(
        ctx,
        api_key_override=req.openrouter_api_key,
        simulate_unavailable=req.simulate_unavailable
    )

    clean_sym = ctx.get("symbol", req.symbol.upper())
    price = float(ctx.get("price") or req.price or req.entry_price or 0.0)

    async with AsyncSessionLocal() as db:
        row = DecisionLog(
            timestamp=datetime.utcnow(),
            event_type="AI_OPINION",
            symbol=clean_sym,
            timeframe=req.timeframe,
            direction=req.direction.upper(),
            price=price,
            entry_price=ctx.get("entry_price"),
            sl_price=ctx.get("sl_price"),
            tp_price=ctx.get("tp_price"),
            strategy_or_condition=f"Второе мнение AI ({req.strategy_type})",
            ai_verdict=ai_res["verdict"],
            ai_reason=ai_res["reason"],
            context_json=json.dumps(ctx, ensure_ascii=False),
            user_decision="PENDING",
            notes=""
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)

        return {
            "status": "ok",
            "ai_available": ai_res["ai_available"],
            "verdict": ai_res["verdict"],
            "reason": ai_res["reason"],
            "context": ctx,
            "log": serialize_log(row)
        }


# ============================================================================
# Stage 3 Endpoints: Fast Strategy Parameter Presets
# ============================================================================

@journal_router.get("/presets")
async def list_strategy_presets():
    async with AsyncSessionLocal() as db:
        await ensure_seed_data(db)
        res = await db.execute(select(StrategyPreset).order_by(StrategyPreset.id))
        rows = res.scalars().all()
        return {
            "status": "ok",
            "presets": [serialize_preset(r) for r in rows]
        }


@journal_router.post("/presets")
async def save_strategy_preset(req: StrategyPresetRequest):
    clean_name = req.name.strip()
    async with AsyncSessionLocal() as db:
        existing_res = await db.execute(select(StrategyPreset).where(StrategyPreset.name == clean_name))
        row = existing_res.scalar_one_or_none()
        if row:
            row.symbol = req.symbol.upper()
            row.timeframe = req.timeframe
            row.strategy_type = req.strategy_type
            row.params_json = json.dumps(req.params, ensure_ascii=False)
            row.updated_at = datetime.utcnow()
        else:
            row = StrategyPreset(
                name=clean_name,
                symbol=req.symbol.upper(),
                timeframe=req.timeframe,
                strategy_type=req.strategy_type,
                params_json=json.dumps(req.params, ensure_ascii=False)
            )
            db.add(row)
        await db.commit()
        await db.refresh(row)
        return {"status": "ok", "preset": serialize_preset(row)}


@journal_router.delete("/presets/{preset_id}")
async def delete_strategy_preset(preset_id: int):
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(StrategyPreset).where(StrategyPreset.id == preset_id))
        row = res.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Пресет не найден")
        await db.delete(row)
        await db.commit()
        return {"status": "ok", "deleted_id": preset_id}
