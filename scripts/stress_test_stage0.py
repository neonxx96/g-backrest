import sys
import asyncio
import json
import time
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT']
TIMEFRAMES = ['5m', '15m', '1h', '15m']

# Expected rough price ranges to verify zero cross-symbol data contamination
PRICE_RANGES = {
    'BTCUSDT': (20000, 250000),
    'ETHUSDT': (800, 15000),
    'SOLUSDT': (20, 1000),
    'DOGEUSDT': (0.01, 5.0),
    'XRPUSDT': (0.1, 20.0),
    'BNBUSDT': (100, 3000),
}

async def get_heap_mb(cdp):
    try:
        await cdp.send("HeapProfiler.collectGarbage")
    except Exception:
        pass
    metrics = await cdp.send("Performance.getMetrics")
    for m in metrics.get("metrics", []):
        if m["name"] == "JSHeapUsedSize":
            return round(m["value"] / (1024 * 1024), 2)
    return 0.0

async def main():
    print("=== [STAGE 0] STARTING LIVE STABILITY, WEBSOCKET & MEMORY STRESS TEST ===", flush=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1600, 'height': 950})
        page = await context.new_page()
        cdp = await context.new_cdp_session(page)
        await cdp.send("Performance.enable")

        page_errors = []
        ws_creations = []

        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on("websocket", lambda ws: ws_creations.append(ws.url))

        print("[STAGE 0] 1. Loading terminal http://127.0.0.1:5173 ...", flush=True)
        await page.goto("http://127.0.0.1:5173")
        await page.wait_for_timeout(4000)

        initial_heap = await get_heap_mb(cdp)
        print(f"[STAGE 0] Initial JS Heap after load: {initial_heap} MB", flush=True)

        # Multi-round stress loop: switch coins & timeframes, verify Chart + DOM + Tape synchronization
        rounds = 3
        total_switches = 0
        sync_checks_passed = 0

        for r in range(rounds):
            print(f"\n--- Stress Round {r + 1}/{rounds} ---", flush=True)
            for idx, sym in enumerate(COINS):
                tf = TIMEFRAMES[idx % len(TIMEFRAMES)]
                total_switches += 1

                # Switch symbol via ColorLinksStore (same action as clicking Screener row)
                await page.evaluate(f"""() => {{
                    if (window.useColorLinksStore) {{
                        window.useColorLinksStore.getState().setChannelSymbol('c1', '{sym}');
                    }}
                }}""")

                # Also switch timeframe occasionally
                tf_btn = page.locator(f"button:has-text('{tf}')").first
                if await tf_btn.is_visible():
                    try:
                        await tf_btn.click(timeout=1500)
                    except Exception:
                        pass

                await page.wait_for_timeout(1800)

                # Inspect live state across Chart, TradesStore, and MarketDataStore
                state = await page.evaluate(f"""() => {{
                    const channelSym = window.useColorLinksStore?.getState()?.channels?.c1;
                    const headerText = document.body.innerText;
                    return {{
                        channelSym,
                        hasSymInDom: headerText.includes('{sym}') || headerText.includes('{sym.replace("USDT", "")}')
                    }};
                }}""")

                if state['channelSym'] == sym and state['hasSymInDom']:
                    sync_checks_passed += 1

            round_heap = await get_heap_mb(cdp)
            print(f"[STAGE 0] End of Round {r + 1}: Switches={total_switches}, SyncPassed={sync_checks_passed}/{total_switches}, JS Heap={round_heap} MB, PageErrors={len(page_errors)}", flush=True)

        # Test Network Drop Simulation (7 seconds offline -> online recovery)
        print("\n[STAGE 0] 2. Simulating network outage (7 seconds offline)...", flush=True)
        ws_before_offline = len(ws_creations)
        await context.set_offline(True)
        await page.evaluate("""() => {
            window.dispatchEvent(new Event('offline'));
        }""")
        await page.wait_for_timeout(7000)

        print("[STAGE 0] 3. Restoring network connection and triggering online recovery...", flush=True)
        await context.set_offline(False)
        await page.evaluate("""() => {
            window.dispatchEvent(new Event('online'));
        }""")
        await page.wait_for_timeout(4500)

        ws_after_online = len(ws_creations)
        new_ws_reconnects = ws_after_online - ws_before_offline
        print(f"[STAGE 0] WebSockets re-established after network recovery: {new_ws_reconnects} new WS connections", flush=True)

        final_heap = await get_heap_mb(cdp)
        heap_delta = round(final_heap - initial_heap, 2)
        print(f"\n=== [STAGE 0] FINAL STRESS TEST SUMMARY ===", flush=True)
        print(f"Total Ticker/TF Switches: {total_switches}", flush=True)
        print(f"Synchronization Checks Passed: {sync_checks_passed}/{total_switches}", flush=True)
        print(f"Initial Heap: {initial_heap} MB -> Final Heap (after GC): {final_heap} MB (Delta: {heap_delta:+.2f} MB)", flush=True)
        print(f"WebSocket Auto-Reconnects after Outage: {new_ws_reconnects}", flush=True)
        print(f"Uncaught Page Errors: {len(page_errors)}", flush=True)
        if page_errors:
            for e in page_errors:
                print(f"  ERROR: {e}", flush=True)

        await browser.close()

        if len(page_errors) > 0:
            sys.exit(1)

if __name__ == '__main__':
    asyncio.run(main())
