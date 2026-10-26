"""Подбор стратегии/ТФ под каждую монету с OOS-валидацией (консультативный инструмент).

Для каждой пары: перебор (strategy x timeframe x SL/TP) на TRAIN (первые 70% свечей),
затем проверка лучшей конфигурации на OOS (последние 30%). В портфель берутся только
конфигурации с положительным OOS net, PF >= MIN_PF и достаточным числом сделок.
Остальные пары получают вердикт SKIP (кэш лучше отрицательного матожидания).

Запуск:  .\\.venv\\Scripts\\python.exe scripts/select_pair_strategies.py [--days 14] [--symbols BTCUSDT,ETHUSDT]
Результат: data/pair_selection.json (+ таблица в stdout). Ничего не отправляет на биржу.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "LINKUSDT",
                   "ZECUSDT", "NEARUSDT", "ENAUSDT", "WLDUSDT", "SUIUSDT", "UNIUSDT", "AVAXUSDT"]
STRATEGIES = ["ema_trend", "ema_trend_window", "ema_pullback", "cluster_volume_bounce"]
TIMEFRAMES = ["5m", "15m"]
RR = [(0.5, 1.0), (0.8, 1.6), (1.0, 2.5)]  # (SL%, TP%): TP >= 2x round-trip fee
TRAIN_FRACTION = 0.7
MIN_TRADES_OOS = 8
MIN_PF = 1.1
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "pair_selection.json"

PARAMS = dict(
    leverage=3.0, risk_per_trade_pct=0.35, min_density_usd=0.0, volume_multiplier=0.0,
    use_multi_tp=False, compute_monte_carlo=False, fast_eval=True,
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


async def evaluate_symbol(bt, fetch_history, sym: str, days: int) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = []
    frames: Dict[str, Any] = {}
    for tf in TIMEFRAMES:
        df = await fetch_history(sym, tf, days)
        if df is None or df.empty or len(df) < 300:
            continue
        frames[tf] = split_train_oos(df)
    if not frames:
        return {"symbol": sym, "verdict": "NO_DATA"}
    for tf, (train, _) in frames.items():
        for strat in STRATEGIES:
            for sl, tp in RR:
                try:
                    res = bt.run_backtest(df=train.copy(), strategy_type=strat,
                                          stop_loss_pct=sl, take_profit_pct=tp, **PARAMS)
                except Exception:
                    continue
                rows.append({"strategy": strat, "timeframe": tf, "sl": sl, "tp": tp, "train": summarize(res)})
    best = pick_best(rows)
    if best is None:
        return {"symbol": sym, "verdict": "SKIP", "reason": "нет конфигурации с положительным TRAIN net",
                "candidates": len(rows)}
    _, oos_df = frames[best["timeframe"]]
    res = bt.run_backtest(df=oos_df.copy(), strategy_type=best["strategy"],
                          stop_loss_pct=best["sl"], take_profit_pct=best["tp"], **PARAMS)
    best["oos"] = summarize(res)
    ok = is_qualified(best["oos"])
    return {"symbol": sym, "verdict": "SELECT" if ok else "SKIP",
            "reason": "OOS подтверждён" if ok else "не прошёл OOS (net<=0, PF<%.1f или мало сделок)" % MIN_PF,
            "best": best, "candidates": len(rows)}


async def main(symbols: List[str], days: int) -> None:
    from backend.app.routers.backtest import fetch_history
    from backend.app.services.orderflow_backtester import OrderFlowBacktester

    bt = OrderFlowBacktester(initial_capital=1000)
    results = []
    for sym in symbols:
        r = await evaluate_symbol(bt, fetch_history, sym, days)
        results.append(r)
        if "best" in r:
            b = r["best"]
            print(f"{sym:10} {r['verdict']:6} {b['strategy']:22} {b['timeframe']:>3} {b['sl']}/{b['tp']} "
                  f"train net={b['train']['net']:>7.2f} PF={b['train']['pf']:.2f} | "
                  f"OOS n={b['oos']['trades']:>3} net={b['oos']['net']:>7.2f} PF={b['oos']['pf']:.2f}")
        else:
            print(f"{sym:10} {r['verdict']:6} {r.get('reason', '')}")
    selected = [r for r in results if r["verdict"] == "SELECT"]
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps({
        "generated_at": int(time.time() * 1000), "days": days,
        "train_fraction": TRAIN_FRACTION, "selected": len(selected), "total": len(results),
        "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nВыбрано {len(selected)}/{len(results)} пар -> {OUT_PATH}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS))
    a = ap.parse_args()
    asyncio.run(main([s.strip().upper() for s in a.symbols.split(",") if s.strip()], a.days))
