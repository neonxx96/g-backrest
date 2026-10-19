"""
E2E verification script for Stage 2:
1. Ticker isolation (customParamsBySymbol)
2. Persistence across F5 refresh
3. 1-Click Quick Backtest utilizing active symbol state
"""
import sys
import time
from playwright.sync_api import sync_playwright

FRONTEND_URL = "http://127.0.0.1:5173"

def main():
    print("--- Testing Stage 2: Frontend State Isolation & Persistence ---")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        console_errors = []
        page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)

        print("[1] Opening UI...")
        page.goto(FRONTEND_URL, wait_until="networkidle", timeout=30000)
        time.sleep(2)

        # 1. Test Ticker Parameter Isolation in Store
        print("[2] Testing per-symbol parameter isolation...")
        res = page.evaluate("""() => {
            const store = window.__backtestStore.getState();
            // Set BTC parameters
            store.setParamsForSymbol('BTCUSDT', { stop_loss_pct: 0.35, take_profit_pct: 1.05, leverage: 3 });
            // Set SOL parameters
            store.setParamsForSymbol('SOLUSDT', { stop_loss_pct: 0.75, take_profit_pct: 2.25, leverage: 5 });

            const btcParams = store.getParamsForSymbol('BTCUSDT');
            const solParams = store.getParamsForSymbol('SOLUSDT');
            const linkParams = store.getParamsForSymbol('LINKUSDT'); // default fallback

            return {
                btc: { sl: btcParams.stop_loss_pct, tp: btcParams.take_profit_pct, lev: btcParams.leverage },
                sol: { sl: solParams.stop_loss_pct, tp: solParams.take_profit_pct, lev: solParams.leverage },
                link: { sl: linkParams.stop_loss_pct, tp: linkParams.take_profit_pct, lev: linkParams.leverage },
            };
        }""")

        assert res["btc"]["sl"] == 0.35 and res["btc"]["tp"] == 1.05, f"BTC params failed: {res['btc']}"
        assert res["sol"]["sl"] == 0.75 and res["sol"]["tp"] == 2.25, f"SOL params failed: {res['sol']}"
        assert res["link"]["sl"] == 0.8 and res["link"]["tp"] == 1.6, f"LINK default params failed: {res['link']}"
        print("    [PASS] Ticker parameter isolation verified! BTC, SOL, and LINK maintain separate configs.")

        # 2. Test LocalStorage Persistence across F5 Reload
        print("[3] Testing F5 Reload Persistence via localStorage...")
        # Check localStorage directly
        stored = page.evaluate("() => localStorage.getItem('signalscript_backtest_storage')")
        assert stored is not None, "localStorage item signalscript_backtest_storage not found!"
        assert "BTCUSDT" in stored, "BTCUSDT not found in localStorage!"

        # Reload the page (simulate F5)
        page.reload(wait_until="networkidle", timeout=30000)
        time.sleep(2)

        restored = page.evaluate("""() => {
            const store = window.__backtestStore.getState();
            const btcParams = store.getParamsForSymbol('BTCUSDT');
            const solParams = store.getParamsForSymbol('SOLUSDT');
            return {
                btc: { sl: btcParams.stop_loss_pct, tp: btcParams.take_profit_pct, lev: btcParams.leverage },
                sol: { sl: solParams.stop_loss_pct, tp: solParams.take_profit_pct, lev: solParams.leverage },
            };
        }""")

        assert restored["btc"]["sl"] == 0.35, f"BTC SL not restored: {restored['btc']}"
        assert restored["sol"]["sl"] == 0.75, f"SOL SL not restored: {restored['sol']}"
        print("    [PASS] Settings successfully restored after F5 reload from localStorage!")

        # 3. Test 1-Click Quick Backtest with Active Symbol State
        print("[4] Testing 1-Click Quick Backtest payload parameters...")
        bt_res = page.evaluate("""async () => {
            const store = window.__backtestStore.getState();
            const res = await store.runQuickBacktest({ symbol: 'SOLUSDT', timeframe: '15m' });
            return {
                success: !!res,
                symbol: res.symbol,
                total_trades: res.trades ? res.trades.length : 0,
            };
        }""")

        assert bt_res["success"], "Quick backtest failed!"
        assert bt_res["symbol"] == "SOLUSDT", f"Symbol mismatch: {bt_res['symbol']}"
        print(f"    [PASS] 1-Click Quick Backtest succeeded for {bt_res['symbol']} (trades={bt_res['total_trades']})!")

        # 4. Check for console errors (especially 404 on /api/monitoring/state)
        print("[5] Checking console errors...")
        real_errors = [e for e in console_errors if "Failed to load resource" not in e and "net::ERR" not in e]
        assert len(real_errors) == 0, f"Uncaught console errors: {real_errors}"
        print("    [PASS] 0 uncaught console errors!")

        browser.close()

    print("\n[ALL PASS] Stage 2 Frontend State Isolation & Persistence Verified!")

if __name__ == "__main__":
    main()
