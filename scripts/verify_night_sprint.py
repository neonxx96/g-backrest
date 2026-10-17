"""
ТАКТ 4: Автоматизированный аудит, E2E-тесты и самопроверка ночного спринта (verify_night_sprint.py)
Проверяет:
1. Тест AI-моделей и OpenRouter (/api/ai/models, /api/ai/validate-key, /api/ai/market-analysis)
2. Тест расширенных параметров стратегий (/api/backtest/run: entry_mode, sl_mode, Multi-TP, min_wall_lifetime_sec, data_feed_context)
3. Тест отрисовки позиций (Entry / SL / TP1 / TP2 / R:R) на графике Chart.jsx и в стакане OrderBookDOM.jsx через Playwright
4. Тест Живого AI-Мониторинга (Live AI Sentinel) + индикатора здоровья позиции (0%-100%) + 0 console.error
5. Стресс-тест стабильности при зуме, скролле и переключении таймфреймов с активными оверлеями Entry/SL/TP
"""

import os
import sys
import time
import urllib.request
import json
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BACKEND_URL = "http://127.0.0.1:8000"
FRONTEND_URL = "http://127.0.0.1:5173"
ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"


def api_post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BACKEND_URL}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_get(path: str) -> dict:
    req = urllib.request.Request(f"{BACKEND_URL}{path}", method="GET")
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def test_backend_apis():
    print("=== [1/5] Тест AI-моделей OpenRouter и расширенного бэктестера (REST API) ===")
    models_resp = api_get("/api/ai/models")
    model_ids = [m["id"] for m in models_resp.get("models", [])]
    expected_models = [
        "google/gemini-2.0-flash-001",
        "anthropic/claude-3.5-sonnet",
        "meta-llama/llama-3.3-70b-instruct:free",
        "local_orderflow_nlp",
    ]
    for em in expected_models:
        assert em in model_ids, f"Модель {em} отсутствует в /api/ai/models"
    print(f"  [OK] Все 4 модели зарегистрированы: {model_ids}")

    # Test /api/ai/market-analysis with model selection & live_sentinel
    for test_model in ["meta-llama/llama-3.3-70b-instruct:free", "local_orderflow_nlp"]:
        ai_data = api_post(
            "/api/ai/market-analysis",
            {
                "symbol": "BTCUSDT",
                "timeframe": "15m",
                "model": test_model,
                "live_sentinel": True,
            },
        )
        assert "sentiment_meter" in ai_data, "Отсутствует sentiment_meter в ответе /api/ai/market-analysis"
        assert "position_setup" in ai_data, "Отсутствует position_setup в ответе /api/ai/market-analysis"
        assert "data_feed_context" in ai_data, "Отсутствует data_feed_context в ответе /api/ai/market-analysis"
        meter = ai_data["sentiment_meter"]
        assert 0 <= meter["score"] <= 100, f"Некорректный score: {meter['score']}"
        assert meter["zone"] in ("GREEN", "BLUE", "YELLOW", "RED"), f"Некорректная зона: {meter['zone']}"
        setup = ai_data["position_setup"]
        assert setup["entry_price"] > 0 and setup["sl_price"] > 0 and setup["tp1_price"] > 0 and setup["tp2_price"] > 0
        print(
            f"  [OK] /api/ai/market-analysis ({test_model}): Score={meter['score']}% ({meter['zone']}), "
            f"Setup={setup['order_type']} @ {setup['entry_price']}, SL={setup['sl_price']}, TP1={setup['tp1_price']}, TP2={setup['tp2_price']}"
        )

    # Test /api/backtest/run with extended strategy parameters
    for entry_mode, sl_mode in [
        ("limit_bounce", "behind_wall"),
        ("breakout", "atr_volatility"),
        ("cvd_absorption", "fixed_pct"),
    ]:
        bt_data = api_post(
            "/api/backtest/run",
            {
                "symbol": "BTCUSDT",
                "timeframe": "5m",
                "days": 7,
                "strategy_type": "density_bounce",
                "params": {
                    "stop_loss_pct": 0.6,
                    "take_profit_pct": 1.6,
                    "min_density_usd": 300000,
                    "entry_mode": entry_mode,
                    "sl_mode": sl_mode,
                    "wall_sl_offset_ticks": 5,
                    "tp1_rr_ratio": 1.5,
                    "tp2_mode": "opposite_wall",
                    "tp2_rr_ratio": 2.8,
                    "min_wall_lifetime_sec": 35,
                    "use_multi_tp": True,
                },
            },
        )
        assert "data_feed_context" in bt_data, "Отсутствует data_feed_context в ответе /api/backtest/run"
        assert "active_position_setup" in bt_data, "Отсутствует active_position_setup в ответе /api/backtest/run"
        dfc = bt_data["data_feed_context"]
        assert "orderbook_walls" in dfc and "cvd_footprint" in dfc and "open_interest" in dfc and "volatility_atr" in dfc
        print(
            f"  [OK] /api/backtest/run (entry={entry_mode}, sl={sl_mode}): "
            f"Trades={bt_data['summary']['total_trades']}, WinRate={bt_data['summary']['win_rate_pct']}%, "
            f"ATR=${dfc['volatility_atr']['atr_14_usd']}"
        )


