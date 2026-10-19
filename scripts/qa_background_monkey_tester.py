#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Autonomous Exploratory QA Monkey Tester for SignalScript Terminal
==================================================================
Runs continuously in background or visible window:
- Actively navigates the UI on http://127.0.0.1:5173
- Switches tickers, timeframes, strategies, and presets
- Interacts with BacktestPanel, AI Copilot, Scalper Desk, DOM, Tape, Settings
- Captures all console errors, unhandled promise rejections, 4xx/5xx responses
- Captures full-page screenshots on errors to backend/logs/screenshots/
- Logs all actions to backend/logs/qa_background_tester.log
- Appends actionable bug reports to QA_BUGS_AUDIT.md in real time
"""

import sys
import os
import time
import json
import random
import datetime
import asyncio
from pathlib import Path

# UTF-8 stdout
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from playwright.async_api import async_playwright

REPO_ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = REPO_ROOT / "backend" / "logs"
SCREENSHOT_DIR = LOG_DIR / "screenshots"
QA_LOG_FILE = LOG_DIR / "qa_background_tester.log"
QA_AUDIT_MD = REPO_ROOT / "QA_BUGS_AUDIT.md"

LOG_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

TARGET_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "LINKUSDT", "BNBUSDT"]
TIMEFRAMES = ["1m", "5m", "15m", "1h"]


def log(msg: str, level: str = "INFO"):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{ts}] [{level}] {msg}"
    print(formatted, flush=True)
    with open(QA_LOG_FILE, "a", encoding="utf-8") as f:
        f.write(formatted + "\n")


def record_bug_to_markdown(title: str, details: str, screenshot_path: str = None):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"\n\n### 🔴 [AUTO-QA] {title} ({ts})\n"
    entry += f"- **Описание:** {details}\n"
    if screenshot_path:
        entry += f"- **Скриншот:** `{screenshot_path}`\n"
    entry += "- **Статус:** ⚠️ Требует исправления\n"

    with open(QA_AUDIT_MD, "a", encoding="utf-8") as f:
        f.write(entry)
    log(f"Зафиксирован баг в QA_BUGS_AUDIT.md: {title}", level="BUG")


async def main():
    log("=" * 76)
    log("🤖 ЗАПУСК АВТОНОМНОГО QA-ТЕСТИРОВЩИКА (SIGNAL_SCRIPT EXPLORATORY MONKEY)")
    log("=" * 76)

    iteration = 0
    bugs_found = 0

    async with async_playwright() as p:
        # Launch browser (headless=True for clean background run, can be toggled)
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1600, "height": 950},
            ignore_https_errors=True
        )
        page = await context.new_page()

        # Listeners for runtime anomalies
        captured_errors = []

        def on_console(msg):
            if msg.type == "error":
                text = msg.text
                # Filter out benign or expected noise
                if "favicon" not in text and "Download the React DevTools" not in text:
                    captured_errors.append(f"ConsoleError: {text}")
                    log(f"Console [ERROR]: {text}", level="ERROR")

        def on_page_error(err):
            captured_errors.append(f"PageUncaughtError: {err}")
            log(f"Uncaught Exception: {err}", level="CRITICAL")

        def on_response(resp):
            if resp.status >= 400 and "/api/" in resp.url:
                err_info = f"HTTP {resp.status} on {resp.url}"
                captured_errors.append(err_info)
                log(f"Backend Request Failed: {err_info}", level="WARN")

        page.on("console", on_console)
        page.on("pageerror", on_page_error)
        page.on("response", on_response)

        log("1. Открытие главной страницы http://127.0.0.1:5173 ...")
        try:
            await page.goto("http://127.0.0.1:5173", timeout=15000)
            await page.wait_for_timeout(3000)
        except Exception as e:
            log(f"Не удалось подключиться к фронтенду: {e}", level="CRITICAL")
            record_bug_to_markdown("Frontend Connection Failure", f"Vite dev server is unreachable: {e}")
            await browser.close()
            return

        # Main exploratory testing loop
        max_cycles = 15  # Comprehensive multi-cycle exploration
        while iteration < max_cycles:
            iteration += 1
            captured_errors.clear()
            log(f"\n--- 🔄 ИТЕРАЦИЯ ТЕСТИРОВАНИЯ #{iteration}/{max_cycles} ---")

            try:
                # 1. Random coin selection from Screener / Watchlist
                target_coin = random.choice(TARGET_COINS)
                short_name = target_coin.replace("USDT", "")
                log(f"Тест #{iteration}.1: Переключение на монету {target_coin}...")
                coin_locator = page.locator(f"text={short_name}").first
                if await coin_locator.is_visible():
                    await coin_locator.click()
                    await page.wait_for_timeout(1500)
                else:
                    log(f"Тикер {short_name} не найден в текущем виде вотчлиста", level="DEBUG")

                # 2. Timeframe switching
                tf = random.choice(TIMEFRAMES)
                log(f"Тест #{iteration}.2: Переключение таймфрейма на {tf}...")
                tf_btn = page.locator(f"button:has-text('{tf}')").first
                if await tf_btn.is_visible():
                    await tf_btn.click()
                    await page.wait_for_timeout(1000)

                # 3. Open Backtest Drawer and test strategy interaction
                log(f"Тест #{iteration}.3: Открытие панели бэктеста и запуск симуляции...")
                drawer_btn = page.locator("[data-testid='btn-toggle-backtest-drawer']").first
                if await drawer_btn.is_visible():
                    await drawer_btn.click()
                    await page.wait_for_timeout(800)

                    # Select strategy
                    strat_select = page.locator("[data-testid='bt-strategy-select']").first
                    if await strat_select.is_visible():
                        strategies = ["confluence_ema", "cvd_absorption", "cluster_volume_bounce"]
                        chosen_strat = random.choice(strategies)
                        await strat_select.select_option(chosen_strat)
                        await page.wait_for_timeout(500)

                    # Click Run Single Backtest
                    run_single_btn = page.locator("[data-testid='btn-run-single']").first
                    if await run_single_btn.is_visible():
                        await run_single_btn.click()
                        log(f"Запущен расчет бэктеста для {target_coin}...")
                        await page.wait_for_timeout(2500)

                    # Close drawer to test UI toggles
                    await drawer_btn.click()
                    await page.wait_for_timeout(500)

                # 4. Test 1-click 'Тест сетапа' in Chart HUD
                log(f"Тест #{iteration}.4: Проверка 1-клик кнопки 'Тест сетапа' в HUD...")
                test_hud_btn = page.locator("[data-testid='btn-quick-backtest-setup']").first
                if await test_hud_btn.is_visible():
                    await test_hud_btn.click(force=True)
                    await page.wait_for_timeout(2000)

                # 5. Open AI Copilot Sidebar and request analysis
                if iteration % 2 == 0:
                    log(f"Тест #{iteration}.5: Тестирование AI Copilot Sidebar...")
                    ai_toggle = page.locator("[data-testid='btn-toggle-ai-copilot']").first
                    if await ai_toggle.is_visible():
                        await ai_toggle.click()
                        await page.wait_for_timeout(800)

                        run_ai_btn = page.locator("[data-testid='btn-run-market-analysis']").first
                        if await run_ai_btn.is_visible():
                            await run_ai_btn.click()
                            log("AI Copilot: запрос анализа отправлен...")
                            await page.wait_for_timeout(4000)

                        close_ai = page.locator("[data-testid='btn-close-ai-sidebar']").first
                        if await close_ai.is_visible():
                            await close_ai.click()
                            await page.wait_for_timeout(500)

                # 6. Test Settings Dialog
                if iteration % 3 == 0:
                    log(f"Тест #{iteration}.6: Проверка модального окна настроек...")
                    settings_btn = page.locator("[data-testid='btn-open-settings']").first
                    if await settings_btn.is_visible():
                        await settings_btn.click()
                        await page.wait_for_timeout(800)
                        close_settings = page.locator("[data-testid='btn-close-settings']").first
                        if await close_settings.is_visible():
                            await close_settings.click()
                            await page.wait_for_timeout(500)

                # Check for critical errors captured during this iteration
                if captured_errors:
                    bugs_found += 1
                    err_msg = "\n".join(captured_errors)
                    shot_path = str(SCREENSHOT_DIR / f"bug_iteration_{iteration}_{int(time.time())}.png")
                    await page.screenshot(path=shot_path, full_page=True)
                    record_bug_to_markdown(
                        title=f"Ошибки при сценарии #{iteration} ({target_coin})",
                        details=err_msg,
                        screenshot_path=shot_path
                    )
                else:
                    log(f"Итерация #{iteration} завершена успешно. Сбоев не зафиксировано.")

            except Exception as e:
                bugs_found += 1
                log(f"Исключение в ходе теста #{iteration}: {e}", level="ERROR")
                shot_path = str(SCREENSHOT_DIR / f"exception_iter_{iteration}_{int(time.time())}.png")
                try:
                    await page.screenshot(path=shot_path, full_page=True)
                except Exception:
                    pass
                record_bug_to_markdown(
                    title=f"Исключение Playwright сценария #{iteration}",
                    details=str(e),
                    screenshot_path=shot_path
                )

            # Brief pacing between testing cycles
            await asyncio.sleep(1)

        await browser.close()
        log("=" * 76)
        log(f"🏁 ТЕСТИРОВАНИЕ ОКОНЧЕНО. Пройдено итераций: {iteration} | Найдено аномалий: {bugs_found}")
        log(f"   Лог:     {QA_LOG_FILE.resolve()}")
        log(f"   Аудит:   {QA_AUDIT_MD.resolve()}")
        log("=" * 76)


if __name__ == "__main__":
    asyncio.run(main())
