"""Post-mortem анализ закрытых paper-сделок (MFE/MAE, Fee Burden, причины потерь).

Чистая функция `analyze_trades` не зависит от БД и покрыта тестами.
Строго консультативный модуль: ничего не отправляет на биржу, только читает
`paper_trade_records` и выдаёт рекомендации.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Optional

FBI_HIGH = 0.35          # комиссии > 35% от |gross| -> ТФ слишком шумный
MFE_BLEED_R = 0.8        # прибыль была >= 0.8R, но сделка в минус
MAE_SEVERE = 0.85        # просадка >= 85% дистанции стопа
MIN_TRADES_FOR_ADVICE = 5
LOW_WR_PCT = 30.0


def _f(v: Any) -> Optional[float]:
    try:
        if v is None:
            return None
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def classify_loss(t: Dict[str, Any]) -> str:
    """Определяет доминирующую причину убытка. Для прибыльных возвращает 'WIN'."""
    net = _f(t.get("net_pnl")) or 0.0
    if net > 0:
        return "WIN"
    gross = _f(t.get("gross_pnl")) or 0.0
    fee = abs(_f(t.get("fee")) or 0.0)
    mfe_r = _f(t.get("mfe_r"))
    mae_r = _f(t.get("mae_r"))
    reason = str(t.get("reason") or "").upper()
    if gross > 0 and net <= 0:
        return "FEE_DRAG"  # движение верное, съели комиссии
    if mfe_r is not None and mfe_r >= MFE_BLEED_R:
        return "MFE_REVERSAL"
    if "TIME_STOP" in reason:
        return "STALE_TIME_OUT"
    if "SENTINEL" in reason or "ADVERSE" in reason:
        return "ADVERSE_EXIT"
    if mae_r is not None and abs(mae_r) >= MAE_SEVERE and (mfe_r is None or mfe_r < 0.3):
        return "BAD_ENTRY"
    if fee and abs(gross) and fee / abs(gross) > FBI_HIGH:
        return "FEE_DRAG"
    return "STOP_OUT"


def _group_stats(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    n = len(trades)
    wins = [t for t in trades if (_f(t.get("net_pnl")) or 0) > 0]
    net = sum(_f(t.get("net_pnl")) or 0 for t in trades)
    gross = sum(_f(t.get("gross_pnl")) or 0 for t in trades)
    fees = sum(abs(_f(t.get("fee")) or 0) for t in trades)
    gp = sum(_f(t.get("net_pnl")) or 0 for t in wins)
    gl = abs(sum(min(0.0, _f(t.get("net_pnl")) or 0) for t in trades))
    rs = [r for r in (_f(t.get("realized_r")) for t in trades) if r is not None]
    mfe = [r for r in (_f(t.get("mfe_r")) for t in trades) if r is not None]
    mae = [r for r in (_f(t.get("mae_r")) for t in trades) if r is not None]
    return {
        "trades": n,
        "win_rate_pct": round(100.0 * len(wins) / n, 1) if n else 0.0,
        "net_pnl": round(net, 4),
        "gross_pnl": round(gross, 4),
        "fees": round(fees, 4),
        "fee_burden_index": round(fees / abs(gross), 3) if abs(gross) > 1e-9 else None,
        "profit_factor": round(gp / gl, 2) if gl > 1e-9 else None,
        "expectancy_r": round(sum(rs) / len(rs), 3) if rs else None,
        "avg_mfe_r": round(sum(mfe) / len(mfe), 3) if mfe else None,
        "avg_mae_r": round(sum(mae) / len(mae), 3) if mae else None,
    }


def _recommend(symbol: str, tf: str, stats: Dict[str, Any], causes: Counter) -> List[str]:
    out: List[str] = []
    n = stats["trades"]
    if n < MIN_TRADES_FOR_ADVICE:
        return out
    fbi = stats["fee_burden_index"]
    if fbi is not None and fbi > FBI_HIGH and tf in ("1m", "3m"):
        nxt = "3m" if tf == "1m" else "5m"
        out.append(f"{symbol}: комиссии съедают {fbi:.0%} валовой прибыли на {tf} — перейти на {nxt}.")
    losses = sum(v for k, v in causes.items() if k != "WIN")
    if losses:
        top, cnt = max(((k, v) for k, v in causes.items() if k != "WIN"), key=lambda kv: kv[1])
        if cnt / losses >= 0.4:
            hints = {
                "MFE_REVERSAL": "прибыль не удерживается — ужесточить защиту/трейлинг",
                "BAD_ENTRY": "входы без подтверждения — добавить фильтр режима/стакана",
                "FEE_DRAG": "комиссионное истощение — увеличить TP или использовать maker",
                "STALE_TIME_OUT": "позиции застаиваются — пересмотреть time-stop/режим",
                "ADVERSE_EXIT": "частые выходы по стакану — проверить микроструктурный гейт",
                "STOP_OUT": "стопы выбиваются — пересмотреть дистанцию SL (ATR)",
            }
            out.append(f"{symbol}: {cnt}/{losses} потерь — {top}: {hints.get(top, '')}.")
    if stats["win_rate_pct"] < LOW_WR_PCT and (stats["expectancy_r"] or 0) < 0:
        out.append(f"{symbol}: WR {stats['win_rate_pct']}% и отрицательное матожидание — "
                   f"сменить стратегию или временно отключить пару.")
    return out


def analyze_trades(trades: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    rows = [dict(t) for t in trades]
    causes: Counter = Counter(classify_loss(t) for t in rows)
    by_symbol: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    by_strategy: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    by_regime: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in rows:
        by_symbol[str(t.get("symbol") or "?")].append(t)
        by_strategy[str(t.get("strategy") or "?")].append(t)
        by_regime[str(t.get("regime") or "?")].append(t)

    symbols: Dict[str, Any] = {}
    recs: List[str] = []
    for sym, items in by_symbol.items():
        sc = Counter(classify_loss(t) for t in items)
        tf = str(items[-1].get("timeframe") or "5m")
        st = _group_stats(items)
        st["timeframe"] = tf
        st["loss_causes"] = {k: v for k, v in sc.items() if k != "WIN"}
        symbols[sym] = st
        recs.extend(_recommend(sym, tf, st, sc))

    return {
        "overall": _group_stats(rows),
        "loss_causes": {k: v for k, v in causes.items() if k != "WIN"},
        "by_symbol": symbols,
        "by_strategy": {k: _group_stats(v) for k, v in by_strategy.items()},
        "by_regime": {k: _group_stats(v) for k, v in by_regime.items()},
        "recommendations": recs,
        "sample_size": len(rows),
        "small_sample": len(rows) < 30,
    }


_COLS = ("trade_id", "symbol", "side", "net_pnl", "gross_pnl", "fee", "mfe", "mae",
         "mfe_r", "mae_r", "realized_r", "regime", "strategy", "timeframe",
         "reason", "exit_ts")


async def analyze_from_db(period_ms: Optional[int] = None, symbol: Optional[str] = None) -> Dict[str, Any]:
    import time
    from sqlalchemy import select
    from backend.app.db.database import AsyncSessionLocal
    from backend.app.db.models import PaperTradeRecord

    async with AsyncSessionLocal() as db:
        q = select(PaperTradeRecord).order_by(PaperTradeRecord.exit_ts.asc())
        if period_ms:
            q = q.where(PaperTradeRecord.exit_ts >= int(time.time() * 1000) - period_ms)
        if symbol and symbol.upper() != "ALL":
            q = q.where(PaperTradeRecord.symbol == symbol.upper())
        res = (await db.execute(q)).scalars().all()
    return analyze_trades({c: getattr(r, c, None) for c in _COLS} for r in res)
