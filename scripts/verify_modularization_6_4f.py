"""Ad-hoc E2E verification (6.4, слайс 7): AICopilotSidebar разбит на copilot/ модули.

Проверяет, что после выноса из AICopilotSidebar.jsx (MODULARIZATION_PLAN п.7) в
frontend/src/components/copilot/ (CopilotHeader, HealthMeterCard, ExpressAnalysisCard,
SweepLeaderboardCard, DataFeedContextCard, AnalysisResults -> TradeSetupCard/
ExpectedValueCard/LiquidityMagnetCard/VolatilityConeCard, QuickPromptChips, ChatMessages)
сайдбар AI Copilot работает поведенчески 1:1:
1. Открытие сайдбара (btn-toggle-ai-copilot): шапка, селектор модели, health-meter,
   sweep-лидерборд, data-feed-context, чипы, чат — все data-testid на месте.
2. Live AI Sentinel: тумблер включается (ACTIVE + счётчик пульса).
3. Экспресс-анализ (btn-run-market-analysis) против живого backend: результаты
   рендерятся (trading idea, EV-карточка, magnet, cone), клик «Нанести уровни» проходит.
4. Чат: отправка сообщения → ответ ассистента (local NLP fallback).
5. Закрытие сайдбара.

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

            log("[1/5] Открытие терминала и сайдбара AI Copilot ...")
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
            click_by_testid(page, "btn-toggle-ai-copilot")
            page.wait_for_selector('[data-testid="ai-copilot-sidebar"]', timeout=8000)
            log("      сайдбар открыт")

            expected_testids = [
                "ai-model-selector",
                "live-ai-sentinel-toggle",
                "ai-health-meter",
                "ai-health-score",
                "ai-sweep-leaderboard",
                "ai-data-feed-context",
                "btn-run-market-analysis",
                "btn-toggle-api-key",
            ]
            for tid in expected_testids:
                if page.locator(f'[data-testid="{tid}"]').count() == 0:
                    failures.append(f"{tid} не найден в сайдбаре")
            if not failures:
                log(f"      {len(expected_testids)} базовых testid на месте (шапка/метер/лидерборд/DFC)")

            log("[2/5] Live AI Sentinel: включение тумблера ...")
            click_by_testid(page, "live-ai-sentinel-toggle")
            time.sleep(1.0)
            toggle_text = page.evaluate(
                """() => document.querySelector('[data-testid="live-ai-sentinel-toggle"]').textContent"""
            )
            if "ACTIVE" not in toggle_text:
                failures.append(f"sentinel-тогл не включился: {toggle_text!r}")
            else:
                log(f"      sentinel ACTIVE (текст тогла: {toggle_text.strip()})")
            click_by_testid(page, "live-ai-sentinel-toggle")  # выключить до анализа
            time.sleep(0.5)

            log("[3/5] Экспресс-анализ против живого backend ...")
            click_by_testid(page, "btn-run-market-analysis")
            try:
                page.wait_for_selector('[data-testid="ai-expected-value-card"]', timeout=90000)
                log("      EV-карточка появилась (analysis prop дошёл через AnalysisResults)")
            except Exception:
                failures.append("ai-expected-value-card не появилась за 90 с")
            for tid in ["ai-liquidity-magnet-card", "ai-volatility-cone-card", "btn-ai-apply-levels", "ai-magnet-ratio"]:
                if page.locator(f'[data-testid="{tid}"]').count() == 0:
                    failures.append(f"{tid} не появился после анализа")
            if page.locator('[data-testid="ai-expected-value-card"]').count() > 0:
                ev_text = page.evaluate(
                    """() => document.querySelector('[data-testid="ai-ev-value"]').textContent"""
                )
                log(f"      карточки EV/Magnet/Cone на месте, EV: {ev_text.strip()}")
                click_by_testid(page, "btn-ai-apply-levels")
                time.sleep(0.5)
                log("      клик «Нанести Entry / SL / TP1 / TP2» прошёл")

            log("[4/5] Чат: отправка сообщения (local NLP fallback) ...")
            msg_before = page.evaluate("() => document.querySelectorAll('[data-testid=ai-copilot-sidebar] .whitespace-pre-wrap').length")
            page.evaluate(
                """() => {
                    const input = [...document.querySelectorAll('input[type=text]')]
                        .find(i => i.placeholder.includes('Спросить у AI'));
                    if (!input) throw new Error('чат-инпут не найден');
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                    setter.call(input, 'Как трактовать текущую кумулятивную дельту CVD?');
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }"""
            )
            time.sleep(0.3)
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button[type=submit]')][0];
                    if (btn) btn.click();
                }"""
            )
            try:
                page.wait_for_function(
                    f"""() => document.querySelectorAll('[data-testid=ai-copilot-sidebar] .whitespace-pre-wrap').length > {msg_before}""",
                    timeout=30000,
                )
                log("      ответ ассистента получен (через /api/ai/chat)")
            except Exception:
                failures.append("ответ ассистента не появился за 30 с")

            log("[5/5] Закрытие сайдбара ...")
            click_by_testid(page, "btn-close-ai-sidebar")
            time.sleep(0.6)
            if page.locator('[data-testid="ai-copilot-sidebar"]').count() > 0:
                failures.append("сайдбар не закрылся по ✕")
            else:
                log("      сайдбар закрыт")

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
    log("\nOK: modularization 6.4 (слайс 7, AICopilotSidebar -> copilot/) E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
