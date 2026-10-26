"""Ad-hoc E2E verification (2.5): replay-плеер lake в UI.

Сценарий:
1. Открывает терминал, ждёт график.
2. Кликает «⏯ Replay» (btn-open-replay) → модалка [data-testid=replay-modal].
3. Ждёт загрузки окна (total > 0), жмёт Play, проверяет, что прогресс движется
   и метрики (trades/depth) растут.
4. Пауза → Step: индекс растёт ровно на шаг.
5. Смена скорости и символа не падает. Exit 0 — OK.

Требует живой backend :8000 с поднятым /api/replay/events (порт 5199 для vite).
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


def cleanup_port(port: int) -> None:
    try:
        out = subprocess.run(
            f'netstat -ano | findstr ":{port}" | findstr LISTENING',
            shell=True, capture_output=True, text=True,
        ).stdout
        for line in out.splitlines():
            parts = line.split()
            if parts and parts[-1].isdigit():
                subprocess.run(f"taskkill /PID {parts[-1]} /F", shell=True, capture_output=True)
    except Exception:
        pass


def main() -> int:
    with urllib.request.urlopen(f"{BACKEND}/api/health", timeout=5) as r:
        assert json.loads(r.read())["status"] == "ok"

    vite = subprocess.Popen(
        "npm run dev -- --host 127.0.0.1 --port " + str(FRONTEND_PORT),
        cwd="frontend", shell=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    failures: list[str] = []
    try:
        wait_frontend_ready()
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_context(viewport={"width": 1600, "height": 950}).new_page()
            page.on("pageerror", lambda err: failures.append(f"pageerror: {err}"))

            log("[1/6] Открытие терминала ...")
            page.goto(FRONTEND, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_selector("canvas", timeout=30000)
            time.sleep(4)

            log("[2/6] Открытие replay-модалки ...")
            page.click('[data-testid="btn-open-replay"]')
            page.wait_for_selector('[data-testid="replay-modal"]', timeout=10000)
            page.wait_for_selector('[data-testid="replay-canvas"]', timeout=10000)
            # total подгружается асинхронно (первый fetch страницы)
            page.wait_for_function(
                "() => !document.body.innerText.includes('загрузка…')",
                timeout=30000,
            )
            head = page.locator('[data-testid="replay-modal"]').inner_text()[:200]
            log(f"      head: {head[:120]!r}")

            log("[3/6] Play → прогресс и метрики растут ...")
            page.click('[data-testid="replay-play"]')
            time.sleep(3.0)
            m1 = page.locator('[data-testid="replay-modal"]').inner_text()
            page.click('[data-testid="replay-play"]')  # пауза
            time.sleep(0.5)
            page.click('[data-testid="replay-play"]')  # снова play
            time.sleep(2.0)
            page.click('[data-testid="replay-play"]')  # пауза
            m2 = page.locator('[data-testid="replay-modal"]').inner_text()
            import re
            def metric(txt, name):
                mt = re.search(rf"{name}:\s*([0-9,]+)", txt)
                return int(mt.group(1).replace(",", "")) if mt else None
            for name in ("trades", "depth"):
                v1, v2 = metric(m1, name), metric(m2, name)
                log(f"      {name}: {v1} -> {v2}")
                if v2 is None or v1 is None or v2 <= v1:
                    failures.append(f"метрика {name} не растёт ({v1} -> {v2})")

            log("[4/6] Step увеличивает индекс ...")
            idx_before = page.evaluate(
                "() => document.querySelector('[data-testid=\"replay-progress\"] div').style.width"
            )
            page.click('[data-testid="replay-step"]')
            time.sleep(0.3)
            idx_after = page.evaluate(
                "() => document.querySelector('[data-testid=\"replay-progress\"] div').style.width"
            )
            log(f"      progress: {idx_before} -> {idx_after}")
            if idx_before == idx_after:
                failures.append("Step не сдвинул прогресс")

            log("[5/6] Смена скорости и символа не падает ...")
            page.click('[data-testid="replay-speed-2000"]')
            page.select_option('[data-testid="replay-symbol"]', "ETHUSDT")
            time.sleep(3)
            page.wait_for_function(
                "() => !document.body.innerText.includes('загрузка…')",
                timeout=30000,
            )
            page.click('[data-testid="replay-play"]')
            time.sleep(1.5)
            page.click('[data-testid="replay-play"]')
            txt = page.locator('[data-testid="replay-modal"]').inner_text()
            if "Ошибка" in txt:
                failures.append(f"ошибка после смены символа: {txt[:200]!r}")

            log("[6/6] Закрытие ...")
            page.click('[data-testid="replay-close"]')
            time.sleep(0.5)
            if page.locator('[data-testid="replay-modal"]').count():
                failures.append("модалка не закрылась")

            pe = [f for f in failures if f.startswith("pageerror")]
            if pe:
                failures = [f for f in failures if not f.startswith("pageerror")] + pe[:3]
            browser.close()
    finally:
        vite.terminate()
        cleanup_port(FRONTEND_PORT)

    if failures:
        log("\nFAIL:")
        for f in failures:
            log(f"  - {f}")
        return 1
    log("\nOK: Replay player E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
