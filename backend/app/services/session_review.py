"""Пост-сессионный разбор (задача 7.3): связка paper-сделок с decision_logs.

Дневник трейдера v2: закрытые сделки paper-сессии соединяются с записями
решений (DecisionLog) по символу и времени — последнее решение не раньше
входа в сделку и не старше max_lag_ms (по умолчанию 15 мин).

Модуль намеренно чистый (без БД/HTTP) — вся интеграция в роутере.
Времена: epoch-ms везде (trades entry_ts/exit_ts — уже ms; DecisionLog
конвертируется в роутере из datetime UTC).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

DEFAULT_MAX_LAG_MS = 15 * 60_000  # 15 минут между решением и входом

# Типы решений, которые считаем «кандидатами на вход»
DECISION_EVENT_TYPES = {"SIGNAL", "MANUAL_ENTRY"}


def _norm_symbol(sym: Any) -> str:
    return str(sym or "").strip().upper()


def find_decision_for_trade(
    trade: Dict[str, Any],
    decisions: List[Dict[str, Any]],
    max_lag_ms: int = DEFAULT_MAX_LAG_MS,
) -> Optional[Dict[str, Any]]:
    """Последнее решение по символу в окне [entry_ts - lag, entry_ts].

    decisions: [{id, timestamp_ms, symbol, event_type, user_decision, direction, price, notes}].
    При равенстве timestamp берётся запись с большим id (позже вставленная).
    """
    entry_ts = trade.get("entry_ts")
    symbol = _norm_symbol(trade.get("symbol"))
    if not isinstance(entry_ts, (int, float)) or not symbol:
        return None
    best: Optional[Dict[str, Any]] = None
    for d in decisions:
        if _norm_symbol(d.get("symbol")) != symbol:
            continue
        if d.get("event_type") not in DECISION_EVENT_TYPES:
            continue
        ts = d.get("timestamp_ms")
        if not isinstance(ts, (int, float)):
            continue
        if ts > entry_ts or ts < entry_ts - max_lag_ms:
            continue
        if best is None or (ts, d.get("id") or 0) >= (best.get("timestamp_ms") or 0, best.get("id") or 0):
            best = d
    return best


def link_trades_to_decisions(
    trades: List[Dict[str, Any]],
    decisions: List[Dict[str, Any]],
    max_lag_ms: int = DEFAULT_MAX_LAG_MS,
) -> List[Dict[str, Any]]:
    """Пары «сделка ↔ решение» (decision=None, если совпадения нет)."""
    return [
        {"trade": t, "decision": find_decision_for_trade(t, decisions, max_lag_ms)}
        for t in trades
    ]


def _net(trades: List[Dict[str, Any]]) -> float:
    return round(sum(float(t.get("net_pnl") or 0.0) for t in trades), 8)


def summarize_session(pairs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Агрегаты пост-сессионного разбора по связанным парам."""
    total = len(pairs)
    matched = [p for p in pairs if p.get("decision")]
    unmatched = [p for p in pairs if not p.get("decision")]
    matched_trades = [p["trade"] for p in matched]

    entered = [p for p in matched if (p["decision"] or {}).get("user_decision") == "ENTERED"]
    skipped = [p for p in matched if (p["decision"] or {}).get("user_decision") == "SKIPPED"]
    pending = [p for p in matched if (p["decision"] or {}).get("user_decision") == "PENDING"]

    winners = [t for t in matched_trades if float(t.get("net_pnl") or 0.0) > 0]
    mfe_r_vals = [float(t.get("mfe_r") or 0.0) for t in matched_trades]

    return {
        "trades_total": total,
        "trades_matched": len(matched),
        "match_rate_pct": round(len(matched) / total * 100.0, 1) if total else 0.0,
        "pnl": {
            "net_all": _net([p["trade"] for p in pairs]),
            "net_matched": _net(matched_trades),
            "net_unmatched": _net([p["trade"] for p in unmatched]),
            "net_entered_decisions": _net([p["trade"] for p in entered]),
            "net_skipped_decisions": _net([p["trade"] for p in skipped]),
        },
        "decisions": {
            "entered": len(entered),
            "skipped": len(skipped),
            "pending": len(pending),
        },
        # Что «пропустил» трейдер: суммарный PnL сделок, привязанных к SKIPPED-решениям
        # (положительный — упущенная прибыль; отрицательный — избежанный убыток).
        "skipped_opportunity_pnl": _net([p["trade"] for p in skipped]),
        "win_rate_matched_pct": round(len(winners) / len(matched) * 100.0, 1) if matched else 0.0,
        "profit_bleed_count": sum(1 for t in matched_trades if t.get("profit_bleed")),
        "avg_mfe_r_matched": round(sum(mfe_r_vals) / len(mfe_r_vals), 4) if mfe_r_vals else 0.0,
    }


def build_session_review(
    trades: List[Dict[str, Any]],
    decisions: List[Dict[str, Any]],
    max_lag_ms: int = DEFAULT_MAX_LAG_MS,
) -> Dict[str, Any]:
    """Полный разбор: пары + агрегаты. Точка входа для роутера."""
    pairs = link_trades_to_decisions(trades, decisions, max_lag_ms)
    return {
        "summary": summarize_session(pairs),
        "pairs": pairs,
        "max_lag_ms": max_lag_ms,
    }


def collect_review_trades(
    source: str,
    demo_trades: Optional[List[Dict[str, Any]]],
    marathon_items: Optional[List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Сбор закрытых сделок из demo paper-сессии и марафонных сессий.

    source: "all" | "demo" | "marathon" (иначе ValueError).
    demo_trades: closed_trades живой demo paper-сессии.
    marathon_items: to_dict() сессий overnight-pilot ({"paper": {...}, "session_id": ...}).
    Каждая сделка тегируется source; марафонные дополнительно session_id.
    Чистая функция — вся интеграция (менеджеры/БД) остаётся в роутере.
    """
    if source not in ("all", "demo", "marathon"):
        raise ValueError("source must be one of: all, demo, marathon")
    trades: List[Dict[str, Any]] = []
    marathon_session_ids: List[str] = []
    if source in ("all", "demo"):
        for t in list(demo_trades or []):
            trades.append({**t, "source": "demo"})
    if source in ("all", "marathon"):
        for item in list(marathon_items or []):
            paper = (item or {}).get("paper") or {}
            session_id = (item or {}).get("session_id")
            if session_id:
                marathon_session_ids.append(str(session_id))
            for t in list(paper.get("closed_trades") or []):
                trades.append({**t, "source": "marathon", "session_id": session_id})
    return {
        "trades": trades,
        "marathon_session_ids": marathon_session_ids,
        "trades_by_source": {
            "demo": sum(1 for t in trades if t.get("source") == "demo"),
            "marathon": sum(1 for t in trades if t.get("source") == "marathon"),
        },
    }
