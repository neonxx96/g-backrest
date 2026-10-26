import requests
import json
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

try:
    r = requests.get("http://127.0.0.1:8000/api/overnight-pilot/status", timeout=15)
    data = r.json()
    print("Pilot running:", data.get("pilot_running"))
    agg = data.get("aggregate", {})
    paper = agg.get("paper", {})
    print(f"Total Equity: ${paper.get('equity', 0.0):,.2f}")
    print(f"Total Net PnL: ${paper.get('net_pnl_usd', 0.0):,.2f}")
    print(f"Total Closed Trades: {paper.get('closed_trades', 0)}")
    print(f"Unrealized PnL: ${paper.get('unrealized_pnl_usd', 0.0):,.2f}")
    print(f"Win Rate: {paper.get('win_rate_pct', 0.0)}%")
    print(f"Profit Factor: {paper.get('profit_factor', 0.0)}")

    sessions = data.get("sessions", {})
    print(f"\nTotal sessions: {len(sessions)}")
    active_positions = []
    closed_trades = []

    for sym, sess in sessions.items():
        paper_info = sess.get("paper", {})
        pos = paper_info.get("open_positions") or paper_info.get("positions") or []
        closed = paper_info.get("closed_trades") or []
        for p in pos:
            active_positions.append((sym, p))
        for c in closed:
            closed_trades.append((sym, c))
        
    print(f"\nActive positions ({len(active_positions)}):")
    for sym, p in active_positions:
        print(f"  {sym}: {p.get('side')} qty={p.get('qty'):.4f} entry=${p.get('avg_entry_price'):.4f} last=${p.get('last_price'):.4f} uPnL=${p.get('unrealized_pnl'):.4f} ({p.get('current_pnl_r', 0):.2f}R)")

    print(f"\nClosed trades ({len(closed_trades)}):")
    for sym, c in closed_trades:
        print(f"  {sym}: {c.get('side')} PnL=${c.get('net_pnl', 0):.2f} Exit={c.get('exit_reason')}")

except Exception as e:
    print("Error:", e)
