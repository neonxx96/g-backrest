"""Ad-hoc E2E verification (6.4, слайс 8): SettingsModal разбит на settings/ модули.

Проверяет, что после выноса из SettingsModal.jsx (MODULARIZATION_PLAN п.8) в
frontend/src/components/settings/ (uiConfig.js — DEFAULT_UI_CONFIG/THEME_PRESETS/MONO_FONTS/
loadLocalUiConfig/applyUiConfigToDOM; constants.js; AppearanceTab/ChartsTab/OrderflowTab/ScannerTab)
центр настроек работает поведенчески 1:1:
1. Открытие по кнопке шапки (title «Центр настроек»): заголовок + все 6 вкладок.
2. Appearance: 3 темы, клик Tiger -> document.documentElement data-theme='tiger' и
   --bg-root=#030406 (updateUi -> applyUiConfigToDOM); шрифт Fira Code -> --font-mono.
3. Charts: EMA-секция, точность '0.01', тумблер подвальной панели RSI.
4. Orderflow: порог плотностей '$100k' -> input=100000.
5. Scanner: после fetch /api/settings — таймфрейм 5m активен, override ETH ema_period=33,
   блок Parquet на месте.
6. Сохранение (Сохранить -> тост «Сохранено в localStorage и SQLite»), после чего
   серверные настройки user_id=0 восстанавливаются снапшотом, снятым до теста.

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


def click_by_text(page, selector: str, text: str) -> None:
    page.evaluate(
        """([sel, txt]) => {
            const els = Array.from(document.querySelectorAll(sel));
            const el = els.find(e => e.textContent.trim().includes(txt));
            if (!el) throw new Error(`${sel} с текстом "${txt}" не найден`);
            el.click();
        }""",
        [selector, text],
    )


def click_by_exact_text(page, selector: str, text: str) -> None:
    # Для коротких тикеров/меток, где includes матчит чужие элементы (ETH -> ETHUSDT).
    page.evaluate(
        """([sel, txt]) => {
            const els = Array.from(document.querySelectorAll(sel));
            const el = els.find(e => e.textContent.trim() === txt);
            if (!el) throw new Error(`${sel} с точным текстом "${txt}" не найден`);
            el.click();
        }""",
        [selector, text],
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


def get_server_settings() -> dict:
    with urllib.request.urlopen(f"{BACKEND}/api/settings?user_id=0", timeout=10) as r:
        return json.loads(r.read())


def post_server_settings(payload: dict) -> None:
    req = urllib.request.Request(
        f"{BACKEND}/api/settings",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        r.read()


def main() -> int:
    check_backend()
    snapshot_before = get_server_settings()
    log("      снапшот /api/settings (user_id=0) снят — восстановим после теста")

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

            log("[1/6] Открытие терминала и Центра настроек ...")
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
            page.evaluate(
                """() => {
                    const btn = Array.from(document.querySelectorAll('button'))
                        .find(b => b.title && b.title.includes('Центр настроек'));
                    if (!btn) throw new Error('кнопка настроек не найдена');
                    btn.click();
                }"""
            )
            page.wait_for_function(
                "() => document.body.innerText.includes('Центр настроек терминала SignalScript')",
                timeout=8000,
            )
            for tab_label in [
                "Внешний вид & Тема", "Графики & Индикаторы", "Order Flow & Стакан",
                "Сканер & Диск", "AI Engine", "Confluence",
            ]:
                if not page.locator(f"text={tab_label}").count():
                    failures.append(f"вкладка '{tab_label}' не найдена")
            if not failures:
                log("      модал открыт, все 6 вкладок на месте")

            log("[2/6] Appearance: тема Tiger -> DOM, шрифт Fira Code ...")
            click_by_text(page, "div.cursor-pointer", "Tiger Deep Dark")
            time.sleep(0.5)
            dom_theme = page.evaluate(
                "() => document.documentElement.getAttribute('data-theme')"
            )
            dom_bg = page.evaluate(
                "() => document.documentElement.style.getPropertyValue('--bg-root')"
            )
            if dom_theme != "tiger" or dom_bg.strip() != "#030406":
                failures.append(f"тема не применилась к DOM: data-theme={dom_theme!r} bg={dom_bg!r}")
            else:
                log(f"      data-theme={dom_theme}, --bg-root={dom_bg.strip()} (updateUi -> applyUiConfigToDOM)")
            click_by_text(page, "button", "Fira Code")
            time.sleep(0.3)
            dom_font = page.evaluate(
                "() => document.documentElement.style.getPropertyValue('--font-mono')"
            )
            if "Fira Code" not in dom_font:
                failures.append(f"--font-mono не сменился: {dom_font!r}")
            else:
                log(f"      --font-mono={dom_font.strip()}")
            # вернуть дефолтную тему, чтобы не уводить UI в tiger
            click_by_text(page, "div.cursor-pointer", "Tealstreet Pro")
            time.sleep(0.3)

            log("[3/6] Charts: EMA-секция, точность 0.01, панель RSI ...")
            click_by_text(page, "button", "Графики & Индикаторы")
            if page.locator("text=Экспоненциальные средние").count() == 0:
                failures.append("EMA-секция не отрендерилась во вкладке Charts")
            click_by_text(page, "button", "0.01")
            rsi_before = page.evaluate(
                """() => {
                    const modal = Array.from(document.querySelectorAll('div.fixed'))
                        .find(d => d.textContent.includes('Центр настроек терминала'));
                    if (!modal) throw new Error('модал настроек не найден');
                    const rsi = Array.from(modal.querySelectorAll('div.cursor-pointer'))
                        .find(e => e.textContent.includes('RSI (14)'));
                    if (!rsi) throw new Error('панель RSI не найдена в модале');
                    return rsi.className.includes('border-[#38bdf8]');
                }"""
            )
            page.evaluate(
                """() => {
                    const modal = Array.from(document.querySelectorAll('div.fixed'))
                        .find(d => d.textContent.includes('Центр настроек терминала'));
                    if (!modal) throw new Error('модал настроек не найден');
                    const rsi = Array.from(modal.querySelectorAll('div.cursor-pointer'))
                        .find(e => e.textContent.includes('RSI (14)'));
                    if (!rsi) throw new Error('панель RSI не найдена в модале');
                    rsi.click();
                }"""
            )
            time.sleep(0.4)
            rsi_after = page.evaluate(
                """() => {
                    const modal = Array.from(document.querySelectorAll('div.fixed'))
                        .find(d => d.textContent.includes('Центр настроек терминала'));
                    if (!modal) throw new Error('модал настроек не найден');
                    const rsi = Array.from(modal.querySelectorAll('div.cursor-pointer'))
                        .find(e => e.textContent.includes('RSI (14)'));
                    if (!rsi) return { found: false, cls: '' };
                    return { found: true, cls: rsi.className, on: rsi.className.includes('border-[#38bdf8]') };
                }"""
            )
            if not rsi_after.get("found") or rsi_after["on"] == rsi_before:
                failures.append(
                    f"панель RSI не переключилась ({rsi_before} -> {rsi_after})"
                )
            else:
                log(f"      EMA-секция, точность 0.01, RSI переключён {rsi_before} -> {not rsi_before}")

            log("[4/6] Orderflow: порог плотностей $100k ...")
            click_by_text(page, "button", "Order Flow & Стакан")
            click_by_text(page, "button", "$100k")
            time.sleep(0.3)
            density_val = page.evaluate(
                """() => {
                    const inp = Array.from(document.querySelectorAll('input[type=number]'))
                        .find(e => Number(e.value) === 100000);
                    return inp ? inp.value : null;
                }"""
            )
            if density_val != "100000":
                failures.append(f"порог плотностей не установлен в 100000 (input={density_val!r})")
            else:
                log("      densityThresholdUsd=100000 в input")

            log("[5/6] Scanner: таймфрейм 5m, override ETH ema_period=33, Parquet ...")
            click_by_text(page, "button", "Сканер & Диск")
            page.wait_for_selector("text=Нормализация метрик", timeout=10000)
            page.evaluate(
                """() => {
                    const modal = Array.from(document.querySelectorAll('div.fixed'))
                        .find(d => d.textContent.includes('Центр настроек терминала'));
                    if (!modal) throw new Error('модал настроек не найден');
                    const clickExact = (sel, txt) => {
                        const el = Array.from(modal.querySelectorAll(sel))
                            .find(e => e.textContent.trim() === txt);
                        if (!el) throw new Error(`в модале не найден ${sel} "${txt}"`);
                        el.click();
                    };
                    clickExact('button', '5m');
                    clickExact('button', 'ETH');
                }"""
            )
            time.sleep(0.5)  # ждём React-ре-рендер после смены selectedCoin
            coin_label = page.evaluate(
                """() => {
                    const modal = Array.from(document.querySelectorAll('div.fixed'))
                        .find(d => d.textContent.includes('Центр настроек терминала'));
                    if (!modal) throw new Error('модал настроек не найден');
                    const span = Array.from(modal.querySelectorAll('span'))
                        .find(e => e.textContent.includes('Период EMA для #'));
                    if (!span) throw new Error('span Период EMA не найден');
                    return span.textContent.trim();
                }"""
            )
            page.evaluate(
                """() => {
                    const modal = Array.from(document.querySelectorAll('div.fixed'))
                        .find(d => d.textContent.includes('Центр настроек терминала'));
                    if (!modal) throw new Error('модал настроек не найден');
                    const span = Array.from(modal.querySelectorAll('span'))
                        .find(e => e.textContent.includes('Период EMA для #'));
                    const inp = span ? span.parentElement.querySelector('input') : null;
                    if (!inp) throw new Error('input ema_period не найден');
                    const setter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value').set;
                    setter.call(inp, '33');
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                }"""
            )
            time.sleep(0.5)
            scanner_check = page.evaluate(
                """() => {
                    const modal = Array.from(document.querySelectorAll('div.fixed'))
                        .find(d => d.textContent.includes('Центр настроек терминала'));
                    if (!modal) throw new Error('модал настроек не найден');
                    const tfBtn = Array.from(modal.querySelectorAll('button'))
                        .find(b => b.textContent.trim() === '5m');
                    const span = Array.from(modal.querySelectorAll('span'))
                        .find(e => e.textContent.includes('Период EMA для #'));
                    const inp = span ? span.parentElement.querySelector('input') : null;
                    return {
                        tfActive: tfBtn ? tfBtn.className.includes('bg-[#2563eb]') : false,
                        overrideVal: inp ? inp.value : null,
                        parquet: modal.textContent.includes('Хранилище Parquet'),
                    };
                }"""
            )
            tf_active = scanner_check["tfActive"]
            override_val = scanner_check["overrideVal"]
            if coin_label != "Период EMA для #ETHUSDT:":
                failures.append(
                    f"выбрана не та монета: label={coin_label!r}"
                )
            if not tf_active:
                failures.append("таймфрейм 5m не стал активным")
            if override_val != "33":
                failures.append(f"coin-override ema_period не записался: {override_val!r}")
            if not scanner_check["parquet"]:
                failures.append("блок Parquet storage не отрендерился")
            if tf_active and override_val == "33":
                log("      5m активен, ETH ema_period=33, Parquet-блок на месте")

            log("[6/6] Сохранение -> тост, закрытие ...")
            click_by_text(page, "button", "Сохранить")
            page.wait_for_function(
                "() => document.body.innerText.includes('Сохранено в localStorage и SQLite')",
                timeout=10000,
            )
            log("      тост «Сохранено в localStorage и SQLite (user_settings)!» появился")
            click_by_text(page, "button", "Закрыть")
            time.sleep(0.5)
            modal_gone = page.evaluate(
                "() => !document.body.innerText.includes('Центр настроек терминала SignalScript')"
            )
            if not modal_gone:
                failures.append("модал не закрылся по кнопке «Закрыть»")
            else:
                log("      модал закрыт")

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

    # Восстановление серверных настроек (таймфрейм 5m / coin_overrides попали в SQLite при Сохранить)
    try:
        post_server_settings(snapshot_before)
        after = get_server_settings()
        if after.get("timeframe") != snapshot_before.get("timeframe"):
            failures.append(
                f"восстановление timeframe не сработало: {after.get('timeframe')} != {snapshot_before.get('timeframe')}"
            )
        else:
            log("      серверные настройки (user_id=0) восстановлены из снапшота")
    except Exception as exc:
        failures.append(f"не удалось восстановить /api/settings: {exc}")

    if failures:
        log("\nFAIL:")
        for f in failures:
            log(f"  - {f}")
        return 1
    log("\nOK: modularization 6.4 (слайс 8, SettingsModal -> settings/) E2E verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
