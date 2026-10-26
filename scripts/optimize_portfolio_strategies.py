"""
Run strategy selection and optimization across all 18 portfolio pairs to find
the best strategy by win-rate, profit factor, and net PnL.
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app.routers.backtest import BacktestRequest, BacktestParams, run_backtest

SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
    "AVAXUSDT", "SUIUSDT", "NEARUSDT", "LINKUSDT", "ZECUSDT", "ENAUSDT",
    "WLDUSDT", "UNIUSDT", "ADAUSDT", "DOTUSDT", "OPUSDT", "ARBUSDT"
]

CANDIDATE_STRATEGIES = [
    "confluence_ema",
    "cvd_absorption",
    "cluster_volume_bounce",
    "ema_trend",
    "ema_pullback",
]

# Timeframes to evaluate
TIMEFRAMES = ["15m", "5m"]

async def evaluate_symbol(symbol: str):
    best_result = None
    best_score = -999999.0
    all_runs = []

    for strat in CANDIDATE_STRATEGIES:
        for tf in (["5m", "15m"] if strat == "cluster_volume_bounce" else ["15m"]):
            params = BacktestParams(
                risk_per_trade_pct=1.0,
                stop_loss_pct=0.8 if tf == "15m" else 1.0,
                take_profit_pct=1.8 if tf == "15m" else 2.2,
                leverage=2.0,
                use_atr_filter=True,
                use_cvd_filter=True,
                use_rsi_filter=True,
                use_multi_tp=True,
                use_trailing=True,
                trailing_pct=0.5,
                sl_tp_mode="atr",
                atr_multiplier=1.35,
            )
            req = BacktestRequest(
                symbol=symbol,
                timeframe=tf,
                days=14,
                strategy_type=strat,
                initial_capital=1000.0,
                params=params,
            )
            try:
                res = await run_backtest(req)
                summary = res.get("summary", {})
                win_rate = summary.get("win_rate_pct", 0.0)
                pnl = summary.get("net_pnl_usd", 0.0)
                pf = summary.get("profit_factor", 0.0)
                trades = summary.get("total_trades", 0)
                max_dd = summary.get("max_drawdown_pct", 0.0)

                # Composite score: prioritizing win rate and profit factor with positive PnL
                score = (win_rate * 2.0) + (pf * 20.0) + pnl - (max_dd * 2.0)
                if trades < 3:
                    score -= 50.0  # penalize too few trades

                entry = {
                    "strategy": strat,
                    "timeframe": tf,
                    "win_rate": win_rate,
                    "pnl": pnl,
                    "profit_factor": pf,
                    "trades": trades,
                    "max_drawdown": max_dd,
                    "score": score
                }
                all_runs.append(entry)

                if score > best_score:
                    best_score = score
                    best_result = entry
            except Exception as e:
                # strategy might not be applicable
                pass

    all_runs.sort(key=lambda x: (x["win_rate"], x["profit_factor"], x["pnl"]), reverse=True)
    return symbol, best_result, all_runs

async def main():
    print(f"[*] Optimizing strategies across {len(SYMBOLS)} symbols on 14-day data...")
    t0 = time.time()
    results = {}
    for sym in SYMBOLS:
        symbol, best, runs = await evaluate_symbol(sym)
        results[symbol] = {"best": best, "all": runs}
        if best:
            print(f"  {symbol:8s} -> {best['strategy']:22s} ({best['timeframe']}) | WinRate: {best['win_rate']:5.1f}% | PF: {best['profit_factor']:.2f} | PnL: ${best['pnl']:+6.2f} | Trades: {best['trades']}")
        else:
            print(f"  {symbol:8s} -> No viable candidate found")

    print(f"\n[+] Optimization completed in {time.time() - t0:.2f}s")
    with open("data/optimal_strategies_audit.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print("[+] Saved results to data/optimal_strategies_audit.json")

if __name__ == "__main__":
    asyncio.run(main())
