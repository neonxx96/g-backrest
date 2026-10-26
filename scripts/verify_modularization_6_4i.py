"""Ad-hoc E2E verification (6.4, слайс i / п.1 слайс 2): ChartContextMenu извлечён из Chart.jsx.

Проверяет, что после выноса контекстного меню (правый клик) и карточки
экспресс-инспектора отскоков в frontend/src/components/chart/ChartContextMenu.jsx
(хук useChartContextMenu + управляемый компонент, JSX/обработчики дословно)
поведение графика 1:1:
1. Правый клик по канвасу -> меню открывается со всеми пунктами.
2. «Магнит к свечам» -> переключается (галочка при повторном открытии), меню закрывается.
3. «Показать EMA(20)» -> состояние EMA меняется (галочка при повторном открытии).
4. «✕ Закрыть» закрывает меню; Escape тоже закрывает.
5. «Отскоки $...» -> карточка инспектора (КАСАНИЙ/WINRATE/СР. ИМПУЛЬС) от живого API;
   «✕» в карточке закрывает её.

Требует живой backend на :8000 (inspect-level). Фронтенд поднимает сам на :5199.
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

MENU_ITEMS = [
    "Сбросить масштаб цены",
    "Удалить все объекты",
    "Магнит к свечам",
    "Показать EMA(20)",
    "Показать объём (VOL)",
    "✕ Закрыть",
]


def log(msg: str) -> None:
    print(msg, flush=True)


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


def open_context_menu(page) -> None:
    """Диспатчит нативный contextmenu по центру канваса (всплывёт к React-хендлеру)."""
    page.evaluate(
        """() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) throw new Error('canvas не найден');
            const r = canvas.getBoundingClientRect();
            const ev = new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true,
                clientX: r.left + r.width / 2,
                clientY: r.top + r.height / 2,
            });
            canvas.dispatchEvent(ev);
        }"""
    )
    time.sleep(0.4)


def menu_visible(page) -> bool:
    return page.evaluate(
        """() => {
            const menus = Array.from(document.querySelectorAll('div.fixed.z-50'));
            return menus.some(m => m.textContent.includes('Магнит к свечам'));
        }"""
    )


def click_menu_item(page, text: str) -> None:
    page.evaluate(
        """(t) => {
            const menus = Array.from(document.querySelectorAll('div.fixed.z-50'))
                .filter(m => m.textContent.includes('Магнит к свечам'));
            const menu = menus[0];
            if (!menu) throw new Error('контекстное меню не открыто');
            const btn = Array.from(menu.querySelectorAll('button'))
                .find(b => b.textContent.includes(t));
            if (!btn) throw new Error(`пункт меню "${t}" не найден`);
            btn.click();
        }""",
        text,
    )
    time.sleep(0.4)


def menu_item_checked(page, text: str) -> bool:
    # У «Магнит» базовая иконка Magnet всегда есть — галочка Check = ВТОРОЙ svg.
    min_svgs = 2 if "Магнит" in text else 1
    return page.evaluate(
        """([t, minSvgs]) => {
            const menus = Array.from(document.querySelectorAll('div.fixed.z-50'))
                .filter(m => m.textContent.includes('Магнит к свечам'));
            const menu = menus[0];
            if (!menu) return false;
            const btn = Array.from(menu.querySelectorAll('button'))
                .find(b => b.textContent.includes(t));
            return !!btn && btn.querySelectorAll('svg').length >= minSvgs;
        }""",
        [text, min_svgs],
    )


def inspector_visible(page) -> bool:
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('div.w-80'))
            .some(d => d.textContent.includes('КАСАНИЙ') && d.textContent.includes('WINRATE'))
        """
    )


def close_inspector(page) -> None:
    page.evaluate(
        """() => {
            const card = Array.from(document.querySelectorAll('div'))
                .find(d => d.textContent.includes('КАСАНИЙ') && d.textContent.includes('WINRATE')
                     && d.className.includes('w-80'));
            if (!card) throw new Error('карточка инспектора не найдена');
            const btn = Array.from(card.querySelectorAll('button'))
                .find(b => b.textContent.trim() === '✕');
            if (!btn) throw new Error('кнопка ✕ в карточке не найдена');
            btn.click();
        }"""
    )
    time.sleep(0.4)