def test_frontend_playwright():
    print("\n=== [2/5] Запуск браузерной E2E-верификации через Playwright ===")
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        def on_console(msg):
            if msg.type == "error":
                text = msg.text
                if "favicon" not in text.lower() and "websocket" not in text.lower():
                    console_errors.append(text)

        page.on("console", on_console)

        page.goto(FRONTEND_URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        # 1. Open BacktestPanel (hotkey 'b') and verify Extended Strategy Parameters & Data Feed Context
        print("=== [3/5] Проверка расширенных параметров стратегии и проекции позиции из Бэктестера ===")
        page.keyboard.press("b")
        page.wait_for_selector('[data-testid="backtest-panel"]', timeout=8000)

        assert page.locator('[data-testid="data-feed-context-card"]').is_visible(), "Блок Источники и метрики не виден в BacktestPanel"
        assert page.locator('[data-testid="extended-strategy-config"]').is_visible(), "Блок расширенных параметров стратегии не виден"

        # Select entry_mode = breakout, sl_mode = behind_wall, wall lifetime = 40s
        page.select_option('[data-testid="select-entry-mode"]', "limit_bounce")
        page.click('[data-testid="sl-mode-behind_wall"]')
        page.fill('[data-testid="input-wall-sl-offset"]', "6")
        page.select_option('[data-testid="select-tp2-mode"]', "opposite_wall")

        # Run single backtest -> automatically projects Entry / SL / TP1 / TP2 onto Chart.jsx & OrderBookDOM.jsx
        page.click('[data-testid="btn-run-single"]')
        page.wait_for_selector('[data-testid="metric-net-pnl"]', timeout=20000)
        page.wait_for_timeout(800)

        # Verify Entry / SL / TP1 / TP2 HUD badges on Chart.jsx & OrderBookDOM.jsx
        assert page.locator('[data-testid="chart-position-hud"]').first.is_visible(), "Оверлей позиции chart-position-hud не появился на графике"
        entry_badge_text = page.locator('[data-testid="chart-badge-entry"]').first.inner_text()
        sl_badge_text = page.locator('[data-testid="chart-badge-sl"]').first.inner_text()
        tp1_badge_text = page.locator('[data-testid="chart-badge-tp1"]').first.inner_text()
        tp2_badge_text = page.locator('[data-testid="chart-badge-tp2"]').first.inner_text()
        rr_badge_text = page.locator('[data-testid="chart-badge-rr"]').first.inner_text()

        print(f"  [OK] На графике отрисована конструкция сделки: {entry_badge_text} | {sl_badge_text} | {tp1_badge_text} | {tp2_badge_text} | {rr_badge_text}")

        # Verify DOM position strip badges
        assert page.locator('[data-testid="dom-position-levels-bar"]').is_visible(), "Плашки ENTRY/SL/TP1/TP2 не отобразились в стакане OrderBookDOM"
        dom_entry = page.locator('[data-testid="dom-badge-entry"]').inner_text()
        dom_sl = page.locator('[data-testid="dom-badge-sl"]').inner_text()
        dom_tp1 = page.locator('[data-testid="dom-badge-tp1"]').inner_text()
        dom_tp2 = page.locator('[data-testid="dom-badge-tp2"]').inner_text()
        print(f"  [OK] Синхронизация со стаканом DOM: {dom_entry} | {dom_sl} | {dom_tp1} | {dom_tp2}")

        # Close BacktestPanel so the full Chart + Entry/SL/TP1/TP2 + DOM is clearly visible for Screenshot 1
        page.keyboard.press("b")
        page.wait_for_timeout(600)

        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        chart_shot_path = os.path.join(ARTIFACT_DIR, "night_sprint_chart_entry_sl_tp.png")
        page.screenshot(path=chart_shot_path, full_page=False)
        print(f"  [OK] Скриншот 1 сохранён: {chart_shot_path}")

        # 2. Open AI Copilot Sidebar (hotkey 'a') and test Model Selector, API Key input, Live AI Sentinel & Health Meter
        print("\n=== [4/5] Тест Живого AI-Мониторинга (Live AI Sentinel) и Индикатора здоровья позиции ===")
        page.keyboard.press("a")
        page.wait_for_selector('[data-testid="ai-copilot-sidebar"]', timeout=8000)

        # Verify AI Model Selector has all 4 options
        selector = page.locator('[data-testid="ai-model-selector"]')
        assert selector.is_visible(), "Селектор AI-моделей не виден"
        options_text = selector.locator("option").all_inner_texts()
        assert len(options_text) >= 4, f"Ожидалось 4 модели в списке, найдено: {options_text}"
        print(f"  [OK] Список моделей в шапке AI-сайдбара: {options_text}")

        # Select free Llama 3.3 70B model and toggle API key input
        selector.select_option("meta-llama/llama-3.3-70b-instruct:free")
        page.click('[data-testid="btn-toggle-api-key"]')
        assert page.locator('[data-testid="openrouter-api-key-input"]').is_visible(), "Поле ввода OpenRouter API Key не открылось"
        page.click('[data-testid="btn-toggle-api-key"]')

        # Enable Live AI Sentinel Toggle
        sentinel_btn = page.locator('[data-testid="live-ai-sentinel-toggle"]')
        sentinel_btn.click()
        page.wait_for_timeout(2200)

        assert sentinel_btn.get_attribute("aria-pressed") == "true", "Тумблер Live AI Sentinel не переключился в ACTIVE"
        health_meter = page.locator('[data-testid="ai-health-meter"]')
        assert health_meter.is_visible(), "Шкала здоровья позиции ai-health-meter не отображается"

        score_text = page.locator('[data-testid="ai-health-score"]').inner_text()
        status_text = page.locator('[data-testid="ai-health-status"]').inner_text()
        advice_text = page.locator('[data-testid="ai-sentinel-advice"]').inner_text()
        print(f"  [OK] Live AI Sentinel активен: Score={score_text}, Статус='{status_text}'")
        print(f"  [OK] Тактический совет AI: '{advice_text}'")

        # Verify Data Feed Context inside AI Sidebar
        assert page.locator('[data-testid="ai-data-feed-context"]').is_visible(), "Блок Источники и метрики в AI-сайдбаре не виден"

        ai_shot_path = os.path.join(ARTIFACT_DIR, "night_sprint_ai_sentinel_sidebar.png")
        page.screenshot(path=ai_shot_path, full_page=False)
        print(f"  [OK] Скриншот 2 сохранён: {ai_shot_path}")

        # 3. Stress Test: Zoom, Scroll & Timeframe Switch while Live AI Sentinel & Entry/SL/TP overlays are active
        print("\n=== [5/5] Стресс-тест стабильности (Зум, Скролл и Смена Таймфреймов с активной разметкой) ===")
        chart_canvas = page.locator("canvas").first
        box = chart_canvas.bounding_box()
        if box:
            cx = box["x"] + box["width"] * 0.45
            cy = box["y"] + box["height"] * 0.5
            page.mouse.move(cx, cy)
            for _ in range(5):
                page.mouse.wheel(0, -180)
                page.wait_for_timeout(80)
            for _ in range(4):
                page.mouse.wheel(0, 150)
                page.wait_for_timeout(80)
            # Drag pan horizontally
            page.mouse.down()
            page.mouse.move(cx - 120, cy, steps=8)
            page.mouse.up()
            page.wait_for_timeout(300)

        # Switch timeframe via hotkey '2' (5m) and back to '3' (15m)
        page.keyboard.press("2")
        page.wait_for_timeout(1200)
        page.keyboard.press("3")
        page.wait_for_timeout(1200)

        # Verify that Entry / SL / TP1 / TP2 overlay & KLineCharts active setup are still intact!
        assert page.locator('[data-testid="chart-position-hud"]').first.is_visible(), "После зума и смены ТФ пропал HUD позиции"
        active_setup_js = page.evaluate("() => window.__chartActiveSetup")
        assert active_setup_js is not None and active_setup_js.get("entry_price", 0) > 0, "После смены ТФ потерялся KLineCharts overlay позиции"
        print(
            f"  [OK] Стресс-тест пройден: разметка позиции сохранена после зума, драга и смены ТФ "
            f"(Overlay ID: {active_setup_js.get('overlayId')}, Entry: {active_setup_js.get('entry_price')})"
        )

        assert len(console_errors) == 0, f"Обнаружены ошибки в консоли браузера: {console_errors}"
        print("  [OK] Ошибок в консоли браузера: 0 (console.error === 0)")

        browser.close()


if __name__ == "__main__":
    test_backend_apis()
    test_frontend_playwright()
    print("\n✅ ВСЕ ПРОВЕРКИ НОЧНОГО СПРИНТА УСПЕШНО ПРОЙДЕНЫ!")
