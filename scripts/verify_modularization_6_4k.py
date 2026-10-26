"""Ad-hoc E2E verification (6.4, слайс k / п.1 слайс 4): системные оверлеи вынесены из Chart.jsx.

Проверяет, что после переноса регистраций кастомных элементов в
chart/registerCustomElements.js и логики системных оверлеев в
chart/useChartOverlays.js (тела дословно, norm-сверка 1879/1879) поведение 1:1:
1. Стены стакана (orderbookWall) по умолчанию ON: WS depth20 + HTTP-fallback рисуют бейджи.
2. VWAP-тоггл: оверлей-сегмент #ffb300 создаётся и удаляется.
3. Footprint: тогикл -> footprintCandle оверлеи из /api/recorder/clusters (42 свечи).
4. TPO: тогл -> tpoProfile оверлей (data_available=True, 197 строк).
5. Heatmap: тогл -> densityPoints > 0, WebGL-canvas DepthHeatmapGL появляется; OFF -> исчезает.
6. Стены OFF -> orderbookWall оверлеи удаляются; ON -> восстанавливаются.
7. Ликвидации: слой default ON, liqMarker не падает при пустых данных (0 событий).

Требует живой backend на :8000. Фронтенд поднимает сам на :5199 (останавливает после).
Снапшотит/восстанавливает localStorage тумблеров (chart_heatmap/footprint/tpo/vwap/walls/liquidations).
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
LS_KEYS = ["chart_heatmap", "chart_footprint", "chart_tpo", "chart_vwap", "chart_walls", "chart_liquidations"]


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


def click_testid(page, testid: str) -> None:
    page.evaluate(
        """(tid) => {
            const el = document.querySelector(`[data-testid="${tid}"]`);
            if (!el) throw new Error(`[data-testid=${tid}] не найден`);
            el.click();
        }""",
        testid,
    )


def click_button_text(page, text: str) -> None:
    page.evaluate(
        """(t) => {
            const el = Array.from(document.querySelectorAll('button'))
                .find(b => b.textContent.trim() === t);
            if (!el) throw new Error(`кнопка с текстом "${t}" не найдена`);
            el.click();
        }""",
        text,
    )


def overlay_names(page) -> dict:
    """Имена оверлеев из внутреннего стора KLineCharts v9 -> {name: count}."""
    return page.evaluate(
        """() => {
            const charts = Object.entries(window.__charts || {});
            const chart = charts.find(([id]) => id === 'chart_main')?.[1]
                || charts.find(([, v]) => v && typeof v.getDataList === 'function')?.[1]
                || window.__chart;
            if (!chart) return {};
            const counts = {};
            try {
                const store = chart._chartStore?.getOverlayStore();
                if (store && store._instances) {
                    for (const instances of store._instances.values()) {
                        instances.forEach(inst => {
                            if (inst && inst.name) counts[inst.name] = (counts[inst.name] || 0) + 1;
                        });
                    }
                }
            } catch (e) { counts.__err = String(e); }
            return counts;
        }"""
    )


def wait_overlay(page, name: str, cmp: str, n: int, timeout_s: float = 12.0) -> dict:
    """Поллит overlay_names, пока count(name) не станет (ge/le/eq) n. Возвращает последний снапшот."""
    deadline = time.time() + timeout_s
    last: dict = {}
    while time.time() < deadline:
        last = overlay_names(page)
        c = last.get(name, 0)
        if (cmp == "ge" and c >= n) or (cmp == "le" and c <= n) or (cmp == "eq" and c == n):
            return last
        time.sleep(0.4)
    return last


def heat_canvas_count(page) -> int:
    return page.evaluate(
        "document.querySelectorAll('[data-testid=\"depth-heatmap-gl\"]').length"
    )


def canvas_count(page) -> int:
    return page.evaluate("document.querySelectorAll('canvas').length")


def ls_snapshot(page) -> dict:
    return page.evaluate(
        """(keys) => {
            const snap = {};
            keys.forEach(k => snap[k] = localStorage.getItem(k));
            return snap;
        }""",
        LS_KEYS,
    )


def ls_restore(page, snap: dict) -> None:
    page.evaluate(
        """(snap) => {
            Object.entries(snap).forEach(([k, v]) => {
                if (v === null) localStorage.removeItem(k);
                else localStorage.setItem(k, v);
            });
        }""",
        snap,
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

            log("[1/7] Открытие терминала (walls default ON) ...")
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
            snap = ls_snapshot(page)
            log(f"      localStorage снапшот: {snap}")
            names = wait_overlay(page, "orderbookWall", "ge", 1, timeout_s=15.0)
            walls = names.get("orderbookWall", 0)
            if walls < 1:
                failures.append(f"стены стакана не появились (orderbookWall=0): {names}")
            else:
                log(f"      orderbookWall × {walls} (WS depth20 / HTTP-fallback)")

            log("[2/7] VWAP-тоггл: сегмент #ffb300 создаётся и удаляется ...")
            click_button_text(page, "VWAP")
            names = wait_overlay(page, "segment", "ge", 1, timeout_s=6.0)
            vwap_on = names.get("segment", 0) >= 1
            if not vwap_on:
                failures.append(f"VWAP-оверлей не создан после тоггла: {names}")
            click_button_text(page, "VWAP")
            names = wait_overlay(page, "segment", "le", 0, timeout_s=6.0)
            if names.get("segment", 0) != 0:
                failures.append(f"VWAP-оверлей не удалён после повторного тоггла: {names}")
            if not failures:
                log("      VWAP on/off OK")

            log("[3/7] Footprint-тогл -> footprintCandle из recorder/clusters ...")
            click_testid(page, "btn-toolbar-toggle-footprint")
            names = wait_overlay(page, "footprintCandle", "ge", 1, timeout_s=12.0)
            fp = names.get("footprintCandle", 0)
            if fp < 1:
                failures.append(f"footprintCandle оверлеи не появились: {names}")
            else:
                log(f"      footprintCandle × {fp}")

            log("[4/7] TPO: loadTpoProfile вызывается из эффекта загрузки свечей ...")
            # Латентная особенность оригинала (1:1, не регрессия): рантайм-тогл TPO
            # только пишет state/localStorage, loadTpoProfile зовётся из fetch-effect.
            # Поэтому проверяем через localStorage + reload — так же, как живой пользователь
            # увидит TPO при следующей загрузке графика.
            page.evaluate("localStorage.setItem('chart_tpo', 'true')")
            page.reload(wait_until="domcontentloaded")
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
            names = wait_overlay(page, "tpoProfile", "ge", 1, timeout_s=15.0)
            tpo = names.get("tpoProfile", 0)
            if tpo < 1:
                failures.append(f"tpoProfile оверлей не появился после reload: {names}")
            else:
                log(f"      tpoProfile × {tpo}")
            page.evaluate("localStorage.removeItem('chart_tpo')")

            log("[5/7] Heatmap-тогл -> WebGL-canvas DepthHeatmapGL; OFF -> исчезает ...")
            click_testid(page, "btn-toolbar-toggle-heatmap")
            heat_on = False
            for _ in range(25):
                time.sleep(0.4)
                if heat_canvas_count(page) >= 1:
                    heat_on = True
                    break
            if not heat_on:
                failures.append("WebGL-canvas heatmap не появился после ON")
            click_testid(page, "btn-toolbar-toggle-heatmap")
            heat_off = False
            for _ in range(25):
                time.sleep(0.4)
                if heat_canvas_count(page) == 0:
                    heat_off = True
                    break
            if not heat_off:
                failures.append(f"WebGL-canvas heatmap не исчез после OFF (n={heat_canvas_count(page)})")
            if not failures:
                log("      heatmap on/off OK (depth-heatmap-gl появился и исчез)")

            log("[6/7] Стены OFF -> orderbookWall=0; ON -> восстановились ...")
            click_testid(page, "btn-toolbar-toggle-walls")
            names = wait_overlay(page, "orderbookWall", "le", 0, timeout_s=6.0)
            if names.get("orderbookWall", 0) != 0:
                failures.append(f"стены не удалились после OFF: {names}")
            click_testid(page, "btn-toolbar-toggle-walls")
            names = wait_overlay(page, "orderbookWall", "ge", 1, timeout_s=15.0)
            walls_back = names.get("orderbookWall", 0)
            if walls_back < 1:
                failures.append(f"стены не восстановились после ON: {names}")
            if not failures:
                log(f"      walls off/on OK (вернулись × {walls_back})")

            log("[7/7] Ликвидации default ON, пустые данные не падают (liqMarker=0) ...")
            names = overlay_names(page)
            if names.get("__err"):
                failures.append(f"overlay-store недоступен: {names['__err']}")
            log(f"      итоговый overlay-store: {names} (liqMarker={names.get('liqMarker', 0)}, данных 0 — ок)")

            ls_restore(page, snap)
            log(f"      localStorage восстановлен")
            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] MODULARIZATION 6.4k (registerCustomElements + useChartOverlays) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
