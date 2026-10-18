import sys
import asyncio
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda msg: print(f"[BROWSER {msg.type}] {msg.text}"))
        page.on("pageerror", lambda err: print(f"[BROWSER ERROR] {err}"))
        await page.goto("http://127.0.0.1:5173")
        await page.wait_for_timeout(2000)

        drawer_btn = page.locator("[data-testid='btn-toggle-backtest-drawer']")
        btn_count = await drawer_btn.count()
        print(f"Drawer btn count: {btn_count}")
        if btn_count > 0:
            print("Clicking drawer btn...")
            await drawer_btn.first.click()
            await page.wait_for_timeout(1000)

        panel = page.locator("[data-testid='backtest-panel']")
        panel_count = await panel.count()
        print(f"Panel count: {panel_count}")
        if panel_count > 0:
            print(f"Panel visible: {await panel.first.is_visible()}")

        await page.screenshot(path="C:/Users/danil/.gemini/antigravity/brain/ed4e7b46-732d-4623-be60-6c1e12127aa5/debug_bt_screen.png")
        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
