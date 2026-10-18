"""
UI Headless Browser Snapshot & Console Error Validator
Takes a screenshot of the live terminal UI, checks for React or WebSocket errors,
and saves the screenshot directly to the Antigravity conversation artifact directory.
"""

import sys
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ARTIFACT_DIR = Path(r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5")
SCREENSHOT_PATH = ARTIFACT_DIR / "overnight_ui_snapshot_01.png"

async def inspect_ui():
    console_errors = []
    page_errors = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        print("Navigating to http://localhost:5173/ ...")
        await page.goto("http://localhost:5173/", wait_until="networkidle", timeout=15000)

        # Allow initial React rendering and WebSocket connections to settle
        await asyncio.sleep(3)

        # Ensure TradeHistoryWidget or Dockview is rendered
        await page.wait_for_selector("[data-testid='terminal-dockview-container']", timeout=10000)

        # Take screenshot
        await page.screenshot(path=str(SCREENSHOT_PATH))
        print(f"Screenshot saved to: {SCREENSHOT_PATH}")

        await browser.close()

    # Filter out ignorable network errors (e.g. adblock or external failed CDN if any)
    critical_errors = [
        err for err in console_errors + page_errors
        if not any(ign in err.lower() for ign in ["failed to fetch", "net::err", "favicon"])
    ]

    print(f"Console errors total: {len(console_errors)}, Page errors: {len(page_errors)}, Critical: {len(critical_errors)}")
    if critical_errors:
        print("[WARNING] Critical frontend errors detected:")
        for e in critical_errors:
            print(f"  - {e}")
    else:
        print("[OK] UI is healthy: 0 critical console/page errors.")

    return len(critical_errors) == 0

if __name__ == "__main__":
    ok = asyncio.run(inspect_ui())
    sys.exit(0 if ok else 1)
