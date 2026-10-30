"""Скрининг пар + запуск уникальных стратегий в тестовой торговле.

Поток: стоп текущего пилота -> скрининг каждой пары по каталогу стратегий
(backtest+forecast) -> выбор лучшей активной конфигурации на пару ->
точный preflight -> старт на общем paper-счёте ($1,000). Затем мониторинг
открытий/закрытий и статистики. Paper-only: реальные ордера не отправляются.

Использование:
    python scripts/screen_and_trade.py run [--pairs BTCUSDT,ETHUSDT ...] [--days 14]
    python scripts/screen_and_trade.py monitor [--once]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen

API = "http://127.0.0.1:8000/api/overnight-pilot"
RESULT_PATH = "data/screen_and_trade_result.json"
WALLET_PATH = "data/demo_wallet.json"  # continuity equity общего paper-счёта между перезапусками
DEFAULT_PAIRS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT",
    "LINKUSDT", "ZECUSDT", "NEARUSDT", "ENAUSDT", "SUIUSDT", "UNIUSDT",
    "AVAXUSDT", "ADAUSDT",
]
DURATION_HOURS = 168.0  # максимум контракта; «без времени» насколько позволяет API
MIN_TRADES_FOR_BEST = 5


def _post(path: str, body: Optional[Dict[str, Any]] = None, timeout: float = 900.0) -> Dict[str, Any]:
    data = json.dumps(body).encode("utf-8") if body is not None else b"{}"
    req = Request(f"{API}{path}", data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310 — локальный доверенный backend
        return json.loads(resp.read().decode("utf-8"))


def _get(path: str, timeout: float = 60.0) -> Dict[str, Any]:
    req = Request(f"{API}{path}", method="GET")
    with urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def pick_best(rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Лучшая строка скрининга: активные, с достаточным числом сделок, макс Net PnL."""
    ok_rows = [r for r in rows if r.get("ok")]
    if not ok_rows:
        return None
    active = [r for r in ok_rows if int((r.get("backtest") or {}).get("total_trades") or 0) >= MIN_TRADES_FOR_BEST]
    pool = active or ok_rows
    return max(
        pool,
        key=lambda r: (
            float((r.get("backtest") or {}).get("net_pnl_usd") or 0.0),
            int((r.get("backtest") or {}).get("total_trades") or 0),
        ),
    )


async def screen_symbol(symbol: str, days: int, sem: asyncio.Semaphore) -> Dict[str, Any]:
    async with sem:
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, _post, "/pairs/screen", {"symbol": symbol, "days": days})
        except Exception as exc:  # noqa: BLE001 — фиксируем и идём дальше по парам
            return {"symbol": symbol, "error": str(exc)}
        result["best"] = pick_best(result.get("rows") or [])
        return result


def stop_pilot() -> None:
    try:
        _post("/stop", {})
        print("[stop] pilot stopped")
    except Exception as exc:  # noqa: BLE001
        print(f"[stop] {exc}")


def start_pair_preflight(config: Dict[str, Any], preflight_id: str) -> Dict[str, Any]:
    """prepare → start-demo по готовому preflight_id."""
    # start-demo ожидает preflight_id строкой запроса
    data = json.dumps(config).encode("utf-8")
    req = Request(
        f"{API}/pairs/start-demo?preflight_id={preflight_id}",
        data=data, headers={"Content-Type": "application/json"}, method="POST",
    )
    with urlopen(req, timeout=300) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def start_pair(symbol: str, row: Dict[str, Any]) -> Dict[str, Any]:
    config = dict(row["config"])
    config["duration_hours"] = DURATION_HOURS
    prepared = _post("/pairs/prepare", config)
    return start_pair_preflight(config, prepared["preflight_id"])


