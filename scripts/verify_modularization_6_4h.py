"""Ad-hoc E2E verification (6.4, слайс h / п.1 слайс 1): ChartToolbar извлечён из Chart.jsx.

Проверяет, что после выноса верхней полосы инструментов в
frontend/src/components/chart/ChartToolbar.jsx (управляемый компонент, вся
логика и состояние остались в Chart.jsx) поведение графика 1:1:
1. Тулбар рендерится: все ключевые data-testid на месте.
2. Выбор инструмента «Линия» -> активный класс; «Курсор» -> сброс.
3. Дропдаун «Шаблоны SMC» открывается (элементы списка) и закрывается.
4. Тумблер heatmap -> активный класс + localStorage chart_heatmap (возврат).
5. Селект «Плотность» -> localStorage chart_density_mode (возврат в auto).
6. Кнопка «Индикаторы [I]» открывает каталог индикаторов, Escape закрывает.

Требует живой backend на :8000. Фронтенд поднимает сам на :5199 (останавливает после).
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


def log(msg: str) -> None:
    print(msg, flush=True)


def check_backend() -> None:
    try:
        with urllib.request.urlopen(f"{BACKEND}/api/health", timeout=5) as r:
            assert json.loads(r.read())["status"] == "ok"
    except Exception as exc:
        raise SystemExit(f"backend не отвечает на :8000: {exc}")


def click_by_testid(page, testid: str) -> None:
    # dockview-sash перехватывает обычные playwright-клики — кликаем через DOM.
    page.evaluate(
        """(tid) => {
            const el = document.querySelector(`[data-testid="${tid}"]`);
            if (!el) throw new Error(`[data-testid=${tid}] не найден`);
            el.click();
        }""",
        testid,
    )


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
    # vite.terminate() убивает только npm-обёртку — дочищаем LISTENING-порт.
    try:
        out = subprocess.check_output("netstat -ano", shell=True, text=True)
        for line in out.splitlines():
            if f":{port}" in line and "LISTENING" in line:
                pid = line.split()[-1]
                subprocess.run(f"taskkill /PID {pid} /F", shell=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


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

            log("[1/6] Открытие терминала, тулбар и его data-testid ...")
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
            for tid in [
                "tool-risk-reward", "btn-smc-templates", "btn-save-as-template",
                "btn-toolbar-second-opinion", "btn-open-indicators-modal",
                "btn-toggle-signals", "btn-toolbar-toggle-heatmap",
                "btn-toolbar-toggle-footprint", "btn-toolbar-toggle-tpo",
                "btn-toolbar-toggle-walls", "btn-toolbar-toggle-cone",
                "density-mode-control",
            ]:
                if page.locator(f"[data-testid='{tid}']").count() == 0:
                    failures.append(f"data-testid '{tid}' не найден в тулбаре")
            if not failures:
                log("      все 12 data-testid тулбара на месте")

            log("[2/6] Инструмент «Линия» -> активный класс, «Курсор» -> сброс ...")
            click_by_title(page, "Трендовая линия")
            time.sleep(0.3)
            seg_active = page.evaluate(
                """() => {
                    const el = Array.from(document.querySelectorAll('button'))
                        .find(b => b.title && b.title.includes('Трендовая линия'));
                    return el ? el.className.includes('bg-[#2563eb]') : false;
                }"""
            )
            if not seg_active:
                failures.append("инструмент 'segment' не активировался")
            click_by_title(page, "Курсор")
            time.sleep(0.3)
            seg_after = page.evaluate(
                """() => {
                    const el = Array.from(document.querySelectorAll('button'))
                        .find(b => b.title && b.title.includes('Трендовая линия'));
                    return el ? el.className.includes('bg-[#2563eb]') : false;
                }"""
            )
            if seg_after:
                failures.append("«Курсор» не сбросил активный инструмент")
            if not failures:
                log("      выбор/сброс инструмента работает")

            log("[3/6] Дропдаун «Шаблоны SMC» ...")
            click_by_testid(page, "btn-smc-templates")
            time.sleep(0.3)
            dd = page.locator("[data-testid='smc-templates-dropdown']")
            if dd.count() == 0:
                failures.append("дропдаун SMC не открылся")
            else:
                items = page.locator("[data-testid='smc-templates-dropdown'] button").count()
                if items < 2:
                    failures.append(f"в дропдауне SMC мало элементов: {items}")
                else:
                    log(f"      дропдаун открыт, элементов: {items}")
                click_by_testid(page, "btn-smc-templates")
                time.sleep(0.3)
                if page.locator("[data-testid='smc-templates-dropdown']").count() != 0:
                    failures.append("дропдаун SMC не закрылся повторным кликом")

            log("[4/6] Тумблер heatmap -> класс + localStorage (и возврат) ...")
            click_by_testid(page, "btn-toolbar-toggle-heatmap")
            time.sleep(0.4)
            hm = page.evaluate(
                """() => ({
                    cls: document.querySelector("[data-testid='btn-toolbar-toggle-heatmap']").className,
                    ls: localStorage.getItem('chart_heatmap'),
                })"""
            )
            if hm["ls"] != "true" or "text-[#ff9800]" not in hm["cls"]:
                failures.append(f"heatmap не включился: {hm}")
            click_by_testid(page, "btn-toolbar-toggle-heatmap")
            time.sleep(0.4)
            hm2 = page.evaluate("() => localStorage.getItem('chart_heatmap')")
            if hm2 != "false":
                failures.append(f"heatmap не выключился: ls={hm2!r}")
            if not failures:
                log("      heatmap on/off + localStorage ok")

            log("[5/6] Селект «Плотность» -> localStorage (возврат в auto) ...")
            page.evaluate(
                """() => {
                    const sel = document.querySelector("[data-testid='density-mode-control'] select");
                    sel.value = 'compact';
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }"""
            )
            time.sleep(0.3)
            dm = page.evaluate("() => localStorage.getItem('chart_density_mode')")
            if dm != "compact":
                failures.append(f"density_mode не сохранился: {dm!r}")
            page.evaluate(
                """() => {
                    const sel = document.querySelector("[data-testid='density-mode-control'] select");
                    sel.value = 'auto';
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }"""
            )
            time.sleep(0.3)
            if page.evaluate("() => localStorage.getItem('chart_density_mode')") != "auto":
                failures.append("density_mode не вернулся в auto")
            else:
                log("      density-mode compact -> auto ok")

            log("[6/6] Каталог индикаторов: открытие и закрытие ...")
            click_by_testid(page, "btn-open-indicators-modal")
            time.sleep(0.5)
            if page.locator("[data-testid='indicators-modal']").count() == 0:
                failures.append("каталог индикаторов не открылся")
            else:
                click_by_testid(page, "btn-close-indicators-modal")
                time.sleep(0.4)
                if page.locator("[data-testid='indicators-modal']").count() != 0:
                    failures.append("каталог индикаторов не закрылся")
            if not failures:
                log("      каталог индикаторов открылся и закрылся")

            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] MODULARIZATION 6.4h (ChartToolbar) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
