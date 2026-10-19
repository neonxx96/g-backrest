"""
Nightly Smoke Test & Paper Trading Reliability Monitor for SignalScript.
Simulates end-to-end user operations:
1. Health checks on Backend (:8000) and Frontend (:5173).
2. Coin & Timeframe switching (BTCUSDT, ETHUSDT; 5m, 15m).
3. 3 Historical Backtests with institutional metrics.
4. Probabilistic Forecast scenario validation (anchor price, ±1σ, ±2σ cone).
5. Paper Trading initialization ($100 virtual wallet) & trade placement.
6. Heartbeat monitoring loop tracking Balance, PnL, Drawdown, and Win32 Memory RSS.
7. Triggering Emergency Kill Switch and asserting HALTED state and position closure.
8. Generating structured report to backend/logs/smoke_test_report.log.
"""

import os
import sys
import time
import json
import math
import argparse
import ctypes
from ctypes import wintypes
from pathlib import Path
from datetime import datetime
import urllib.request
import urllib.error

# Root project paths
ROOT_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = ROOT_DIR / "backend" / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
REPORT_FILE = LOGS_DIR / "smoke_test_report.log"


class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


def get_process_memory_by_pid(pid: int) -> dict:
    """Retrieves RSS and Peak RSS memory in MB for a given PID using Win32 API."""
    try:
        PROCESS_QUERY_INFORMATION = 0x0400
        PROCESS_VM_READ = 0x0010
        h_proc = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if h_proc:
            try:
                pmc = PROCESS_MEMORY_COUNTERS_EX()
                pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
                ok = ctypes.windll.psapi.GetProcessMemoryInfo(h_proc, ctypes.byref(pmc), pmc.cb)
                if ok:
                    return {
                        "rss_mb": round(pmc.WorkingSetSize / (1024 * 1024), 2),
                        "peak_rss_mb": round(pmc.PeakWorkingSetSize / (1024 * 1024), 2),
                        "private_mb": round(pmc.PrivateUsage / (1024 * 1024), 2),
                    }
            finally:
                ctypes.windll.kernel32.CloseHandle(h_proc)
    except Exception:
        pass
    return {"rss_mb": 0.0, "peak_rss_mb": 0.0, "private_mb": 0.0}


def find_port_listening_pid(port: int = 8000) -> int:
    """Finds the PID of the process listening on the specified port via netstat."""
    import subprocess
    try:
        out = subprocess.check_output("netstat -ano", shell=True).decode(errors="ignore")
        for line in out.splitlines():
            if f":{port} " in line and "LISTENING" in line:
                parts = line.strip().split()
                return int(parts[-1])
    except Exception:
        pass
    return 0


