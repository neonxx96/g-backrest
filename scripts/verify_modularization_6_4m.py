"""Ad-hoc E2E verification (6.4, слайс m / п.1 слайс 6): useChartAnnotations из Chart.jsx.

Проверяет, что после переноса аннотаций/сигнальных оверлеев в
chart/useChartAnnotations.js (тела дословно, norm-сверка 554/554) поведение 1:1:
1. Базовая загрузка без pageerror (ловит ReferenceError «X is not defined»,
   который сборка не видит — урок слайса 5 с wsRef).
2. Конус волатильности: тогл тулбара -> overlay volatilityCone создан; повторный
   тогл -> overlay удалён.
3. AI-уровни: событие apply-ai-strategy-levels -> strategyLevelZone оверлеи
   (по числу уровней); пустой список -> очищены.
4. Position setup (регрессия через новый хук): apply-position-setup ->
   positionSetupBox +1 и HUD виден.
5. Второе мнение (регрессия handleAskSecondOpinion с localPositionSetup):
   карточка появляется по кнопке HUD.

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


def overlay_count(page, name: str) -> int:
    return page.evaluate(
        """(n) => {
            const chart = window.__charts?.chart_main || window.__chart;
            let c = 0;
            const store = chart?._chartStore?.getOverlayStore();
            if (store && store._instances) {
                for (const inst of store._instances.values()) {
                    inst.forEach(i => { if (i?.name === n) c++; });
                }
            }
            return c;
        }""",
        name,
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

            log("[2/5] Конус волатильности: тогл -> overlay; тогл -> скрыт ...")
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-toolbar-toggle-cone"]');
                    if (el) el.click();
                }"""
            )
            cone_on = False
            for _ in range(15):
                time.sleep(0.4)
                if overlay_count(page, "volatilityCone") >= 1:
                    cone_on = True
                    break
            if not cone_on:
                failures.append(f"volatilityCone overlay не создан после тогла (pageerrors: {failures})")
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-toolbar-toggle-cone"]');
                    if (el) el.click();
                }"""
            )
            cone_off = False
            for _ in range(15):
                time.sleep(0.4)
                if overlay_count(page, "volatilityCone") == 0:
                    cone_off = True
                    break
            if not cone_off:
                failures.append("volatilityCone overlay не удалён после повторного тогла")
            if not any("volatilityCone" in f for f in failures):
                log("      cone on/off OK")

            log("[3/5] AI-уровни: apply-ai-strategy-levels -> strategyLevelZone ...")
            page.evaluate(
                """() => {
                    window.dispatchEvent(new CustomEvent('apply-ai-strategy-levels', {
                        detail: { levels: [
                            { price: 79000, type: 'BUY', label: 'E2E BUY ZONE' },
                            { price: 83000, type: 'SELL', label: 'E2E SHORT ZONE' }
                        ] }
                    }));
                }"""
            )
            lv_on = False
            for _ in range(15):
                time.sleep(0.4)
                if overlay_count(page, "strategyLevelZone") >= 2:
                    lv_on = True
                    break
            if not lv_on:
                failures.append(f"strategyLevelZone оверлеи не созданы (count={overlay_count(page, 'strategyLevelZone')})")
            page.evaluate(
                """() => {
                    window.dispatchEvent(new CustomEvent('apply-ai-strategy-levels', { detail: { levels: [] } }));
                }"""
            )
            lv_off = False
            for _ in range(15):
                time.sleep(0.4)
                if overlay_count(page, "strategyLevelZone") == 0:
                    lv_off = True
                    break
            if not lv_off:
                failures.append("strategyLevelZone оверлеи не очищены пустым списком")
            if not any("strategyLevelZone" in f for f in failures):
                log("      AI-уровни on/off OK")

            log("[4/5] Position setup (регрессия через useChartAnnotations) ...")
            n0 = overlay_count(page, "positionSetupBox")
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
            box_ok = False
            for _ in range(15):
                time.sleep(0.4)
                if overlay_count(page, "positionSetupBox") == n0 + 1:
                    box_ok = True
                    break
            hud = page.evaluate("!!document.querySelector('[data-testid=\"chart-position-hud\"]')")
            if not box_ok:
                failures.append(f"positionSetupBox не добавлен: {n0} -> {overlay_count(page, 'positionSetupBox')}")
            if not hud:
                failures.append("HUD не виден после apply-position-setup")
            if not failures:
                log(f"      positionSetupBox {n0} -> {n0 + 1}, HUD OK")

            log("[5/5] Второе мнение (регрессия handleAskSecondOpinion) ...")
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
    log("[OK] MODULARIZATION 6.4m (useChartAnnotations) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