def main() -> int:
    check_backend()

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

            log("[1/5] Открытие терминала, правый клик -> контекстное меню ...")
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
            open_context_menu(page)
            if not menu_visible(page):
                failures.append("контекстное меню не открылось по правому клику")
            else:
                for item in MENU_ITEMS:
                    ok = page.evaluate(
                        """(t) => {
                            const menus = Array.from(document.querySelectorAll('div.fixed.z-50'))
                                .filter(m => m.textContent.includes('Магнит к свечам'));
                            const menu = menus[0];
                            if (!menu) return false;
                            return Array.from(menu.querySelectorAll('button'))
                                .some(b => b.textContent.includes(t));
                        }""",
                        item,
                    )
                    if not ok:
                        failures.append(f"пункт меню '{item}' не найден")
                has_bounce = page.evaluate(
                    """() => {
                        const menus = Array.from(document.querySelectorAll('div.fixed.z-50'))
                            .filter(m => m.textContent.includes('Магнит к свечам'));
                        const menu = menus[0];
                        return menu ? menu.textContent.includes('Отскоки $') : false;
                    }"""
                )
                if not has_bounce:
                    failures.append("пункт 'Отскоки $...' (с ценой) не найден")
            if not failures:
                log("      меню открылось, все 7 пунктов на месте")

            log("[2/5] «Магнит к свечам» -> переключение и галочка ...")
            mag_before = menu_item_checked(page, "Магнит к свечам")
            click_menu_item(page, "Магнит к свечам")
            if menu_visible(page):
                failures.append("меню не закрылось после клика по «Магнит»")
            open_context_menu(page)
            mag_after = menu_item_checked(page, "Магнит к свечам")
            if mag_before == mag_after:
                failures.append(f"магнит не переключился: before={mag_before} after={mag_after}")
            click_menu_item(page, "Магнит к свечам")  # вернуть как было
            if not failures:
                log(f"      магнит переключён {mag_before} -> {mag_after} и возвращён")

            log("[3/5] «Показать EMA(20)» -> переключение и галочка ...")
            open_context_menu(page)
            ema_before = menu_item_checked(page, "Показать EMA(20)")
            click_menu_item(page, "Показать EMA(20)")
            open_context_menu(page)
            ema_after = menu_item_checked(page, "Показать EMA(20)")
            if ema_before == ema_after:
                failures.append(f"EMA не переключилась: before={ema_before} after={ema_after}")
            click_menu_item(page, "Показать EMA(20)")  # вернуть как было
            if not failures:
                log(f"      EMA переключена {ema_before} -> {ema_after} и возвращена")

            log("[4/5] Закрытие: «✕ Закрыть» и Escape ...")
            open_context_menu(page)
            click_menu_item(page, "✕ Закрыть")
            if menu_visible(page):
                failures.append("«✕ Закрыть» не закрыл меню")
            open_context_menu(page)
            page.keyboard.press("Escape")
            time.sleep(0.4)
            if menu_visible(page):
                failures.append("Escape не закрыл меню")
            if not failures:
                log("      «✕ Закрыть» и Escape закрывают меню")

            log("[5/5] «Отскоки $...» -> карточка инспектора от живого API ...")
            open_context_menu(page)
            click_menu_item(page, "Отскоки $")
            page.wait_for_function(
                """() => Array.from(document.querySelectorAll('div.w-80'))
                    .some(d => d.textContent.includes('КАСАНИЙ') && d.textContent.includes('WINRATE'))""",
                timeout=30000,
            )
            txt = page.evaluate(
                """() => {
                    const card = Array.from(document.querySelectorAll('div.w-80'))
                        .find(d => d.textContent.includes('КАСАНИЙ') && d.textContent.includes('WINRATE'));
                    return card ? card.textContent : '';
                }"""
            )
            if "СР. ИМПУЛЬС" not in txt or "Период:" not in txt:
                failures.append(f"в карточке нет блока импульса/периода: {txt[:120]!r}")
            log(f"      карточка: {txt[:110]}...")
            close_inspector(page)
            if inspector_visible(page):
                failures.append("карточка инспектора не закрылась по ✕")

            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] MODULARIZATION 6.4i (ChartContextMenu) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
