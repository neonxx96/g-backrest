"""
Creates paper_trade_records table in data/signals.db if not exists,
and imports historical closed trades from overnight_pilot_runs and deep_intent_log.jsonl.
"""
import asyncio
import json
import os
import sqlite3
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = "data/signals.db"
LOG_PATH = "backend/data/deep_intent_log.jsonl"

def init_table():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS paper_trade_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id VARCHAR UNIQUE,
        session_id VARCHAR DEFAULT '',
        symbol VARCHAR NOT NULL,
        side VARCHAR NOT NULL,
        qty FLOAT DEFAULT 0.0,
        entry_price FLOAT DEFAULT 0.0,
        exit_price FLOAT DEFAULT 0.0,
        target_price FLOAT,
        stop_price FLOAT,
        gross_pnl FLOAT DEFAULT 0.0,
        net_pnl FLOAT DEFAULT 0.0,
        pnl_percent FLOAT DEFAULT 0.0,
        fee FLOAT DEFAULT 0.0,
        fee_drag FLOAT DEFAULT 0.0,
        slippage_cost FLOAT DEFAULT 0.0,
        mfe FLOAT DEFAULT 0.0,
        mae FLOAT DEFAULT 0.0,
        mfe_r FLOAT DEFAULT 0.0,
        profit_bleed BOOLEAN DEFAULT 0,
        reason VARCHAR DEFAULT '',
        entry_reason TEXT DEFAULT '',
        source VARCHAR DEFAULT 'paper',
        strategy VARCHAR DEFAULT '',
        timeframe VARCHAR DEFAULT '5m',
        entry_ts INTEGER DEFAULT 0,
        exit_ts INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS ix_paper_trade_records_trade_id ON paper_trade_records (trade_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_paper_trade_records_symbol ON paper_trade_records (symbol)")
    cur.execute("CREATE INDEX IF NOT EXISTS ix_paper_trade_records_exit_ts ON paper_trade_records (exit_ts)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_paper_symbol_exit_ts ON paper_trade_records (symbol, exit_ts)")
    conn.commit()
    conn.close()
    print("Table paper_trade_records checked/created.")

def import_from_overnight_pilot_runs():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    imported = 0
    skipped = 0

    cur.execute("SELECT session_id, symbol, strategy_type, paper_json FROM overnight_pilot_runs WHERE paper_json IS NOT NULL")
    rows = cur.fetchall()
    for session_id, sym, strat, paper_json in rows:
        try:
            data = json.loads(paper_json)
            closed_trades = data.get("closed_trades", [])
            for t in closed_trades:
                trade_symbol = t.get("symbol") or sym
                entry_ts = int(t.get("entry_ts") or 0)
                exit_ts = int(t.get("exit_ts") or 0)
                qty = float(t.get("qty") or 0.0)
                reason = str(t.get("reason") or t.get("exit_reason") or "")
                closure_id = t.get("closure_id") or f"{session_id}:{trade_symbol}:{entry_ts}:{exit_ts}:{qty:.4f}"

                side = str(t.get("side") or "LONG").upper()
                entry_px = float(t.get("entry_price") or 0.0)
                exit_px = float(t.get("exit_price") or 0.0)
                gross_pnl = float(t.get("gross_pnl") or 0.0)
                net_pnl = float(t.get("net_pnl") or 0.0)
                pnl_pct = float(t.get("pnl_percent") or 0.0)
                fee = float(t.get("fee") or 0.0)
                fee_drag = float(t.get("fee_drag") or fee)
                slippage = float(t.get("slippage_cost") or 0.0)
                mfe = float(t.get("mfe") or 0.0)
                mae = float(t.get("mae") or 0.0)
                mfe_r = float(t.get("mfe_r") or 0.0)
                bleed = 1 if t.get("profit_bleed") else 0
                entry_reason = str(t.get("entry_reason") or "")
                source = "marathon"

                try:
                    cur.execute("""
                    INSERT OR IGNORE INTO paper_trade_records (
                        trade_id, session_id, symbol, side, qty, entry_price, exit_price,
                        target_price, stop_price, gross_pnl, net_pnl, pnl_percent,
                        fee, fee_drag, slippage_cost, mfe, mae, mfe_r, profit_bleed,
                        reason, entry_reason, source, strategy, timeframe, entry_ts, exit_ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        closure_id, session_id, trade_symbol, side, qty, entry_px, exit_px,
                        t.get("target_price"), t.get("stop_price"), gross_pnl, net_pnl, pnl_pct,
                        fee, fee_drag, slippage, mfe, mae, mfe_r, bleed,
                        reason, entry_reason, source, strat, "5m", entry_ts, exit_ts
                    ))
                    if cur.rowcount > 0:
                        imported += 1
                    else:
                        skipped += 1
                except Exception as e:
                    print(f"Error inserting trade {closure_id}: {e}")
        except Exception as e:
            print(f"Error parsing paper_json: {e}")

    conn.commit()
    conn.close()
    print(f"Imported {imported} trades from overnight_pilot_runs (skipped/duplicates: {skipped}).")

def import_from_deep_intent_log():
    if not os.path.exists(LOG_PATH):
        return
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    imported = 0
    skipped = 0

    with open(LOG_PATH, "r", encoding="utf-8") as f:
        for line in f:
            if "POSITION_CLOSED" not in line:
                continue
            try:
                ev = json.loads(line)
                if ev.get("event_type") != "POSITION_CLOSED":
                    continue
                p = ev.get("payload", {})
                sym = ev.get("symbol", "")
                sess_id = ev.get("session_id", "")
                ts_str = ev.get("timestamp", "")
                try:
                    # ISO string to epoch ms
                    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    exit_ts = int(dt.timestamp() * 1000)
                except Exception:
                    exit_ts = int(datetime.utcnow().timestamp() * 1000)

                closure_id = p.get("closure_id") or f"{sess_id}:{sym}:{exit_ts}:{ev.get('event_id', '')[:8]}"
                reason = ev.get("reason_code") or p.get("exit_reason") or ""
                gross_pnl = float(p.get("gross_pnl") or 0.0)
                net_pnl = float(p.get("net_pnl") or 0.0)
                fee_drag = float(p.get("fee_drag") or p.get("total_fees") or 0.0)
                slippage = float(p.get("slippage_cost") or 0.0)
                entry_px = float(p.get("entry_price") or 0.0)
                exit_px = float(p.get("exit_price") or 0.0)

                cur.execute("""
                INSERT OR IGNORE INTO paper_trade_records (
                    trade_id, session_id, symbol, side, qty, entry_price, exit_price,
                    gross_pnl, net_pnl, fee_drag, slippage_cost,
                    reason, source, strategy, timeframe, exit_ts
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    closure_id, sess_id, sym, "SHORT" if "SHORT" in str(ev) else "LONG", 1.0, entry_px, exit_px,
                    gross_pnl, net_pnl, fee_drag, slippage,
                    reason, ev.get("source", "paper"), ev.get("strategy", ""), ev.get("timeframe", "5m"), exit_ts
                ))
                if cur.rowcount > 0:
                    imported += 1
                else:
                    skipped += 1
            except Exception:
                pass

    conn.commit()
    conn.close()
    print(f"Imported {imported} trades from deep_intent_log (skipped/duplicates: {skipped}).")

def print_summary():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*), SUM(net_pnl), MIN(exit_ts), MAX(exit_ts) FROM paper_trade_records")
    cnt, total_pnl, min_ts, max_ts = cur.fetchone()
    print(f"Total records in paper_trade_records: {cnt}, Total Net PnL: ${total_pnl:+.2f}")
    if min_ts and max_ts:
        min_dt = datetime.utcfromtimestamp(min_ts / 1000.0)
        max_dt = datetime.utcfromtimestamp(max_ts / 1000.0)
        print(f"Time range: {min_dt} -> {max_dt}")
    conn.close()

if __name__ == "__main__":
    init_table()
    import_from_overnight_pilot_runs()
    import_from_deep_intent_log()
    print_summary()
