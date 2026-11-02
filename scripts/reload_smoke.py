# -*- coding: utf-8 -*-
"""Быстрый reload-smoke: раскладка/пары/статистика переживают перезагрузку страницы."""
import json
import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:7100/"
FETCH_STATUS = (
    "fetch('/api/overnight-pilot/status', {signal: AbortSignal.timeout(30000)})"
    ".then(r => r.json())"
)


def snapshot(page, tag):
    # Активируем вкладку демо-торговли: dockview не рендерит неактивные вкладки.
    tab_locator = page.locator(".dv-tab")
    for index, text in enumerate(tab_locator.all_inner_texts()):
        if text.strip().startswith("Демо-торговля"):
            tab_locator.nth(index).click()
            break
    # Внутри виджета включаем под-таб «По парам» (таблица пар).
    inner = page.locator('[data-testid="tab-paper-pairs"]')
    if inner.count() > 0:
        inner.first.click()
    page.wait_for_timeout(4000)
    tabs = sorted(t.strip() for t in page.locator(".dv-tab").all_inner_texts())
    status = page.evaluate(FETCH_STATUS)
    rows = page.locator('[data-testid="paper-pairs-table"] tbody tr').count()
    out = {
        "tabs": tabs,
        "sessions": len(status["sessions"]),
        "pair_rows": rows,
        "closed_trades": status["aggregate"]["paper"]["closed_trades"],
        "equity": status["aggregate"]["paper"]["equity"],
    }
    print(tag, json.dumps(out, ensure_ascii=False), flush=True)
    return out


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    page.set_default_timeout(25000)
    print("goto #1...", flush=True)
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(25000)
    before = snapshot(page, "BEFORE")
    print("reload...", flush=True)
    page.reload(wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(25000)
    after = snapshot(page, "AFTER ")
    browser.close()

ok = (
    before["tabs"] == after["tabs"]
    and before["sessions"] == after["sessions"] == 20
    and before["pair_rows"] == after["pair_rows"] >= 20
    and after["closed_trades"] >= before["closed_trades"]
)
print("RELOAD SMOKE:", "PASS" if ok else "FAIL", flush=True)
sys.exit(0 if ok else 1)
