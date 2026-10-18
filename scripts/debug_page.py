import asyncio
import os
import sys
from playwright.async_api import async_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"

async def debug_page():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})
        
        errors = []
        page.on("pageerror", lambda err: errors.append(f"PageError: {err}"))
        page.on("console", lambda msg: errors.append(f"Console: {msg.text}") if msg.type in ['error', 'warn'] else None)

        await page.goto("http://127.0.0.1:5173", wait_until="networkidle", timeout=30000)
        await asyncio.sleep(2.0)

        # Check all testids
        testids = await page.evaluate("""() => {
            return Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'));
        }""")
        print("Found testids:", testids)

        if errors:
            print("Errors on page:", errors[:10])

        await page.screenshot(path=os.path.join(ARTIFACT_DIR, "debug_page_load.png"))
        await browser.close()

if __name__ == "__main__":
    asyncio.run(debug_page())
