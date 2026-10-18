"""
Overnight Watchdog & Reliability Monitor for SignalScript
Periodically inspects:
1. Paper Trading Engine Status (Balance, Realized/Unrealized PnL, Positions, Closed Trades, Reasons)
2. Focus Coins Monitoring State (BTC, SOL, LINK, ADA, SUI, UNI, ZEC)
3. Backend Process Memory Consumption (RSS in MB)
4. WebSocket & Server Health
5. Critical Drawdown Alert (< $90.00 USD)
"""

import os
import sys
import time
import argparse
import logging
from pathlib import Path
from datetime import datetime
import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

LOGS_DIR = ROOT_DIR / "backend" / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
SUMMARY_LOG_FILE = LOGS_DIR / "overnight_summary.log"

API_BASE = "http://127.0.0.1:8000"
FOCUS_COINS = ["BTCUSDT", "SOLUSDT", "LINKUSDT", "ADAUSDT", "SUIUSDT", "UNIUSDT", "ZECUSDT"]


def get_backend_process_info():
    """Finds backend python process listening on port 8000 and retrieves its RSS memory."""
    try:
        import psutil
        for proc in psutil.process_iter(['pid', 'name', 'connections', 'memory_info']):
            try:
                for conn in proc.connections(kind='inet'):
                    if conn.laddr.port == 8000 and conn.status == 'LISTEN':
                        mem_info = proc.memory_info()
                        return {
                            "pid": proc.pid,
                            "rss_mb": round(mem_info.rss / (1024 * 1024), 2),
                            "vms_mb": round(mem_info.vms / (1024 * 1024), 2)
                        }
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception:
        pass

    # Fallback to current memory stats via logging_setup if in-process
    try:
        from backend.app.logging_setup import get_memory_stats
        stats = get_memory_stats()
        if stats.get("rss_mb", 0) > 0:
            return {"pid": os.getpid(), "rss_mb": stats["rss_mb"], "vms_mb": stats["peak_rss_mb"]}
    except Exception:
        pass

    return {"pid": None, "rss_mb": 0.0, "vms_mb": 0.0}


def query_paper_trading_status():
    """Queries GET /api/paper-trading/status"""
    try:
        res = requests.get(f"{API_BASE}/api/paper-trading/status", timeout=5)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        return {"error": str(e)}
    return {"error": f"HTTP {res.status_code}"}


def query_monitoring_state():
    """Queries GET /api/monitoring/state"""
    try:
        res = requests.get(f"{API_BASE}/api/monitoring/state", timeout=5)
        if res.status_code == 200:
            return res.json()
    except Exception as e:
        return {"error": str(e)}
    return {"error": f"HTTP {res.status_code}"}


def format_uptime(uptime_sec: int) -> str:
    h = uptime_sec // 3600
    m = (uptime_sec % 3600) // 60
    s = uptime_sec % 60
    return f"{h:02d}h {m:02d}m {s:02d}s"