def cmd_run(pairs: List[str], days: int) -> int:
    print(f"[run] стоп текущего пилота, скрининг {len(pairs)} пар ({days} дн.)…")
    stop_pilot()
    time.sleep(3)

    async def screen_all() -> List[Dict[str, Any]]:
        sem = asyncio.Semaphore(4)
        return list(await asyncio.gather(*(screen_symbol(s, days, sem) for s in pairs)))

    screens = asyncio.run(screen_all())
    started: List[Dict[str, Any]] = []
    skipped: Dict[str, str] = {}
    for item in screens:
        symbol = item["symbol"]
        if item.get("error"):
            skipped[symbol] = f"screen: {item['error']}"
            continue
        best = item.get("best")
        if not best:
            skipped[symbol] = "нет валидных стратегий в скрининге"
            continue
        try:
            start_pair(symbol, best)
            started.append({
                "symbol": symbol,
                "strategy_type": best["strategy_type"],
                "timeframe": best["timeframe"],
                "net_pnl_usd": (best.get("backtest") or {}).get("net_pnl_usd"),
                "total_trades": (best.get("backtest") or {}).get("total_trades"),
            })
            print(f"[start] {symbol}: {best['strategy_type']} {best['timeframe']} "
                  f"(PnL {best['backtest'].get('net_pnl_usd')}, сделок {best['backtest'].get('total_trades')})")
        except Exception as exc:  # noqa: BLE001
            skipped[symbol] = f"start: {exc}"

    summary = {"started": started, "skipped": skipped, "account_target": "shared $1,000 paper wallet"}
    with open(RESULT_PATH, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)
    print(f"[done] запущено {len(started)} пар, пропущено {len(skipped)}: {skipped}")
    return 0 if started else 1


def _positions_snapshot() -> Dict[str, Any]:
    status = _get("/status")
    sessions = status.get("sessions") or {}
    open_positions: List[Dict[str, Any]] = []
    closed_total = 0
    for sym, sess in sessions.items():
        paper = sess.get("paper") or {}
        for pos in paper.get("open_positions") or []:
            open_positions.append({"symbol": sym, **pos})
        closed_total += len(paper.get("closed_trades") or [])
    agg = (status.get("aggregate") or {}).get("paper") or {}
    return {
        "pilot_running": status.get("pilot_running"),
        "account": agg.get("account_id"),
        "equity": agg.get("equity"),
        "sessions": len(sessions),
        "open_count": len(open_positions),
        "open_positions": open_positions,
        "closed_total": closed_total,
    }


def cmd_monitor(once: bool, interval: int, rounds: int) -> int:
    prev_open: set = set()
    prev_closed = -1
    for i in range(rounds):
        snap = _positions_snapshot()
        opens = {f"{p.get('symbol')}:{p.get('side')}:{p.get('entry_price')}" for p in snap["open_positions"]}
        new_opens = opens - prev_open
        closed_now = snap["closed_total"]
        print(
            f"[{time.strftime('%H:%M:%S')}] running={snap['pilot_running']} account={snap['account']} "
            f"equity={snap['equity']} sessions={snap['sessions']} open={snap['open_count']} closed={closed_now}"
        )
        for p in snap["open_positions"]:
            key = f"{p.get('symbol')}:{p.get('side')}:{p.get('entry_price') or p.get('avg_entry_price')}"
            marker = " NEW" if key in new_opens else ""
            if marker:
                # первый снапшот новой позиции — печатаем сырой JSON (ключи зависят от раннера)
                print(f"  NEW POSITION {json.dumps(p, ensure_ascii=False, default=str)[:800]}")
            else:
                compact = {k: p.get(k) for k in (
                    "symbol", "side", "qty", "entry_price", "avg_entry_price", "stop_price",
                    "take_profit", "target_price", "unrealized_pnl", "leverage") if k in p}
                print(f"  {json.dumps(compact, ensure_ascii=False, default=str)}{marker}")
        if prev_closed >= 0 and closed_now > prev_closed:
            print(f"  >>> закрыто сделок суммарно: {closed_now} (новых: {closed_now - prev_closed}) — статистика пишется")
        prev_open = opens
        prev_closed = closed_now
        if once:
            break
        time.sleep(interval)
    return 0


