"""Подбор стратегии/ТФ под каждую монету с OOS-валидацией (только консультативный paper-режим).

TRAIN (первые 70% свечей) -> выбор лучшей конфигурации -> OOS (последние 30%).
Вердикты:
  SELECT  - OOS подтверждён (net>0, PF>=MIN_PF, сделок>=MIN_TRADES_OOS): полный риск.
  EXPLORE - TRAIN положителен, но OOS не подтвердил: торгуем уменьшенным риском для сбора статистики.
  SKIP    - нет конфигурации с положительным TRAIN: пара не торгуется (кэш).
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.app.services.strategy_catalog import SELECTABLE_STRATEGY_IDS

DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "LINKUSDT",
                   "ZECUSDT", "NEARUSDT", "ENAUSDT", "WLDUSDT", "SUIUSDT", "UNIUSDT", "AVAXUSDT",
                   "ADAUSDT", "DOTUSDT", "OPUSDT", "ARBUSDT", "TIAUSDT", "TRXUSDT",
                   "HYPEUSDT", "BCHUSDT", "AAVEUSDT", "FILUSDT", "TAOUSDT", "LTCUSDT",
                   "ONDOUSDT", "PENGUUSDT"]
# The selector keeps its current four candidates; the catalogue prevents this
# list from drifting away from profiles the paper runner supports.
STRATEGIES = list(SELECTABLE_STRATEGY_IDS)
TIMEFRAMES = ["5m", "15m"]
RR = [(0.5, 1.0), (0.8, 1.6), (1.0, 2.5)]  # (SL%, TP%): TP >= 2x round-trip fee
TRAIN_FRACTION = 0.7
MIN_TRADES_OOS = 8
MIN_PF = 1.1
RISK_SELECT_PCT = 0.35
RISK_EXPLORE_PCT = 0.15
OUT_PATH = Path(__file__).resolve().parents[3] / "data" / "pair_selection.json"

BT_PARAMS = dict(
    leverage=3.0, risk_per_trade_pct=RISK_SELECT_PCT, min_density_usd=0.0, volume_multiplier=0.0,
    use_atr_filter=True, use_multi_tp=False, compute_monte_carlo=False, fast_eval=True,
)


def split_train_oos(df, frac: float = TRAIN_FRACTION):
    cut = int(len(df) * frac)
    return df.iloc[:cut].copy(), df.iloc[cut:].copy()


def summarize(res: Dict[str, Any]) -> Dict[str, float]:
    return {
        "trades": int(res.get("total_trades", 0) or 0),
        "win": float(res.get("win_rate_pct", 0) or 0),
        "net": float(res.get("net_pnl", 0) or 0),
        "pf": float(res.get("profit_factor", 0) or 0),
        "dd": float(res.get("max_drawdown_pct", 0) or 0),
    }


def is_qualified(oos: Dict[str, float]) -> bool:
    return oos["trades"] >= MIN_TRADES_OOS and oos["net"] > 0 and oos["pf"] >= MIN_PF


def pick_best(train_rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Лучший кандидат по TRAIN: положительный net, затем PF, затем net."""
    pool = [r for r in train_rows if r["train"]["net"] > 0 and r["train"]["trades"] >= MIN_TRADES_OOS]
    if not pool:
        return None
    return max(pool, key=lambda r: (r["train"]["pf"], r["train"]["net"]))


def evaluate_symbol_sync(bt, frames: Dict[str, Any], sym: str) -> Dict[str, Any]:
    """CPU-часть: frames = {tf: (train_df, oos_df)}."""
    if not frames:
        return {"symbol": sym, "verdict": "NO_DATA", "reason": "нет истории"}
    rows: List[Dict[str, Any]] = []
    for tf, (train, _) in frames.items():
        for strat in STRATEGIES:
            for sl, tp in RR:
                try:
                    res = bt.run_backtest(df=train.copy(), strategy_type=strat,
                                          stop_loss_pct=sl, take_profit_pct=tp, **BT_PARAMS)
                except Exception:
                    continue
                rows.append({"strategy": strat, "timeframe": tf, "sl": sl, "tp": tp, "train": summarize(res)})
    best = pick_best(rows)
    if best is None:
        return {"symbol": sym, "verdict": "SKIP", "reason": "нет конфигурации с положительным TRAIN net",
                "candidates": len(rows)}
    _, oos_df = frames[best["timeframe"]]
    res = bt.run_backtest(df=oos_df.copy(), strategy_type=best["strategy"],
                          stop_loss_pct=best["sl"], take_profit_pct=best["tp"], **BT_PARAMS)
    best["oos"] = summarize(res)
    ok = is_qualified(best["oos"])
    return {"symbol": sym, "verdict": "SELECT" if ok else "EXPLORE",
            "reason": "OOS подтверждён" if ok else "OOS не подтвердил - уменьшенный риск, сбор статистики",
            "best": best, "candidates": len(rows)}


async def run_selection(symbols: Optional[List[str]] = None, days: int = 14, save: bool = True) -> Dict[str, Any]:
    import asyncio
    from backend.app.routers.backtest import fetch_history
    from backend.app.services.orderflow_backtester import OrderFlowBacktester

    symbols = [s.upper() for s in (symbols or DEFAULT_SYMBOLS)]
    bt = OrderFlowBacktester(initial_capital=1000)
    results = []
    for sym in symbols:
        frames: Dict[str, Any] = {}
        for tf in TIMEFRAMES:
            try:
                df = await fetch_history(sym, tf, days)
            except Exception:
                continue
            if df is not None and not df.empty and len(df) >= 300:
                frames[tf] = split_train_oos(df)
        # бэктест CPU-bound: уводим в поток, чтобы не блокировать event loop марафона
        results.append(await asyncio.to_thread(evaluate_symbol_sync, bt, frames, sym))
    counts = {v: sum(1 for r in results if r["verdict"] == v) for v in ("SELECT", "EXPLORE", "SKIP", "NO_DATA")}
    payload = {"generated_at": int(time.time() * 1000), "days": days, "train_fraction": TRAIN_FRACTION,
               "counts": counts, "results": results}
    if save:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload


def load_last_selection() -> Optional[Dict[str, Any]]:
    try:
        return json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def build_pilot_configs(selection: Dict[str, Any], include_explore: bool = True,
                        duration_hours: float = 24.0, capital: float = 1000.0) -> List[Dict[str, Any]]:
    """Преобразует результат селектора в словари для OvernightPilotConfig."""
    out: List[Dict[str, Any]] = []
    for r in selection.get("results", []):
        v = r.get("verdict")
        if v not in ("SELECT", "EXPLORE") or (v == "EXPLORE" and not include_explore):
            continue
        b = r["best"]
        out.append({
            "symbol": r["symbol"], "strategy_type": b["strategy"], "timeframe": b["timeframe"],
            "days": int(selection.get("days", 14)), "initial_capital": capital,
            "risk_per_trade_pct": RISK_SELECT_PCT if v == "SELECT" else RISK_EXPLORE_PCT,
            "stop_loss_pct": b["sl"], "take_profit_pct": b["tp"], "leverage": 3.0,
            "duration_hours": duration_hours, "min_density_usd": 0.0, "volume_multiplier": 0.0,
            "use_atr_filter": True, "use_cvd_filter": False, "use_oi_filter": False, "use_rsi_filter": False,
            "use_multi_tp": False, "use_trailing": True, "trailing_pct": 0.5, "trailing_activation_pct": 0.5,
            "sl_tp_mode": "fixed", "ai_control": True, "auto_strategy_switch": True,
        })
    return out