def run_single_check(cycle_num: int):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    proc_info = get_backend_process_info()
    pt_status = query_paper_trading_status()
    mon_status = query_monitoring_state()

    has_pt_error = "error" in pt_status
    balance = pt_status.get("balance", 100.0)
    init_bal = pt_status.get("initial_balance", 100.0)
    realized = pt_status.get("realized_pnl", 0.0)
    unrealized = pt_status.get("unrealized_pnl", 0.0)
    positions = pt_status.get("positions", [])
    closed_trades = pt_status.get("closed_trades", [])
    fees = pt_status.get("total_fees_paid", 0.0)
    uptime_sec = pt_status.get("uptime_seconds", 0)

    # Win rate
    wins = [t for t in closed_trades if (t.get("exit_price", 0) - t.get("entry_price", 0)) * (1 if t.get("side") == "LONG" else -1) > 0]
    win_rate = (len(wins) / len(closed_trades) * 100.0) if closed_trades else 0.0

    # Drawdown check
    drawdown_pct = ((init_bal - balance) / init_bal * 100.0) if balance < init_bal else 0.0
    is_critical_dd = balance < 90.0

    # Monitored statuses
    statuses = mon_status.get("statuses", {})

    # Console Output formatting
    lines = []
    lines.append("=" * 76)
    lines.append(f" [WATCHDOG DASHBOARD #{cycle_num:03d}]  {now_str}  | Uptime: {format_uptime(uptime_sec)}")
    lines.append("=" * 76)

    # System & Memory
    lines.append(f" BACKEND PROCESS : PID {proc_info.get('pid', 'N/A')} | RAM: {proc_info.get('rss_mb', 0.0):.1f} MB RSS | Health: {'OK' if not has_pt_error else 'OFFLINE/ERROR'}")
    
    # Financial Overview
    pnl_sign = "+" if realized >= 0 else ""
    u_sign = "+" if unrealized >= 0 else ""
    lines.append(f" VIRTUAL WALLET  : Balance: ${balance:.2f} (Start: ${init_bal:.2f}) | Realized: {pnl_sign}${realized:.2f} | Unrealized: {u_sign}${unrealized:.2f}")
    lines.append(f" RISK & STATS    : Max Drawdown: {drawdown_pct:.1f}% | WinRate: {win_rate:.0f}% ({len(wins)}/{len(closed_trades)} wins) | Fees: ${fees:.4f}")
    lines.append(f" ACTIVE POSITIONS: {len(positions)} open | CLOSED TRADES: {len(closed_trades)}")

    # Critical alert if balance < $90.00
    if is_critical_dd:
        lines.append("!" * 76)
        lines.append(f" [CRITICAL DRAWDOWN ALERT] BALANCE DROPPED BELOW $90.00: ${balance:.2f} USD!")
        lines.append(f" Total Drawdown: {drawdown_pct:.2f}% | Reviewing last losing trades:")
        for t in closed_trades[-3:]:
            lines.append(f"   -> {t.get('symbol')} {t.get('side')} Entry: {t.get('entry_price')} Exit: {t.get('exit_price')} | Reason: {t.get('reason')}")
        lines.append("!" * 76)

    # Open Positions Detail
    if positions:
        lines.append("-" * 76)
        lines.append(" OPEN POSITIONS:")
        for p in positions:
            u_pnl = p.get("unrealized_pnl", 0.0)
            u_s = "+" if u_pnl >= 0 else ""
            lines.append(f"   • {p.get('symbol')} {p.get('side')}: Qty={p.get('qty', 0):.4f} Entry=${p.get('avg_entry_price', 0):.2f} Mark=${p.get('last_price', 0):.2f} | PnL: {u_s}${u_pnl:.2f} | Reason: {p.get('reason')}")

    # Latest Closed Trades
    if closed_trades:
        lines.append("-" * 76)
        lines.append(" LATEST CLOSED TRADES (Last 3):")
        for t in closed_trades[-3:]:
            t_gross = (t.get("exit_price", 0) - t.get("entry_price", 0)) * (1 if t.get("side") == "LONG" else -1) * t.get("qty", 0)
            t_s = "+" if t_gross >= 0 else ""
            lines.append(f"   • {t.get('symbol')} {t.get('side')}: In=${t.get('entry_price', 0):.2f} Out=${t.get('exit_price', 0):.2f} | Net={t_s}${t_gross:.2f} | Reason: {t.get('reason')}")

    # Focus Coins Status
    lines.append("-" * 76)
    lines.append(" FOCUS COINS QUANT REGIME STATUS:")
    for sym in FOCUS_COINS:
        st = statuses.get(sym, {})
        regime = st.get("regime_name", "Confluence Momentum")
        pnl_pct = st.get("pnl_pct", 0.0)
        signal = st.get("signal", "NEUTRAL")
        trend = st.get("forecast_trend", "FLAT")
        is_prof = st.get("is_profitable", True)
        prof_flag = "[ACTIVE]" if is_prof else "[PAUSED]"
        lines.append(f"   • {sym:<8} {prof_flag:<8} | Regime: {regime:<28} | 7d PnL: {pnl_pct:+.1f}% | Signal: {signal:<7} | Trend: {trend}")

    lines.append("=" * 76)
    output_block = "\n".join(lines)
    print(output_block, flush=True)

    # Append to overnight_summary.log
    with open(SUMMARY_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{now_str}] Check #{cycle_num:03d} | Balance: ${balance:.2f} | Realized: ${realized:+.2f} | Positions: {len(positions)} | RAM: {proc_info.get('rss_mb', 0)}MB | WinRate: {win_rate:.0f}%\n")
        if is_critical_dd:
            f.write(f"[{now_str}] [ALERT] CRITICAL DRAWDOWN < $90.00: ${balance:.2f} USD\n")

    return {
        "cycle": cycle_num,
        "balance": balance,
        "realized_pnl": realized,
        "unrealized_pnl": unrealized,
        "positions_count": len(positions),
        "closed_trades_count": len(closed_trades),
        "win_rate": win_rate,
        "ram_mb": proc_info.get("rss_mb", 0.0),
        "critical_drawdown": is_critical_dd,
        "output": output_block
    }


def main():
    parser = argparse.ArgumentParser(description="Overnight Watchdog for SignalScript Paper Trading")
    parser.add_argument("--interval", type=int, default=300, help="Interval in seconds between checks (default: 300)")
    parser.add_argument("--once", action="store_true", help="Run once and exit (for diagnostics)")
    args = parser.parse_args()

    print(f"Starting Overnight Watchdog (interval={args.interval}s, summary_log={SUMMARY_LOG_FILE})...", flush=True)

    if args.once:
        run_single_check(1)
        return

    cycle = 1
    while True:
        try:
            run_single_check(cycle)
            cycle += 1
        except Exception as e:
            print(f"[ERROR] Error in watchdog cycle #{cycle}: {e}", file=sys.stderr, flush=True)
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
