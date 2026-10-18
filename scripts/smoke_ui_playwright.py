"""
SignalScript UI smoke test on Playwright (Python).

Two parts, per the task specification:

1. BLOCKING part (`--part blocking`, exit code 1 on failure):
   - the terminal page opens;
   - chart canvas and order-book canvas are present;
   - no console errors (network/Binance failures are tolerated);
   - no uncaught page errors;
   - switching the symbol works.
   The part must not depend on Binance availability: with no network the UI may
   honestly show `disconnected`, but the page must not crash.

2. LIVE part (`--part live`, never blocks, warnings only, always exit 0):
   - a Binance WebSocket reaches the `connected` state and frames (prints) arrive.

The script is self-contained: if the local backend (8000) or frontend (5173) is
not responding, it starts them itself and shuts them down afterwards (only the
processes it started itself). Existing dev servers are reused, never killed.

Usage:
    .venv\\Scripts\\python.exe scripts/smoke_ui_playwright.py --part blocking
    .venv\\Scripts\\python.exe scripts/smoke_ui_playwright.py --part live
    .venv\\Scripts\\python.exe scripts/smoke_ui_playwright.py --part all
"""

import argparse
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_URL = "http://127.0.0.1:8000"
FRONTEND_URL = "http://127.0.0.1:5173"
BACKEND_PROBE = f"{BACKEND_URL}/api/settings?user_id=0"

BACKEND_START_TIMEOUT = 90
FRONTEND_START_TIMEOUT = 150
UI_RENDER_TIMEOUT_MS = 45000
LIVE_WS_TIMEOUT_SEC = 40

# Console messages caused by an unreachable exchange / offline mode are tolerated:
# the UI is required to degrade honestly (status "disconnected"), not to crash.
TOLERATED_CONSOLE_PATTERNS = [
    r"net::ERR",
    r"ERR_NAME_NOT_RESOLVED",
    r"ERR_INTERNET_DISCONNECTED",
    r"Failed to load resource",
    r"Failed to fetch",
    r"WebSocket",
    r"websocket",
    r"Connection closed",
    r"NetworkError",
]

SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,15}USDT$")

_started_procs: list = []


def log(msg: str) -> None:
    print(msg, flush=True)


def _probe(url: str, timeout: float = 2.0) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SmokeUI/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 500
    except urllib.error.HTTPError:
        return True  # server answers (even 4xx) => it is up
    except Exception:
        return False


def _wait_for(url: str, timeout_sec: int, label: str) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if _probe(url):
            return True
        time.sleep(2.0)
    log(f"[WARN] {label} did not become ready within {timeout_sec}s")
    return False


def _spawn(cmd: list, cwd: Path) -> subprocess.Popen:
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    _started_procs.append(proc)
    return proc


