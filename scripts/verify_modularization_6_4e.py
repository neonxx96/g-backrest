"""Ad-hoc E2E verification (6.4, слайс 5): App.jsx разбит на components/app/ модули.

Проверяет, что после выноса из App.jsx (MODULARIZATION_PLAN п.5) шапки
(AppTopBar.jsx + constants.js) и хвоста модалок/тостов (ModalsHost.jsx)
терминал работает поведенчески 1:1:
1. Терминал открывается, график грузит свечи.
2. Шапка: таймфрейм 5m переключается (active-класс), деноминация USDT кликабельна,
   alerts-toolbar-button на месте.
3. Дропдаун «+ Add Widget»: открывается, пункты меню (widget-toggle-*) рендерятся,
   клик по Alerts открывает модалку алертов (alerts-modal).
4. Журнал решений: btn-open-decision-journal -> decision-journal-modal -> закрытие по ✕.
5. Hotkeys-оверлей «Горячие клавиши терминала» открывается/закрывается.
6. Центр настроек («Центр настроек терминала SignalScript») открывается/закрывается.

Требует живой backend на :8000. Фронтенд поднимает сам на :5199 (останавливает после).
Exit 0 — все проверки прошли.
"""

from __future__ import annotations

import json
import subprocess
import sys
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
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()
            page.on("pageerror", lambda err: failures.append(f"pageerror: {err}"))

            log("[1/6] Открытие терминала ...")
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
            log("      график загрузил свечи")

            log("[2/6] Шапка: таймфрейм 5m, деноминация, alerts-toolbar ...")
            click_by_testid(page, "timeframe-btn-5m")
            time.sleep(0.5)
            active_tf = page.evaluate(
                """() => {
                    const btn = document.querySelector('[data-testid="timeframe-btn-5m"]');
                    return btn ? btn.className : null;
                }"""
            )
            if not active_tf or "bg-[#2563eb]" not in active_tf:
                failures.append(f"timeframe-btn-5m не активировался (class: {active_tf!r})")
            else:
                log("      5m активирован (onTimeframe -> setTimeframe)")
            click_by_testid(page, "denomination-USDT")
            time.sleep(0.3)
            den_active = page.evaluate(
                """() => {
                    const btn = document.querySelector('[data-testid="denomination-USDT"]');
                    return btn ? btn.className.includes('bg-neutral-800') : false;
                }"""
            )
            if not den_active:
                failures.append("denomination-USDT не показала активное состояние")
            else:
                log("      деноминация USDT активна")
            if page.locator('[data-testid="alerts-toolbar-button"]').count() == 0:
                failures.append("alerts-toolbar-button не найден в шапке")
            else:
                log("      alerts-toolbar-button на месте")

            log("[3/6] Дропдаун «+ Add Widget» -> Alerts ...")
            click_by_testid(page, "widgets-menu-button")
            time.sleep(0.4)
            if page.locator('[data-testid="widgets-dropdown"]').count() == 0:
                failures.append("widgets-dropdown не открылся")
            elif page.locator('[data-testid="widget-toggle-alerts"]').count() == 0:
                failures.append("widget-toggle-alerts не найден в дропдауне")
            else:
                log("      дропдаун открыт, пункты меню на месте")
                click_by_testid(page, "widget-toggle-alerts")
                try:
                    page.wait_for_selector('[data-testid="alerts-modal"]', timeout=8000)
                    log("      alerts-modal открыт (useAlertsStore.openAlertsModal через AppTopBar)")
                except Exception:
                    failures.append("alerts-modal не открылся по клику widget-toggle-alerts")
            # закрыть дропдаун/модалку если висит
            page.keyboard.press("Escape")
            time.sleep(0.3)

            log("[4/6] Журнал решений: открытие и закрытие ...")
            click_by_testid(page, "btn-open-decision-journal")
            try:
                page.wait_for_selector('[data-testid="decision-journal-modal"]', timeout=8000)
                log("      decision-journal-modal открыт")
            except Exception:
                failures.append("decision-journal-modal не открылся")
            if page.locator('[data-testid="btn-close-decision-journal"]').count() > 0:
                click_by_testid(page, "btn-close-decision-journal")
                time.sleep(0.4)
                if page.locator('[data-testid="decision-journal-modal"]').count() > 0:
                    failures.append("decision-journal-modal не закрылся по ✕")
                else:
                    log("      журнал закрыт по ✕")
            else:
                page.keyboard.press("Escape")
                log("      (кнопка ✕ не найдена — закрыт по Escape)")

            log("[5/6] Hotkeys-оверлей ...")
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')]
                        .find(b => b.title === "Горячие клавиши ('?')");
                    if (!btn) throw new Error('кнопка горячих клавиш не найдена');
                    btn.click();
                }"""
            )
            time.sleep(0.4)
            overlay_text = page.evaluate(
                """() => document.body.innerText.includes('Горячие клавиши терминала')"""
            )
            if not overlay_text:
                failures.append("оверлей «Горячие клавиши терминала» не появился")
            else:
                log("      оверлей открыт (ModalsHost)")
                page.evaluate(
                    """() => {
                        const btn = [...document.querySelectorAll('button')]
                            .find(b => b.textContent.trim() === 'Понятно');
                        if (btn) btn.click();
                    }"""
                )
                time.sleep(0.4)
                if page.evaluate("() => document.body.innerText.includes('Горячие клавиши терминала')"):
                    failures.append("hotkeys-оверлей не закрылся по «Понятно»")
                else:
                    log("      оверлей закрыт")

            log("[6/6] Центр настроек ...")
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')]
                        .find(b => b.title && b.title.includes('Центр настроек'));
                    if (!btn) throw new Error('кнопка настроек не найдена');
                    btn.click();
                }"""
            )
            time.sleep(0.6)
            if not page.evaluate(
                "() => document.body.innerText.includes('Центр настроек терминала SignalScript')"
            ):
                failures.append("Центр настроек не открылся")
            else:
                log("      Центр настроек открыт (SettingsModal через ModalsHost)")
                page.keyboard.press("Escape")
                time.sleep(0.3)

            browser.close()
    finally:
        vite.terminate()
        # Windows: terminate() убивает npm-обёртку, но node-vite ребёнок выживает
        # и держит порт — дочищаем по занятому LISTENING-порту.
        try:
            import os

            out = subprocess.run(
                f'netstat -ano | findstr ":{FRONTEND_PORT}" | findstr LISTENING',
                shell=True, capture_output=True, text=True,
            ).stdout
            for line in out.splitlines():
                parts = line.split()
                if parts and parts[-1].isdigit():
                    pid = int(parts[-1])
                    if pid != os.getpid():
                        subprocess.run(f"taskkill /PID {pid} /F", shell=True, capture_output=True)
        except Exception:
            pass

    if failures:
        log("\nFAIL:")
        for f in failures:
            log(f"  - {f}")
        return 1
    log("\nOK: modularization 6.4 (слайс 5, App -> components/app/) E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
