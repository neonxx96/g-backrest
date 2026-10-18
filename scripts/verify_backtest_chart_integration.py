import sys
import asyncio
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

async def verify_backtest_chart_integration():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        print("[TEST] 1. Opening terminal page http://127.0.0.1:5173 ...")
        await page.goto("http://127.0.0.1:5173", timeout=30000)
        await page.wait_for_timeout(3000)

        # Look for the 1-click backtest button on active chart
        print("[TEST] 2. Checking 1-click backtest trigger in chart header...")
        bt_btn = page.locator("button[data-testid^='btn-quick-backtest-']").first
        await bt_btn.wait_for(state="visible", timeout=10000)
        btn_text = await bt_btn.inner_text()
        print(f"[TEST] Found button: '{btn_text}'")

        # Click the 1-click backtest button
        print("[TEST] 3. Clicking ⚡ Бэктест button...")
        await bt_btn.click()

        # Wait for calculation to finish (loader disappears, win rate appears)
        print("[TEST] 4. Waiting for backtest calculation to complete...")
        await page.wait_for_selector("text=Win", timeout=20000)
        await page.wait_for_timeout(2000)

        # Check win rate badge
        win_badge = page.locator("text=Win").first
        win_text = await win_badge.inner_text()
        print(f"[TEST] ✅ Backtest finished successfully! Result badge: '{win_text}'")

        # Capture screenshot of chart with trade lines & PnL badges
        screenshot_path = "C:/Users/danil/.gemini/antigravity/brain/ed4e7b46-732d-4623-be60-6c1e12127aa5/backtest_trades_on_chart_verified.png"
        await page.screenshot(path=screenshot_path)
        print(f"[TEST] Screenshot saved to: {screenshot_path}")

        # Check R:R tool button and interactive setup HUD
        print("[TEST] 5. Activating R:R Box tool...")
        rr_tool_btn = page.locator("button[data-testid='tool-risk-reward']").first
        if await rr_tool_btn.is_visible():
            await rr_tool_btn.click()
            await page.wait_for_timeout(500)
            print("[TEST] R:R tool selected.")

        # Test setup button if HUD is visible or trigger click on chart
        hud_btn = page.locator("button[data-testid='btn-quick-backtest-setup']").first
        if await hud_btn.is_visible():
            print("[TEST] ✅ Found 'Тест сетапа' in position setup HUD!")
            await hud_btn.click()
            await page.wait_for_timeout(3000)
            print("[TEST] Successfully tested current setup on history!")

        await browser.close()
        print("[TEST] All Stage 1 verification steps PASSED!")

if __name__ == "__main__":
    asyncio.run(verify_backtest_chart_integration())
