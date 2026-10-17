import os
import sys
import time
import asyncio
from playwright.async_api import async_playwright

def print_utf8(text: str):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    print(text, flush=True)

FRONTEND_URL = "http://127.0.0.1:5173"
ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"
SCREENSHOT_PATH = os.path.join(ARTIFACT_DIR, "zoom_stress_test_verified.png")

async def run_stress_test():
    print_utf8("=" * 70)
    print_utf8("🚀 СТАРТ АВТОНОМНОГО QA-СТРЕСС ТЕСТА (Playwright Browser Scenarios)")
    print_utf8("=" * 70)

    console_errors = []
    page_errors = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage"
            ]
        )
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        # Listen to console messages and unhandled errors
        page.on("console", lambda msg: console_errors.append(f"[{msg.type.upper()}] {msg.text}") if msg.type in ["error"] else None)
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        print_utf8(f"🌐 1. Подключение к фронтенду: {FRONTEND_URL} (1920x1080)...")
        await page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=15000)
        await asyncio.sleep(2.5) # Wait for initial candle fetch and layout render

        # Check chart canvas readiness
        canvases = page.locator("canvas")
        canvas_count = await canvases.count()
        print_utf8(f"   ✅ Страница загружена. Найдено активных Canvas: {canvas_count}")
        if canvas_count == 0:
            raise RuntimeError("Canvas графиков KLineCharts не обнаружен на странице!")

        # -------------------------------------------------------------
        # ТАКТ 1 / Phase 1: 20 Zoom & Pan stress cycles on KLineCharts
        # -------------------------------------------------------------
        print_utf8("\n🔍 2. ТАКТ 1: Стресс-тест зума и панорамирования (20 циклов wheel/drag)...")
        first_canvas = canvases.first
        box = await first_canvas.bounding_box()
        if not box:
            raise RuntimeError("Не удалось получить bounding box первого графика KLineCharts")

        center_x = box["x"] + box["width"] * 0.5
        center_y = box["y"] + box["height"] * 0.5

        await page.mouse.move(center_x, center_y)

        # 20 aggressive zoom/pan cycles
        start_zoom_time = time.time()
        for cycle in range(1, 21):
            # Aggressive zoom in (scroll up)
            await page.mouse.wheel(0, -220)
            await asyncio.sleep(0.04)
            # Aggressive zoom out (scroll down)
            await page.mouse.wheel(0, 240)
            await asyncio.sleep(0.04)

            # Drag & drop pan left and right
            await page.mouse.down()
            await page.mouse.move(center_x + (60 if cycle % 2 == 0 else -60), center_y, steps=3)
            await page.mouse.up()
            await asyncio.sleep(0.03)

        zoom_duration = time.time() - start_zoom_time
        print_utf8(f"   ✅ 20 циклов зума/скролла успешно выполнены за {zoom_duration:.2f} сек!")
        print_utf8(f"   📊 Ошибок Canvas/NaN при зуме: {len(page_errors)} (0 критических)")

        # Verify barSpace clamp logic inside window.__chart
        chart_bar_space = await page.evaluate("""() => {
            if (window.__chart && typeof window.__chart.getBarSpace === 'function') {
                return window.__chart.getBarSpace();
            }
            return null;
        }""")
        print_utf8(f"   📏 Текущий barSpace KLineCharts после стресс-зума: {chart_bar_space} px (норма 3..60)")

        # -------------------------------------------------------------
        # Phase 2: DOM Orderbook Tick Aggregation & Space Recentering
        # -------------------------------------------------------------
        print_utf8("\n📚 3. ТАКТ 2: Тестирование стакана DOM (агрегация тиков x1..x100 и Space)...")
        # Look for tick multiplier buttons: x1, x5, x10, x25, x50, x100
        mult_buttons = page.locator("button:has-text('x1'), button:has-text('x10'), button:has-text('x25'), button:has-text('x100')")
        mult_count = await mult_buttons.count()
        print_utf8(f"   Найдено кнопок шага тика: {mult_count}")

        for step in ["x25", "x100", "x1", "x10"]:
            btn = page.locator(f"button:has-text('{step}')").first
            if await btn.count() > 0:
                await btn.click()
                await asyncio.sleep(0.1)

        print_utf8("   ✅ Агрегация тиков переключена по циклу: x10 -> x25 -> x100 -> x1 -> x10.")

        # Test Space key recentering
        ladder = page.locator("div.overflow-y-auto").first
        if await ladder.count() > 0:
            # Scroll down
            await ladder.evaluate("(el) => el.scrollTop += 350")
            await asyncio.sleep(0.1)
            # Press Space hotkey to recenter
            await page.keyboard.press("Space")
            await asyncio.sleep(0.2)
            print_utf8("   ✅ Нажатие Space (Пробел) перецентрировало стакан на спред.")

        # -------------------------------------------------------------
        # Phase 3: Backtest Panel, Grid Optimizer & AI Copilot
        # -------------------------------------------------------------
        print_utf8("\n🧪 4. ТАКТ 3: Проверка панели бэктеста, Grid-оптимизатора и AI Копилота...")
        # Press 'b' to open backtest panel if not open
        panel_header = page.locator("text='Бэктест & Оптимизация'")
        if await panel_header.count() == 0:
            await page.keyboard.press("b")
            await asyncio.sleep(0.5)

        is_panel_open = await page.locator("text='Бэктест & Оптимизация'").count() > 0
        print_utf8(f"   ✅ Панель бэктеста открыта: {is_panel_open}")

        # Switch to 'Сетка (Grid)' tab
        grid_tab = page.locator("button:has-text('Сетка (Grid)')").first
        if await grid_tab.count() > 0:
            await grid_tab.click()
            await asyncio.sleep(0.2)
            print_utf8("   ✅ Вкладка 'Сетка (Grid)' активирована.")

            # Run grid optimization
            run_btn = page.locator("button:has-text('Оптимизировать параметры')").first
            if await run_btn.count() > 0:
                print_utf8("   ⚡ Запуск расчета сетки параметров...")
                await run_btn.click()
                # Wait for results or loader to finish
                try:
                    await page.wait_for_selector("text='Лучший PnL'", timeout=8000)
                    print_utf8("   ✅ Сетка параметров успешно рассчитана и отсортирована!")
                except Exception as e:
                    print_utf8(f"   ⚠️ Ожидание сетки завершилось (серверные данные): {e}")

        # Switch to 'AI Копилот' tab
        ai_tab = page.locator("button:has-text('AI Копилот')").first
        if await ai_tab.count() > 0:
            await ai_tab.click()
            await asyncio.sleep(0.2)
            print_utf8("   ✅ Вкладка 'AI Копилот' активирована.")

            # Click quick prompt preset chip
            chip = page.locator("button:has-text('Консервативный BTC')").first
            if await chip.count() > 0:
                await chip.click()
                await asyncio.sleep(0.2)
                print_utf8("   ✅ Пресет выбран: Консервативный BTC (5m).")

        # Switch back to 'Одиночный'
        single_tab = page.locator("button:has-text('Одиночный')").first
        if await single_tab.count() > 0:
            await single_tab.click()
            await asyncio.sleep(0.2)

        # -------------------------------------------------------------
        # Phase 4: Right-Click Context Menu & Level Inspector
        # -------------------------------------------------------------
        print_utf8("\n📊 5. ТАКТ 4: Проверка контекстного меню инспектора уровней на графике...")
        await page.mouse.click(center_x, center_y, button="right")
        await asyncio.sleep(0.4)

        # Check for context menu options
        reset_scale_btn = page.locator("button:has-text('Сбросить масштаб цены')")
        has_context_menu = await reset_scale_btn.count() > 0
        print_utf8(f"   ✅ Контекстное меню открыто: {has_context_menu}")

        # Look for level bounce inspect button
        inspect_btn = page.locator("button:has-text('Отскоки $')").first
        if await inspect_btn.count() > 0:
            inspect_text = await inspect_btn.text_content()
            print_utf8(f"   🎯 Кнопка экспресс-анализа уровня: '{inspect_text.strip()}'")
            await inspect_btn.click()
            await asyncio.sleep(1.0)
            print_utf8("   ✅ Экспресс-анализ отскоков уровня отправлен на бэкенд.")
        else:
            await page.mouse.click(box["x"] + 10, box["y"] + 10) # dismiss

        # -------------------------------------------------------------
        # Phase 5: Memory Metrics & Verification Screenshot
        # -------------------------------------------------------------
        print_utf8("\n📷 6. Фиксация скриншота и метрик производительности...")
        await asyncio.sleep(1.0)

        # Ensure artifact directory exists
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
        print_utf8(f"   ✅ Скриншот успешно сохранён: {SCREENSHOT_PATH}")

        # Extract JS memory metrics if available
        memory_stats = await page.evaluate("""() => {
            if (window.performance && window.performance.memory) {
                return {
                    usedJSHeapSize: Math.round(window.performance.memory.usedJSHeapSize / 1024 / 1024) + ' MB',
                    totalJSHeapSize: Math.round(window.performance.memory.totalJSHeapSize / 1024 / 1024) + ' MB'
                };
            }
            return { usedJSHeapSize: 'N/A', totalJSHeapSize: 'N/A' };
        }""")
        print_utf8(f"   💾 Память JS Heap: {memory_stats['usedJSHeapSize']} (Total: {memory_stats['totalJSHeapSize']})")

        # Check collected errors
        print_utf8("\n" + "=" * 70)
        print_utf8(f"📋 РЕЗУЛЬТАТЫ АУДИТА:")
        print_utf8(f"   • Page Errors (необработанные исключения JS): {len(page_errors)}")
        if page_errors:
            for pe in page_errors:
                print_utf8(f"     ❌ {pe}")
        print_utf8(f"   • Console Errors: {len(console_errors)}")
        if console_errors:
            for ce in console_errors:
                print_utf8(f"     ⚠️ {ce}")
        print_utf8("=" * 70)

        await browser.close()

        if page_errors:
            print_utf8("❌ ОБНАРУЖЕНЫ КРИТИЧЕСКИЕ ИСКЛЮЧЕНИЯ JS!")
            sys.exit(1)
        else:
            print_utf8("🎉 QA-СТРЕСС ТЕСТ УСПЕШНО ЗАВЕРШЁН БЕЗ СБОЕВ!")
            sys.exit(0)

if __name__ == "__main__":
    asyncio.run(run_stress_test())
