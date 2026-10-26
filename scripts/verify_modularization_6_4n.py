"""Ad-hoc E2E verification (6.4, слайс n / п.1 слайс 7): useChartIndicators + useSecondOpinion из Chart.jsx.

Проверяет, что после переноса индикаторной логики в chart/useChartIndicators.js
и «второго мнения AI» в chart/useSecondOpinion.js (тела дословно, norm-сверка
10/10 сегментов) поведение 1:1:
1. Базовая загрузка без pageerror (ловит ReferenceError — урок слайсов 5/6).
2. Каталог индикаторов: открытие из стека -> IndicatorsModal -> добавление BOLL
   -> пилюля в ActiveIndicatorStack -> индикатор создан в candle_pane.
3. Toggle видимости через пилюлю: BOLL убран/возвращён в candle_pane.
4. Удаление через пилюлю: пилюля исчезает, BOLL убран из candle_pane.
5. Регрессия «второго мнения»: карточка по кнопке HUD.

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


def chart_instance(page):
    return page.evaluate(
        """() => {
            const charts = Object.entries(window.__charts || {});
            return charts.find(([id]) => id === 'chart_main')?.[1]
                || charts.find(([, v]) => v && typeof v.getDataList === 'function')?.[1]
                || window.__chart || null;
        }"""
    )


def has_boll(page) -> bool:
    return page.evaluate(
        """() => {
            const charts = Object.entries(window.__charts || {});
            const chart = charts.find(([id]) => id === 'chart_main')?.[1]
                || charts.find(([, v]) => v && typeof v.getDataList === 'function')?.[1]
                || window.__chart;
            if (!chart || !chart.getIndicatorByPaneId) return false;
            try {
                const inst = chart.getIndicatorByPaneId('candle_pane', 'BOLL');
                return Array.isArray(inst) ? inst.length > 0 : !!inst;
            } catch (_) { return false; }
        }"""
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
    wait_for_frontend()
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()
            page.on("pageerror", lambda err: failures.append(f"pageerror: {err}"))

            log("[1/5] Открытие терминала, базовая загрузка без pageerror ...")
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
            time.sleep(2)
            if failures:
                log("      ранние pageerrors: " + "; ".join(failures))

            log("[2/5] Каталог: открытие из стека -> добавление BOLL -> пилюля + индикатор ...")
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-stack-open-catalog"]');
                    if (el) el.click();
                }"""
            )
            modal_ok = False
            for _ in range(15):
                time.sleep(0.4)
                if page.evaluate("!!document.querySelector('[data-testid=\"indicators-modal\"]')"):
                    modal_ok = True
                    break
            if not modal_ok:
                failures.append("IndicatorsModal не открылся по кнопке стека")
            else:
                page.evaluate(
                    """() => {
                        const el = document.querySelector('[data-testid="btn-add-indicator-boll"]');
                        if (el) el.click();
                    }"""
                )
                pill_ok = False
                for _ in range(15):
                    time.sleep(0.4)
                    if page.evaluate("!!document.querySelector('[data-testid=\"active-indicator-pill-boll\"]')"):
                        pill_ok = True
                        break
                if not pill_ok:
                    failures.append("пилюля active-indicator-pill-boll не появилась после добавления")
                boll_ok = False
                for _ in range(15):
                    time.sleep(0.4)
                    if has_boll(page):
                        boll_ok = True
                        break
                if not boll_ok:
                    failures.append("BOLL не создан в candle_pane после handleAddIndicator")
                if pill_ok and boll_ok:
                    log("      каталог: модалка + пилюля + BOLL в candle_pane OK")
                page.evaluate(
                    """() => {
                        const el = document.querySelector('[data-testid="btn-close-indicators-modal"]');
                        if (el) el.click();
                    }"""
                )
                time.sleep(0.5)

            log("[3/5] Toggle видимости BOLL через пилюлю ...")
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-toggle-vis-boll"]');
                    if (el) el.click();
                }"""
            )
            boll_off = False
            for _ in range(15):
                time.sleep(0.4)
                if not has_boll(page):
                    boll_off = True
                    break
            if not boll_off:
                failures.append("BOLL не убран из candle_pane после toggle visibility OFF")
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-toggle-vis-boll"]');
                    if (el) el.click();
                }"""
            )
            boll_back = False
            for _ in range(15):
                time.sleep(0.4)
                if has_boll(page):
                    boll_back = True
                    break
            if not boll_back:
                failures.append("BOLL не возвращён в candle_pane после toggle visibility ON")
            if boll_off and boll_back:
                log("      toggle BOLL off/on OK")

            log("[4/5] Удаление BOLL через пилюлю ...")
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-remove-boll"]');
                    if (el) el.click();
                }"""
            )
            pill_gone = False
            for _ in range(15):
                time.sleep(0.4)
                if not page.evaluate("!!document.querySelector('[data-testid=\"active-indicator-pill-boll\"]')"):
                    pill_gone = True
                    break
            boll_removed = False
            for _ in range(15):
                time.sleep(0.4)
                if not has_boll(page):
                    boll_removed = True
                    break
            if not pill_gone:
                failures.append("пилюля BOLL не исчезла после удаления")
            if not boll_removed:
                failures.append("BOLL не убран из candle_pane после удаления")
            if pill_gone and boll_removed:
                log("      удаление BOLL OK")

            log("[5/5] Регрессия: второе мнение (useSecondOpinion) ...")
            page.evaluate(
                """() => {
                    window.dispatchEvent(new CustomEvent('apply-position-setup', {
                        detail: { setup: {
                            direction: 'LONG', entry_price: 80000, sl_price: 79600,
                            tp1_price: 80700, sl_pct: -0.5, tp1_pct: 0.875, sl_risk_usd: 50
                        } }
                    }));
                }"""
            )
            time.sleep(1.5)
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-ask-second-opinion"]');
                    if (el) el.click();
                }"""
            )
            card_ok = False
            for _ in range(60):
                time.sleep(0.5)
                if page.evaluate("!!document.querySelector('[data-testid=\"second-opinion-card\"]')"):
                    card_ok = True
                    break
            if not card_ok:
                failures.append("карточка второго мнения не появилась")
            else:
                verdict = page.evaluate(
                    "document.querySelector('[data-testid=\"second-opinion-verdict\"]')?.textContent?.trim() || ''"
                )
                log(f"      вердикт: {verdict!r}")

            if failures:
                log("      итоговые pageerrors: " + "; ".join(f for f in failures if f.startswith("pageerror")))
            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] MODULARIZATION 6.4n (useChartIndicators + useSecondOpinion) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
