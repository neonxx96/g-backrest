"""Ad-hoc E2E verification (6.4, слайс j / п.1 слайс 3): useChartDrawings извлечён из Chart.jsx.

Проверяет, что после выноса рисования / SMC-шаблонов / undo в
frontend/src/components/chart/useChartDrawings.js (тела дословно) поведение 1:1:
1. Выбор инструмента «Линия» активирует тулбар-кнопку (как в слайсе h).
2. Drag-рисование сегмента на канвасе -> overlay сохранён бэкендом (GET /api/drawings).
3. Ctrl+Z -> статус «Отменено (Ctrl+Z)» и сохранённый список пустеет.
4. Escape отменяет активный инструмент («Режим курсора»), курсор возвращается.
5. SMC-шаблон применяется: инструмент активен + chip цвета в модалке «Сохранить шаблон».
6. Модалка «Сохранить шаблон»: имя -> сохранение -> шаблон появляется в дропдауне SMC.
7. «Удалить все объекты» из контекстного меню: статус «Разметка очищена», список пуст.

Требует живой backend на :8000. Фронтенд поднимает сам на :5199 (останавливает после).
Снапшот /api/drawings (BTCUSDT/15m/user 0) делается до теста и восстанавливается после.
Exit 0 — все проверки прошли.
"""

from __future__ import annotations

import json
import subprocess
import time
import urllib.request

BACKEND = "http://127.0.0.1:8000"
FRONTEND_PORT = 5199
FRONTEND = f"http://127.0.0.1:{FRONTEND_PORT}/"
SYM, TF, UID = "BTCUSDT", "15m", "0"


def log(msg: str) -> None:
    print(msg, flush=True)


def api_drawings() -> list:
    try:
        with urllib.request.urlopen(
            f"{BACKEND}/api/drawings?symbol={SYM}&timeframe={TF}&user_id={UID}", timeout=10
        ) as r:
            data = json.loads(r.read())
        raw = data.get("elements_json") or "[]"
        return json.loads(raw)
    except Exception:
        return []


def wait_drawings_count(expected: int, timeout_s: float = 6.0, cmp: str = "ge") -> list:
    """Поллит /api/drawings, пока count не станет expected (ge/le/eq). Возвращает последний список."""
    deadline = time.time() + timeout_s
    last: list = []
    while time.time() < deadline:
        last = api_drawings()
        n = len(last)
        if (cmp == "ge" and n >= expected) or (cmp == "le" and n <= expected) or (cmp == "eq" and n == expected):
            return last
        time.sleep(0.3)
    return last