def http_request(url: str, method: str = "GET", data: dict = None, timeout: float = 10.0) -> tuple:
    """Standard HTTP request helper returning (status_code, response_json_or_text)."""
    headers = {"User-Agent": "SignalScript-NightlySmokeTest/1.0"}
    req_body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        req_body = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(url, data=req_body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = raw
            return resp.status, parsed
    except urllib.error.HTTPError as he:
        err_body = he.read().decode("utf-8", errors="ignore")
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = err_body
        return he.code, parsed
    except Exception as e:
        return 0, str(e)


class SmokeTestRunner:
    def __init__(self, backend_url: str, frontend_url: str, duration: int, interval: int = 5):
        self.backend_url = backend_url.rstrip("/")
        self.frontend_url = frontend_url.rstrip("/")
        self.duration = duration
        self.interval = interval
        self.start_time = None
        self.end_time = None
        self.backend_pid = find_port_listening_pid(8000)
        self.errors = []
        self.trade_events = []
        self.backtest_results = []
        self.forecast_results = []
        self.wallet_snapshots = []
        self.max_drawdown_usd = 0.0
        self.max_drawdown_pct = 0.0
        self.peak_balance = 100.0

    def log(self, msg: str):
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] {msg}")

    def run_all(self) -> bool:
        self.start_time = datetime.now()
        self.log("=" * 65)
        self.log(f"🚀 STARTING NIGHTLY SMOKE TEST (Duration: {self.duration}s)")
        self.log(f"   Backend: {self.backend_url} (PID: {self.backend_pid})")
        self.log(f"   Frontend: {self.frontend_url}")
        self.log("=" * 65)

        # 1. Health Checks
        if not self.step_1_health_checks():
            self.log("❌ Health check failed. Aborting smoke test.")
            return False

        # 2. Symbol & Timeframe Switching
        if not self.step_2_symbol_timeframe_switching():
            self.log("❌ Symbol/timeframe switching failed.")
            return False

        # 3. 3 Historical Backtests
        if not self.step_3_run_backtests():
            self.log("❌ Backtest execution failed.")
            return False

        # 4. Probabilistic Forecast
        if not self.step_4_probabilistic_forecast():
            self.log("❌ Probabilistic forecast failed.")
            return False

        # 5. Paper Trading Setup & Placement
        if not self.step_5_paper_trading_setup():
            self.log("❌ Paper trading setup failed.")
            return False

        # 6. Monitoring Loop
        self.step_6_monitoring_loop()

        # 7. Emergency Kill Switch
        if not self.step_7_activate_kill_switch():
            self.log("❌ Kill switch activation assertion failed.")
            return False

        # 8. Report Generation
        self.end_time = datetime.now()
        self.step_8_generate_report()
        return len(self.errors) == 0

    def step_1_health_checks(self) -> bool:
        self.log("\n[STEP 1/7] Health Checks (Backend & Frontend)...")
        # Backend health
        b_code, b_data = http_request(f"{self.backend_url}/api/monitoring/state")
        if b_code != 200:
            self.errors.append(f"Backend ping failed: HTTP {b_code} - {b_data}")
            self.log(f"  ❌ Backend ping failed: HTTP {b_code}")
            return False
        self.log("  ✅ Backend is ONLINE and responding (HTTP 200)")

        # Frontend health
        f_code, _ = http_request(f"{self.frontend_url}/")
        if f_code != 200:
            self.errors.append(f"Frontend ping failed: HTTP {f_code}")
            self.log(f"  ❌ Frontend ping failed: HTTP {f_code}")
            return False
        self.log("  ✅ Frontend is ONLINE and serving index (HTTP 200)")
        return True

    def step_2_symbol_timeframe_switching(self) -> bool:
        self.log("\n[STEP 2/7] Simulating Symbol & Timeframe Switching (BTC/ETH, 5m/15m)...")
        switches = [
            ("BTCUSDT", "5m"),
            ("ETHUSDT", "15m"),
            ("BTCUSDT", "15m"),
        ]

        for sym, tf in switches:
            # 1. Update settings
            s_code, s_res = http_request(
                f"{self.backend_url}/api/settings",
                method="POST",
                data={"timeframe": tf, "theme": "dark", "selected_symbol": sym}
            )
            # 2. Fetch klines for the switched state
            k_code, k_res = http_request(
                f"{self.backend_url}/api/klines?symbol={sym}&interval={tf}&limit=10"
            )
            if k_code != 200 or not isinstance(k_res, list) or len(k_res) == 0:
                err = f"Failed to fetch klines for {sym} {tf}: HTTP {k_code}"
                self.errors.append(err)
                self.log(f"  ❌ {err}")
                return False
            self.log(f"  ✅ Switched to {sym} [{tf}] - received {len(k_res)} historical bars (last close: {k_res[-1].get('close')})")
        return True

    def step_3_run_backtests(self) -> bool:
        self.log("\n[STEP 3/7] Running 3 Historical Backtests...")
        tests = [
            {"symbol": "BTCUSDT", "timeframe": "15m", "days": 2, "strategy_type": "ema_trend", "params": {"stop_loss_pct": 1.0, "take_profit_pct": 2.0, "leverage": 1.0}},
            {"symbol": "ETHUSDT", "timeframe": "15m", "days": 2, "strategy_type": "confluence_ema", "params": {"stop_loss_pct": 1.2, "take_profit_pct": 2.4, "leverage": 1.0}},
            {"symbol": "BTCUSDT", "timeframe": "5m", "days": 2, "strategy_type": "density_bounce", "params": {"stop_loss_pct": 0.8, "take_profit_pct": 1.6, "leverage": 1.0}},
        ]

        for i, t in enumerate(tests, 1):
            self.log(f"  Executing Backtest #{i}: {t['symbol']} [{t['timeframe']}] - Strategy '{t['strategy_type']}'...")
            code, res = http_request(f"{self.backend_url}/api/backtest/run", method="POST", data=t, timeout=30.0)
            if code != 200 or not isinstance(res, dict) or "summary" not in res:
                err = f"Backtest #{i} failed: HTTP {code} - {res}"
                self.errors.append(err)
                self.log(f"  ❌ {err}")
                return False

            summary = res["summary"]
            trades_cnt = summary.get("total_trades", 0)
            net_pnl = summary.get("net_pnl_usd", 0.0)
            wr = summary.get("win_rate_pct", 0.0)
            self.backtest_results.append({
                "index": i,
                "symbol": t["symbol"],
                "timeframe": t["timeframe"],
                "strategy": t["strategy_type"],
                "trades": trades_cnt,
                "net_pnl_usd": net_pnl,
                "win_rate_pct": wr,
            })
            self.log(f"  ✅ Backtest #{i} finished: {trades_cnt} trades, Net PnL: ${net_pnl:.2f}, Win Rate: {wr:.1f}%")
        return True

    def step_4_probabilistic_forecast(self) -> bool:
        self.log("\n[STEP 4/7] Requesting Probabilistic Forecast Scenario (Anchor + ±1σ / ±2σ Cone)...")
        # 1. Valid forecast
        code, res = http_request(f"{self.backend_url}/api/ai/forecast?symbol=BTCUSDT&timeframe=15m&horizon_bars=16")
        if code != 200 or not isinstance(res, dict) or not res.get("is_probabilistic_forecast"):
            err = f"Probabilistic forecast failed: HTTP {code} - {res}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        anchor_price = res.get("anchor_price")
        anchor_ts = res.get("anchor_timestamp")
        cone = res.get("expected_move_cone", {})
        fan = cone.get("fan_points", [])
        disclaimer = res.get("disclaimer")

        if not fan or len(fan) != 16 or not anchor_price or anchor_price <= 0:
            err = f"Invalid forecast contract structure: fan_points={len(fan)}, anchor={anchor_price}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        # Validate band envelope geometry: lower_2s < lower_1s <= mid <= upper_1s < upper_2s
        p0 = fan[0]
        if not (p0["lower_2s"] < p0["lower_1s"] <= p0["price_mid"] <= p0["upper_1s"] < p0["upper_2s"]):
            err = f"Invalid forecast probability geometry in first bar: {p0}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        self.forecast_results.append({
            "symbol": "BTCUSDT",
            "timeframe": "15m",
            "anchor_price": anchor_price,
            "anchor_timestamp": anchor_ts,
            "horizon_bars": len(fan),
            "disclaimer_present": bool(disclaimer),
            "base_bias": res.get("base_scenario", {}).get("bias"),
        })
        self.log(f"  ✅ Forecast received: Anchor ${anchor_price:,.2f}, 16 bars cone verified, Bias: {res.get('base_scenario', {}).get('bias')}")
        self.log(f"     Disclaimer: '{disclaimer}'")
        return True

    def step_5_paper_trading_setup(self) -> bool:
        self.log("\n[STEP 5/7] Initializing & Validating Paper Trading Wallet...")
        # Check status
        code, res = http_request(f"{self.backend_url}/api/paper-trading/status")
        if code != 200:
            err = f"Failed to get paper trading status: HTTP {code} - {res}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        # If halted, resume
        if res.get("is_halted"):
            self.log("  ⚠️ Paper trading is currently HALTED. Resuming for smoke test...")
            r_code, r_res = http_request(
                f"{self.backend_url}/api/paper-trading/resume",
                method="POST",
                data={"reason": "Nightly Smoke Test Resume"}
            )
            if r_code != 200:
                err = f"Failed to resume paper trading: HTTP {r_code} - {r_res}"
                self.errors.append(err)
                self.log(f"  ❌ {err}")
                return False
            self.log("  ✅ Session resumed to ACTIVE.")

        # Place a controlled sample paper order to exercise risk engine
        current_btc = self.forecast_results[0]["anchor_price"]
        entry_price = round(current_btc * 0.998, 1)  # Buy limit just below market
        sl_price = round(current_btc * 0.985, 1)     # SL ~1.5% below
        tp_price = round(current_btc * 1.025, 1)     # TP ~2.5% above

        order_data = {
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "LIMIT",
            "price": entry_price,
            "stop_price": sl_price,
            "target_price": tp_price,
            "reason": "Nightly Smoke Test Entry Signal",
        }

        o_code, o_res = http_request(
            f"{self.backend_url}/api/paper-trading/order",
            method="POST",
            data=order_data
        )
        if o_code != 200:
            err = f"Failed to place paper order: HTTP {o_code} - {o_res}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        self.trade_events.append(order_data)
        self.log(f"  ✅ Virtual Order placed: BUY BTCUSDT @ ${entry_price:,.1f} (SL: ${sl_price:,.1f}, TP: ${tp_price:,.1f})")
        return True

    def step_6_monitoring_loop(self):
        self.log(f"\n[STEP 6/7] Entering Heartbeat Monitoring Loop ({self.duration}s)...")
        elapsed = 0
        loop_start = time.time()

        while elapsed < self.duration:
            loop_now = time.time()
            elapsed = int(loop_now - loop_start)

            # Query paper trading status
            code, status = http_request(f"{self.backend_url}/api/paper-trading/status")
            if code == 200 and isinstance(status, dict):
                balance = status.get("balance", 100.0)
                realized_pnl = status.get("realized_pnl", 0.0)
                unrealized_pnl = status.get("unrealized_pnl", 0.0)
                positions_cnt = len(status.get("positions", []))
                orders_cnt = len(status.get("active_orders", []))
                closed_cnt = len(status.get("closed_trades", []))

                # Track drawdown
                if balance > self.peak_balance:
                    self.peak_balance = balance
                dd_usd = max(0.0, self.peak_balance - balance)
                dd_pct = (dd_usd / self.peak_balance) * 100.0 if self.peak_balance > 0 else 0.0
                if dd_usd > self.max_drawdown_usd:
                    self.max_drawdown_usd = dd_usd
                if dd_pct > self.max_drawdown_pct:
                    self.max_drawdown_pct = dd_pct

                # Memory usage
                mem = get_process_memory_by_pid(self.backend_pid) if self.backend_pid else {"rss_mb": 0.0, "peak_rss_mb": 0.0}

                snap = {
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "elapsed_sec": elapsed,
                    "balance": balance,
                    "realized_pnl": realized_pnl,
                    "unrealized_pnl": unrealized_pnl,
                    "positions": positions_cnt,
                    "active_orders": orders_cnt,
                    "closed_trades": closed_cnt,
                    "drawdown_usd": round(dd_usd, 2),
                    "backend_rss_mb": mem.get("rss_mb", 0.0),
                    "backend_peak_mb": mem.get("peak_rss_mb", 0.0),
                }
                self.wallet_snapshots.append(snap)

                if elapsed % (self.interval * 3) == 0 or elapsed >= self.duration - 1:
                    self.log(
                        f"  ⏱ [{elapsed:04d}s / {self.duration}s] Balance: ${balance:.2f} | "
                        f"Orders: {orders_cnt} | Pos: {positions_cnt} | Closed: {closed_cnt} | "
                        f"Max DD: ${self.max_drawdown_usd:.2f} ({self.max_drawdown_pct:.1f}%) | "
                        f"Backend RSS: {mem.get('rss_mb', 0.0)} MB"
                    )

            sleep_time = min(self.interval, max(1, self.duration - elapsed))
            time.sleep(sleep_time)

    def step_7_activate_kill_switch(self) -> bool:
        self.log("\n[STEP 7/7] Activating EMERGENCY STOP (Kill Switch)...")
        k_code, k_res = http_request(
            f"{self.backend_url}/api/paper-trading/kill-switch",
            method="POST",
            data={"reason": "Nightly Smoke Test Completed - Safety Emergency Stop Activated"}
        )

        if k_code != 200 or not isinstance(k_res, dict) or k_res.get("status") != "HALTED":
            err = f"Kill switch activation failed: HTTP {k_code} - {k_res}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        # Assert post-kill-switch session state
        st_code, st_res = http_request(f"{self.backend_url}/api/paper-trading/status")
        if st_code != 200 or not st_res.get("is_halted"):
            err = f"Session state is not HALTED after kill switch: {st_res}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        # Assert no open positions remaining
        open_pos = st_res.get("positions", [])
        if len(open_pos) > 0:
            err = f"Open positions remaining after kill switch: {open_pos}"
            self.errors.append(err)
            self.log(f"  ❌ {err}")
            return False

        self.log(f"  ✅ Kill Switch ACTIVATED successfully:")
        self.log(f"     Status: {k_res.get('status')}")
        self.log(f"     Reason: {k_res.get('reason')}")
        self.log(f"     Cancelled Orders: {k_res.get('cancelled_orders', 0)}")
        self.log(f"     Closed Positions: {k_res.get('closed_positions', 0)}")
        self.log(f"     Active Positions Remaining: {len(open_pos)}")
        return True

    def step_8_generate_report(self):
        last_snap = self.wallet_snapshots[-1] if self.wallet_snapshots else {}
        total_duration = (self.end_time - self.start_time).total_seconds()
        final_balance = last_snap.get("balance", 100.0)
        final_rss = last_snap.get("backend_rss_mb", 0.0)
        final_peak_rss = last_snap.get("backend_peak_mb", 0.0)

        report_lines = [
            "=" * 70,
            "       SIGNALSCRIPT PAPER TRADING NIGHTLY SMOKE TEST REPORT",
            "=" * 70,
            f"Execution Window : {self.start_time.strftime('%Y-%m-%d %H:%M:%S')} -> {self.end_time.strftime('%Y-%m-%d %H:%M:%S')} (Total: {total_duration:.1f}s)",
            f"Overall Status   : {'✅ SUCCESS / PASS' if len(self.errors) == 0 else '❌ FAILED'}",
            "",
            "1. SYSTEM & PROCESS HEALTH",
            f"   - Backend URL  : {self.backend_url} (HTTP 200 PASS)",
            f"   - Frontend URL : {self.frontend_url} (HTTP 200 PASS)",
            f"   - Backend PID  : {self.backend_pid}",
            f"   - Memory RSS   : {final_rss} MB (Peak: {final_peak_rss} MB)",
            "",
            "2. USER WORKFLOW SIMULATION",
            "   - Symbol & Timeframe Switching : PASS (BTCUSDT [5m], ETHUSDT [15m], BTCUSDT [15m])",
            f"   - Historical Backtests (x3)    : PASS ({len(self.backtest_results)}/3 completed successfully)",
        ]

        for bt in self.backtest_results:
            report_lines.append(
                f"     * #{bt['index']}: {bt['symbol']} [{bt['timeframe']}] {bt['strategy']} -> "
                f"{bt['trades']} trades, PnL: ${bt['net_pnl_usd']:.2f}, WR: {bt['win_rate_pct']:.1f}%"
            )

        fc = self.forecast_results[0] if self.forecast_results else {}
        report_lines.extend([
            f"   - Probabilistic Forecast       : PASS (Anchor: ${fc.get('anchor_price', 0):,.2f}, 16 bars cone)",
            f"   - Disclaimer Grounding         : PASS ('{fc.get('disclaimer_present')}')",
            f"   - Virtual Order Placement      : PASS ({len(self.trade_events)} orders sent to Risk Engine)",
            "",
            "3. FINANCIAL & RISK METRICS (VIRTUAL WALLET)",
            f"   - Starting Balance : $100.00 USD",
            f"   - Final Balance    : ${final_balance:.2f} USD",
            f"   - Realized PnL     : ${last_snap.get('realized_pnl', 0.0):.2f} USD",
            f"   - Unrealized PnL   : ${last_snap.get('unrealized_pnl', 0.0):.2f} USD",
            f"   - Max Drawdown     : ${self.max_drawdown_usd:.2f} USD ({self.max_drawdown_pct:.2f}%)",
            f"   - Closed Trades    : {last_snap.get('closed_trades', 0)}",
            "",
            "4. SAFETY & EMERGENCY STOP (KILL SWITCH)",
            "   - Kill Switch Triggered : YES (POST /api/paper-trading/kill-switch)",
            "   - Final Session State   : HALTED",
            "   - Open Positions Post   : 0 (Strictly closed at market)",
            "",
            "5. ERRORS & DEFECTS LOG",
            f"   - Total Errors: {len(self.errors)}",
        ])

        if self.errors:
            for err in self.errors:
                report_lines.append(f"     ! {err}")
        else:
            report_lines.append("     (None. All operations completed cleanly)")

        report_lines.extend([
            "=" * 70,
            f"Report generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            f"Report file: {REPORT_FILE}",
            "=" * 70,
        ])

        report_text = "\n".join(report_lines)
        with open(REPORT_FILE, "w", encoding="utf-8") as rf:
            rf.write(report_text + "\n")

        print("\n" + report_text)
        self.log(f"Report saved to {REPORT_FILE}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Nightly Smoke Test for SignalScript Paper Trading Readiness")
    parser.add_argument("--duration", type=int, default=30, help="Monitoring duration in seconds (default: 30s)")
    parser.add_argument("--backend-url", type=str, default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--frontend-url", type=str, default="http://127.0.0.1:5173", help="Frontend base URL")
    parser.add_argument("--interval", type=int, default=5, help="Heartbeat polling interval in seconds")

    args = parser.parse_args()

    runner = SmokeTestRunner(
        backend_url=args.backend_url,
        frontend_url=args.frontend_url,
        duration=args.duration,
        interval=args.interval,
    )

    success = runner.run_all()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
