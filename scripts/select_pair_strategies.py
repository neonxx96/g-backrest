"""CLI-обёртка над backend/app/services/pair_selector.py.

Запуск:  .\\.venv\\Scripts\\python.exe scripts/select_pair_strategies.py [--days 14] [--symbols BTCUSDT,ETHUSDT]
Результат: data/pair_selection.json. Ничего не отправляет на биржу.
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from backend.app.services.pair_selector import (  # noqa: E402,F401
    DEFAULT_SYMBOLS, MIN_PF, MIN_TRADES_OOS, OUT_PATH, is_qualified, pick_best,
    run_selection, split_train_oos, summarize,
)


async def main(symbols, days):
    payload = await run_selection(symbols, days)
    for r in payload["results"]:
        if "best" in r:
            b = r["best"]
            print(f"{r['symbol']:10} {r['verdict']:7} {b['strategy']:22} {b['timeframe']:>3} {b['sl']}/{b['tp']} "
                  f"train net={b['train']['net']:>7.2f} PF={b['train']['pf']:.2f} | "
                  f"OOS n={b['oos']['trades']:>3} net={b['oos']['net']:>7.2f} PF={b['oos']['pf']:.2f}")
        else:
            print(f"{r['symbol']:10} {r['verdict']:7} {r.get('reason', '')}")
    print(f"\n{payload['counts']} -> {OUT_PATH}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS))
    a = ap.parse_args()
    asyncio.run(main([s.strip().upper() for s in a.symbols.split(",") if s.strip()], a.days))
