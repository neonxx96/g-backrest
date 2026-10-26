"""Ad-hoc E2E verification (6.4, слайс 4): OrderBookDOM разбит на dom/ модули.

Проверяет, что после выноса из OrderBookDOM.jsx (MODULARIZATION_PLAN п.4) в
frontend/src/components/dom/ (useDepthStream, useAggregatedOrderbook, DOMControlsHeader,
constants) стакан работает поведенчески 1:1:
1. Виджет DOM в дефолтной раскладке: __domLadderState инициализирован, anchorPrice > 0,
   семантические sr-only строки лестницы (data-row-price) рендерятся.
2. Шапка управления: бейдж FPS, агрегация x25 переключается, панель quick settings открывается.
3. Сквозная детекция спуфа: window.__domLadderState.simulateSpoofWall() -> инъекция стены
   -> трекинг мега-стены -> снятие -> бейдж [SPOOF REMOVED] (spoof-removed-badge) в DOM.

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

            log("[1/5] Открытие терминала ...")
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

            log("[2/5] DOM-виджет: __domLadderState, anchorPrice, sr-only строки ...")
            page.wait_for_function("() => window.__domLadderState?.anchorPrice > 0", timeout=30000)
            state = page.evaluate("() => window.__domLadderState")
            log(f"      anchorPrice={state['anchorPrice']}, visibleRows={state['visibleRowCount']}, "
                f"bestBid={state['bestBid']}, bestAsk={state['bestAsk']}")
            row_count = page.locator("[data-row-price]").count()
            if row_count < 10:
                failures.append(f"sr-only строк лестницы мало: {row_count} (ожидалось >=10)")
            else:
                log(f"      sr-only строк: {row_count}")

            log("[3/5] Шапка: FPS-бейдж и агрегация x25 ...")
            fps_text = page.evaluate(
                """() => {
                    const el = [...document.querySelectorAll('span')].find(s => /FPS/.test(s.textContent) && s.className.includes('font-mono'));
                    return el ? el.textContent.trim() : null;
                }"""
            )
            if not fps_text or "FPS" not in fps_text:
                failures.append(f"FPS-бейдж в шапке DOM не найден (получено: {fps_text!r})")
            else:
                log(f"      FPS-бейдж: {fps_text}")
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'x25');
                    if (btn) btn.click();
                }"""
            )
            time.sleep(0.6)
            active = page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'x25');
                    return btn ? btn.className.includes('bg-[#2563eb]') : false;
                }"""
            )
            if not active:
                failures.append("кнопка x25 не активировалась (колбэк onTickMult не дошёл)")
            else:
                log("      x25 активирован (onTickMult -> setTickMult)")
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'x10');
                    if (btn) btn.click();
                }"""
            )
            time.sleep(0.4)

            log("[4/5] Quick settings: тоггл шапки открывает панель настроек ...")
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')].find(b => b.title === 'Настройки плотностей и кластеров DOM');
                    if (btn) btn.click();
                }"""
            )
            time.sleep(0.4)
            mega_input = page.locator('input[step="100000"]').count()
            if mega_input == 0:
                failures.append("quick settings не открылась (input мега-стены не найден)")
            else:
                log("      quick settings открыта (мега-стена/плотность/кластеры на месте)")
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')].find(b => b.title === 'Настройки плотностей и кластеров DOM');
                    if (btn) btn.click();
                }"""
            )

            log("[5/5] Сквозная детекция спуфа: simulateSpoofWall -> [SPOOF REMOVED] ...")
            page.evaluate("() => window.__domLadderState.simulateSpoofWall()")
            try:
                page.wait_for_selector('[data-testid="spoof-removed-badge"]', timeout=10000)
                log("      spoof-removed-badge появился (инъекция -> трекинг -> детекция в useAggregatedOrderbook)")
            except Exception:
                failures.append("spoof-removed-badge не появился за 10 с после simulateSpoofWall")

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
    log("\nOK: modularization 6.4 (слайс 4, DOM) E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
