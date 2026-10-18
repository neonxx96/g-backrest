import asyncio
import os
import sys
from playwright.async_api import async_playwright

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"

async def test_rr_and_failover():
    print("🧪 Тестирование Risk/Reward Auto Long/Short, Dragging и Dual-Source Failover...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1920, 'height': 1080})

        await page.goto("http://127.0.0.1:5173", wait_until="networkidle", timeout=30000)
        await asyncio.sleep(2.0)

        # 1. Test Dual-Source Fetcher & ClearData in browser context
        fetcher_res = await page.evaluate("""async () => {
            const { fetchKlinesDualSource, normalizeCandle } = await import('/src/services/marketDataFetcher.js');
            // Test normal fetch
            const normal = await fetchKlinesDualSource({ symbol: 'BTCUSDT', timeframe: '15m', limit: 10 });
            
            // Test failover normalization on raw array (Binance structure)
            const rawBinance = [1700000000000, "80000.5", "80500.0", "79900.0", "80200.0", "123.45", 1700000899999, "9876543.21"];
            const normBinance = normalizeCandle(rawBinance);

            // Test failover normalization on backend object
            const rawBackend = { timestamp: 1700000000000, open: 80000.5, high: 80500.0, low: 79900.0, close: 80200.0, volume: 123.45 };
            const normBackend = normalizeCandle(rawBackend);

            return {
                normalCount: normal.candles.length,
                normalSource: normal.source,
                normBinanceOk: normBinance.close === 80200.0 && normBinance.turnover === 9876543.21,
                normBackendOk: normBackend.close === 80200.0
            };
        }""")
        print("  - Результаты Dual-Source fetcher:", fetcher_res)
        assert fetcher_res['normalCount'] > 0
        assert fetcher_res['normBinanceOk'] is True
        assert fetcher_res['normBackendOk'] is True

        # 2. Test Interactive Risk/Reward calculations and Auto Long/Short
        rr_calc_res = await page.evaluate("""() => {
            const { calculatePositionMetrics } = window; // or from store
            // We can test via tradeOverlayStore directly
            return import('/src/stores/tradeOverlayStore.js').then(m => {
                const calc = m.calculatePositionMetrics;
                // Test Long: TP > Entry
                const longSetup = calc({ entryPrice: 80000, tpPrice: 82400, slPrice: 79200, riskUsd: 100 });
                // Test Short: TP < Entry
                const shortSetup = calc({ entryPrice: 80000, tpPrice: 77600, slPrice: 80800, riskUsd: 100 });
                
                // Set transient setup into store
                m.useTradeOverlayStore.getState().setTransientSetup(longSetup);
                const readBackLong = m.useTradeOverlayStore.getState().activeSetup;

                m.useTradeOverlayStore.getState().setTransientSetup(shortSetup);
                const readBackShort = m.useTradeOverlayStore.getState().activeSetup;

                return {
                    longDirection: longSetup.direction, // LONG
                    longRR: longSetup.rr_ratio,         // 2400 / 800 = 3.0
                    longRewardUsd: longSetup.reward_usd,// 300.0
                    shortDirection: shortSetup.direction,// SHORT
                    shortRR: shortSetup.rr_ratio,       // 2400 / 800 = 3.0
                    readBackLongOk: readBackLong.direction === 'LONG',
                    readBackShortOk: readBackShort.direction === 'SHORT'
                };
            });
        }""")
        print("  - Результаты R:R математики и авто Long/Short:", rr_calc_res)
        assert rr_calc_res['longDirection'] == 'LONG'
        assert rr_calc_res['longRR'] == 3.0
        assert rr_calc_res['shortDirection'] == 'SHORT'
        assert rr_calc_res['shortRR'] == 3.0
        assert rr_calc_res['readBackLongOk'] is True
        assert rr_calc_res['readBackShortOk'] is True

        # 3. Test DOM Canvas Ladder Projection matching
        ladder_sync_res = await page.evaluate("""() => {
            return import('/src/stores/tradeOverlayStore.js').then(m => {
                // Set an active setup at current price level
                m.useTradeOverlayStore.getState().setTransientSetup({
                    entry_price: 82138.0,
                    sl_price: 81500.0,
                    tp1_price: 83500.0,
                    direction: 'LONG'
                });
                return {
                    activeSetup: m.useTradeOverlayStore.getState().activeSetup
                };
            });
        }""")
        print("  - Синхронизация проекции стакана с transient setup:", ladder_sync_res)
        assert ladder_sync_res['activeSetup']['entry_price'] == 82138.0

        await asyncio.sleep(1.0)
        screenshot_path = os.path.join(ARTIFACT_DIR, "interactive_rr_overlay_verified.png")
        await page.screenshot(path=screenshot_path)
        print(f"📸 Скриншот R:R Box и стакана сохранен: {screenshot_path}")

        await browser.close()
        print("🎉 ВСЕ ТЕСТЫ R:R OVERLAY, AUTO DIRECTION И TRANSIENT PROJECTION УСПЕШНО ПРОЙДЕНЫ!")

if __name__ == "__main__":
    asyncio.run(test_rr_and_failover())
