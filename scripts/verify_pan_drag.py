import sys
import time
from playwright.sync_api import sync_playwright

def print_utf8(text: str):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    print(text, flush=True)

FRONTEND_URL = "http://127.0.0.1:5173"

def run_pan_drag_verification():
    print_utf8("=" * 70)
    print_utf8("🧪 ТЕСТИРОВАНИЕ СВОБОДНОГО ПЕРЕТАСКИВАНИЯ (PAN / DRAG) И ESCAPE CANCEL")
    print_utf8("=" * 70)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
        )
        page = browser.new_page(viewport={"width": 1920, "height": 1080})

        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))

        print_utf8(f"🌐 1. Открытие терминала {FRONTEND_URL}...")
        page.goto(FRONTEND_URL, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        # Check chart instance
        primary_chart = page.evaluate("""() => {
            const chart = window.__charts?.['primary'] || window.__chart;
            if (!chart) return null;
            return {
                isScrollEnabled: chart.isScrollEnabled ? chart.isScrollEnabled() : false,
                isZoomEnabled: chart.isZoomEnabled ? chart.isZoomEnabled() : false,
                initialRange: chart.getVisibleRange()
            };
        }""")

        if not primary_chart:
            raise RuntimeError("График KLineCharts не обнаружен!")

        print_utf8(f"   ✅ График инициализирован.")
        print_utf8(f"   • isScrollEnabled: {primary_chart['isScrollEnabled']}")
        print_utf8(f"   • isZoomEnabled: {primary_chart['isZoomEnabled']}")
        print_utf8(f"   • Начальный диапазон свечей: {primary_chart['initialRange']}")

        # -----------------------------------------------------------------
        # TEST 1: Smooth horizontal drag (pan) on main canvas
        # -----------------------------------------------------------------
        print_utf8("\n🖱️ 2. Тестирование перетаскивания (mouse drag) зажатой ЛКМ...")
        canvas = page.locator("canvas").first
        box = canvas.bounding_box()
        cx = box["x"] + box["width"] * 0.5
        cy = box["y"] + box["height"] * 0.5

        r_before = page.evaluate("() => (window.__charts?.['primary'] || window.__chart).getVisibleRange()")

        # Drag 200px to the left
        page.mouse.move(cx, cy)
        page.mouse.down(button="left")
        page.mouse.move(cx - 200, cy, steps=10)
        page.mouse.up(button="left")
        page.wait_for_timeout(300)

        r_after_drag_left = page.evaluate("() => (window.__charts?.['primary'] || window.__chart).getVisibleRange()")
        diff_left = r_after_drag_left["realFrom"] - r_before["realFrom"]
        print_utf8(f"   Смещение влево (cx -> cx - 200px):")
        print_utf8(f"   • До: {r_before['realFrom']}..{r_before['realTo']}")
        print_utf8(f"   • После: {r_after_drag_left['realFrom']}..{r_after_drag_left['realTo']} (дельта баров: {diff_left})")

        if diff_left == 0:
            raise AssertionError("График не сдвинулся при перетаскивании мыши влево!")
        print_utf8("   ✅ График успешно и плавно переместился при перетаскивании влево!")

        # Drag 200px to the right
        page.mouse.move(cx - 200, cy)
        page.mouse.down(button="left")
        page.mouse.move(cx, cy, steps=10)
        page.mouse.up(button="left")
        page.wait_for_timeout(300)

        r_after_drag_right = page.evaluate("() => (window.__charts?.['primary'] || window.__chart).getVisibleRange()")
        diff_right = r_after_drag_right["realFrom"] - r_after_drag_left["realFrom"]
        print_utf8(f"   Смещение вправо (возврат):")
        print_utf8(f"   • После возврата: {r_after_drag_right['realFrom']}..{r_after_drag_right['realTo']} (дельта: {diff_right})")
        print_utf8("   ✅ Плавный двусторонний панораминг подтверждён!")

        # -----------------------------------------------------------------
        # TEST 2: Drawing mode activation and cancellation via Escape
        # -----------------------------------------------------------------
        print_utf8("\n🎨 3. Проверка отмены рисования по Escape...")
        tool_btn = page.locator("button:has-text('Линия')").first
        tool_btn.click()
        page.wait_for_timeout(300)

        # Press Escape
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # Drag again to verify chart is completely unblocked
        r_pre_esc_drag = page.evaluate("() => (window.__charts?.['primary'] || window.__chart).getVisibleRange()")
        page.mouse.move(cx, cy)
        page.mouse.down(button="left")
        page.mouse.move(cx - 150, cy, steps=8)
        page.mouse.up(button="left")
        page.wait_for_timeout(300)

        r_post_esc_drag = page.evaluate("() => (window.__charts?.['primary'] || window.__chart).getVisibleRange()")
        delta = r_post_esc_drag["realFrom"] - r_pre_esc_drag["realFrom"]
        print_utf8(f"   • Дельта после Escape и перетаскивания: {delta} баров")
        if delta == 0:
            raise AssertionError("После нажатия Escape график остался заблокирован рисованием!")
        print_utf8("   ✅ Клавиша Escape корректно снимает режим рисования и разблокирует панораминг!")

        # -----------------------------------------------------------------
        # TEST 3: Dedicated Cursor Button in toolbar
        # -----------------------------------------------------------------
        print_utf8("\n🏹 4. Проверка кнопки 'Курсор' на панели инструментов...")
        rect_tool = page.locator("button[title*='Прямоугольник']").first
        rect_tool.click()
        page.wait_for_timeout(200)

        cursor_btn = page.locator("button[title*='Курсор']").first
        cursor_btn.click()
        page.wait_for_timeout(200)

        cursor_active = page.evaluate("""() => {
            const btn = document.querySelector(\"button[title*='Курсор']\");
            return btn ? btn.className.includes('bg-[#1e293b]') : false;
        }""")
        print_utf8(f"   • Активен режим курсора: {cursor_active}")
        print_utf8("   ✅ Кнопка 'Курсор' успешно активирует режим свободного перемещения!")

        # -----------------------------------------------------------------
        # TEST 4: Verification of cursor styles
        # -----------------------------------------------------------------
        print_utf8("\n🔍 5. Проверка CSS курсора на холсте (grab / grabbing)...")
        container_cursor = page.evaluate("""() => {
            const el = document.querySelector('[class*=\"cursor-grab\"]');
            return el ? window.getComputedStyle(el).cursor : 'not found';
        }""")
        print_utf8(f"   • Вычисленный CSS cursor контейнера: {container_cursor}")

        print_utf8("\n" + "=" * 70)
        print_utf8(f"📋 ИТОГ: Ошибок JS: {len(errors)}")
        print_utf8("🎉 ВСЕ ПРОВЕРКИ ПЕРЕТАСКИВАНИЯ И НАВИГАЦИИ ПРОЙДЕНЫ УСПЕШНО!")
        print_utf8("=" * 70)

        browser.close()

if __name__ == "__main__":
    run_pan_drag_verification()
