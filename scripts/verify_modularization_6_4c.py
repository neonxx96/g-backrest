"""Ad-hoc E2E verification (6.4, слайс 3): BacktestOptimizerView извлечён корректно.

Проверяет, что после выноса блоков 'optimizer' и 'matrix' из BacktestPanel.jsx
(MODULARIZATION_PLAN п.2) компонент frontend/src/components/backtest/BacktestOptimizerView.jsx:
1. Матрица конфлюенса рендерит строки после одиночного бэктеста (viewTab='matrix').
2. Кнопка «Включить» связки дёргает onApplyConfluenceSetup (appliedFeedback + переключение вкладки).
3. Генетический прогон (1 день истории — ускоренный) показывает карточки До/После и лидерборд.
4. Кнопка «Применить лучший» дёргает onApplySetup (appliedFeedback «применён»).

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

            log("[2/6] Открытие BacktestPanel (hotkey 'b') и одиночный прогон ...")
            page.keyboard.press("b")
            page.wait_for_selector('[data-testid="btn-run-single"]', timeout=8000)
            page.click('[data-testid="btn-run-single"]')
            page.wait_for_selector('[data-testid="tab-matrix"]', timeout=240000)
            log("      результат получен")

            log("[3/6] Вкладка «Матрица связок»: строки рендерятся ...")
            page.click('[data-testid="tab-matrix"]')
            time.sleep(1.0)
            matrix_rows = page.locator('[data-testid="tab-matrix"] ~ * table tbody tr').count()
            # таб-бар не внутри View Body — ищем таблицу матрицы по заголовку колонки
            if matrix_rows == 0:
                matrix_rows = page.evaluate(
                    """() => {
                        const th = [...document.querySelectorAll('th')].find(t => t.textContent.includes('Условие / Связка'));
                        if (!th) return 0;
                        const tbody = th.closest('table').querySelector('tbody');
                        return tbody ? tbody.querySelectorAll('tr').length : 0;
                    }"""
                )
            log(f"      строк матрицы: {matrix_rows}")
            if matrix_rows < 1:
                failures.append("матрица конфлюенса пуста после одиночного прогона (ожидались строки)")

            log("[4/6] «Включить» связку -> onApplyConfluenceSetup ...")
            if matrix_rows >= 1:
                page.evaluate(
                    """() => {
                        const th = [...document.querySelectorAll('th')].find(t => t.textContent.includes('Условие / Связка'));
                        const btn = th?.closest('table').querySelector('tbody button');
                        if (btn) btn.click();
                    }"""
                )
                try:
                    page.wait_for_selector("text=применена к стратегии", timeout=5000)
                    log("      appliedFeedback связки показан (колбэк дошёл до панели)")
                except Exception:
                    failures.append("appliedFeedback после «Включить» связку не появился")
                # applyConfluenceSetup переключает вкладку на 'trades' и перезапускает single
                page.wait_for_selector('[data-testid="tab-matrix"]', timeout=240000)
                time.sleep(0.5)

            log("[5/6] Генетика (1 день, ускоренно): карточки До/После + лидерборд ...")
            page.click('[data-testid="bt-mode-optimizer"]')
            time.sleep(0.3)
            page.fill('[data-testid="input-days"]', "1")
            # dockview-sash перехватывает нативный клик по кнопкам панели — кликаем через DOM
            page.evaluate(
                "() => document.querySelector('[data-testid=\"btn-run-genetic\"]')?.click()"
            )
            try:
                page.wait_for_selector('[data-testid="card-after-opt"]', timeout=300000)
                log("      генетика завершена, card-after-opt отрендерился")
            except Exception:
                failures.append("генетический прогон не завершился за 300 с (card-after-opt не появился)")
            if page.locator('[data-testid="card-after-opt"]').count() > 0:
                page.wait_for_selector('[data-testid="tab-optimizer-results"]', timeout=5000)
                page.evaluate(
                    "() => document.querySelector('[data-testid=\"tab-optimizer-results\"]')?.click()"
                )
                time.sleep(0.8)
                n_lead = page.locator('[data-testid="card-before-opt"]').count()
                grid_btns = page.evaluate(
                    """() => {
                        const th = [...document.querySelectorAll('th')].find(t => t.textContent.trim() === '#');
                        if (!th) return 0;
                        const tbody = th.closest('table').querySelector('tbody');
                        return tbody ? tbody.querySelectorAll('tr').length : 0;
                    }"""
                )
                log(f"      card-before-opt={n_lead}, строк лидерборда={grid_btns}")
                if n_lead == 0 and grid_btns == 0:
                    failures.append("optimizer-вью пуст: ни карточек До/После, ни строк лидерборда")

            log("[6/6] «Применить лучший» -> onApplySetup ...")
            if page.locator('[data-testid="btn-apply-best-setup"]').count() > 0:
                page.evaluate(
                    "() => document.querySelector('[data-testid=\"btn-apply-best-setup\"]')?.click()"
                )
                try:
                    page.wait_for_selector("text=применён", timeout=5000)
                    log("      appliedFeedback «применён» показан (onApplySetup дошёл до панели)")
                except Exception:
                    failures.append("appliedFeedback после «Применить лучший» не появился")
            else:
                failures.append("btn-apply-best-setup не отрендерился после генетики")

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
    log("\nOK: modularization 6.4 (слайс 3) E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