def ensure_servers() -> None:
    """Start local dev servers if they are not already running."""
    if _probe(BACKEND_PROBE):
        log("[INFO] Backend already running on :8000 (reused).")
    else:
        python_exe = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
        if not python_exe.exists():
            python_exe = Path(sys.executable)
        log(f"[INFO] Starting backend: {python_exe.name} backend/main.py")
        _spawn([str(python_exe), "backend/main.py"], PROJECT_ROOT)
        _wait_for(BACKEND_PROBE, BACKEND_START_TIMEOUT, "Backend :8000")

    if _probe(FRONTEND_URL):
        log("[INFO] Frontend already running on :5173 (reused).")
    else:
        log("[INFO] Starting frontend: npm run dev -- --host 127.0.0.1 --port 5173")
        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        _spawn([npm_cmd, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
               PROJECT_ROOT / "frontend")
        _wait_for(FRONTEND_URL, FRONTEND_START_TIMEOUT, "Frontend :5173")


def shutdown_servers() -> None:
    """Stop only the servers this script started."""
    for proc in _started_procs:
        if proc.poll() is not None:
            continue
        log(f"[INFO] Stopping dev server pid={proc.pid} (started by this smoke test)")
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                proc.terminate()
        except Exception as exc:  # pragma: no cover - best effort cleanup
            log(f"[WARN] Could not stop pid={proc.pid}: {exc}")
    _started_procs.clear()


def run_live_part() -> None:
    from playwright.sync_api import sync_playwright

    sockets = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        def on_ws(ws):
            entry = {"url": ws.url, "frames": 0}
            sockets.append(entry)
            ws.on("framereceived", lambda _payload: entry.update(frames=entry["frames"] + 1))

        page.on("websocket", on_ws)

        try:
            page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception as exc:
            log(f"[WARN] LIVE check: page did not open: {exc}")

        # Wait until the terminal is actually mounted (canvas attached) before
        # judging the exchange streams - a cold Vite dev server needs a moment.
        try:
            page.wait_for_selector('[data-testid="orderbook-canvas-ladder"]',
                                   state="attached", timeout=UI_RENDER_TIMEOUT_MS)
        except Exception as exc:
            log(f"[WARN] LIVE check: terminal UI did not mount in time: {exc}")

        log(f"[LIVE] Waiting up to {LIVE_WS_TIMEOUT_SEC}s for Binance WebSocket frames ...")
        deadline = time.time() + LIVE_WS_TIMEOUT_SEC
        while time.time() < deadline:
            if any(s["frames"] > 0 and "binance" in s["url"] for s in sockets):
                break
            time.sleep(1.0)
            try:
                # Keep the headless page "active" so Chromium does not throttle
                # timers / WebSocket handshakes in an idle background tab.
                page.evaluate("() => document.hasFocus()")
            except Exception:
                pass

        binance_sockets = [s for s in sockets if "binance" in s["url"]]
        with_frames = [s for s in binance_sockets if s["frames"] > 0]
        log(f"       websockets opened: {len(sockets)} (binance: {len(binance_sockets)}), "
            f"with frames: {len(with_frames)}")
        for s in binance_sockets:
            stream = s["url"].split("/ws/")[-1][:40]
            log(f"       [ws] frames={s['frames']:5d} stream={stream}")

        try:
            chart_candles = page.evaluate(
                """() => (window.__chart && window.__chart.getDataList)
                        ? window.__chart.getDataList().length : null"""
            )
        except Exception:
            chart_candles = None
        log(f"       chart candles loaded: {chart_candles}")

        browser.close()

    if with_frames:
        log("\n[OK] LIVE UI check passed: Binance WebSocket is connected and prints are arriving.")
    else:
        log("\n[WARN] LIVE UI check: no Binance WebSocket frames (exchange unreachable or offline). "
            "Not blocking the commit - the UI degrades to 'disconnected' by design.")


def main() -> int:
    parser = argparse.ArgumentParser(description="SignalScript Playwright UI smoke test")
    parser.add_argument("--part", choices=["blocking", "live", "all"], default="all")
    parser.add_argument("--no-autostart", action="store_true",
                        help="Do not start dev servers automatically")
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    log("--- SignalScript UI Smoke (Playwright) ---")

    console_errors: list = []
    page_errors: list = []
    ok = True

    try:
        if not args.no_autostart:
            ensure_servers()

        if args.part in ("blocking", "all"):
            ok = run_blocking_part(console_errors, page_errors)

        if args.part in ("live", "all"):
            run_live_part()
    except Exception as exc:
        log(f"[FAIL] UI smoke crashed: {exc}")
        ok = False
    finally:
        shutdown_servers()

    return 0 if ok else 1


def _tolerated(text: str) -> bool:
    return any(re.search(pattern, text) for pattern in TOLERATED_CONSOLE_PATTERNS)


def _ladder_rect(page):
    return page.evaluate(
        """() => {
            const c = document.querySelector('[data-testid="orderbook-canvas-ladder"]');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
        }"""
    )


def _ensure_orderbook_visible(page, min_w: int = 100, min_h: int = 40):
    """Make sure the order-book widget is really on screen (not a collapsed strip)."""
    rect = _ladder_rect(page)
    if rect and rect["w"] >= min_w and rect["h"] >= min_h:
        return rect

    log("      order-book canvas is collapsed - opening the DOM widget via the widgets menu ...")
    try:
        page.click('[data-testid="widgets-menu-button"]', timeout=5000)
        active = page.evaluate(
            """() => {
                const btn = document.querySelector('[data-testid="widget-toggle-dom"]');
                if (!btn) return null;
                const badge = btn.querySelector('span:last-child');
                return badge ? badge.className.includes('2563eb') : null;
            }"""
        )
        log(f"      DOM widget active flag: {active}")
        if active is False:
            page.click('[data-testid="widget-toggle-dom"]', timeout=5000)
        # close the dropdown again (click the menu button)
        try:
            page.click('[data-testid="widgets-menu-button"]', timeout=3000)
        except Exception:
            pass
    except Exception as exc:
        log(f"      [WARN] could not open the DOM widget: {exc}")

    deadline = time.time() + 20
    while time.time() < deadline:
        rect = _ladder_rect(page)
        if rect and rect["w"] >= min_w and rect["h"] >= min_h:
            return rect
        time.sleep(0.5)
    return rect


def _collect_header_symbol(page) -> str:
    return page.evaluate(
        """() => {
            const spans = Array.from(document.querySelectorAll('header span'));
            const hit = spans.map(s => (s.textContent || '').trim())
                             .filter(t => /^[A-Z0-9]{2,15}USDT$/.test(t));
            return hit.length ? hit[0] : '';
        }"""
    )


def run_blocking_part(console_errors: list, page_errors: list) -> bool:
    from playwright.sync_api import sync_playwright

    failures = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        log(f"[1/4] Opening {FRONTEND_URL} ...")
        try:
            page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception as exc:
            failures.append(f"page did not open: {exc}")

        log("[2/4] Waiting for chart and order-book canvases ...")
        try:
            page.wait_for_selector('[data-testid="orderbook-canvas-ladder"]',
                                   timeout=UI_RENDER_TIMEOUT_MS)
        except Exception as exc:
            failures.append(f"order-book canvas not found: {exc}")

        canvas_report = page.evaluate(
            """() => {
                const ladder = document.querySelector('[data-testid="orderbook-canvas-ladder"]');
                const containers = Array.from(document.querySelectorAll('div.w-full.h-full'));
                let chartCanvas = false;
                let chartRect = null;
                for (const d of containers) {
                    const c = d.querySelector('canvas');
                    if (c) {
                        chartCanvas = true;
                        const r = c.getBoundingClientRect();
                        chartRect = { w: Math.round(r.width), h: Math.round(r.height) };
                        break;
                    }
                }
                return {
                    total_canvases: document.querySelectorAll('canvas').length,
                    chart_container_canvas: chartCanvas,
                    chart_rect: chartRect,
                    chart_instance: !!window.__chart,
                    chart_api: !!(window.__chart && typeof window.__chart.getDataList === 'function'),
                    ladder_present: !!ladder,
                    ladder_size: ladder ? `${ladder.width}x${ladder.height}` : 'n/a',
                    ladder_rect: ladder ? (() => {
                        const r = ladder.getBoundingClientRect();
                        return { w: Math.round(r.width), h: Math.round(r.height) };
                    })() : null,
                };
            }"""
        )
        log(f"      canvas report: {canvas_report}")
        if not canvas_report["chart_container_canvas"]:
            failures.append("chart canvas is not rendered in the chart container")
        if not canvas_report["chart_api"]:
            failures.append("KLineCharts instance (window.__chart) is missing")
        chart_rect = canvas_report.get("chart_rect")
        if not chart_rect or chart_rect["w"] < 200 or chart_rect["h"] < 150:
            failures.append(f"chart canvas is not really rendered: {chart_rect}")
        if not canvas_report["ladder_present"]:
            failures.append("order-book ladder canvas element is missing")

        log("[2b/4] Ensuring the order-book widget is actually visible ...")
        ladder_rect = _ensure_orderbook_visible(page)
        log(f"      order-book canvas rect: {ladder_rect}")
        if not ladder_rect:
            failures.append("order-book ladder canvas is missing after opening the DOM widget")
        elif ladder_rect["w"] < 100 or ladder_rect["h"] < 40:
            failures.append(f"order-book ladder canvas is not really rendered: {ladder_rect}")

        log("[3/4] Switching symbol (ArrowDown) ...")
        symbol_before = _collect_header_symbol(page)
        page.keyboard.press("ArrowDown")
        symbol_after = ""
        deadline = time.time() + 15
        while time.time() < deadline:
            time.sleep(0.5)
            symbol_after = _collect_header_symbol(page)
            if symbol_after and symbol_after != symbol_before:
                break
        log(f"      symbol: '{symbol_before}' -> '{symbol_after}'")
        if not symbol_before:
            failures.append("active symbol was not found in the header")
        elif symbol_before == symbol_after:
            failures.append(f"symbol did not change after ArrowDown (still '{symbol_after}')")

        log("[4/4] Checking console/page errors ...")
        browser.close()

    real_errors = [e for e in console_errors if not _tolerated(e)]
    log(f"      console errors: {len(console_errors)} total, {len(real_errors)} non-network")
    for err in real_errors[:10]:
        log(f"      [console error] {err[:200]}")
    for err in page_errors[:10]:
        log(f"      [page error] {err[:200]}")
    if real_errors:
        failures.append(f"{len(real_errors)} console error(s) that are not network-related")
    if page_errors:
        failures.append(f"{len(page_errors)} uncaught page error(s)")

    if failures:
        log("\n[FAIL] BLOCKING UI smoke failed:")
        for item in failures:
            log(f"  - {item}")
        return False

    log("\n[OK] BLOCKING UI smoke passed (page opened, both canvases present, "
        "no console/page errors, symbol switch works).")
    return True


if __name__ == "__main__":
    sys.exit(main())

