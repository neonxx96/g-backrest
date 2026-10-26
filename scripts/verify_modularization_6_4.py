"""Ad-hoc E2E verification (6.4): извлечённые компоненты backtest/ рендерятся корректно.

Проверяет, что после модуляризации BacktestPanel (MODULARIZATION_PLAN п.2):
1. Прогон одиночного бэктеста через UI работает.
2. Вкладка «Эквити & Монте-Карло» показывает svg (monte-carlo-svg) — компонент
   frontend/src/components/backtest/MonteCarloEquityChart.jsx.
3. Вкладка «Сделки» показывает строки backtest-trade-row — компонент
   frontend/src/components/backtest/BacktestTradesTable.jsx.
4. Сортировка по колонке «Чистый PnL» меняет порядок строк (управляемый onSort).
5. Клик по строке выделяет её (selectedTradeId подсветка).

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

STRATEGY_LABEL = "Confluence EMA"  # historical, работает на реальных свечах


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

            log("[2/6] Открытие BacktestPanel (hotkey 'b') и прогон бэктеста ...")
            page.keyboard.press("b")
            page.wait_for_selector('[data-testid="btn-run-single"]', timeout=8000)
            # стратегия по умолчанию (первый historical) уже выбрана в <select>
            page.click('[data-testid="btn-run-single"]')

            log("[3/6] Ожидание equity-вью (monte-carlo-svg или empty-state) ...")
            page.wait_for_selector('[data-testid="tab-equity-mc"]', timeout=180000)
            page.click('[data-testid="tab-equity-mc"]')
            time.sleep(1.0)
            svg = page.locator('[data-testid="monte-carlo-svg"]')
            empty = page.locator("text=Недостаточно сделок")
            if svg.count() == 0 and empty.count() == 0:
                failures.append("ни monte-carlo-svg, ни empty-state не отрендерились")
            else:
                log(f"      monte-carlo-svg={svg.count()}, empty-state={empty.count()}")

            log("[4/6] Вкладка «Сделки»: строки backtest-trade-row ...")
            page.click('[data-testid="tab-trades"]')
            page.wait_for_selector('[data-testid="backtest-trade-row"]', timeout=15000)
            rows = page.locator('[data-testid="backtest-trade-row"]')
            n = rows.count()
            log(f"      строк сделок: {n}")
            if n < 2:
                failures.append(f"сделок меньше 2 ({n}) — сортировку не проверить")

            log("[5/6] Сортировка по «Чистый PnL» меняет порядок ...")
            if n >= 2:
                pnl_td = "td:nth-child(8)"
                before = rows.locator(pnl_td).all_inner_texts()
                page.evaluate(
                    """() => {
                        const th = [...document.querySelectorAll('th')].find(t => t.textContent.includes('Чистый PnL'));
                        if (th) th.click();
                    }"""
                )
                time.sleep(0.5)
                after = page.locator('[data-testid="backtest-trade-row"] td:nth-child(8)').all_inner_texts()
                log(f"      до:  {before[:4]}")
                log(f"      после: {after[:4]}")
                if before == after:
                    failures.append("сортировка по pnl_usd не изменила порядок строк")

            log("[6/6] Клик по строке выделяет её ...")
            if n >= 1:
                page.evaluate(
                    "() => document.querySelector('[data-testid=\"backtest-trade-row\"]')?.click()"
                )
                time.sleep(0.5)
                selected = page.locator('[data-testid="backtest-trade-row"].bg-sky-500\\/10')
                if selected.count() == 0:
                    failures.append("клик по строке не дал подсветки выбора (selectedTradeId)")
                else:
                    log("      подсветка выбора появилась")

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
    log("\nOK: modularization 6.4 E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
