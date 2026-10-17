import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"
os.makedirs(ARTIFACT_DIR, exist_ok=True)


async def run_verification():
    print("======================================================================")
    print("[1/5] Запуск браузерной верификации Docking Layout & Jitter-Free DOM")
    print("======================================================================")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1600, "height": 900})
        page = await context.new_page()

        await page.goto("http://127.0.0.1:5173", wait_until="networkidle")
        await page.wait_for_timeout(2500)

        # ------------------------------------------------------------------
        # ТЕСТ 1: Проверка стабильности стакана DOM за 5 секунд живого стрима
        # ------------------------------------------------------------------
        print("[2/5] Замер стабильности DOM-стакана в течение 5 секунд живого потока...")
        state_t0 = await page.evaluate("() => window.__domLadderState")
        assert state_t0 is not None, "window.__domLadderState не инициализирован!"
        assert state_t0["anchorPrice"] > 0, f"Некорректный anchorPrice: {state_t0}"

        scroll_samples = []
        anchor_samples = []
        for _ in range(10):
            await page.wait_for_timeout(500)
            st = await page.evaluate("() => window.__domLadderState")
            scroll_samples.append(st["scrollTop"])
            anchor_samples.append(st["anchorPrice"])

        state_t5 = await page.evaluate("() => window.__domLadderState")
        renders_in_5s = state_t5["renderCount"] - state_t0["renderCount"]
        unique_scrolls = set(scroll_samples)
        unique_anchors = set(anchor_samples)

        print(f" -> Anchor Price: {state_t0['anchorPrice']} (уникальных значений за 5с: {len(unique_anchors)})")
        print(f" -> ScrollTop: {state_t0['scrollTop']}px (уникальных значений за 5с: {len(unique_scrolls)})")
        print(f" -> Ререндеров объёма за 5 секунд (rAF throttle): {renders_in_5s}")

        assert len(unique_anchors) == 1, f"ОШИБКА: Ценовая шкала прыгала! Значения: {anchor_samples}"
        assert len(unique_scrolls) == 1, f"ОШИБКА: Скролл стакана самопроизвольно смещался! Значения: {scroll_samples}"
        assert renders_in_5s <= 70, f"ОШИБКА: Слишком много ререндеров за 5с ({renders_in_5s} > 70), троттлинг не работает!"
        print(" ✅ Стакан абсолютно статичен (0 скачков скролла и шкалы за 5 секунд)!")

        # ------------------------------------------------------------------
        # ТЕСТ 2: Интерактивный Drag-to-Resize разделителей и chart.resize()
        # ------------------------------------------------------------------
        print("[3/5] Проверка Drag-to-Resize разделителей и вызова chart.resize()...")
        initial_resizes = await page.evaluate("() => ({ ...(window.__chartResizeCounts || {}) })")

        # 2.1 Перетащим разделитель между графиками HTF и LTF вправо (+90px)
        chart_splitter = page.locator("[data-testid='splitter-charts']")
        assert await chart_splitter.count() == 1, "Разделитель графиков splitter-charts не найден!"
        box_cs = await chart_splitter.bounding_box()
        await page.mouse.move(box_cs["x"] + box_cs["width"] / 2, box_cs["y"] + box_cs["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(box_cs["x"] + 90, box_cs["y"] + box_cs["height"] / 2, steps=8)
        await page.mouse.up()
        await page.wait_for_timeout(300)

        # 2.2 Перетащим главный разделитель бокового дока влево (-80px, расширяя стакан и ленту)
        dock_splitter = page.locator("[data-testid='splitter-main-dock']")
        assert await dock_splitter.count() == 1, "Разделитель дока splitter-main-dock не найден!"
        box_ds = await dock_splitter.bounding_box()
        await page.mouse.move(box_ds["x"] + box_ds["width"] / 2, box_ds["y"] + box_ds["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(box_ds["x"] - 80, box_ds["y"] + box_ds["height"] / 2, steps=8)
        await page.mouse.up()
        await page.wait_for_timeout(300)

        # 2.3 Перетащим разделитель между DOM и Лентой сделок
        dom_splitter = page.locator("[data-testid='splitter-dom-tape']")
        assert await dom_splitter.count() == 1, "Разделитель splitter-dom-tape не найден!"
        box_dt = await dom_splitter.bounding_box()
        await page.mouse.move(box_dt["x"] + box_dt["width"] / 2, box_dt["y"] + box_dt["height"] / 2)
        await page.mouse.down()
        await page.mouse.move(box_dt["x"] - 35, box_dt["y"] + box_dt["height"] / 2, steps=5)
        await page.mouse.up()
        await page.wait_for_timeout(300)

        after_resizes = await page.evaluate("() => ({ ...(window.__chartResizeCounts || {}) })")
        saved_layout_raw = await page.evaluate("() => localStorage.getItem('terminal_layout_v1')")
        saved_layout = json.loads(saved_layout_raw)

        print(f" -> Счётчики chart.resize(): до={initial_resizes}, после={after_resizes}")
        print(f" -> Сохранённый layout в localStorage: {saved_layout}")

        assert after_resizes.get("primary", 0) > initial_resizes.get("primary", 0), "chart.resize() не вызвался для primary графика!"
        assert after_resizes.get("secondary", 0) > initial_resizes.get("secondary", 0), "chart.resize() не вызвался для secondary графика!"
        assert saved_layout["sidebarWidth"] > 500, "Новая ширина бокового дока не сохранилась в localStorage!"
        assert saved_layout["chartSplitPct"] > 50, "Новая пропорция графиков не сохранилась в localStorage!"
        print(" ✅ Drag-to-Resize разделителей и авто-ресайз KLineCharts работают безупречно!")

        # ------------------------------------------------------------------
        # ТЕСТ 3: Скрытие виджета кнопкой [×] и восстановление через «+ Виджеты»
        # ------------------------------------------------------------------
        print("[4/5] Проверка закрытия виджета кнопкой [×] и восстановления через меню '+ Виджеты'...")
        close_tape_btn = page.locator("button[title='Скрыть виджет ленты сделок']")
        assert await close_tape_btn.count() == 1, "Кнопка закрытия [×] на виджете Ленты не найдена!"
        await close_tape_btn.click()
        await page.wait_for_timeout(300)

        # Убедимся, что виджет Ленты скрылся
        assert await page.locator("button[title='Скрыть виджет ленты сделок']").count() == 0, "Виджет Ленты не закрылся!"
        print(" -> Виджет 'Лента сделок' успешно закрыт кнопкой [×].")

        # Открываем меню «+ Виджеты»
        widgets_btn = page.locator("[data-testid='widgets-menu-button']")
        await widgets_btn.click()
        await page.wait_for_timeout(300)

        dropdown = page.locator("[data-testid='widgets-dropdown']")
        assert await dropdown.is_visible(), "Меню управления виджетами не открылось!"

        # Включаем Ленту сделок обратно из меню «+ Виджеты»
        tape_toggle = page.locator("[data-testid='widget-toggle-tape']")
        await tape_toggle.click()
        await page.wait_for_timeout(400)

        assert await page.locator("button[title='Скрыть виджет ленты сделок']").count() == 1, "Виджет Ленты не восстановился из меню!"
        print(" -> Виджет 'Лента сделок' в 1 клик восстановлен через меню '+ Виджеты'!")

        # Сделаем скриншот с изменёнными размерами панелей и открытым меню «+ Виджеты»
        screenshot_path = os.path.join(ARTIFACT_DIR, "docking_and_stable_dom.png")
        await page.screenshot(path=screenshot_path, full_page=False)
        print(f"[5/5] Скриншот сохранён: {screenshot_path}")

        await browser.close()
        print("======================================================================")
        print("🎉 ВСЕ ПРОВЕРКИ DOCKING LAYOUT & JITTER-FREE DOM ПРОЙДЕНЫ УСПЕШНО!")
        print("======================================================================")


if __name__ == "__main__":
    asyncio.run(run_verification())
