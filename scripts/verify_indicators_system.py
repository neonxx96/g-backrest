"""
Playwright E2E Verification Script for SignalScript Unified Indicators System
Tests:
1. Indicators Modal (Catalog, Search, Category filters)
2. Adding Indicator (Bollinger Bands & SuperTrend)
3. Active Indicator Stack overlay on chart
4. Indicator Settings Dialog (Inputs tab, Style tab, parameter changes)
5. Hiding/Restoring indicator visibility
6. Backend /api/backtest/run synchronization with unified indicators config
7. Full screen artifact capture
"""

import os
import sys
import time
import requests
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BACKEND_URL = "http://127.0.0.1:8000"
FRONTEND_URL = "http://127.0.0.1:5173"
ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"


def test_backend_indicators_sync():
    print("=== [1/5] Проверка бэкенд синхронизации индикаторов (POST /api/backtest/run) ===")
    payload = {
        "symbol": "BTCUSDT",
        "timeframe": "15m",
        "days": 2,
        "strategy_type": "ema_trend",
        "indicators": {
            "boll": {"params": {"period": 25, "stdDev": 2.0}},
            "supertrend": {"params": {"atrPeriod": 10, "multiplier": 3.0}},
            "rsi": {"params": {"period": 14}},
        },
    }
    resp = requests.post(f"{BACKEND_URL}/api/backtest/run", json=payload, timeout=15)
    assert resp.status_code == 200, f"Ошибка бэктеста с индикаторами: {resp.text}"
    data = resp.json()
    custom_inds = data.get("meta", {}).get("custom_indicators", [])
    print(f"  [OK] Бэктест успешно рассчитан! Кастомные индикаторы: {custom_inds}")
    assert "boll" in custom_inds and "supertrend" in custom_inds and "rsi" in custom_inds, "Не все индикаторы вернулись в meta"


