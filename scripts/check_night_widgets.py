"""Проверка виджетов: Футпринт (активная вкладка), CVD, Лента.

Под нагрузкой ночного марафона бэкенд отвечает по 3+ с — ожидания большие.
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:7100/"
errors = []

def activate_tab(page, prefix):
    locator = page.locator(".dv-tab")
    for i, t in enumerate(locator.all_inner_texts()):
        if t.strip().startswith(prefix):
            locator.nth(i).click()
            return True
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
    page.goto(URL, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(60000)  # раскладка с сервера может ждать HTTP-слот до ~2 мин

    # 1. Футпринт — активная вкладка группы 9 сразу после загрузки
    fp = page.locator('[data-testid="footprint-panel"]').first
    if fp.count() == 0:
        errors.append("footprint: не в DOM (активная вкладка на загрузке)")
    else:
        page.wait_for_timeout(15000)
        grid_children = fp.locator(".grid > *").count()
        sticky = fp.locator(".grid .sticky").count()
        print(f"footprint grid children: {grid_children}, sticky cells: {sticky}")
        if grid_children < 10:
            errors.append(f"footprint: мало ячеек ({grid_children})")
        if sticky < 10:
            errors.append("footprint: лесенка уровней не заполнилась")
        if fp.locator("text=ΣVol").count() == 0:
            errors.append("footprint: нет строки статистики")
        usdt_btn = fp.locator('button:has-text("USDT")')
        if usdt_btn.count() == 0:
            errors.append("footprint: нет переключателя USDT")
        else:
            usdt_btn.first.click()
            page.wait_for_timeout(1000)
            if fp.locator("text=USDT").count() == 0:
                errors.append("footprint: метка USDT не появилась")
            else:
                print("footprint USDT toggle: OK")

    # 2. CVD — активируем вкладку
    if not activate_tab(page, "CVD"):
        errors.append("cvd: вкладка не найдена")
    else:
        page.wait_for_timeout(20000)
        cvd = page.locator('[data-testid="cvd-widget"]').first
        if cvd.count() == 0:
            errors.append("cvd-widget: не в DOM после активации")
        else:
            box = cvd.bounding_box()
            print(f"CVD box: {box}")
            canvas = cvd.locator("canvas")
            if canvas.count() > 0:
                dims = canvas.evaluate("el => [el.width, el.height]")
                nonblank = canvas.evaluate(
                    "el => { const c = el.getContext('2d'); const d = c.getImageData(0,0,el.width,el.height).data; let n=0; for (let i=3;i<d.length;i+=4) if (d[i]>0) n++; return n; }"
                )
                print(f"CVD canvas: {dims}, non-blank px: {nonblank}")
                if dims[0] < 40 or dims[1] < 40 or nonblank == 0:
                    errors.append(f"cvd canvas пуст/мал: {dims} px={nonblank}")
            elif cvd.locator("text=Нет данных CVD").count() == 0:
                errors.append("cvd: ни canvas, ни empty-state")

    # 3. Лента
    if not activate_tab(page, "Лента сделок"):
        errors.append("tape: вкладка не найдена")
    else:
        page.wait_for_timeout(4000)
        coin_btn = page.locator('[data-testid="btn-tape-unit-coin"]')
        usd_btn = page.locator('[data-testid="btn-tape-unit-usd"]')
        if coin_btn.count() == 0 or usd_btn.count() == 0:
            errors.append("tape: нет переключателя единиц")
        else:
            col_header = page.locator('[data-testid="trades-widget"] .h-5', has_text="Объем")
            coin_btn.first.click()
            page.wait_for_timeout(800)
            h_coin = col_header.last.inner_text().strip()
            usd_btn.first.click()
            page.wait_for_timeout(800)
            h_usd = col_header.last.inner_text().strip()
            print(f"tape headers: COIN->{h_coin!r} USDT->{h_usd!r}")
            if "COIN" not in h_coin or "USD" not in h_usd:
                errors.append(f"tape: заголовки не переключаются: {h_coin!r} / {h_usd!r}")
            else:
                print("tape unit toggle: OK")

    browser.close()

if errors:
    print("FAIL:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("OK: все проверки виджетов пройдены")
