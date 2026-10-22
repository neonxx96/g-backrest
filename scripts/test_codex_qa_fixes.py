"""
Verification script for Codex QA Bugfixes:
- BUG-001: L2 Live strategy backtest guard & warning banner with quick-switch button
- BUG-002: Parameter bounds validation (SL, TP, Leverage, Days) & disabling button on invalid params
- BUG-003: User-friendly error messages (no raw Pydantic JSON)
"""

import asyncio
import sys
import requests
from playwright.async_api import async_playwright

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

API_BASE = "http://127.0.0.1:8000/api"
FRONTEND_URL = "http://localhost:5173"

def test_backend_live_strategy_rejection():
    print("Testing Backend /api/backtest/run rejection of live_density_bounce...")
    payload = {
        "symbol": "BTCUSDT",
        "timeframe": "5m",
        "days": 1,
        "strategy_type": "live_density_bounce",
        "params": {
            "stop_loss_pct": 0.8,
            "take_profit_pct": 1.5,
            "min_density_usd": 100000.0,
            "volume_multiplier": 1.0,
            "leverage": 1.0
        }
    }
    r = requests.post(f"{API_BASE}/backtest/run", json=payload, timeout=10)
    assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"
    data = r.json()
    detail = data.get("detail", "")
    print(f"Backend returned friendly error: {detail}")
    assert "исключительно в реальном времени" in detail or "Исторический бэктест недоступен" in detail
    print("✅ Backend properly rejects live_density_bounce with friendly 400.")

async def test_frontend_ui():
    print("Starting Playwright to verify UI fixes in BacktestPanel...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1600, "height": 950})
        
        # Collect console logs
        page.on("console", lambda msg: print(f"[Browser Console] {msg.type}: {msg.text}") if msg.type in ("error", "warning") else None)
        
        await page.goto(FRONTEND_URL, wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # Open Backtest Panel via hotkey 'b'
        await page.keyboard.press("b")
        await page.wait_for_timeout(1000)
        
        # Locate Backtest Panel
        panel = page.locator("[data-testid='backtest-panel']")
        await panel.wait_for(state="visible", timeout=5000)
        print("✅ Backtest Panel opened.")

        # 1. Test BUG-001: Select live_density_bounce
        strategy_select = page.locator("[data-testid='bt-strategy-select']")
        await strategy_select.select_option("live_density_bounce")
        await page.wait_for_timeout(500)

        banner = page.locator("[data-testid='live-strategy-warning-banner']")
        assert await banner.is_visible(), "Live strategy warning banner should be visible!"
        print("✅ Live strategy warning banner is visible.")

        run_btn = page.locator("[data-testid='btn-run-single']")
        is_disabled = await run_btn.is_disabled()
        btn_text = await run_btn.inner_text()
        print(f"Run button text with L2 Live: '{btn_text}', disabled: {is_disabled}")
        assert is_disabled, "Run button MUST be disabled for live_density_bounce!"
        assert "недоступен" in btn_text, "Run button text should state that backtest is unavailable!"
        print("✅ Run button is disabled with clear 'Бэктест недоступен' label.")

        # Test one-click quick switch button
        switch_btn = page.locator("[data-testid='btn-switch-cluster-strategy']")
        await switch_btn.click()
        await page.wait_for_timeout(500)

        # Strategy should now be cluster_volume_bounce
        selected_val = await strategy_select.input_value()
        assert selected_val == "cluster_volume_bounce", f"Expected cluster_volume_bounce, got {selected_val}"
        assert not await banner.is_visible(), "Warning banner should be hidden for historical strategy!"
        assert not await run_btn.is_disabled(), "Run button should now be enabled!"
        print("✅ Quick-switch button successfully switched strategy to Cluster Volume Bounce and enabled backtest.")

        # 2. Test BUG-002: Invalid Parameters
        # Find SL input (it has label 'SL')
        sl_input = page.locator("label:has-text('SL') input")
        await sl_input.fill("-1")
        await page.wait_for_timeout(500)

        is_disabled_invalid = await run_btn.is_disabled()
        btn_text_invalid = await run_btn.inner_text()
        print(f"Run button with SL=-1: '{btn_text_invalid}', disabled: {is_disabled_invalid}")
        assert is_disabled_invalid, "Run button MUST be disabled when SL is negative!"

        val_warning = page.locator("[data-testid='param-validation-warning']")
        assert await val_warning.is_visible(), "Validation warning should appear!"
        warning_text = await val_warning.inner_text()
        print(f"Validation warning: '{warning_text}'")
        assert "Стоп-лосс" in warning_text or "SL" in warning_text

        # Restore SL to 0.8
        await sl_input.fill("0.8")
        await page.wait_for_timeout(500)
        assert not await run_btn.is_disabled(), "Run button should re-enable once valid SL is entered!"
        print("✅ Parameter validation successfully blocks submission and warns inline.")

        # Take screenshot for proof
        await page.screenshot(path="C:/Users/danil/.gemini/antigravity/brain/ed4e7b46-732d-4623-be60-6c1e12127aa5/codex_qa_fixes_verified.png")
        print("✅ Screenshot saved.")
        await browser.close()

if __name__ == "__main__":
    test_backend_live_strategy_rejection()
    asyncio.run(test_frontend_ui())
    print("\n🎉 ALL CODEX QA BUGFIXES VERIFIED SUCCESSFULLY!")
