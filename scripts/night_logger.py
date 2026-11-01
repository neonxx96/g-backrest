"""Ночной логгер демо-марафона: каждые N минут пишет снапшот в data/night_log.jsonl.

Фиксирует: equity, число сессий/открытых позиций, суммарное число закрытых
сделок, сделки с прошлого снапшота (символ/PnL), задержку health бэкенда,
счётчики событий пилота. Утром по этому файлу видно всю ночь без раскопок.

Запуск (отсоединённо, с авто-стопом через --hours):
    .venv\\Scripts\\python.exe -u scripts/night_logger.py --interval 15 --hours 10
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "night_log.jsonl")
BASE = "http://127.0.0.1:8000"


def get_json(path: str, timeout: float = 30.0):
    with urllib.request.urlopen(BASE + path, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def snapshot() -> dict:
    t0 = time.time()
    health = None
    health_ms = None
    try:
        health = get_json("/api/health", timeout=15.0)
        health_ms = int((time.time() - t0) * 1000)
    except Exception as exc:  # noqa: BLE001 — фиксируем недоступность как факт
        health = {"status": f"error: {exc}"}

    row: dict = {"ts": datetime.now().isoformat(timespec="seconds"), "health_ms": health_ms}
    try:
        status = get_json("/api/overnight-pilot/status", timeout=60.0)
        sessions = status.get("sessions") or {}
        row["pilot_running"] = bool(status.get("pilot_running"))
        row["sessions"] = len(sessions)
        row["strategies"] = sorted({s.get("strategy_type") for s in sessions.values()})
    except Exception as exc:  # noqa: BLE001
        row["pilot_error"] = str(exc)[:160]

    try:
        trades = get_json("/api/paper-trading/closed-trades?period=all&sort_by=date&sort_order=desc&limit=200", timeout=60.0)
        items = trades.get("trades") or []
        row["closed_total"] = trades.get("total_count")
        row["open_positions"] = sum(1 for t in items if not t.get("exit_ts"))  # запасной признак
        # суммарный PnL по последним 200 закрытым
        closed = [t for t in items if t.get("exit_ts")]
        row["recent_pnl"] = round(sum(float(t.get("net_pnl") or 0) for t in closed), 3)
    except Exception as exc:  # noqa: BLE001
        row["trades_error"] = str(exc)[:160]

    try:
        agg = (get_json("/api/overnight-pilot/status", timeout=60.0).get("aggregate") or {}).get("paper") or {}
        if agg.get("equity") is not None:
            row["equity"] = round(float(agg["equity"]), 2)
    except Exception:  # noqa: BLE001 — equity необязателен
        pass
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=int, default=15, help="минут между снапшотами")
    parser.add_argument("--hours", type=float, default=10.0, help="самоуничтожение через N часов")
    args = parser.parse_args()

    deadline = time.time() + args.hours * 3600
    last_total = None
    while time.time() < deadline:
        try:
            row = snapshot()
            total = row.get("closed_total")
            if last_total is not None and total is not None:
                row["new_trades"] = int(total) - int(last_total)
            if total is not None:
                last_total = total
            with open(OUT, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(f"[{time.strftime('%H:%M:%S')}] {json.dumps(row, ensure_ascii=False)}", flush=True)
        except Exception as exc:  # noqa: BLE001 — логгер не должен умирать
            print(f"[{time.strftime('%H:%M:%S')}] cycle error: {exc}", flush=True)
        time.sleep(max(60, args.interval * 60))
    print(f"[{time.strftime('%H:%M:%S')}] лимит {args.hours}ч исчерпан — логгер остановлен", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
