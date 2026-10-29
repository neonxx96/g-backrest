"""Reconcile one stopped paper position from closed public Binance candles.

Dry run by default. A recovery fill is an estimate at the first closed 1m
bar crossing the saved SL/TP after the runner's last observed tick. It is
explicitly labeled and never presented as an exchange execution.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def first_exit_bar(position: dict, bars: list, last_tick_ms: int, now_ms: int):
    side = str(position["side"]).upper()
    stop = float(position["stop_price"])
    target = float(position["target_price"])
    next_minute = (int(last_tick_ms) // 60_000 + 1) * 60_000
    for bar in bars:
        opened, high, low, close, closed = int(bar[0]), float(bar[2]), float(bar[3]), float(bar[4]), int(bar[6])
        if opened < next_minute or closed >= now_ms:
            continue
        stop_hit = low <= stop if side == "LONG" else high >= stop
        target_hit = high >= target if side == "LONG" else low <= target
        if stop_hit:
            price = min(close, stop) if side == "LONG" else max(close, stop)
            return price, closed, "RECOVERY_STOP_CROSS_1M_CLOSE"
        if target_hit:
            price = min(close, target) if side == "LONG" else max(close, target)
            return price, closed, "RECOVERY_TARGET_CROSS_1M_CLOSE"
    return None


def build_recovery_trade(position: dict, exit_price: float, exit_ts: int, reason: str) -> dict[str, Any]:
    qty = float(position["qty"])
    entry = float(position["avg_entry_price"])
    entry_fee = float(position.get("fees_paid") or 0.0)
    exit_fee = abs(exit_price * qty) * 0.0005  # configured paper taker fee, 5 bps
    gross = (exit_price - entry) * qty * (1 if position["side"] == "LONG" else -1)
    net = gross - entry_fee - exit_fee
    risk = max(float(position.get("risk_amount") or 0.0), 1e-9)
    return {
        "symbol": position["symbol"], "side": position["side"], "qty": qty,
        "entry_price": entry, "exit_price": exit_price,
        "entry_ts": int(position["entry_ts"]), "exit_ts": int(exit_ts),
        "stop_price": float(position["stop_price"]),
        "target_price": float(position["target_price"]),
        "gross_pnl": gross, "net_pnl": net,
        "pnl_percent": (exit_price - entry) / entry * 100 * (1 if position["side"] == "LONG" else -1),
        "fee": exit_fee, "fee_drag": entry_fee + exit_fee, "slippage_cost": 0.0,
        "risk_usd": risk, "realized_r": net / risk,
        "reason": reason, "entry_reason": position.get("reason") or "",
        "source": "paper_recovery", "recovery_price_basis": "first closed Binance Futures 1m candle after missed SL/TP",
    }


def _fetch_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def _load_snapshot(connection: sqlite3.Connection, session_id: str):
    row = connection.execute(
        "SELECT config_json, paper_json, is_running FROM overnight_pilot_runs WHERE session_id=?",
        (session_id,),
    ).fetchone()
    if row is None or not row[1] or row[2]:
        raise ValueError("Stopped paper snapshot not found or still running")
    config, paper = json.loads(row[0]), json.loads(row[1])
    positions = paper.get("open_positions") or []
    if len(positions) != 1 or (paper.get("closed_trades") or []):
        raise ValueError("Recovery requires exactly one open position and no prior closed trades")
    return row[1], config, paper, positions[0]


def reconcile(db_path: Path, session_id: str, *, apply: bool = False, backup_path: Path | None = None) -> dict:
    if apply and (backup_path is None or not backup_path.is_file()):
        raise ValueError("--apply requires an existing SQLite backup file")
    with sqlite3.connect(f"file:{db_path.resolve()}?mode=ro", uri=True) as connection:
        original_json, config, paper, position = _load_snapshot(connection, session_id)
    symbol = str(position["symbol"]).upper()
    last_tick = int(paper["last_tick_time"])
    now_ms = int(_fetch_json("https://fapi.binance.com/fapi/v1/time")["serverTime"])
    start_ms = (last_tick // 60_000 + 1) * 60_000
    if now_ms - start_ms > 1000 * 60_000:
        raise ValueError("Gap exceeds 1000 one-minute candles; manual review required")
    params = urllib.parse.urlencode({"symbol": symbol, "interval": "1m", "startTime": start_ms, "limit": 1000})
    bars = _fetch_json(f"https://fapi.binance.com/fapi/v1/klines?{params}")
    event = first_exit_bar(position, bars, last_tick, now_ms)
    if event is None:
        raise ValueError("Saved SL/TP was not crossed by a closed one-minute candle")
    trade = build_recovery_trade(position, *event)
    shared_id = str(paper["session_id"])
    trade_id = f"recovery:{shared_id}:{symbol}:{trade['entry_ts']}"
    result = {"applied": False, "trade_id": trade_id, "session_id": session_id, "trade": trade}
    if not apply:
        return result
    run_id = str(config.get("_run_id") or "")
    if not run_id:
        raise ValueError("Persisted run id is missing")
    with sqlite3.connect(db_path, timeout=20) as connection:
        connection.execute("BEGIN IMMEDIATE")
        live_json, _, _, _ = _load_snapshot(connection, session_id)
        if live_json != original_json:
            raise ValueError("Paper snapshot changed during recovery")
        existing = connection.execute("SELECT 1 FROM paper_trade_records WHERE trade_id=?", (trade_id,)).fetchone()
        if existing:
            raise ValueError("Recovery trade already recorded")
        connection.execute(
            """INSERT INTO paper_trade_records
            (trade_id,session_id,symbol,side,qty,entry_price,exit_price,target_price,stop_price,
             gross_pnl,net_pnl,pnl_percent,fee,fee_drag,slippage_cost,risk_usd,realized_r,
             reason,entry_reason,source,strategy,timeframe,entry_ts,exit_ts,run_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (trade_id, shared_id, symbol, trade["side"], trade["qty"], trade["entry_price"], trade["exit_price"],
             trade["target_price"], trade["stop_price"], trade["gross_pnl"], trade["net_pnl"],
             trade["pnl_percent"], trade["fee"], trade["fee_drag"], trade["slippage_cost"],
             trade["risk_usd"], trade["realized_r"], trade["reason"], trade["entry_reason"],
             trade["source"], config.get("strategy_type", ""), config.get("timeframe", ""),
             trade["entry_ts"], trade["exit_ts"], run_id),
        )
        rows = connection.execute("SELECT session_id,config_json,paper_json FROM overnight_pilot_runs WHERE paper_json IS NOT NULL").fetchall()
        updated = 0
        for row_id, config_json, paper_json in rows:
            if json.loads(config_json or "{}").get("_run_id") != run_id:
                continue
            snapshot = json.loads(paper_json)
            if snapshot.get("session_id") != shared_id or snapshot.get("closed_trades"):
                raise ValueError("Shared paper snapshot is inconsistent; manual review required")
            if row_id != session_id and snapshot.get("open_positions"):
                raise ValueError("Another open position exists in the shared run")
            capital = float(snapshot.get("initial_capital") or 1000.0)
            equity = capital + trade["net_pnl"]
            snapshot.update({
                "is_running": False, "open_positions": [], "current_equity": equity,
                "balance": equity, "available_margin": equity, "used_margin": 0.0,
                "unrealized_pnl": 0.0, "total_fees": trade["fee_drag"],
                "roi_pct": trade["net_pnl"] / capital * 100,
                "data_status": "stale", "last_data_error": "Stopped runner; recovery exit estimated from closed 1m candle",
            })
            if row_id == session_id:
                snapshot["closed_trades"] = [trade]
                snapshot["closed_trades_count"] = 1
                snapshot["realized_pnl"] = trade["net_pnl"]
            connection.execute(
                "UPDATE overnight_pilot_runs SET paper_json=?, is_running=0, updated_at=CURRENT_TIMESTAMP WHERE session_id=?",
                (json.dumps(snapshot, ensure_ascii=False), row_id),
            )
            updated += 1
        if updated < 1:
            raise ValueError("No matching persisted run snapshots found")
    result["applied"] = True
    result["updated_snapshots"] = updated
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session_id", help="Persisted stopped per-symbol session id")
    parser.add_argument("--db", type=Path, default=Path("data/signals.db"))
    parser.add_argument("--backup-file", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(reconcile(args.db, args.session_id, apply=args.apply, backup_path=args.backup_file), indent=2))


if __name__ == "__main__":
    main()
