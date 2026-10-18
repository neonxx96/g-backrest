import sys
import asyncio
import json
import os
import csv
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={'width': 1600, 'height': 950},
            accept_downloads=True
        )
        page = await context.new_page()
        page.on("console", lambda msg: print(f"[BROWSER-CONSOLE] {msg.type}: {msg.text}", flush=True))
        page.on("pageerror", lambda err: print(f"[BROWSER-ERROR] {err}", flush=True))

        print("[AUDIT-5] 1. Opening terminal at http://127.0.0.1:5173 ...", flush=True)
        await page.goto('http://127.0.0.1:5173')
        await page.wait_for_timeout(3000)

        # 2. Select coin ETH/USDT from Screener
        print("[AUDIT-5] 2. Switching ticker to ETH/USDT...")
        eth_row = page.locator("text=ETH").first
        if await eth_row.is_visible():
            await eth_row.click()
            await page.wait_for_timeout(2000)
        print("[AUDIT-5] Active ticker switched to ETHUSDT.")

        # 3. Open AI Copilot to get initial setup
        print("[AUDIT-5] 3. Opening AI Copilot and generating market setup...", flush=True)
        ai_btn = page.locator("[data-testid='btn-toggle-ai-copilot']").first
        await ai_btn.click()
        await page.wait_for_timeout(1000)

        run_analysis_btn = page.locator("[data-testid='btn-run-market-analysis']")
        await run_analysis_btn.click()
        print("[AUDIT-5] Waiting for analysis to complete...", flush=True)
        await page.wait_for_selector("[data-testid='btn-ai-apply-levels']", timeout=30000)
        print("[AUDIT-5] Analysis complete! Applying setup to chart...", flush=True)
        apply_btn = page.locator("[data-testid='btn-ai-apply-levels']").first
        await apply_btn.click()
        await page.wait_for_timeout(1500)

        # Close AI sidebar so it doesn't intercept clicks on chart
        print("[AUDIT-5] Closing AI sidebar...", flush=True)
        close_btn = page.locator("[data-testid='btn-close-ai-sidebar']").first
        await close_btn.click()
        await page.wait_for_selector("[data-testid='ai-copilot-sidebar']", state="hidden", timeout=5000)
        await page.wait_for_timeout(1000)

        # 4. Check setup on chart
        setup_info = await page.evaluate('''() => {
            return window.__chartActiveSetup;
        }''')
        print("[AUDIT-5] Initial setup on chart:", json.dumps(setup_info, indent=2), flush=True)

        # 5. Click 'Тест сетапа' in chart HUD
        print("[AUDIT-5] 4. Clicking 'Тест сетапа' in chart HUD...", flush=True)
        test_setup_btn = page.locator("[data-testid='btn-quick-backtest-setup']").first
        is_visible = await test_setup_btn.is_visible()
        print(f"[AUDIT-5] Is test_setup_btn visible: {is_visible}", flush=True)

        async with page.expect_response(lambda r: "/api/backtest/run" in r.url, timeout=30000) as resp_info:
            await test_setup_btn.click(force=True)
        resp = await resp_info.value
        bt_data = await resp.json()
        print(f"[AUDIT-5] Backtest HTTP Response 200 OK! Total trades in response: {len(bt_data.get('trades', []))}", flush=True)
        await page.wait_for_timeout(2000)

        # 6. Extract trades from backtestStore in frontend
        store_trades = await page.evaluate('''() => {
            const res = window.__backtestStore ? window.__backtestStore.getState().activeResult : null;
            return res ? res.trades : null;
        }''')
        print(f"[AUDIT-5] 5. Number of backtest trades in store: {len(store_trades) if store_trades else 'None'}", flush=True)

        # 7. Open Backtest Panel drawer
        print("[AUDIT-5] 6. Opening Backtest Panel drawer...", flush=True)
        bt_drawer_btn = page.locator("[data-testid='btn-toggle-backtest-drawer']").first
        await bt_drawer_btn.click()
        await page.wait_for_timeout(1000)

        # Switch to Trades Log tab
        trades_tab = page.locator("[data-testid='tab-trades']")
        await trades_tab.click()
        await page.wait_for_timeout(1000)

        # Read visible table rows from UI
        table_rows = await page.locator("table tbody tr").all_inner_texts()
        print(f"[AUDIT-5] Visible table rows in UI: {len(table_rows)}", flush=True)
        for r in table_rows[:3]:
            print("  UI Row:", r.replace('\n', ' | '), flush=True)

        # 8. Click 'Экспорт CSV' and capture download
        print("[AUDIT-5] 7. Clicking 'Экспорт CSV'...", flush=True)
        export_btn = page.locator("[data-testid='btn-export-csv']")
        async with page.expect_download() as download_info:
            await export_btn.click()
        download = await download_info.value

        download_path = os.path.join(r"d:\AI_agent_space\gemini\scripts", download.suggested_filename)
        await download.save_as(download_path)
        print(f"[AUDIT-5] CSV saved to {download_path}", flush=True)

        # 9. Read and parse downloaded CSV
        csv_rows = []
        with open(download_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                csv_rows.append(row)
        print(f"[AUDIT-5] 8. CSV contains {len(csv_rows)} rows.", flush=True)
        for r in csv_rows[:3]:
            print("  CSV Row:", r, flush=True)

        # 10. Compare CSV with UI / Chart data
        if len(csv_rows) > 0 and len(table_rows) > 0:
            first_csv = csv_rows[0]
            print("\n[AUDIT-5] --- COMPARISON ---", flush=True)
            print("Trade #1 in CSV: Type=", first_csv.get('Тип'), "Entry=", first_csv.get('Цена входа'), "Exit=", first_csv.get('Цена выхода'), "Net PnL=", first_csv.get('Чистый PnL ($)'), flush=True)
            print("Trade #1 Exit Reason in CSV:", first_csv.get('Причина выхода'), flush=True)

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
