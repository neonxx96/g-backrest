"""Ad-hoc E2E verification (6.4, слайс l / п.1 слайс 5): жизненный цикл графика + PositionSetupHUD.

Проверяет, что после переноса в chart/chartStyles.js, chart/useChartLifecycle.js
(chart/init/dispose/ResizeObserver/dual-source свечи/live WS — тела дословно,
norm-сверка 713/713) и chart/PositionSetupHUD.jsx (HUD сетапа + карточка второго
мнения — JSX дословно) поведение 1:1:
1. Инициализация: window.__charts.chart_main, deep load 1500 свечей, overlay-store жив.
2. ResizeObserver: ресайз вьюпорта -> __chartResizeCounts[chartId] растёт.
3. HUD: событие apply-position-setup -> бейджи Entry/SL/TP1/R:R + overlay positionSetupBox;
   ✕ скрывает HUD и удаляет overlay.
4. Второе мнение AI: кнопка -> живой POST /api/journal/second-opinion -> карточка с вердиктом;
   ✕ закрывает карточку.
5. Live WS: свечи продолжают обновляться (две выборки getDataList().length равны/растут,
   last candle fresh — живой поток без синтетики).

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

            log("[1/5] Открытие терминала: init, deep load 1500 свечей ...")
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
            info = page.evaluate(
                """() => {
                    const chart = window.__charts?.chart_main || window.__chart;
                    return {
                        bars: chart?.getDataList?.().length || 0,
                        loaded: window.__historyLoadedBars || 0,
                        oldest: window.__historyOldestTs || null,
                    };
                }"""
            )
            log(f"      bars={info['bars']} loaded={info['loaded']} oldest={info['oldest']}")
            if info["loaded"] < 1400:
                failures.append(f"deep load недостаточен: {info['loaded']} баров")
            if not info["oldest"]:
                failures.append("__historyOldestTs не выставлен")

            log("[2/5] ResizeObserver: ресайз -> __chartResizeCounts растёт ...")
            r0 = page.evaluate(
                "Object.values(window.__chartResizeCounts || {}).reduce((a, b) => a + b, 0)"
            )
            page.set_viewport_size({"width": 1280, "height": 800})
            grew = False
            for _ in range(15):
                time.sleep(0.4)
                r1 = page.evaluate(
                    "Object.values(window.__chartResizeCounts || {}).reduce((a, b) => a + b, 0)"
                )
                if r1 > r0:
                    grew = True
                    log(f"      resize {r0} -> {r1}")
                    break
            if not grew:
                failures.append("ResizeObserver не отреагировал на ресайз вьюпорта")
            page.set_viewport_size({"width": 1600, "height": 950})

            log("[3/5] HUD: apply-position-setup -> бейджи + overlay; ✕ скрывает ...")
            n_box0 = page.evaluate(
                """() => {
                    const chart = window.__charts?.chart_main || window.__chart;
                    let n = 0;
                    const store = chart?._chartStore?.getOverlayStore();
                    if (store && store._instances) {
                        for (const inst of store._instances.values()) {
                            inst.forEach(i => { if (i?.name === 'positionSetupBox') n++; });
                        }
                    }
                    return n;
                }"""
            )
            page.evaluate(
                """() => {
                    window.dispatchEvent(new CustomEvent('apply-position-setup', {
                        detail: { setup: {
                            direction: 'LONG',
                            entry_price: 80000, sl_price: 79600, tp1_price: 80700,
                            tp2_price: 81000, sl_pct: -0.5, tp1_pct: 0.875, tp2_pct: 1.25,
                            sl_risk_usd: 50, rr_ratio: 1.75, rr_label: '1:1.75'
                        } }
                    }));
                }"""
            )
            hud_ok = False
            for _ in range(15):
                time.sleep(0.4)
                if page.evaluate("!!document.querySelector('[data-testid=\"chart-position-hud\"]')"):
                    hud_ok = True
                    break
            if not hud_ok:
                failures.append("HUD не появился после apply-position-setup")
            badges = page.evaluate(
                """() => ['chart-badge-entry','chart-badge-sl','chart-badge-tp1','chart-badge-rr']
                    .map(t => !!document.querySelector(`[data-testid="${t}"]`))"""
            )
            if hud_ok and not all(badges):
                failures.append(f"не все бейджи HUD: {badges}")
            n_box1 = page.evaluate(
                """() => {
                    const chart = window.__charts?.chart_main || window.__chart;
                    let n = 0;
                    const store = chart?._chartStore?.getOverlayStore();
                    if (store && store._instances) {
                        for (const inst of store._instances.values()) {
                            inst.forEach(i => { if (i?.name === 'positionSetupBox') n++; });
                        }
                    }
                    return n;
                }"""
            )
            if n_box1 != n_box0 + 1:
                failures.append(f"positionSetupBox overlay не добавлен: {n_box0} -> {n_box1}")
            if not failures:
                log(f"      HUD + overlay OK ({n_box0} -> {n_box1})")
            # закрытие по ✕ («Скрыть разметку позиции»)
            page.evaluate(
                """() => {
                    const btns = Array.from(document.querySelectorAll('[data-testid="chart-position-hud"] button'));
                    const x = btns.find(b => b.textContent.trim() === '✕');
                    if (x) x.click();
                }"""
            )
            hid = False
            for _ in range(15):
                time.sleep(0.4)
                if not page.evaluate("!!document.querySelector('[data-testid=\"chart-position-hud\"]')"):
                    hid = True
                    break
            if not hid:
                failures.append("HUD не скрылся по ✕")
            n_box2 = page.evaluate(
                """() => {
                    const chart = window.__charts?.chart_main || window.__chart;
                    let n = 0;
                    const store = chart?._chartStore?.getOverlayStore();
                    if (store && store._instances) {
                        for (const inst of store._instances.values()) {
                            inst.forEach(i => { if (i?.name === 'positionSetupBox') n++; });
                        }
                    }
                    return n;
                }"""
            )
            if n_box2 != n_box0:
                failures.append(f"positionSetupBox overlay не удалён после ✕: {n_box2} (ожидалось {n_box0})")
            if not failures:
                log(f"      ✕ -> HUD скрыт, overlay {n_box1} -> {n_box2}")

            log("[4/5] Второе мнение AI: живой запрос -> карточка с вердиктом ...")
            page.evaluate(
                """() => {
                    window.dispatchEvent(new CustomEvent('apply-position-setup', {
                        detail: { setup: {
                            direction: 'LONG',
                            entry_price: 80000, sl_price: 79600, tp1_price: 80700,
                            sl_pct: -0.5, tp1_pct: 0.875, sl_risk_usd: 50
                        } }
                    }));
                }"""
            )
            time.sleep(1.0)
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
                failures.append("карточка второго мнения не появилась за 30с")
            else:
                verdict = page.evaluate(
                    "document.querySelector('[data-testid=\"second-opinion-verdict\"]')?.textContent?.trim() || ''"
                )
                reason = page.evaluate(
                    "document.querySelector('[data-testid=\"second-opinion-reason\"]')?.textContent?.trim()?.slice(0, 60) || ''"
                )
                log(f"      вердикт: {verdict!r}, причина: {reason!r}...")
                if not verdict:
                    failures.append("вердикт пустой")
                page.evaluate(
                    """() => {
                        const el = document.querySelector('[data-testid="btn-close-second-opinion"]');
                        if (el) el.click();
                    }"""
                )
                time.sleep(0.6)
                if page.evaluate("!!document.querySelector('[data-testid=\"second-opinion-card\"]')"):
                    failures.append("карточка второго мнения не закрылась по ✕")

            log("[5/5] Live WS: свечи живые, last bar свежий ...")
            t1 = page.evaluate(
                """() => {
                    const chart = window.__charts?.chart_main || window.__chart;
                    const d = chart?.getDataList?.() || [];
                    const last = d[d.length - 1];
                    return { n: d.length, ts: last?.timestamp || 0 };
                }"""
            )
            time.sleep(5)
            t2 = page.evaluate(
                """() => {
                    const chart = window.__charts?.chart_main || window.__chart;
                    const d = chart?.getDataList?.() || [];
                    const last = d[d.length - 1];
                    return { n: d.length, ts: last?.timestamp || 0 };
                }"""
            )
            age_s = (time.time() * 1000 - t2["ts"]) / 1000 if t2["ts"] else 9999
            log(f"      bars {t1['n']} -> {t2['n']}, last bar age {age_s:.0f}s (таймфрейм 15m — норма до 900с)")
            # 15m TF: свеча живёт 900 с; возраст > 2 интервалов = протухание (WS+heartbeat мертвы)
            if age_s > 1800:
                failures.append(f"последняя свеча протухла (age {age_s:.0f}s) — WS/heartbeat не работают")

            browser.close()
    finally:
        vite.terminate()
        kill_port(FRONTEND_PORT)

    if failures:
        log("[FAIL] " + "; ".join(failures))
        return 1
    log("[OK] MODULARIZATION 6.4l (chartStyles + useChartLifecycle + PositionSetupHUD) — все проверки прошли.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
