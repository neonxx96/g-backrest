import sys
import asyncio
import json
from playwright.async_api import async_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

async def run_audit():
    print("=" * 76)
    print("🔬 [QA-AUDIT] СТРАТЕГИЧЕСКИЙ UI-АУДИТ И ПРОВЕРКА ИЗОЛЯЦИИ НАСТРОЕК")
    print("=" * 76)

    captured_requests = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1600, "height": 950})
        page = await context.new_page()

        # Listen to backtest run requests
        def handle_request(req):
            if "/api/backtest/run" in req.url:
                try:
                    data = json.loads(req.post_data) if req.post_data else {}
                    captured_requests.append({
                        "url": req.url,
                        "data": data
                    })
                except Exception:
                    pass

        page.on("request", handle_request)

        print("\n1️⃣  Загрузка страницы http://127.0.0.1:5173...")
        await page.goto("http://127.0.0.1:5173")
        await page.wait_for_timeout(3000)

        # Open Backtest drawer
        print("2️⃣  Открытие панели бэктестера...")
        drawer_btn = page.locator("[data-testid='btn-toggle-backtest-drawer']").first
        if await drawer_btn.is_visible():
            await drawer_btn.click()
            await page.wait_for_timeout(1000)

        # Inspect initial input values
        sl_input = page.locator("label:has-text('SL') input").first
        tp_input = page.locator("label:has-text('TP') input").first

        initial_sl = await sl_input.input_value() if await sl_input.count() > 0 else "N/A"
        initial_tp = await tp_input.input_value() if await tp_input.count() > 0 else "N/A"
        print(f"   • Исходные настройки UI: SL = {initial_sl}%, TP = {initial_tp}%")

        # Modify values
        print("3️⃣  Изменение параметров на кастомные: SL = 1.15%, TP = 3.25%...")
        if await sl_input.count() > 0:
            await sl_input.fill("1.15")
        if await tp_input.count() > 0:
            await tp_input.fill("3.25")
        await page.wait_for_timeout(500)

        # Run single backtest
        print("4️⃣  Запуск бэктеста из панели и захват сетевого запроса...")
        captured_requests.clear()
        run_btn = page.locator("[data-testid='btn-run-single']").first
        if await run_btn.is_visible():
            await run_btn.click()
            await page.wait_for_timeout(3000)

        if captured_requests:
            req_data = captured_requests[-1]["data"]
            sent_params = req_data.get("params", {})
            print(f"   • Запрос отправлен для символа: {req_data.get('symbol')}")
            print(f"   • Передано в params: SL = {sent_params.get('stop_loss_pct')}%, TP = {sent_params.get('take_profit_pct')}%")
            print(f"   • Переданы фильтры: CVD={sent_params.get('use_cvd_filter')}, RSI={sent_params.get('use_rsi_filter')}, ATR={sent_params.get('use_atr_filter')}")
        else:
            print("   ⚠️ Запрос /api/backtest/run не был перехвачен.")

        # Test Ticker switch: change symbol from BTC to SOLUSDT
        print("\n5️⃣  Переключение монеты на SOLUSDT и проверка изоляции параметров...")
        sol_btn = page.locator("text=SOL").first
        if await sol_btn.is_visible():
            await sol_btn.click()
            await page.wait_for_timeout(2000)

        # Check what is in the inputs now for SOLUSDT
        sol_sl = await page.locator("label:has-text('SL') input").first.input_value()
        sol_tp = await page.locator("label:has-text('TP') input").first.input_value()
        print(f"   • Значения в полях после переключения на SOL: SL = {sol_sl}%, TP = {sol_tp}%")
        is_isolated = (sol_sl != "1.15")
        if is_isolated:
            print("   ✅ Изоляция работает: SOL имеет собственные настройки.")
        else:
            print("   ❌ Настройки НЕ изолированы: кастомный SL 1.15% от BTC перетёк на SOL!")

        # Test Reload Persistence
        print("\n6️⃣  Перезагрузка страницы (F5) и проверка сохранения...")
        await page.reload()
        await page.wait_for_timeout(3000)

        # Open drawer again
        drawer_btn = page.locator("[data-testid='btn-toggle-backtest-drawer']").first
        if await drawer_btn.is_visible():
            await drawer_btn.click()
            await page.wait_for_timeout(1000)

        reloaded_sl = await page.locator("label:has-text('SL') input").first.input_value()
        reloaded_tp = await page.locator("label:has-text('TP') input").first.input_value()
        print(f"   • Значения в полях после перезагрузки: SL = {reloaded_sl}%, TP = {reloaded_tp}%")
        if reloaded_sl == "1.15":
            print("   ✅ Настройки сохранились после перезагрузки.")
        else:
            print(f"   ❌ Настройки СБРОСИЛИСЬ на дефолт ({reloaded_sl}% / {reloaded_tp}%)!")

        # Test 1-click Chart HUD backtest payload
        print("\n7️⃣  Проверка 1-клик кнопки 'Тест сетапа' в HUD графика...")
        test_hud_btn = page.locator("[data-testid='btn-quick-backtest-setup']").first
        captured_requests.clear()
        if await test_hud_btn.is_visible():
            await test_hud_btn.click(force=True)
            await page.wait_for_timeout(2000)
            if captured_requests:
                hud_req = captured_requests[-1]["data"]
                print(f"   • Запрос от HUD кнопки:")
                print(f"     Strategy: {hud_req.get('strategy_type')}")
                print(f"     Params: {json.dumps(hud_req.get('params'), indent=2)}")
                print(f"     stop_loss_pct: {hud_req.get('stop_loss_pct')} (в корне), {hud_req.get('params', {}).get('stop_loss_pct')} (в params)")
            else:
                print("   ⚠️ HUD backtest request not captured.")

        await browser.close()
        print("\n" + "=" * 76)
        print("✅ [QA-AUDIT] ТЕСТИРОВАНИЕ ЗАВЕРШЕНО")
        print("=" * 76)

if __name__ == "__main__":
    asyncio.run(run_audit())