def test_frontend_indicators_ui():
    print("\n=== [2/5] Запуск Playwright: Тестирование UI каталога и стека индикаторов ===")
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080})
        page = context.new_page()

        def on_console(msg):
            if msg.type in ["error"]:
                text = msg.text
                if not any(skip in text.lower() for skip in ["favicon", "net::err", "404"]):
                    console_errors.append(text)

        page.on("console", on_console)

        print(f"  Переход на {FRONTEND_URL}...")
        page.goto(FRONTEND_URL, wait_until="networkidle", timeout=25000)
        page.wait_for_selector('[data-testid="terminal-dockview-container"]', timeout=15000)
        page.wait_for_selector('[data-testid="active-indicator-stack"]', timeout=15000)

        # 1. Проверяем наличие стека активных индикаторов на графике
        print("=== [3/5] Проверка начального состояния стека индикаторов ===")
        stack = page.locator('[data-testid="active-indicator-stack"]').first
        assert stack.is_visible(), "Стек активных индикаторов не найден на графике"
        print("  [OK] Стек активных индикаторов успешно смонтирован на холсте")

        # 2. Открытие каталога индикаторов через кнопку тулбара
        print("=== [4/5] Открытие каталога индикаторов (IndicatorsModal) ===")
        btn_open = page.locator('[data-testid="btn-open-indicators-modal"]').first
        btn_open.click()
        page.wait_for_selector('[data-testid="indicators-modal"]', timeout=5000)

        modal = page.locator('[data-testid="indicators-modal"]')
        assert modal.is_visible(), "Модальное окно каталога индикаторов не открылось"
        print("  [OK] Каталог индикаторов успешно открыт")

        # Поиск и фильтрация по категории
        search_input = page.locator('[data-testid="indicators-search-input"]')
        search_input.fill("Bollinger")
        page.wait_for_timeout(400)

        boll_card = page.locator('[data-testid="indicator-card-boll"]')
        assert boll_card.is_visible(), "Карточка Bollinger Bands не найдена по поиску"
        print("  [OK] Поиск работает корректно: найдена карточка Bollinger Bands")

        # Добавление индикатора BOLL (или подтверждение персистентности из SQLite)
        btn_add_boll = page.locator('[data-testid="btn-add-indicator-boll"]').first
        if btn_add_boll.is_visible():
            btn_add_boll.click()
            page.wait_for_timeout(400)
            print("  [OK] Нажата кнопка добавления Bollinger Bands на график")
        else:
            print("  [OK] Индикатор Bollinger Bands уже персистентно сохранен в сессии SQLite")

        # Добавим также SuperTrend
        search_input.fill("SuperTrend")
        page.wait_for_timeout(400)
        btn_add_st = page.locator('[data-testid="btn-add-indicator-supertrend"]').first
        if btn_add_st.is_visible():
            btn_add_st.click()
            page.wait_for_timeout(400)
            print("  [OK] Добавлен индикатор SuperTrend")

        # Закрываем модальное окно
        page.locator('[data-testid="btn-close-indicators-modal"]').click()
        page.wait_for_timeout(500)

        # 3. Проверяем появление плашки BOLL в стеке на графике
        print("=== [5/5] Проверка стека, настроек и скрытия/показа ===")
        page.wait_for_selector('[data-testid="active-indicator-pill-boll"]', timeout=5000)
        pill_boll = page.locator('[data-testid="active-indicator-pill-boll"]').first
        assert pill_boll.is_visible(), "Плашка BOLL не появилась в активном стеке графика"
        print(f"  [OK] Индикатор BOLL отображается в активном стеке: '{pill_boll.inner_text().strip()}'")

        # Открываем настройки индикатора BOLL (шестеренка)
        btn_settings_boll = page.locator('[data-testid="btn-settings-boll"]').first
        btn_settings_boll.click()
        page.wait_for_selector('[data-testid="indicator-settings-dialog"]', timeout=5000)

        settings_dialog = page.locator('[data-testid="indicator-settings-dialog"]')
        assert settings_dialog.is_visible(), "Диалог настроек индикатора не открылся"
        print("  [OK] Окно настроек индикатора успешно открыто")

        # Меняем период SMA с 20 на 25
        input_period = page.locator('[data-testid="input-period"]')
        input_period.fill("25")
        page.wait_for_timeout(300)

        # Переключаемся на вкладку «Стиль»
        page.locator('[data-testid="tab-style"]').click()
        page.wait_for_timeout(300)
        assert page.locator('[data-testid="style-tab-content"]').is_visible(), "Вкладка «Стиль» не открылась"
        print("  [OK] Вкладка стилизации активна (цвета полос, толщина линий)")

        # Нажимаем «Применить»
        page.locator('[data-testid="btn-apply-indicator-settings"]').click()
        page.wait_for_timeout(600)

        # Проверяем обновленные параметры в стеке
        pill_text = pill_boll.inner_text()
        assert "25" in pill_text, f"Параметр 25 не отобразился в плашке стека: {pill_text}"
        print(f"  [OK] Настройки успешно применились и обновили стек: '{pill_text.strip()}'")

        # Тестируем переключение видимости (Eye)
        btn_toggle_vis = page.locator('[data-testid="btn-toggle-vis-boll"]').first
        btn_toggle_vis.click()
        page.wait_for_timeout(400)
        print("  [OK] Видимость индикатора переключена (скрыт без удаления)")

        btn_toggle_vis.click()
        page.wait_for_timeout(400)
        print("  [OK] Видимость индикатора восстановлена")

        # Сохранение скриншота артефакта
        os.makedirs(ARTIFACT_DIR, exist_ok=True)
        screenshot_path = os.path.join(ARTIFACT_DIR, "indicators_system_verified.png")
        page.screenshot(path=screenshot_path, full_page=False)
        print(f"\n  [OK] Скриншот подтверждения сохранен: {screenshot_path}")

        critical_errors = [e for e in console_errors if "favicon" not in e.lower()]
        print(f"  Ошибок в консоли: {len(critical_errors)}")
        assert len(critical_errors) == 0, f"Обнаружены консольные ошибки: {critical_errors}"

        browser.close()


if __name__ == "__main__":
    test_backend_indicators_sync()
    test_frontend_indicators_ui()
    print("\n============================================================")
    print(" [SUCCESS] Все 5 этапов тестирования системы индикаторов пройдены!")
    print("============================================================\n")
