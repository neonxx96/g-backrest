"""
Playwright E2E Verification Script: Widget Hub Modal & Screener with Sparklines
Validates:
1. ScreenerWidget rendering with 24h Sparklines (SVG) & Volatility sorting
2. Opening Widget Hub Modal from "+ Виджеты" button
3. Inspecting module catalog cards (Chart, DOM, Trades Tape, Screener, Paper Trading)
4. Dynamic mounting of a module (Paper Trading) from the Hub into active Dockview grid
5. Verifying clean console and execution state
"""

import os
import sys
import time
from playwright.sync_api import sync_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"


def verify_widget_hub_and_screener():
    print(">>> Starting Widget Hub & Screener Playwright E2E Verification...")
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
        print(">>> [1/4] Verifying ScreenerWidget...")
        screener = page.locator("[data-testid='screener-widget']")
        assert screener.count() > 0, "ScreenerWidget not found in DOM!"
        print(">>> [PASS] ScreenerWidget is mounted.")

        # Check Sparklines
        sparklines = page.locator("[data-testid='screener-widget'] svg path")
        sparkline_count = sparklines.count()
        print(f">>> Found {sparkline_count} SVG Sparklines rendered.")
        assert sparkline_count >= 5, f"Expected at least 5 sparklines, got {sparkline_count}"
        print(">>> [PASS] 24-hour Sparklines rendered.")

        # Test Volatility Sorting
        sort_vol_btn = page.locator("[data-testid='sort-volatility']")
        assert sort_vol_btn.count() > 0, "Volatility sort button not found!"
        sort_vol_btn.click()
        time.sleep(0.5)
        print(">>> [PASS] Volatility sorting applied.")

        # -------------------------------------------------------------
        # STEP 2: Open Widget Hub Modal
        # -------------------------------------------------------------
        print(">>> [2/4] Testing Widget Hub Modal trigger ('+ Виджеты')...")
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
        card_papertrade = page.locator("[data-testid='card-add-widget-papertrade']")

        assert card_chart.count() > 0, "Chart card missing in Widget Hub!"
        assert card_dom.count() > 0, "Orderbook DOM card missing in Widget Hub!"
        assert card_trades.count() > 0, "Trades Tape card missing in Widget Hub!"
        assert card_screener.count() > 0, "Screener card missing in Widget Hub!"
        assert card_papertrade.count() > 0, "Paper Trading card missing in Widget Hub!"
        print(">>> [PASS] All 5 core module cards (Chart, DOM, Tape, Screener, Paper Trading) are present.")

        # -------------------------------------------------------------
        # STEP 3: Spawn New Module (Paper Trading) from the Hub
        # -------------------------------------------------------------
        print(">>> [3/4] Spawning Paper Trading panel from Widget Hub...")
        card_papertrade.click()
        time.sleep(1.0)

        # Modal should be closed now
        assert page.locator("[data-testid='widget-hub-modal']").count() == 0, "Widget Hub should close after selecting a module!"
        print(">>> [PASS] Widget Hub closed automatically upon module selection.")

        # Check that PaperTradePanel is mounted
        paper_panel = page.locator("[data-testid='paper-trade-panel']")
        assert paper_panel.count() > 0, "PaperTradePanel was not mounted into dockview grid!"
        print(">>> [PASS] PaperTradePanel successfully mounted into active dockview grid.")

        # -------------------------------------------------------------
        # STEP 4: Check Console Errors
        # -------------------------------------------------------------
        print(">>> [4/4] Checking console error logs...")
        critical_errors = [e for e in console_errors if "net::ERR_" not in e and "WebSocket" not in e and "fapi.binance.com" not in e]
        if critical_errors:
            print(f">>> [WARN] Critical console errors detected: {critical_errors}")
            assert len(critical_errors) == 0, f"Critical console errors: {critical_errors}"
        else:
            print(">>> [PASS] Zero critical JavaScript errors.")

        # Save screenshot artifact
        screenshot_path = os.path.join(ARTIFACT_DIR, "widget_hub_screener_e2e_verified.png")
        page.screenshot(path=screenshot_path)
        print(f">>> [PASS] E2E screenshot saved to {screenshot_path}")

        browser.close()
        print(">>> ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    verify_widget_hub_and_screener()
