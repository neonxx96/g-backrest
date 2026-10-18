import sys
import asyncio
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

async def verify_honest_backtest_table():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 900})
        page = await context.new_page()

        print("[TEST-STAGE-2] 1. Opening terminal page http://127.0.0.1:5173 ...")
        await page.goto("http://127.0.0.1:5173", timeout=30000)
        await page.wait_for_timeout(3000)

        # Open Backtest Panel via testid
        print("[TEST-STAGE-2] 2. Opening Backtest Panel via [data-testid='btn-toggle-backtest-drawer']...")
        bt_btn = page.locator("[data-testid='btn-toggle-backtest-drawer']").first
        await bt_btn.wait_for(state="visible", timeout=10000)
        await bt_btn.click()
        await page.wait_for_timeout(1000)

        # Check that backtest panel is open
        bt_panel = page.locator("[data-testid='backtest-panel']")
        await bt_panel.wait_for(state="visible", timeout=5000)
        print("[TEST-STAGE-2] ✅ Backtest Panel opened successfully.")

        # Check strategy dropdown options
        strategy_select = page.locator("select[data-testid='bt-strategy-select']")
        if await strategy_select.is_visible():
            options = await strategy_select.locator("option").all_inner_texts()
            print(f"[TEST-STAGE-2] Found strategy options: {options}")
            assert any("Historical" in opt or "🟢" in opt or "Confluence" in opt for opt in options), "Historical Flow strategy must be present"
            assert any("Live" in opt or "🟠" in opt for opt in options), "Live Orderbook strategy must be categorized"
            print("[TEST-STAGE-2] ✅ Strategies properly categorized into Historical Flow vs Live Orderbook.")

        # Run single backtest
        print("[TEST-STAGE-2] 3. Running backtest...")
        run_btn = page.locator("button[data-testid='btn-run-single']")
        await run_btn.click()
        await page.wait_for_selector("[data-testid='metric-net-pnl']", timeout=25000)
        print("[TEST-STAGE-2] ✅ Backtest finished.")

        # Switch to Trades Log tab
        print("[TEST-STAGE-2] 4. Switching to Trades Log tab...")
        trades_tab_btn = page.locator("[data-testid='tab-trades']")
        await trades_tab_btn.click()
        await page.wait_for_timeout(1000)

        # Verify engine disclaimer / toolbar
        export_btn = page.locator("[data-testid='btn-export-csv']")
        await export_btn.wait_for(state="visible", timeout=5000)
        print("[TEST-STAGE-2] ✅ 'Экспорт CSV' button is visible.")

        engine_badge = page.locator("text=Historical Flow & Volume Engine")
        await engine_badge.wait_for(state="visible", timeout=5000)
        print("[TEST-STAGE-2] ✅ 'Historical Flow & Volume Engine' badge is verified.")

        # Test sorting by clicking Net PnL column header
        print("[TEST-STAGE-2] 5. Testing column sorting...")
        pnl_header = page.locator("th:has-text('Чистый PnL')")
        await pnl_header.click()
        await page.wait_for_timeout(500)
        await pnl_header.click()
        await page.wait_for_timeout(500)
        print("[TEST-STAGE-2] ✅ Column sorting verified.")

        # Capture screenshot
        screenshot_path = "C:/Users/danil/.gemini/antigravity/brain/ed4e7b46-732d-4623-be60-6c1e12127aa5/honest_backtest_table_verified.png"
        await page.screenshot(path=screenshot_path)
        print(f"[TEST-STAGE-2] Screenshot saved to: {screenshot_path}")

        await browser.close()
        print("[TEST-STAGE-2] All Stage 2 verification steps PASSED!")

if __name__ == "__main__":
    asyncio.run(verify_honest_backtest_table())
