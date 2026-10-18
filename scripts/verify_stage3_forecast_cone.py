import sys
import asyncio
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

async def verify_stage3():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1600, "height": 950})
        page = await context.new_page()

        print("[TEST-STAGE-3] 1. Opening terminal page http://127.0.0.1:5173 ...")
        await page.goto("http://127.0.0.1:5173", timeout=30000)
        await page.wait_for_timeout(3000)

        print("[TEST-STAGE-3] 2. Opening AI Copilot Sidebar...")
        ai_btn = page.locator("[data-testid='btn-toggle-ai-copilot']").first
        await ai_btn.wait_for(state="visible", timeout=10000)
        await ai_btn.click()
        await page.wait_for_timeout(1000)

        # Ensure analysis button is present
        print("[TEST-STAGE-3] 3. Running express market analysis...")
        run_analysis_btn = page.locator("[data-testid='btn-run-market-analysis']")
        await run_analysis_btn.wait_for(state="visible", timeout=5000)
        await run_analysis_btn.click()

        print("[TEST-STAGE-3] 4. Waiting for quantitative analysis cards (EV, Magnet, Cone)...")
        ev_card = page.locator("[data-testid='ai-expected-value-card']")
        await ev_card.wait_for(state="visible", timeout=30000)

        ev_val = await page.locator("[data-testid='ai-ev-value']").inner_text()
        ev_verdict = await page.locator("[data-testid='ai-ev-verdict']").inner_text()
        print(f"[TEST-STAGE-3] ✅ Expected Value (EV) Card verified: {ev_val} | Verdict: {ev_verdict}")

        mag_card = page.locator("[data-testid='ai-liquidity-magnet-card']")
        await mag_card.wait_for(state="visible", timeout=5000)
        mag_ratio = await page.locator("[data-testid='ai-magnet-ratio']").inner_text()
        print(f"[TEST-STAGE-3] ✅ Liquidity Magnet Card verified: Bid/Ask Ratio = {mag_ratio}")

        cone_card = page.locator("[data-testid='ai-volatility-cone-card']")
        await cone_card.wait_for(state="visible", timeout=5000)
        print("[TEST-STAGE-3] ✅ Expected Move Cone Card verified.")

        # Click button to project Volatility Cone on chart
        print("[TEST-STAGE-3] 5. Projecting Volatility Cone (±1σ / ±2σ) onto KLineChart...")
        cone_btn = page.locator("[data-testid='btn-toggle-volatility-cone']")
        await cone_btn.click()
        await page.wait_for_timeout(2000)

        btn_text = await cone_btn.inner_text()
        print(f"[TEST-STAGE-3] Cone button state after projection: '{btn_text}'")
        assert "Скрыть" in btn_text, "Cone button should switch to hide state when projected"

        # Capture screenshot
        artifact_path = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5\stage3_forecast_cone_verified.png"
        await page.screenshot(path=artifact_path, full_page=False)
        print(f"[TEST-STAGE-3] 📸 Screenshot saved to {artifact_path}")

        print("[TEST-STAGE-3] 🎉 ALL STAGE 3 ASSERTIONS PASSED SUCCESSFULLY!")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_stage3())
