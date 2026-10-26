import asyncio, sys
from playwright.async_api import async_playwright
sys.stdout.reconfigure(encoding='utf-8')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})
        await page.goto("http://localhost:7100/", wait_until="domcontentloaded")
        
        # Wait up to 10 seconds for the tab to display non-zero count
        print("Waiting for closed trades to load...")
        tab_btn = page.locator("button:has-text('Закрытые сделки')").first
        await tab_btn.wait_for(state="visible", timeout=15000)

        # Wait for tab text to update
        for _ in range(15):
            txt = await tab_btn.inner_text()
            if "(0)" not in txt:
                print(f"Loaded! Tab button: {txt}")
                break
            await asyncio.sleep(1)

        print(f"Final tab button text: {await tab_btn.inner_text()}")
        await tab_btn.click()
        await asyncio.sleep(2)

        rows = await page.locator("table tbody tr").all()
        print(f"Total rendered rows count: {len(rows)}")
        for idx in range(min(5, len(rows))):
            txt = await rows[idx].inner_text()
            print(f"Row {idx}: {txt.replace(chr(10), ' | ')}")

        out_path = r"C:\Users\danil\.gemini\antigravity\brain\72a830ab-8fb5-4fb2-8267-c1a8a4795da5\terminal_durable_closed_trades.png"
        await page.screenshot(path=out_path)
        print(f"Screenshot saved to {out_path}")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
