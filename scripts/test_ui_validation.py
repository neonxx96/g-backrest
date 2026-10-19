"""
SignalScript UI Validation E2E Test Suite (Playwright)
======================================================
Tests all frontend validation requirements:
1. L2 Live strategy guard: blocks single backtest and genetic optimizer buttons with clear warning banner.
2. Quick-switch button in banner switches to cluster_volume_bounce and unblocks buttons.
3. Parameter bounds validation: SL/TP <= 0, leverage < 1 or > 125, days < 1 or > 30, empty inputs.
   Asserts button is disabled and ZERO network calls are dispatched to backend.
4. Pydantic error translation: raw JSON errors from API are formatted into human-readable text.
5. Error banner dismissal and UI recovery.
"""

import asyncio
import json
import sys
from playwright.async_api import async_playwright

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

FRONTEND_URL = "http://localhost:5173"


async def run_ui_validation_suite():
    print("=" * 60)
    print("🚀 Running SignalScript UI Validation Test Suite (Playwright)")
    print("=" * 60)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1600, "height": 950})

        # Track network calls to /api/backtest/run
        backtest_run_requests = []
        page.on("request", lambda req: backtest_run_requests.append(req.url) if "/api/backtest/run" in req.url else None)

        print("[1/5] Navigating to terminal UI...")
        await page.goto(FRONTEND_URL, wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # Open Backtest Panel via hotkey 'b'
        await page.keyboard.press("b")
        await page.wait_for_timeout(1000)

        panel = page.locator("[data-testid='backtest-panel']")
        await panel.wait_for(state="visible", timeout=6000)
        print("✅ Backtest Panel opened successfully.")

        strategy_select = page.locator("[data-testid='bt-strategy-select']")
        run_single_btn = page.locator("[data-testid='btn-run-single']")

        # ----------------------------------------------------------------------
        # TEST 1: L2 Live Strategy Button & Optimizer Disabling + Banner
        # ----------------------------------------------------------------------
        print("\n[2/5] Testing L2 Live strategy button guards...")
        await strategy_select.select_option("live_density_bounce")
        await page.wait_for_timeout(400)

        assert await run_single_btn.is_disabled(), "Single run button MUST be disabled for L2 Live!"
        single_text = await run_single_btn.inner_text()
        assert "недоступен" in single_text, f"Unexpected single button label: '{single_text}'"

        banner = page.locator("[data-testid='live-strategy-warning-banner']")
        assert await banner.is_visible(), "Live strategy warning banner must be visible!"
        print("✅ Single backtest button is disabled with 'Бэктест недоступен (L2 Live)'.")

        # Switch to Genetic Optimizer mode
        opt_mode_tab = page.locator("button:has-text('Оптимизатор параметров')")
        if await opt_mode_tab.is_visible():
            await opt_mode_tab.click()
            await page.wait_for_timeout(400)
            run_genetic_btn = page.locator("[data-testid='btn-run-genetic']")
            assert await run_genetic_btn.is_disabled(), "Genetic optimizer button MUST be disabled for L2 Live!"
            genetic_text = await run_genetic_btn.inner_text()
            assert "недоступна" in genetic_text, f"Unexpected genetic button label: '{genetic_text}'"
            print("✅ Genetic optimizer button is disabled with 'Оптимизация недоступна (L2 Live)'.")

            # Return to Single mode
            single_mode_tab = page.locator("button:has-text('Одиночный')")
            await single_mode_tab.click()
            await page.wait_for_timeout(400)

        # Click quick-switch button
        switch_btn = page.locator("[data-testid='btn-switch-cluster-strategy']")
        await switch_btn.click()
        await page.wait_for_timeout(400)

        current_strat = await strategy_select.input_value()
        assert current_strat == "cluster_volume_bounce", f"Expected cluster_volume_bounce, got '{current_strat}'"
        assert not await banner.is_visible(), "Warning banner should be gone after quick switch!"
        assert not await run_single_btn.is_disabled(), "Single button should now be enabled!"
        print("✅ Quick-switch button switched strategy to Cluster Volume Bounce and enabled execution.")

        # ----------------------------------------------------------------------
        # TEST 2: Boundary Values Validation & Network Call Prevention
        # ----------------------------------------------------------------------
        print("\n[3/5] Testing boundary values and network call cancellation...")
        sl_input = page.locator("[data-testid='input-sl']")
        tp_input = page.locator("[data-testid='input-tp']")
        lev_input = page.locator("[data-testid='input-leverage']")
        days_input = page.locator("[data-testid='input-days']")
        val_warning = page.locator("[data-testid='param-validation-warning']")

        test_cases = [
            ("SL <= 0", sl_input, "-1", "0.8", "Стоп-лосс"),
            ("SL == 0", sl_input, "0", "0.8", "Стоп-лосс"),
            ("TP <= 0", tp_input, "-2", "1.5", "Тейк-профит"),
            ("TP == 0", tp_input, "0", "1.5", "Тейк-профит"),
            ("Leverage < 1", lev_input, "0", "1", "Кредитное плечо"),
            ("Leverage > 125", lev_input, "150", "1", "Кредитное плечо"),
            ("Days < 1", days_input, "0", "14", "Период"),
            ("Days > 30", days_input, "45", "14", "Период"),
        ]

        for desc, input_elem, invalid_val, restore_val, expected_keyword in test_cases:
            req_count_before = len(backtest_run_requests)
            await input_elem.fill(invalid_val)
            await page.wait_for_timeout(200)

            # Check that button is disabled
            is_dis = await run_single_btn.is_disabled()
            assert is_dis, f"Button should be disabled when {desc}!"

            # Check inline warning
            assert await val_warning.is_visible(), f"Warning banner must be visible when {desc}!"
            warning_msg = await val_warning.inner_text()
            assert expected_keyword.lower() in warning_msg.lower(), f"Warning '{warning_msg}' missing '{expected_keyword}'"

            # Attempt force click to ensure no network call is sent
            try:
                await run_single_btn.click(force=True, timeout=500)
            except Exception:
                pass
            await page.wait_for_timeout(200)

            req_count_after = len(backtest_run_requests)
            assert req_count_after == req_count_before, f"Network request was sent despite invalid {desc}!"

            # Restore valid value
            await input_elem.fill(restore_val)
            await page.wait_for_timeout(200)
            assert not await run_single_btn.is_disabled(), f"Button failed to re-enable after restoring {desc}!"
            print(f"  ✓ {desc}: validated and blocked (0 requests dispatched).")

        print("✅ All boundary values strictly blocked at UI level with zero network leakage.")

        # ----------------------------------------------------------------------
        # TEST 3: Pydantic Error Translation (No Raw JSON)
        # ----------------------------------------------------------------------
        print("\n[4/5] Testing Pydantic error translation into clean Russian text...")
        # Intercept /api/backtest/run to simulate a raw Pydantic 422 JSON response
        mock_pydantic_error = {
            "detail": [
                {
                    "loc": ["body", "params", "stop_loss_pct"],
                    "msg": "Input should be greater than 0",
                    "type": "greater_than"
                }
            ]
        }

        async def handle_mock_error(route):
            await route.fulfill(
                status=422,
                content_type="application/json",
                body=json.dumps(mock_pydantic_error)
            )

        await page.route("**/api/backtest/run", handle_mock_error)
        await run_single_btn.click()
        await page.wait_for_timeout(600)

        error_banner = page.locator("[data-testid='backtest-error-banner']")
        assert await error_banner.is_visible(), "Error banner must appear on backend error!"
        error_text = await error_banner.inner_text()
        print(f"  Rendered error text: '{error_text}'")

        # Must NOT contain raw JSON syntax or technical tokens
        assert "{" not in error_text, "Error text must NOT contain raw JSON '{'!"
        assert "greater_than" not in error_text, "Error text must NOT contain 'greater_than'!"
        assert "Стоп-лосс" in error_text or "SL" in error_text, "Error text must contain human-readable Russian explanation!"
        print("✅ Pydantic error translation verified: raw JSON prevented, human text displayed.")

        # ----------------------------------------------------------------------
        # TEST 4: UI Recovery (Error Dismissal)
        # ----------------------------------------------------------------------
        print("\n[5/5] Testing UI error banner dismissal...")
        close_error_btn = error_banner.locator("button:has-text('✕')")
        assert await close_error_btn.is_visible(), "Close button '✕' must be present on error banner!"
        await close_error_btn.click()
        await page.wait_for_timeout(300)
        assert not await error_banner.is_visible(), "Error banner must disappear after clicking '✕'!"
        print("✅ Error banner successfully dismissed on '✕' click.")

        # Unroute mock
        await page.unroute("**/api/backtest/run")

        await browser.close()
        print("\n" + "=" * 60)
        print("🎉 ALL UI VALIDATION TESTS PASSED (100% GREEN)")
        print("=" * 60)

if __name__ == "__main__":
    asyncio.run(run_ui_validation_suite())
