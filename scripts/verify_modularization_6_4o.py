"""Ad-hoc E2E verification (6.4, слайс o / п.1 слайс 8): JSX-модалки из Chart.jsx.

Проверяет, что после выделения JSX-блоков в компоненты
chart/SaveTemplateModal.jsx, chart/BtTooltipOverlay.jsx,
chart/ToxicVolatilityOverlay.jsx и chart/IndicatorsDock.jsx
(JSX дословно) поведение 1:1:
1. Базовая загрузка без pageerror (ловит ReferenceError/типографику пропсов).
2. Модалка «Сохранить шаблон SMC»: открытие -> имя -> confirm -> шаблон
   появляется в дропдауне smc-templates (паттерн слайса 6.4j).
3. Индикаторный док (регрессия IndicatorsDock): стек открывает каталог.
4. Закрытие каталога кнопкой; pageerror-контроль тултипа bt и toxic-оверлея
   (пути недетерминированы в E2E — покрыты дословностью и мониторингом ошибок).

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


def click_by_testid(page, testid: str) -> None:
    page.evaluate(
        """(tid) => {
            const el = document.querySelector(`[data-testid="${tid}"]`);
            if (!el) throw new Error(`testid ${tid} не найден`);
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
    wait_for_frontend()
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()
            page.on("pageerror", lambda err: failures.append(f"pageerror: {err}"))

            log("[1/4] Открытие терминала, базовая загрузка без pageerror ...")
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

            log("[2/4] Модалка «Сохранить шаблон SMC» -> имя -> дропдаун ...")
            click_by_testid(page, "btn-save-as-template")
            time.sleep(0.5)
            modal_ok = page.evaluate("!!document.querySelector('[data-testid=\"modal-save-template\"]')")
            if not modal_ok:
                failures.append("modal-save-template не открылся по btn-save-as-template")
            else:
                tpl_name = "e2e_slice8_probe"
                page.evaluate(
                    """(name) => {
                        const inp = document.querySelector("[data-testid='input-template-name']");
                        if (!inp) throw new Error('input-template-name не найден');
                        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        setter.call(inp, name);
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                    }""",
                    tpl_name,
                )
                time.sleep(0.3)
                click_by_testid(page, "btn-confirm-save-template")
                time.sleep(0.6)
                modal_closed = page.evaluate("!document.querySelector('[data-testid=\"modal-save-template\"]')")
                if not modal_closed:
                    failures.append("модалка save-template не закрылась после confirm")
                click_by_testid(page, "btn-smc-templates")
                time.sleep(0.4)
                found = page.evaluate(
                    """(name) => {
                        const dd = document.querySelector("[data-testid='smc-templates-dropdown']");
                        return dd ? dd.textContent.includes(name) : false;
                    }""",
                    tpl_name,
                )
                if not found:
                    failures.append(f"шаблон {tpl_name} не появился в дропдауне SMC")
                else:
                    log(f"      шаблон {tpl_name} в дропдауне OK")
                # закрыть дропдаун Escape
                page.keyboard.press("Escape")
                time.sleep(0.4)

            log("[3/4] Индикаторный док: стек открывает каталог (регрессия IndicatorsDock) ...")
            page.evaluate(
                """() => {
                    const el = document.querySelector('[data-testid="btn-stack-open-catalog"]');
                    if (el) el.click();
                }"""
            )
            dock_ok = False
            for _ in range(15):
                time.sleep(0.4)
                if page.evaluate("!!document.querySelector('[data-testid=\"indicators-modal\"]')"):
                    dock_ok = True
                    break
            if not dock_ok:
                failures.append("IndicatorsModal не открылся через IndicatorsDock")
            else:
                log("      каталог открылся OK")
                page.evaluate(
                    """() => {
                        const el = document.querySelector('[data-testid="btn-close-indicators-modal"]');
                        if (el) el.click();
                    }"""
                )
                time.sleep(0.5)

            log("[4/4] Контроль pageerror после прохода (btTooltip/toxic — дословность) ...")
            time.sleep(2)
            page_errs = [f for f in failures if f.startswith("pageerror")]
            if page_errs:
                log("      pageerrors: " + "; ".join(page_errs))
            else:
                log("      pageerrors нет")

            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] MODULARIZATION 6.4o (SaveTemplateModal/BtTooltip/ToxicOverlay/IndicatorsDock) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
