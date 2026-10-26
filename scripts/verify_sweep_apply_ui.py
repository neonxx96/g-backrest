"""Ad-hoc E2E verification (M5.2): «Apply Strategy #X» из Quant Sweep в AI Copilot.

Сценарий:
1. Открывает терминал, ждёт появления свечей на графике.
2. Hotkey 'a' → открывает AI Copilot, ждёт секцию ai-sweep-leaderboard.
3. Кликает «▶ Запустить sweep» → ждёт sweep-entry-1 (реальный grid-прогон Train/OOS).
4. Кликает «Apply Strategy #1» → проверяет чат-сообщение и localStorage backtest store.
5. Открывает BacktestPanel и проверяет, что поля Fast/Slow EMA применились (форма
   слушает событие apply-sweep-strategy).

Требует живой backend на :8000. Фронтенд поднимает сам на свободном порту (останавливает после).
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

STEP_LOG = []


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
                timeout=45000,
            )

            log("[2/6] Открытие AI Copilot (hotkey 'a') ...")
            page.keyboard.press("a")
            page.wait_for_selector('[data-testid="ai-sweep-leaderboard"]', timeout=15000)
            log("      секция ai-sweep-leaderboard найдена")

            empty_state = page.locator('[data-testid="ai-sweep-leaderboard"]')
            log(f"      текст секции до прогона: {empty_state.inner_text()[:140]!r}")

            log("[3/6] Запуск sweep через UI-кнопку ...")
            page.click('[data-testid="btn-run-sweep"]')
            page.wait_for_selector('[data-testid="sweep-entry-1"]', timeout=180000)
            log("      sweep-entry-1 появился")

            first_entry = page.locator('[data-testid="sweep-entry-1"]').inner_text()
            log(f"      запись #1: {first_entry[:160]!r}")

            log("[4/6] Клик «Apply Strategy #1» ...")
            page.click('[data-testid="btn-apply-sweep-1"]')
            time.sleep(1.5)

            log("[5/6] Проверка чат-сообщения и localStorage ...")
            body_text = page.locator("body").inner_text()
            if "Применён Sweep #1" not in body_text:
                failures.append("чат-сообщение «Применён Sweep #1» не появилось")
            else:
                log("      чат-сообщение появилось")

            stored = page.evaluate(
                "() => JSON.parse(localStorage.getItem('signalscript_backtest_storage') || '{}')"
            )
            state = stored.get("state", {})
            by_symbol = state.get("customParamsBySymbol") or {}
            # активный символ берём из store, а не хардкодом (терминал может стартовать не на BTC)
            sym_key = next(iter(by_symbol), None)
            sym = by_symbol.get(sym_key, {})
            if state.get("strategyType") != "ema_trend":
                failures.append(f"strategyType != ema_trend: {state.get('strategyType')}")
            if not (sym.get("fast_period") and sym.get("slow_period")):
                failures.append(f"fast/slow period не записаны в store ({sym_key}): {sym}")
            else:
                log(f"      store [{sym_key}]: strategy={state.get('strategyType')} fast={sym.get('fast_period')} slow={sym.get('slow_period')}")

            log("[6/6] BacktestPanel: применились ли поля EMA ...")
            page.keyboard.press("a")  # закрыть сайдбар
            page.keyboard.press("b")  # открыть BacktestPanel
            opened = page.wait_for_selector('[data-testid="input-fast-ema"]', timeout=8000)
            if opened:
                fast_val = page.input_value('[data-testid="input-fast-ema"]')
                slow_val = page.input_value('[data-testid="input-slow-ema"]')
                log(f"      поля формы: Fast EMA={fast_val}, Slow EMA={slow_val}")
                if str(sym.get("fast_period")) != fast_val or str(sym.get("slow_period")) != slow_val:
                    failures.append(
                        f"форма не подхватила EMA-периоды: {fast_val}/{slow_val} != "
                        f"{sym.get('fast_period')}/{sym.get('slow_period')}"
                    )
            else:
                failures.append("поля input-fast-ema не появились (BacktestPanel не открылся или strategy != ema_trend)")

            browser.close()
    finally:
        vite.terminate()

    if failures:
        log("\nFAIL:")
        for f in failures:
            log(f"  - {f}")
        return 1
    log("\nOK: Apply Strategy #X E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
