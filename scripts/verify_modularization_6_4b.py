"""Ad-hoc E2E verification (6.4, слайс 2): BacktestPresetsBar + BacktestParametersForm.

Проверяет, что после извлечения из BacktestPanel.jsx (MODULARIZATION_PLAN п.2):
1. Пресет-бар рендерится (strategy-presets-bar) и применение пресета вызывает appliedFeedback.
2. Сохранение нового пресета через UI (input-preset-name -> btn-confirm-save-preset) работает;
   созданный пресет подчищается через DELETE /api/journal/presets/{id} (в finally).
3. Форма параметров управляема: смена стратегии на ema_trend показывает EMA-поля,
   ручной ввод SL отражается в поле, тоггл CVD меняет подпись кнопки.
4. Прогон одиночного бэктеста не сломан (btn-run-single -> вкладка Эквити & Монте-Карло).

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

TMP_PRESET_NAME = "E2E_6_4b_tmp"


def log(msg: str) -> None:
    print(msg, flush=True)


def api(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{BACKEND}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        body = r.read()
    return json.loads(body) if body else {}


def cleanup_tmp_preset() -> None:
    try:
        rows = api("GET", "/api/journal/presets").get("presets", [])
        for p in rows:
            if p.get("name") == TMP_PRESET_NAME:
                api("DELETE", f"/api/journal/presets/{p['id']}")
                log(f"      cleanup: пресет '{TMP_PRESET_NAME}' (id={p['id']}) удалён из SQLite")
    except Exception as exc:  # noqa: BLE001
        log(f"      WARN: не удалось подчистить временный пресет: {exc}")


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
    # vite стартует несколько секунд — ждём готовности порта, иначе goto падает с ERR_CONNECTION_REFUSED
    for _ in range(60):
        try:
            urllib.request.urlopen(FRONTEND, timeout=2)
            break
        except Exception:
            time.sleep(1)
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()
            page.on("pageerror", lambda err: failures.append(f"pageerror: {err}"))

            log("[1/7] Открытие терминала ...")
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

            log("[2/7] Открытие BacktestPanel (hotkey 'b'): пресет-бар + форма ...")
            page.keyboard.press("b")
            page.wait_for_selector('[data-testid="strategy-presets-bar"]', timeout=8000)
            page.wait_for_selector('[data-testid="input-days"]', timeout=8000)
            # пресеты подгружаются асинхронным fetch после открытия панели — поллим до 25с
            n_options = 0
            for _ in range(50):
                n_options = page.locator('[data-testid="select-strategy-preset"] option').count()
                if n_options >= 1:
                    break
                time.sleep(0.5)
            log(f"      пресет-бар отрендерился, пресетов в селекте: {n_options}")
            if n_options < 1:
                failures.append("в селекте пресетов нет ни одного набора (дефолтные не просеялись?)")

            log("[3/7] Управляемость формы: стратегия ema_trend -> EMA-поля ...")
            page.select_option('[data-testid="bt-strategy-select"]', "ema_trend")
            page.wait_for_selector('[data-testid="input-fast-ema"]', timeout=5000)
            log("      input-fast-ema/input-slow-ema появились")
            page.select_option('[data-testid="bt-strategy-select"]', "confluence_ema")
            time.sleep(0.3)

            log("[4/7] Управляемость формы: ручной ввод SL и тоггл CVD ...")
            page.fill('[data-testid="input-sl"]', "1.3")
            time.sleep(0.3)
            sl_val = page.input_value('[data-testid="input-sl"]')
            if sl_val != "1.3":
                failures.append(f"ручной ввод SL не отразился: '{sl_val}' (ожидалось '1.3')")
            page.fill('[data-testid="input-sl"]', "0.8")  # вернуть валидное значение
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'CVD: OFF');
                    if (btn) btn.click();
                }"""
            )
            time.sleep(0.3)
            cvd_on = page.locator("button:has-text('CVD: ON')").count()
            if cvd_on == 0:
                failures.append("тоггл CVD не переключился в ON")
            else:
                log("      CVD: ON — колбэк дошёл до панели")
            page.evaluate(
                """() => {
                    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'CVD: ON');
                    if (btn) btn.click();
                }"""
            )

            log("[5/7] Применение существующего пресета (1 клик) ...")
            if n_options >= 1:
                first_label = page.locator('[data-testid="select-strategy-preset"] option').first.inner_text()
                page.select_option('[data-testid="select-strategy-preset"]', label=first_label.strip())
                try:
                    page.wait_for_selector("text=применён", timeout=4000)
                    log(f"      пресет '{first_label.strip()}' применён, appliedFeedback показан")
                except Exception:
                    failures.append("appliedFeedback не появился после применения пресета")

            log("[6/7] Сохранение нового пресета через UI ...")
            page.click('[data-testid="btn-open-save-preset"]')
            page.fill('[data-testid="input-preset-name"]', TMP_PRESET_NAME)
            time.sleep(0.2)
            disabled = page.get_attribute('[data-testid="btn-confirm-save-preset"]', "disabled")
            if disabled is not None:
                failures.append("btn-confirm-save-preset остался disabled при непустом имени")
            page.click('[data-testid="btn-confirm-save-preset"]')
            try:
                page.wait_for_selector("text=сохранён", timeout=12000)
                log("      пресет сохранён, appliedFeedback показан")
            except Exception:
                fb = page.evaluate(
                    "() => document.querySelector('[data-testid=\"strategy-presets-bar\"]')?.textContent || ''"
                )
                log(f"      DEBUG appliedFeedback-зона: {fb[:200]!r}")
                failures.append("appliedFeedback после сохранения пресета не появился")
            time.sleep(0.5)
            rows = api("GET", "/api/journal/presets").get("presets", [])
            if not any(p.get("name") == TMP_PRESET_NAME for p in rows):
                failures.append("сохранённый пресет не найден в SQLite через API")

            log("[7/7] Прогон одиночного бэктеста (btn-run-single) ...")
            page.click('[data-testid="btn-run-single"]')
            page.wait_for_selector('[data-testid="tab-equity-mc"]', timeout=240000)
            log("      результат получен, вкладки результата доступны")
            page.click('[data-testid="tab-equity-mc"]')
            time.sleep(1.0)
            svg = page.locator('[data-testid="monte-carlo-svg"]')
            empty = page.locator("text=Недостаточно сделок")
            if svg.count() == 0 and empty.count() == 0:
                failures.append("ни monte-carlo-svg, ни empty-state не отрендерились")
            else:
                log(f"      monte-carlo-svg={svg.count()}, empty-state={empty.count()}")

            browser.close()
    finally:
        cleanup_tmp_preset()
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
    log("\nOK: modularization 6.4 (слайс 2) E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
