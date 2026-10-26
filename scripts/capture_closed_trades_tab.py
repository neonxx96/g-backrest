"""
Captures screenshot of the Trade History Widget's closed trades tab.
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

OUTPUT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\72a830ab-8fb5-4fb2-8267-c1a8a4795da5"
OUT_IMG = os.path.join(OUTPUT_DIR, "terminal_durable_closed_trades.png")

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        page = await context.new_page()

        print("Navigating to http://localhost:7100/...")
        await page.goto("http://localhost:7100/", wait_until="networkidle", timeout=30000)
        await asyncio.sleep(4)

        # Ensure Trade History Widget is visible and click tab 'trades' if not already active
        tab_btn = page.locator("button:has-text('Закрытые сделки')").first
        if await tab_btn.count() > 0:
            print("Clicking 'Закрытые сделки' tab...")
            await tab_btn.click()
            await asyncio.sleep(2)

        # Capture screenshot
        await page.screenshot(path=OUT_IMG)
        print(f"Captured screen closed trades to: {OUT_IMG}")

        # Check table rows count
        rows = page.locator("table tbody tr")
        cnt = await rows.count()
        print(f"Total rows rendered in table: {cnt}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
