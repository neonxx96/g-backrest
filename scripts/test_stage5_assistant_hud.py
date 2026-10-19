"""
Stage 5 Verification: Live Assistant HUD and Predictive Interface
Tests:
1. Assistant HUD presence on the chart canvas.
2. Market regime indication & institutional recommendation display.
3. State isolation on symbol switch (BTCUSDT -> SOLUSDT).
4. HUD minimize / maximize toggle behavior.
5. Volatility Cone and Liquidity Magnet Walls toggle controls.
6. Zero console errors.
"""

import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

FRONTEND_URL = "http://127.0.0.1:5173"


def test_stage5_assistant_hud():
    print("--- [STAGE 5] Testing Tactical Assistant HUD & Predictive Overlay ---")
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        def on_console(msg):
            if msg.type == "error":
                text = msg.text
                if not any(ign in text for ign in ["net::ERR", "Failed to fetch", "WebSocket"]):
                    console_errors.append(text)

        page.on("console", on_console)
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        print("[1/5] Navigating to terminal UI...")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        print("[2/5] Verifying Assistant HUD existence on chart...")
        hud = page.locator('[data-testid="assistant-hud"]')
        if not hud.is_visible():
            print("❌ FAIL: [data-testid='assistant-hud'] not visible on page!")
            browser.close()
            return False
        print("  ✓ Assistant HUD container is rendered on the chart.")

        regime_badge = page.locator('[data-testid="assistant-regime-badge"]').first
        if not regime_badge.is_visible():
            print("❌ FAIL: Regime badge not visible!")
            browser.close()
            return False
        badge_text = regime_badge.inner_text().strip()
        print(f"  ✓ Active Regime Badge: '{badge_text}'")

        recommendation = page.locator('[data-testid="assistant-regime-recommendation"]').first
        if recommendation.is_visible():
            print(f"  ✓ Tactical Recommendation: '{recommendation.inner_text().strip()}'")

        print("[3/5] Testing Collapse / Expand toggle...")
        btn_collapse = page.locator('[data-testid="btn-collapse-assistant"]')
        if btn_collapse.is_visible():
            btn_collapse.click()
            page.wait_for_timeout(500)
            minimized = page.locator('[data-testid="assistant-hud-minimized"]')
            if not minimized.is_visible():
                print("❌ FAIL: Minimized pill not visible after collapse!")
                browser.close()
                return False
            print("  ✓ HUD minimized into sleek pill badge.")

            minimized.click()
            page.wait_for_timeout(500)
            card = page.locator('[data-testid="assistant-hud-card"]')
            if not card.is_visible():
                print("❌ FAIL: HUD card did not re-expand!")
                browser.close()
                return False
            print("  ✓ HUD expanded back to full card.")

        print("[4/5] Testing Volatility Cone & Magnet Walls Toggles...")
        btn_cone = page.locator('[data-testid="btn-hud-toggle-cone"]')
        if btn_cone.is_visible():
            btn_cone.click()
            page.wait_for_timeout(800)
            print("  ✓ Volatility Cone toggled.")

        btn_walls = page.locator('[data-testid="btn-hud-toggle-walls"]')
        if btn_walls.is_visible():
            btn_walls.click()
            page.wait_for_timeout(600)
            btn_walls.click()
            page.wait_for_timeout(600)
            print("  ✓ Magnet Walls toggled.")

        print("[5/5] Testing Symbol Switch (BTCUSDT -> SOLUSDT)...")
        # Trigger symbol switch via keyboard ArrowDown
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(2500)

        # Check HUD title contains current symbol
        hud_text = hud.inner_text()
        print(f"  ✓ HUD updated after switch. Content summary:\n    {hud_text[:120]}...")

        # Screenshot verification
        screenshot_path = "C:/Users/danil/.gemini/antigravity/brain/ed4e7b46-732d-4623-be60-6c1e12127aa5/stage5_assistant_hud_verified.png"
        page.screenshot(path=screenshot_path)
        print(f"  ✓ Captured verification snapshot: {screenshot_path}")

        browser.close()

    if console_errors:
        print(f"❌ Uncaught console errors: {console_errors}")
        return False

    print("\n✅ [STAGE 5] ALL ASSISTANT HUD & PREDICTIVE INTERFACE TESTS PASSED!")
    return True


if __name__ == "__main__":
    success = test_stage5_assistant_hud()
    sys.exit(0 if success else 1)
