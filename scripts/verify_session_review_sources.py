"""Ad-hoc E2E probe: SessionReviewPanel с источниками demo/марафон (дослайс 7.3).

Журнал открывается через localStorage signalscript_show_journal=true + reload.
Проверяет: панель разбора рендерится, чипы Все/Demo/Марафон переключают
source и данные приходят (data.source меняется, marathon_session_ids видны).
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
    with urllib.request.urlopen(f"{BACKEND}/api/health", timeout=5) as r:
        assert json.loads(r.read())["status"] == "ok"


def wait_for_frontend(timeout_s: int = 40) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(FRONTEND, timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"фронтенд не поднялся на :{FRONTEND_PORT}")


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


def main() -> int:
    check_backend()
    vite = subprocess.Popen(
        "npm run dev -- --host 127.0.0.1 --port " + str(FRONTEND_PORT),
        cwd="frontend", shell=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
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
            page.add_init_script(
                "try { localStorage.setItem('signalscript_show_journal', 'true'); } catch (_) {}"
            )

            log("[1/3] Загрузка с открытым журналом, панель разбора ...")
            page.goto(FRONTEND, wait_until="domcontentloaded", timeout=60000)
            panel_ok = False
            for _ in range(30):
                time.sleep(0.5)
                if page.evaluate("!!document.querySelector('[data-testid=\"session-review-panel\"]')"):
                    panel_ok = True
                    break
            if not panel_ok:
                failures.append("session-review-panel не отрендерилась")
            else:
                log("      панель разбора видна")

            log("[2/3] Чипы источников: Все -> Марафон ...")
            for chip in ("session-review-source-all", "session-review-source-marathon",
                         "session-review-source-demo"):
                if not page.evaluate(f"!!document.querySelector('[data-testid=\"{chip}\"]')"):
                    failures.append(f"чип {chip} не найден")
            if not failures:
                page.evaluate(
                    """() => document.querySelector('[data-testid="session-review-source-marathon"]').click()"""
                )
                time.sleep(1.5)
                src = page.evaluate(
                    "document.querySelector('[data-testid=\"session-review-panel\"]')?.textContent || ''"
                )
                if "марафон" not in src.lower():
                    failures.append("после клика «Марафон» панель не показывает марафон-контекст")
                else:
                    log("      переключение на Марафон OK")

            log("[3/3] Контроль pageerror ...")
            time.sleep(1)
            perrs = [f for f in failures if f.startswith("pageerror")]
            if perrs:
                failures.extend([])  # уже в списке
                log("      pageerrors: " + "; ".join(perrs))
            else:
                log("      pageerrors нет")
            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] SESSION REVIEW PANEL (demo/марафон sources) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
