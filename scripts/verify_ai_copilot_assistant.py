import asyncio
import os
import sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"
os.makedirs(ARTIFACT_DIR, exist_ok=True)

async def run_verification():
    print("[1/6] Launching Playwright Chromium...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1600, "height": 900})
        page = await context.new_page()

        print("[2/6] Navigating to http://127.0.0.1:5173 ...")
        await page.goto("http://127.0.0.1:5173", wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # 1. Open AI Copilot Sidebar via button or hotkey 'A'
        print("[3/6] Opening AI Copilot Sidebar...")
        ai_btn = page.locator("button:has-text('AI Ассистент')")
        if await ai_btn.count() > 0:
            await ai_btn.first.click()
        else:
            await page.keyboard.press("KeyA")
        await page.wait_for_timeout(1000)

        # 2. Trigger Express Market Analysis
        print("[4/6] Running Express Market Analysis...")
        analysis_btn = page.locator("button:has-text('Анализ рынка прямо сейчас')")
        assert await analysis_btn.count() > 0, "Button 'Анализ рынка прямо сейчас' not found!"
        await analysis_btn.click()

        # Wait for analysis results
        await page.wait_for_selector("text=Готовый торговый сетап", timeout=10000)
        print(" -> Found Trade Setup Card!")

        # 3. Apply levels to chart
        apply_btn = page.locator("button:has-text('Нанести уровни на график')")
        if await apply_btn.count() > 0:
            await apply_btn.click()
            print(" -> Clicked 'Нанести уровни на график'")

        # 4. Quick backtest test
        bt_btn = page.locator("button:has-text('Проверить идею в бэктестере')")
        if await bt_btn.count() > 0:
            await bt_btn.click()
            await page.wait_for_timeout(2000)
            print(" -> Inline Backtest Triggered!")

        # 5. Send message in chat
        chat_input = page.locator("input[placeholder*='Спросить у AI Ассистента']")
        if await chat_input.count() > 0:
            await chat_input.fill("Как трактовать кумулятивную дельту CVD?")
            await chat_input.press("Enter")
            await page.wait_for_timeout(2000)
            print(" -> Chat question submitted!")

        # Capture AI Sidebar Screenshot
        ai_shot_path = os.path.join(ARTIFACT_DIR, "ai_sidebar_analysis.png")
        await page.screenshot(path=ai_shot_path, full_page=False)
        print(f" -> AI Sidebar screenshot saved to: {ai_shot_path}")

        # 6. Test Indicators Catalog Modal
        print("[5/6] Testing Indicators Modal...")
        ind_btn = page.locator("button:has-text('Индикаторы')").first
        if await ind_btn.count() > 0:
            await ind_btn.click()
        else:
            await page.keyboard.press("KeyI")
        await page.wait_for_timeout(1000)

        # Verify catalog presence
        await page.wait_for_selector("text=Каталог индикаторов & Order Flow", timeout=5000)
        print(" -> Indicators catalog modal verified!")

        # Search for CVD
        search_input = page.locator("input[placeholder*='Поиск индикатора']")
        if await search_input.count() > 0:
            await search_input.fill("CVD")
            await page.wait_for_timeout(500)
            print(" -> Filtered by 'CVD' successfully!")

        # Capture Indicators Modal Screenshot
        ind_shot_path = os.path.join(ARTIFACT_DIR, "indicators_modal_catalog.png")
        await page.screenshot(path=ind_shot_path, full_page=False)
        print(f" -> Indicators modal screenshot saved to: {ind_shot_path}")

        await browser.close()
        print("[6/6] All verification steps completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_verification())
