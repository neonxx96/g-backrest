import asyncio
import sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})
        print("Navigating to http://localhost:7100/...")
        await page.goto("http://localhost:7100/", wait_until="domcontentloaded")
        
        tab_btn = page.locator("button:has-text('Закрытые сделки')").first
        await tab_btn.wait_for(state="visible", timeout=15000)

        # Wait for tab trades to load
        for _ in range(15):
            txt = await tab_btn.inner_text()
            if "(0)" not in txt:
                break
            await asyncio.sleep(1)

        print(f"Tab text: {await tab_btn.inner_text()}")
        await tab_btn.click()
        await asyncio.sleep(1)

        # 1. Total rows (All time)
        total_rows = await page.locator("table tbody tr").count()
        print(f"[ALL TIME] Total rows: {total_rows}")

        # 2. Test 24h filter
        btn_24h = page.locator('[data-testid="closed-period-24h"]')
        if await btn_24h.count() > 0:
            print("Clicking 24h period filter...")
            await btn_24h.click()
            await asyncio.sleep(1.5)
            rows_24h = await page.locator("table tbody tr").count()
            print(f"[24H] Rows: {rows_24h}")

        # 3. Test Sort by PnL Descending
        sort_sel = page.locator('[data-testid="closed-sort-select"]')
        if await sort_sel.count() > 0:
            print("Selecting sort: pnl_desc...")
            await sort_sel.select_option("pnl_desc")
            await asyncio.sleep(1)
            first_pnl = await page.locator("table tbody tr td:nth-child(7)").first.inner_text()
            first_sym = await page.locator("table tbody tr td:nth-child(2)").first.inner_text()
            print(f"[SORT PNL DESC] First row: {first_sym.replace(chr(10), ' ')} | PnL: {first_pnl}")

            # 4. Test Sort by PnL Ascending
            print("Selecting sort: pnl_asc...")
            await sort_sel.select_option("pnl_asc")
            await asyncio.sleep(1)
            worst_pnl = await page.locator("table tbody tr td:nth-child(7)").first.inner_text()
            worst_sym = await page.locator("table tbody tr td:nth-child(2)").first.inner_text()
            print(f"[SORT PNL ASC] Worst row: {worst_sym.replace(chr(10), ' ')} | PnL: {worst_pnl}")

            # 5. Reset to date_desc
            await sort_sel.select_option("date_desc")
            await asyncio.sleep(1)

        # 6. Test Symbol filter: BNBUSDT
        sym_sel = page.locator('[data-testid="closed-symbol-select"]')
        if await sym_sel.count() > 0:
            print("Selecting symbol filter: BNBUSDT...")
            await sym_sel.select_option("BNBUSDT")
            await asyncio.sleep(1)
            bnb_rows = await page.locator("table tbody tr").count()
            print(f"[FILTER BNBUSDT] Rows: {bnb_rows}")

            # Reset back to ALL
            await sym_sel.select_option("ALL")
            await asyncio.sleep(1)

        # 7. Reset to 'all' time
        btn_all = page.locator('[data-testid="closed-period-all"]')
        await btn_all.click()
        await asyncio.sleep(1)

        out_path = r"C:\Users\danil\.gemini\antigravity\brain\72a830ab-8fb5-4fb2-8267-c1a8a4795da5\terminal_verified_filters.png"
        await page.screenshot(path=out_path)
        print(f"Screenshot saved to {out_path}")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
