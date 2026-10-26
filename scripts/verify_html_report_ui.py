"""Ad-hoc E2E verification (6.4 HTML): кнопка «HTML отчёт» в BacktestPanel.

Сценарий:
1. Открывает терминал, ждёт свечи на графике.
2. Hotkey 'b' → BacktestPanel → «Запустить бэктест» (btn-run-single).
3. Ждёт результат (tab-equity-mc), затем кнопку btn-export-html.
4. Кликает её, перехватывает popup (window.open blob-URL) → проверяет: открылся
   документ, содержит <table>, символ и секции отчёта.
Exit 0 — все проверки прошли. Требует живой backend на :8000 (endpoint
/api/backtest/report-html).
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
    with urllib.request.urlopen(f"{BACKEND}/api/health", timeout=5) as r:
        assert json.loads(r.read())["status"] == "ok"


def wait_frontend_ready(timeout_s: int = 60) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(FRONTEND, timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"frontend на :{FRONTEND_PORT} не поднялся за {timeout_s} с")


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
        wait_frontend_ready()
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()
            page.on("pageerror", lambda err: failures.append(f"pageerror: {err}"))

            log("[1/4] Открытие терминала ...")
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

            log("[2/4] Прогон бэктеста через UI ...")
            page.keyboard.press("b")
            page.wait_for_selector('[data-testid="btn-run-single"]', timeout=8000)
            page.click('[data-testid="btn-run-single"]')
            page.wait_for_selector('[data-testid="tab-equity-mc"]', timeout=180000)

            log("[3/4] Проверка наличия кнопки HTML ...")
            page.wait_for_selector('[data-testid="btn-export-html"]', timeout=10000)
            log("      кнопка btn-export-html найдена")

            log("[4/4] Клик и перехват popup ...")
            with context.expect_page(timeout=30000) as popup_info:
                page.click('[data-testid="btn-export-html"]')
            popup = popup_info.value
            popup.wait_for_load_state("domcontentloaded", timeout=30000)
            body = popup.locator("body").inner_text(timeout=15000)
            html_src = popup.content()

            if "<table" not in html_src:
                failures.append("в popup нет <table> — это не отчёт")
            for needle in ("Сводка", "Кривая Equity", "Стресс-тест Монте-Карло", "Разбор сделок"):
                if needle not in body:
                    failures.append(f"секция «{needle}» отсутствует в отчёте")
            log(f"      popup загружен, секций найдено: {body.count('SignalScript') > 0}, bytes={len(html_src)}")
            popup.close()

            err_badge = page.locator('[data-testid="pdf-export-error"]')
            if err_badge.count() > 0:
                failures.append(f"ошибка экспорта в UI: {err_badge.inner_text()}")

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
    log("\nOK: HTML report export E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
