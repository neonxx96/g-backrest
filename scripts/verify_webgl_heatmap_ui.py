"""Ad-hoc E2E verification (4.5): непрерывная WebGL-heatmap плотностей стакана.

Сценарий:
1. Открывает терминал, ждёт свечи на графике.
2. Кликает тумбл «🔥 Плотн.» (btn-toolbar-toggle-heatmap) → включает heatmap.
3. Ждёт canvas [data-testid=depth-heatmap-gl].
4. Проверяет, что canvas не пустой: читает пиксели (webgl preserveDrawingBuffer=False —
   читаем через toDataURL только что отрисованный кадр; безопаснее проверять
   наличие ненулевых пикселей через 2D-скриншот области графика).
5. Двигает зум/скролл — canvas должен остаться синхронизирован (не падает, не исчезает).

Требует живой backend на :8000 (данные /api/heatmap из recorder'а). Exit 0 — OK.
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
    import time as _t

    deadline = _t.time() + timeout_s
    while _t.time() < deadline:
        try:
            with urllib.request.urlopen(FRONTEND, timeout=2) as r:
                if r.status == 200:
                    return
        except Exception:
            _t.sleep(0.5)
    raise SystemExit(f"frontend на :{FRONTEND_PORT} не поднялся за {timeout_s} с")


def main() -> int:
    with urllib.request.urlopen(f"{BACKEND}/api/health", timeout=5) as r:
        assert json.loads(r.read())["status"] == "ok"

    # Данные есть? Если recorder ещё не накопил depth-снимки — честно пропускаем.
    with urllib.request.urlopen(f"{BACKEND}/api/heatmap?symbol=BTCUSDT&min_usd=50000&limit=50", timeout=10) as r:
        pts = json.loads(r.read())
    log(f"heatmap points (BTC, min 50k$): {len(pts) if isinstance(pts, list) else 'n/a'}")

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

            log("[1/5] Открытие терминала ...")
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

            log("[2/5] Включение heatmap тумблом ...")
            page.click('[data-testid="btn-toolbar-toggle-heatmap"]')
            time.sleep(1.0)

            log("[3/5] Ожидание WebGL-canvas ...")
            page.wait_for_selector('[data-testid="depth-heatmap-gl"]', timeout=10000)
            info = page.evaluate(
                """() => {
                    const c = document.querySelector('[data-testid="depth-heatmap-gl"]');
                    if (!c) return null;
                    return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight };
                }"""
            )
            log(f"      canvas: {info}")
            if not info or info["cw"] == 0 or info["ch"] == 0:
                failures.append("canvas имеет нулевой размер")
            if not info or info["w"] == 0:
                failures.append("canvas не отресайзился (backing store 0)")

            log("[4/5] Проверка, что canvas что-то рисует ...")
            # Даём время на fetch точек и первый кадр. Диагностика — через
            # window.__depthHeatmapGL {mode, points, drawn, glError}.
            deadline = time.time() + 25
            dbg: dict = {}
            while time.time() < deadline:
                dbg = page.evaluate("() => window.__depthHeatmapGL || {}")
                if dbg.get("points", 0) > 0 and dbg.get("drawn", 0) > 0:
                    break
                time.sleep(0.5)
            log(f"      debug: {dbg}")
            if dbg.get("mode") not in ("webgl", "2d-fallback"):
                failures.append(f"WebGL-контекст не создан: mode={dbg.get('mode')}")
            if dbg.get("points", 0) <= 0:
                failures.append("точки heatmap не загрузились (points=0)")
            if dbg.get("drawn", 0) <= 0:
                failures.append("ничего не отрисовано (drawn=0)")
            if dbg.get("glError") not in (0, None):
                failures.append(f"glError={dbg.get('glError')}")

            # Пиксельный smoke: скриншот ценовой полосы поверх canvas.
            # ВАЖНО: element-screenshot прозрачного WebGL-canvas захватывает и контент
            # под ним — поэтому сканируем пиксели clip-скриншота страницы, а не байты PNG.
            box = page.locator('[data-testid="depth-heatmap-gl"]').bounding_box()
            if not box:
                failures.append("не удалось измерить canvas")
            else:
                strip = page.screenshot(clip={
                    "x": box["x"], "y": box["y"] + box["height"] * 0.4,
                    "width": box["width"], "height": box["height"] * 0.3,
                })
                import io
                import PIL.Image
                img = PIL.Image.open(io.BytesIO(strip)).convert("RGB")
                w, h = img.size
                colored = 0
                for row_y in (h // 3, h // 2, 2 * h // 3):
                    for x in range(0, w, 3):
                        r, g, b = img.getpixel((x, row_y))
                        if (g > 120 and r < 110) or (r > 150 and g < 120):
                            colored += 1
                log(f"      pixel scan: colored={colored} в 3 строках ({w}x{h})")
                if colored < 30:
                    failures.append(
                        f"сплаты не видны на скриншоте (colored={colored}); "
                        f"points={dbg.get('points')}, drawn={dbg.get('drawn')}"
                    )

            log("[5/5] Зум/скролл — canvas жив и синхронен ...")
            page.evaluate("() => window.__chart && window.__chart.scrollToRealTime && window.__chart.scrollToRealTime()")
            time.sleep(1.0)
            still = page.locator('[data-testid="depth-heatmap-gl"]').count()
            if still != 1:
                failures.append(f"canvas исчез после навигации (count={still})")
            pe = [f for f in failures if f.startswith("pageerror")]
            if pe:
                failures = [f for f in failures if not f.startswith("pageerror")] + pe[:3]

            browser.close()
    finally:
        vite.terminate()
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
    log("\nOK: WebGL heatmap E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
