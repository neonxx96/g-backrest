"""Before/after matrix for the STRATEGY_WEAKNESSES fixes (roadmap phase 3.3).

Runs 3 symbols x 3 strategies on the local Bybit 15m klines cache:
  - baseline: all fix flags OFF (default, marathon-identical behaviour)
  - fixed:    use_dynamic_breakeven + use_adaptive_wall + use_time_stop + use_maker_exits

Writes docs/STRATEGY_FIXES_MATRIX.md. Read-only against data/, no backend restart.
"""

from pathlib import Path

import pandas as pd

from backend.app.services.orderflow_backtester import OrderFlowBacktester

SYMBOLS = ["BTC", "ETH", "SOL"]
STRATEGIES = ["confluence_ema", "ema_trend", "naked_test"]
CACHE = Path("data/cache")
OUT = Path("docs/STRATEGY_FIXES_MATRIX.md")

FIX_FLAGS = dict(
    use_dynamic_breakeven=True,
    use_adaptive_wall=True,
    use_time_stop=True,
    time_stop_minutes=45,
    time_stop_min_r=0.3,
    use_maker_exits=True,
)


def run(df, strategy, flags):
    bt = OrderFlowBacktester(initial_capital=10000.0)
    return bt.run_backtest(
        df.copy(),
        strategy_type=strategy,
        use_trailing=True,
        compute_monte_carlo=False,
        **flags,
    )


def row(sym, strategy, mode, r):
    trades = r.get("trades", [])
    wins = sum(1 for t in trades if t.get("pnl_usd", 0) > 0)
    winrate = (wins / len(trades) * 100.0) if trades else 0.0
    return {
        "symbol": sym,
        "strategy": strategy,
        "mode": mode,
        "trades": r["total_trades"],
        "winrate_pct": round(winrate, 1),
        "net_pnl": round(r["net_pnl"], 2),
        "fees": round(r["total_fees_usd"], 2),
        "roi_pct": round(r["roi_pct"], 2),
    }


def main():
    rows = []
    for sym in SYMBOLS:
        path = CACHE / f"bybit_{sym}_USDT_15m.parquet"
        df = pd.read_parquet(path)
        days = (df["timestamp"].max() - df["timestamp"].min()) / 86_400_000
        for strategy in STRATEGIES:
            base = run(df, strategy, {})
            fixed = run(df, strategy, FIX_FLAGS)
            rows.append(row(sym, strategy, "baseline", base))
            rows.append(row(sym, strategy, "fixed", fixed))
            print(f"{sym} {strategy}: base pnl={base['net_pnl']:.2f} ({base['total_trades']}t) "
                  f"-> fixed pnl={fixed['net_pnl']:.2f} ({fixed['total_trades']}t)")

    res = pd.DataFrame(rows)
    lines = [
        "# STRATEGY_FIXES_MATRIX — матрица «было/стало» (Фаза 3.3)",
        "",
        "Данные: локальный кэш `data/cache/bybit_*_USDT_15m.parquet` "
        f"(BTC ~{days:.1f} дн., ETH/SOL ~7 дн.; delta аппроксимирована из тела свечи).",
        "",
        "- **baseline** — все флаги выкл. (поведение марафона, дефолт)",
        "- **fixed** — `use_dynamic_breakeven` + `use_adaptive_wall` + `use_time_stop`(45м, 0.3R) + `use_maker_exits`",
        "- Общие параметры: capital $10k, `use_trailing=True`, Монте-Карло выкл.",
        "",
        res.to_markdown(index=False),
        "",
        "Все флаги default-off: при выключенных флагах baseline воспроизводится побарово "
        "(якорь: golden_ohlcv + confluence_ema = 11 сделок / net_pnl 261.23, см. "
        "`backend/tests/test_strategy_weaknesses_fixes.py`).",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nSaved {OUT}")


if __name__ == "__main__":
    main()
