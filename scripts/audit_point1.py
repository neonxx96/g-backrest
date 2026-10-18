import sys
import asyncio
import json
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1600, 'height': 900})
        page = await context.new_page()

        captured_requests = []

        def on_req(req):
            if '/api/backtest/run' in req.url:
                captured_requests.append({
                    'url': req.url,
                    'post_data': req.post_data
                })

        page.on('request', on_req)

        print("[AUDIT-1] 1. Opening page...")
        await page.goto('http://127.0.0.1:5173')
        await page.wait_for_timeout(3000)

        print("[AUDIT-1] 2. Opening AI Copilot and running analysis...")
        ai_btn = page.locator("[data-testid='btn-toggle-ai-copilot']").first
        await ai_btn.click()
        await page.wait_for_timeout(1000)

        run_btn = page.locator("[data-testid='btn-run-market-analysis']")
        await run_btn.click()
        await page.wait_for_selector("[data-testid='btn-ai-apply-levels']", timeout=30000)

        # Check what was applied to chart and store
        state = await page.evaluate('''() => {
            return {
                chartSetup: window.__chartActiveSetup,
                storeSetup: window.__chartActiveSetup
            };
        }''')
        print("[AUDIT-1] Setup on Chart:", json.dumps(state['chartSetup'], indent=2))

        # Check the button 'Тест сетапа' in the HUD
        print("[AUDIT-1] 3. Clicking 'Тест сетапа' in chart HUD...")
        test_setup_btn = page.locator("[data-testid='btn-quick-backtest-setup']").first
        await test_setup_btn.wait_for(state="visible", timeout=5000)
        
        # Clear captured requests before clicking to capture the exact one from this click
        captured_requests.clear()
        await test_setup_btn.click()
        await page.wait_for_timeout(3000)

        print(f"[AUDIT-1] 4. Captured {len(captured_requests)} requests to /api/backtest/run.")
        for i, req in enumerate(captured_requests):
            print(f"--- REQUEST #{i+1} ---")
            if req['post_data']:
                data = json.loads(req['post_data'])
                print("Symbol:", data.get('symbol'))
                print("Timeframe:", data.get('timeframe'))
                print("Strategy:", data.get('strategy_type'))
                print("stop_loss_pct:", data.get('stop_loss_pct'))
                print("take_profit_pct:", data.get('take_profit_pct'))
                print("source_setup:", json.dumps(data.get('source_setup'), indent=2))
                print("params:", json.dumps(data.get('params'), indent=2))

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