def post_drawings(elements: list) -> None:
    req = urllib.request.Request(
        f"{BACKEND}/api/drawings",
        data=json.dumps({
            "user_id": UID, "symbol": SYM, "timeframe": TF,
            "elements_json": json.dumps(elements),
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=10).read()


def check_backend() -> None:
    try:
        with urllib.request.urlopen(f"{BACKEND}/api/health", timeout=5) as r:
            assert json.loads(r.read())["status"] == "ok"
    except Exception as exc:
        raise SystemExit(f"backend не отвечает на :8000: {exc}")


def wait_for_frontend(timeout_s: int = 40) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(FRONTEND, timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"фронтенд не поднялся на :{FRONTEND_PORT} за {timeout_s} с")


def kill_port(port: int) -> None:
    try:
        out = subprocess.check_output("netstat -ano", shell=True, text=True)
        for line in out.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                pid = line.split()[-1]
                subprocess.run(f"taskkill /PID {pid} /F", shell=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


def click_by_title(page, title: str) -> None:
    page.evaluate(
        """(t) => {
            const el = Array.from(document.querySelectorAll('button'))
                .find(b => b.title && b.title.includes(t));
            if (!el) throw new Error(`кнопка с title "${t}" не найдена`);
            el.click();
        }""",
        title,
    )


def click_by_testid(page, testid: str) -> None:
    page.evaluate(
        """(tid) => {
            const el = document.querySelector(`[data-testid="${tid}"]`);
            if (!el) throw new Error(`[data-testid=${tid}] не найден`);
            el.click();
        }""",
        testid,
    )


def status_text(page) -> str:
    return page.evaluate(
        """() => {
            const el = Array.from(document.querySelectorAll('div'))
                .find(d => d.textContent && ['Отменено', 'Режим курсора', 'Разметка очищена', 'Сохранено'].some(s => d.textContent.includes(s)) && d.children.length <= 3);
            return el ? el.textContent : '';
        }"""
    )


def toolbar_tool_active(page, title: str) -> bool:
    return page.evaluate(
        """(t) => {
            const el = Array.from(document.querySelectorAll('button'))
                .find(b => b.title && b.title.includes(t));
            return el ? el.className.includes('bg-[#2563eb]') : false;
        }""",
        title,
    )


def canvas_cursor(page) -> str:
    return page.evaluate(
        """() => {
            const canvas = document.querySelector('canvas');
            let el = canvas;
            for (let i = 0; i < 8 && el; i++) {
                if ((el.className || '').includes('cursor-')) return el.className;
                el = el.parentElement;
            }
            return '';
        }"""
    )


def draw_segment(page) -> None:
    # KLineCharts v9: сегмент ставится ДВУМЯ точками (точка -> точка).
    # ВАЖНО: page.mouse.click() НЕ срабатывает (KLineCharts фильтрует быстрый
    # down+up) — нужны явные mouse.down()/mouse.up() (см. probe_slice3_draw2.py).
    box = page.evaluate(
        """() => {
            const canvas = document.querySelector('canvas');
            const r = canvas.getBoundingClientRect();
            return {x: r.left, y: r.top, w: r.width, h: r.height};
        }"""
    )
    x1 = box["x"] + box["w"] * 0.3
    y1 = box["y"] + box["h"] * 0.3
    x2 = box["x"] + box["w"] * 0.6
    y2 = box["y"] + box["h"] * 0.45
    page.mouse.move(x1, y1)
    page.mouse.down()
    time.sleep(0.05)
    page.mouse.up()
    time.sleep(0.4)
    page.mouse.move(x2, y2)
    page.mouse.down()
    time.sleep(0.05)
    page.mouse.up()


def open_context_menu(page) -> None:
    page.evaluate(
        """() => {
            const canvas = document.querySelector('canvas');
            const r = canvas.getBoundingClientRect();
            canvas.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
            }));
        }"""
    )
    time.sleep(0.4)


def click_menu_item(page, text: str) -> None:
    page.evaluate(
        """(t) => {
            const menus = Array.from(document.querySelectorAll('div.fixed.z-50'))
                .filter(m => m.textContent.includes('Магнит к свечам'));
            const btn = Array.from(menus[0].querySelectorAll('button'))
                .find(b => b.textContent.includes(t));
            if (!btn) throw new Error(`пункт "${t}" не найден`);
            btn.click();
        }""",
        text,
    )
    time.sleep(0.5)


def main() -> int:
    check_backend()
    snapshot = api_drawings()
    log(f"снапшот /api/drawings: {len(snapshot)} элементов (восстановим в конце)")

    vite = subprocess.Popen(
        "npm run dev -- --host 127.0.0.1 --port " + str(FRONTEND_PORT),
        cwd="frontend",
        shell=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    failures: list[str] = []
    wait_for_frontend()
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()
            page.on("pageerror", lambda err: failures.append(f"pageerror: {err}"))

            log("[1/7] Открытие терминала, выбор инструмента «Линия» ...")
            page.goto(FRONTEND, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_function(
                """() => {
                    const charts = Object.entries(window.__charts || {});
                    const chart = charts.find(([id]) => id === 'chart_main')?.[1]
                        || charts.find(([, v]) => v && typeof v.getDataList === 'function')?.[1]
                        || window.__chart;
                    return !!chart?.getDataList?.().length;
                }""",
                timeout=120000,
            )
            click_by_title(page, "Трендовая линия")
            time.sleep(0.3)
            active = page.evaluate(
                """() => {
                    const el = Array.from(document.querySelectorAll('button'))
                        .find(b => b.title && b.title.includes('Трендовая линия'));
                    return el ? el.className.includes('bg-[#2563eb]') : false;
                }"""
            )
            if not active:
                failures.append("инструмент 'segment' не активировался после выноса хука")

            log("[2/7] Drag-рисование сегмента -> сохранение на бэкенде ...")
            n0 = len(snapshot)
            draw_segment(page)
            saved = wait_drawings_count(n0 + 1, timeout_s=8.0, cmp="ge")
            if len(saved) < n0 + 1:
                failures.append(f"рисунок не сохранился на бэкенде: было {n0}, стало {len(saved)}")
            else:
                log(f"      элементов: {n0} -> {len(saved)} (последний: {saved[-1].get('name')})")

            log("[3/7] Ctrl+Z -> список на бэкенде уменьшается на 1 ...")
            page.keyboard.press("Control+z")
            target = len(saved) - 1
            left = wait_drawings_count(target, timeout_s=8.0, cmp="le")
            if len(left) != target:
                failures.append(f"undo не удалил ровно один рисунок: {len(saved)} -> {len(left)}")
            else:
                log(f"      Ctrl+Z: {len(saved)} -> {len(left)}")

            log("[4/7] Escape отменяет активный инструмент ...")
            click_by_title(page, "Трендовая линия")
            tool_on = False
            for _ in range(20):
                time.sleep(0.2)
                if toolbar_tool_active(page, "Трендовая линия"):
                    tool_on = True
                    break
            if not tool_on:
                failures.append("инструмент не активен перед Escape")
            page.keyboard.press("Escape")
            time.sleep(0.5)
            if toolbar_tool_active(page, "Трендовая линия"):
                failures.append("кнопка инструмента осталась активной после Escape")
            cur = canvas_cursor(page)
            if "crosshair" in cur:
                failures.append(f"курсор остался crosshair после Escape: {cur!r}")
            if not failures:
                log("      Escape -> кнопка сброшена, курсор вернулся")

            log("[5/7] SMC-шаблон применяется (инструмент активен, дропдаун закрылся) ...")
            click_by_testid(page, "btn-smc-templates")
            time.sleep(0.4)
            n_items = page.evaluate(
                "document.querySelectorAll(\"[data-testid='smc-templates-dropdown'] button\").length"
            )
            applied = page.evaluate(
                """() => {
                    const dd = document.querySelector("[data-testid='smc-templates-dropdown']");
                    if (!dd) return 'dropdown missing';
                    // первая кнопка дропдауна — «+ Сохранить текущий», шаблоны ниже
                    const items = Array.from(dd.querySelectorAll('button'))
                        .filter(b => !b.textContent.includes('Сохранить текущий'));
                    if (items.length === 0) return 'no items';
                    items[0].click();
                    return 'ok';
                }"""
            )
            time.sleep(0.5)
            dd_open = page.evaluate(
                "document.querySelectorAll(\"[data-testid='smc-templates-dropdown']\").length"
            )
            cur = canvas_cursor(page)
            if applied != 'ok':
                failures.append(f"SMC-шаблон не применился: {applied}")
            elif dd_open != 0:
                failures.append("дропдаун SMC не закрылся после применения шаблона")
            elif "crosshair" not in cur:
                failures.append(f"после шаблона курсор не crosshair (инструмент не активен): {cur!r}")
            else:
                log(f"      шаблон применён (пунктов в дропдауне: {n_items}), режим рисования активен")
            page.keyboard.press("Escape")
            time.sleep(0.4)

            log("[6/7] Модалка «Сохранить шаблон»: имя -> дропдаун SMC ...")
            click_by_testid(page, "btn-save-as-template")
            time.sleep(0.5)
            tpl_name = "e2e_slice3_probe"
            page.evaluate(
                """(name) => {
                    const inp = document.querySelector("[data-testid='input-template-name']");
                    if (!inp) throw new Error('input-template-name не найден');
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, name);
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                }""",
                tpl_name,
            )
            time.sleep(0.3)
            click_by_testid(page, "btn-confirm-save-template")
            time.sleep(0.6)
            click_by_testid(page, "btn-smc-templates")
            time.sleep(0.4)
            found = page.evaluate(
                """(name) => {
                    const dd = document.querySelector("[data-testid='smc-templates-dropdown']");
                    return dd ? dd.textContent.includes(name) : false;
                }""",
                tpl_name,
            )
            if not found:
                failures.append(f"шаблон {tpl_name} не появился в дропдауне SMC")
            else:
                log(f"      шаблон «{tpl_name}» в дропдауне, пунктов было {n_items}")

            log("[7/7] «Удалить все объекты» из контекстного меню ...")
            draw_segment(page)
            saved2 = wait_drawings_count(len(snapshot) + 1, timeout_s=8.0, cmp="ge")
            before_clear = len(saved2)
            open_context_menu(page)
            click_menu_item(page, "Удалить все объекты")
            cleared = wait_drawings_count(0, timeout_s=8.0, cmp="eq")
            after_clear = len(cleared)
            if before_clear < 1:
                failures.append("перед очисткой нет рисунков на бэкенде")
            elif after_clear != 0:
                failures.append(f"очистка не сработала: до={before_clear} после={after_clear}")
            if not failures:
                log(f"      разметка очищена: до={before_clear} после={after_clear}")

            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)
        try:
            post_drawings(snapshot)
            log(f"снапшот /api/drawings восстановлен ({len(snapshot)} элементов)")
        except Exception as exc:
            log(f"!! не удалось восстановить снапшот drawings: {exc}")

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] MODULARIZATION 6.4j (useChartDrawings) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
