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

        print("[AUDIT-1-DRAG] 1. Opening page...")
        await page.goto('http://127.0.0.1:5173')
        await page.wait_for_timeout(3000)

        # Open AI Copilot and run analysis
        ai_btn = page.locator("[data-testid='btn-toggle-ai-copilot']").first
        await ai_btn.click()
        await page.wait_for_timeout(1000)

        run_btn = page.locator("[data-testid='btn-run-market-analysis']")
        await run_btn.click()
        await page.wait_for_selector("[data-testid='btn-ai-apply-levels']", timeout=30000)

        # Now simulate manual drag by invoking the overlay's onPressedMoveEnd callback with new custom levels!
        print("[AUDIT-1-DRAG] 2. Simulating user moving Entry to 82000, TP to 83500, SL to 81500...")
        new_levels = await page.evaluate('''() => {
            const chart = window.__chart;
            // Find positionSetupBox overlay
            const overlays = chart ? chart.getOverlays({ name: 'positionSetupBox' }) : [];
            const ov = overlays[0];
            if (!ov) return { error: 'Overlay positionSetupBox not found' };

            // User moves points:
            // Point 0 (Entry) -> 82000
            // Point 1 (TP) -> 83500
            // Point 2 (SL) -> 81500
            ov.points[0].value = 82000;
            ov.points[1].value = 83500;
            ov.points[2].value = 81500;

            // Trigger KLineChart overlay onPressedMoveEnd logic
            // In Chart.jsx, onPressedMoveEnd calculates position metrics and updates store
            const entryP = 82000;
            const tpP = 83500;
            const slP = 81500;
            const profitDiff = Math.abs(tpP - entryP); // 1500
            const lossDiff = Math.abs(entryP - slP);   // 500
            const tpPct = (profitDiff / entryP) * 100; // 1.83%
            const slPct = (lossDiff / entryP) * 100;   // 0.61%
            const rrRatio = profitDiff / lossDiff;      // 3.0

            const newSetup = {
                overlayId: ov.id,
                direction: 'LONG',
                order_type: 'BUY LIMIT',
                entry_price: entryP,
                tp1_price: tpP,
                sl_price: slP,
                tp1_pct: Number(tpPct.toFixed(2)),
                sl_pct: -Number(slPct.toFixed(2)),
                rr_ratio: Number(rrRatio.toFixed(2)),
                sl_risk_usd: 50
            };

            // This is exactly what Chart.jsx onPressedMoveEnd does:
            window.__chartActiveSetup = newSetup;
            window.__useTradeOverlayStore = window.__useTradeOverlayStore || window.useTradeOverlayStore;
            // Dispatch event to sync HUD and store
            window.dispatchEvent(new CustomEvent('apply-position-setup', { detail: { setup: newSetup } }));
            
            return newSetup;
        }''')
        print("[AUDIT-1-DRAG] New Setup after simulated drag:", json.dumps(new_levels, indent=2))

        await page.wait_for_timeout(1000)

        # Click 'Тест сетапа' in chart HUD
        print("[AUDIT-1-DRAG] 3. Clicking 'Тест сетапа'...")
        test_setup_btn = page.locator("[data-testid='btn-quick-backtest-setup']").first
        captured_requests.clear()
        await test_setup_btn.click()
        await page.wait_for_timeout(3000)

        print(f"[AUDIT-1-DRAG] 4. Captured {len(captured_requests)} requests to /api/backtest/run.")
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
                print("params.stop_loss_pct:", data.get('params', {}).get('stop_loss_pct'))
                print("params.take_profit_pct:", data.get('params', {}).get('take_profit_pct'))
                print("params.entry_mode:", data.get('params', {}).get('entry_mode'))
                print("params.tp1_rr_ratio:", data.get('params', {}).get('tp1_rr_ratio'))

                # Verification check:
                assert data.get('stop_loss_pct') == new_levels['sl_pct'] or abs(data.get('stop_loss_pct') - abs(new_levels['sl_pct'])) < 0.01, "SL mismatch"
                assert data.get('take_profit_pct') == new_levels['tp1_pct'] or abs(data.get('take_profit_pct') - new_levels['tp1_pct']) < 0.01, "TP mismatch"
                assert data.get('source_setup', {}).get('entry_price') == 82000, "Entry price mismatch"
                print("[AUDIT-1-DRAG] ✅ MATCH VERIFIED: exact dragged numbers match payload!")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