def saved_equity() -> float:
    """Сохранённый equity общего paper-счёта (fallback $1,000)."""
    try:
        return float(json.load(open(WALLET_PATH, encoding="utf-8")).get("initial_balance") or 1000.0)
    except Exception:  # noqa: BLE001 — файла нет или битый: стартуем с дефолта
        return 1000.0


def save_equity(value: float) -> None:
    try:
        with open(WALLET_PATH, "w", encoding="utf-8") as fh:
            json.dump({"initial_balance": round(float(value), 2)}, fh)
    except Exception:  # noqa: BLE001 — запоминание equity некритично
        pass


def build_config(symbol: str, strategy_type: str, timeframe: str,
                 initial_capital: Optional[float] = None) -> Dict[str, Any]:
    """Конфиг демо-сессии — зеркало probe-конфига скрининга (overnight_pilot.screen_pair)."""
    return {
        "symbol": symbol, "strategy_type": strategy_type, "timeframe": timeframe,
        "days": 14, "initial_capital": float(initial_capital if initial_capital is not None else 1000.0),
        "risk_per_trade_pct": 0.5,
        "min_density_usd": 0.0, "volume_multiplier": 0.0,
        "use_cvd_filter": False, "use_rsi_filter": False,
        "use_multi_tp": False, "trailing_activation_pct": 0.5,
        "ai_control": True, "auto_strategy_switch": True,
        "duration_hours": DURATION_HOURS,
    }


def load_started() -> List[Dict[str, Any]]:
    """Сохранённый набор запущенных пар (symbol/strategy_type/timeframe)."""
    try:
        return list(json.load(open(RESULT_PATH, encoding="utf-8")).get("started") or [])
    except Exception:  # noqa: BLE001 — файла нет или битый
        return []


def cmd_resume() -> int:
    """Перезапуск демо по сохранённому набору пар/стратегий (без нового скрининга)."""
    started = load_started()
    if not started:
        print(f"[resume] нет записей о запуске в {RESULT_PATH}")
        return 1
    print(f"[resume] перезапуск {len(started)} пар по {RESULT_PATH} …")
    ok, failed = [], {}
    for item in started:
        symbol = item["symbol"]
        config = build_config(symbol, item["strategy_type"], item["timeframe"],
                              initial_capital=saved_equity())
        try:
            prepared = _post("/pairs/prepare", config)
            result = start_pair_preflight(config, prepared["preflight_id"])
            ok.append({"symbol": symbol, "strategy_type": item["strategy_type"], "timeframe": item["timeframe"]})
            print(f"[resume] OK {symbol} {item['strategy_type']} {item['timeframe']} → {result.get('session_id') or result.get('account_id') or 'started'}")
        except Exception as exc:  # noqa: BLE001 — продолжаем по остальным парам
            failed[symbol] = str(exc)
            print(f"[resume] FAIL {symbol}: {exc}")
    out_path = "data/screen_and_trade_resume.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"resumed": ok, "failed": failed}, fh, ensure_ascii=False, indent=2)
    print(f"[resume] готово: {len(ok)} запущено, {len(failed)} ошибок → {out_path}")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    run_p = sub.add_parser("run")
    run_p.add_argument("--pairs", default=",".join(DEFAULT_PAIRS), help="список USDT-пар через запятую")
    run_p.add_argument("--days", type=int, default=14)
    sub.add_parser("resume", help="перезапуск демо по сохранённому набору пар без нового скрининга")
    mon_p = sub.add_parser("monitor")
    mon_p.add_argument("--once", action="store_true")
    mon_p.add_argument("--interval", type=int, default=60)
    mon_p.add_argument("--rounds", type=int, default=30)
    args = parser.parse_args()
    if args.cmd == "run":
        return cmd_run([s.strip().upper() for s in args.pairs.split(",") if s.strip()], args.days)
    if args.cmd == "resume":
        return cmd_resume()
    return cmd_monitor(args.once, args.interval, args.rounds)


if __name__ == "__main__":
    sys.exit(main())
