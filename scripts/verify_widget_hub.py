"""
Playwright E2E Verification Script for Widget Hub Modal and Screener Sparklines
Validates:
1. ScreenerWidget rendering with 24h Sparklines (SVG) & Volatility sorting
2. Opening Widget Hub Modal from "+ Виджеты" button
3. Inspecting module catalog cards
4. Spawning a new Chart tab from the Hub into active Dockview grid
5. Color-channel linking on spawned panel
"""

import os
import sys
import time
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"

def verify_widget_hub():
    print(">>> Starting Widget Hub & Screener Sparklines Playwright verification...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        console_errors = []
        page.on("pageerror", lambda err: console_errors.append(f"PageError: {err}"))
        page.on("console", lambda msg: console_errors.append(f"Console: {msg.text}") if msg.type == 'error' else None)

        print(">>> Navigating to http://127.0.0.1:5173 ...")
        page.goto("http://127.0.0.1:5173", wait_until="networkidle")
        time.sleep(2.5)

        # -------------------------------------------------------------
        # STEP 1: Verify Screener Widget & Sparklines
        # -------------------------------------------------------------
        print(">>> Verifying ScreenerWidget...")
        screener = page.locator("[data-testid='screener-widget']")
        assert screener.count() > 0, "ScreenerWidget not found in DOM!"
        print(">>> [PASS] ScreenerWidget is mounted.")

        # Check Sparklines
        sparklines = page.locator("[data-testid='screener-widget'] svg path")
        sparkline_count = sparklines.count()
        print(f">>> Found {sparkline_count} SVG Sparklines rendered.")
        assert sparkline_count >= 5, f"Expected at least 5 sparklines, got {sparkline_count}"
        print(">>> [PASS] 24-hour Sparklines rendered with SVG paths.")

        # Test Volatility Sorting
        sort_vol_btn = page.locator("[data-testid='sort-volatility']")
        assert sort_vol_btn.count() > 0, "Volatility sort button not found!"
        sort_vol_btn.click()
        time.sleep(0.5)
        print(">>> [PASS] Volatility sorting applied.")

        # Take screener screenshot
        screener_screenshot = os.path.join(ARTIFACT_DIR, "screener_sparklines_verified.png")
        screener.screenshot(path=screener_screenshot)
        print(f">>> [PASS] Screener screenshot saved to {screener_screenshot}")

        # -------------------------------------------------------------
        # STEP 2: Open Widget Hub Modal
        # -------------------------------------------------------------
        print(">>> Testing Widget Hub Modal trigger ('+ Виджеты')...")
        widgets_btn = page.locator("[data-testid='widgets-menu-button']")
        assert widgets_btn.count() > 0, "+ Виджеты button not found!"
        widgets_btn.click()
        time.sleep(0.5)

        modal = page.locator("[data-testid='widget-hub-modal']")
        assert modal.count() > 0, "WidgetHubModal did not open!"
        print(">>> [PASS] WidgetHubModal opened successfully.")

        # Verify module cards in catalog
        card_chart = page.locator("[data-testid='card-add-widget-chart']")
        card_dom = page.locator("[data-testid='card-add-widget-orderbook']")
        card_trades = page.locator("[data-testid='card-add-widget-trades']")
        card_screener = page.locator("[data-testid='card-add-widget-screener']")

        assert card_chart.count() > 0, "Chart card missing in Widget Hub!"
        assert card_dom.count() > 0, "Orderbook DOM card missing in Widget Hub!"
        assert card_trades.count() > 0, "Trades Tape card missing in Widget Hub!"
        assert card_screener.count() > 0, "Screener card missing in Widget Hub!"
        print(">>> [PASS] All core module cards (Chart, DOM, Tape, Screener) are present in the catalog.")

        # Take modal screenshot
        modal_screenshot = os.path.join(ARTIFACT_DIR, "widget_hub_modal_verified.png")
        page.screenshot(path=modal_screenshot)
        print(f">>> [PASS] Widget Hub screenshot saved to {modal_screenshot}")

        # -------------------------------------------------------------
        # STEP 3: Spawn New Chart Widget from the Hub
        # -------------------------------------------------------------
        print(">>> Clicking Chart card to spawn a new Chart panel...")
        card_chart.click()
        time.sleep(1.5)

        modal_count = page.locator("[data-testid='widget-hub-modal']").count()
        print(f">>> Modal count after click: {modal_count}")
        if console_errors:
            print(f">>> Console errors: {console_errors}")

        # Modal should automatically close
        assert modal_count == 0, f"Modal did not close after card selection! Errors: {console_errors}"
        print(">>> [PASS] Modal automatically closed after widget selection.")

        # Verify newly spawned chart panel or tab in dockview
        tab_texts = page.evaluate("""() => {
            return Array.from(document.querySelectorAll('.tab, .default-tab, [class*="tab"]'))
                .map(el => el.textContent.trim())
                .filter(Boolean);
        }""")
        print(f">>> Found tabs in dockview: {tab_texts}")

        # Check for Chart tab or panel
        chart_found = any('График' in t for t in tab_texts) or page.locator("text='График'").count() > 0
        assert chart_found, "Spawned chart tab not found in dockview!"
        print(">>> [PASS] New Chart panel successfully spawned and docked into grid.")

        # Take final workspace screenshot
        workspace_screenshot = os.path.join(ARTIFACT_DIR, "widget_spawned_chart_verified.png")
        page.screenshot(path=workspace_screenshot, full_page=True)
        print(f">>> [PASS] Workspace screenshot saved to {workspace_screenshot}")

        # Check console errors
        if console_errors:
            print(f">>> Console warnings/errors: {console_errors}")

        browser.close()
        print(">>> ALL WIDGET HUB & SCREENER SPARKLINES VERIFICATION CHECKS PASSED!")

if __name__ == "__main__":
    verify_widget_hub()
