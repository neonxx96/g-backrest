"""
End-to-End Verification for Stages 1, 2, and 3:
- Stage 1: SQLite Decision Journal (signals, manual entries/exits, coin filter, CSV export)
- Stage 2: Consultative AI Second Opinion ("Спросить мнение по этой позиции" / "Мнение AI", honest fallback when OpenRouter is unconfigured, and linking trader's decision)
- Stage 3: Fast 1-click Strategy Parameter Presets (save & apply without backend restart)
"""

import asyncio
import urllib.request
import json
from playwright.async_api import async_playwright

ARTIFACT_DIR = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5"


async def main():
    print("=== Starting Verification of Stages 1, 2, and 3 ===")

    # 1. Verify Backend API directly first
    with urllib.request.urlopen("http://127.0.0.1:8000/api/journal/presets", timeout=10) as r:
        presets_data = json.loads(r.read().decode("utf-8"))
        assert presets_data["status"] == "ok", "Presets endpoint failed"
        assert len(presets_data["presets"]) >= 3, "Default presets not seeded"
        print(f"[API OK] Default strategy presets seeded: {[p['name'] for p in presets_data['presets']]}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1600, "height": 920})
        page = await context.new_page()

        page_errors = []
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        await page.goto("http://127.0.0.1:5173", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)

        # =====================================================================
        # STAGE 2: Consultative AI Second Opinion from Chart HUD
        # =====================================================================
        print("\n--- Testing Stage 2: Consultative AI Second Opinion ---")
        btn_opinion = page.get_by_test_id("btn-toolbar-second-opinion").first
        await btn_opinion.click()

        card = page.get_by_test_id("second-opinion-card").first
        await card.wait_for(state="visible", timeout=10000)
        await page.wait_for_timeout(500)

        verdict_text = await page.get_by_test_id("second-opinion-verdict").first.inner_text()
        reason_text = await page.get_by_test_id("second-opinion-reason").first.inner_text()
        print(f"[Stage 2] Verdict: {verdict_text} | Reason: {reason_text}")

        # Verify honest message if OpenRouter key is not configured
        assert verdict_text in ("ЗА", "ПРОТИВ", "НЕЙТРАЛЬНО", "AI НЕДОСТУПЕН"), f"Unexpected verdict: {verdict_text}"
        if verdict_text == "AI НЕДОСТУПЕН":
            assert "AI недоступен, принимай решение сам" in reason_text

        # Record trader's decision ("✅ Вошёл") right from the consultative card
        await page.get_by_test_id("btn-opinion-mark-entered").first.click()
        await page.wait_for_timeout(600)

        await page.screenshot(path=f"{ARTIFACT_DIR}\\stage2_second_opinion_verified.png")
        print("[Stage 2] Screenshot saved: stage2_second_opinion_verified.png")

        # Close Second Opinion card
        await page.get_by_test_id("btn-close-second-opinion").first.click()
        await page.wait_for_timeout(300)

        # =====================================================================
        # STAGE 1: SQLite Decision Journal Modal, Manual Entry, Filter & CSV
        # =====================================================================
        print("\n--- Testing Stage 1: Decision Journal Modal & CSV Export ---")
        await page.get_by_test_id("btn-open-decision-journal").click()
        modal = page.get_by_test_id("decision-journal-modal")
        await modal.wait_for(state="visible", timeout=5000)
        await page.wait_for_timeout(800)

        # Record a manual entry with note
        await page.get_by_test_id("input-journal-manual-note").fill("Тестовый вход от крупной плотности в стакане")
        await page.get_by_test_id("btn-journal-manual-long").click()
        await page.wait_for_timeout(800)

        # Verify rows are rendered in the journal table
        rows_count = await page.locator('[data-testid^="journal-row-"]').count()
        print(f"[Stage 1] Decision Journal rows rendered: {rows_count}")
        assert rows_count >= 2, "Expected at least 2 rows in Decision Journal (AI_OPINION + MANUAL_ENTRY)"

        await page.screenshot(path=f"{ARTIFACT_DIR}\\stage1_decision_journal_verified.png")
        print("[Stage 1] Screenshot saved: stage1_decision_journal_verified.png")

        # Verify CSV export endpoint content
        with urllib.request.urlopen("http://127.0.0.1:8000/api/journal/export-csv", timeout=10) as csv_resp:
            csv_text = csv_resp.read().decode("utf-8-sig")
            lines = [line for line in csv_text.splitlines() if line.strip()]
            print(f"[Stage 1] CSV Export verified: {len(lines)} lines, Header: {lines[0][:80]}...")
            assert "Решение трейдера" in lines[0]
            assert len(lines) >= 3

        # Close Journal Modal
        await page.get_by_test_id("btn-close-decision-journal").click()
        await page.wait_for_timeout(400)

        # =====================================================================
        # STAGE 3: Fast 1-Click Strategy Parameter Presets
        # =====================================================================
        print("\n--- Testing Stage 3: 1-Click Strategy Parameter Presets ---")
        await page.get_by_test_id("btn-toggle-backtest-drawer").click()
        presets_bar = page.get_by_test_id("strategy-presets-bar")
        await presets_bar.wait_for(state="visible", timeout=5000)
        await page.wait_for_timeout(500)

        # Apply preset #2 ("Поглощение дельты + CVD (Импульс)") in 1 click via select
        select_el = page.get_by_test_id("select-strategy-preset")
        options = await select_el.locator("option").all_inner_texts()
        print(f"[Stage 3] Available presets in dropdown: {options}")
        await select_el.select_option(index=1)
        await page.wait_for_timeout(500)

        # Check that backtestStore updated immediately without backend restart
        bt_store_params = await page.evaluate("() => window.__backtestStore?.getState()?.customParams")
        print(f"[Stage 3] Active backtestStore customParams after 1-click preset switch: {bt_store_params}")
        assert bt_store_params["stop_loss_pct"] == 0.7 and bt_store_params["take_profit_pct"] == 1.8

        # Save a new custom preset
        await page.get_by_test_id("btn-open-save-preset").click()
        await page.get_by_test_id("input-preset-name").fill("Утренний рабочий сетап BTC")
        await page.get_by_test_id("btn-confirm-save-preset").click()
        await page.wait_for_timeout(700)

        options_after = await page.get_by_test_id("select-strategy-preset").locator("option").all_inner_texts()
        print(f"[Stage 3] Presets after saving custom preset: {options_after}")
        assert "Утренний рабочий сетап BTC" in options_after

        await page.screenshot(path=f"{ARTIFACT_DIR}\\stage3_strategy_presets_verified.png")
        print("[Stage 3] Screenshot saved: stage3_strategy_presets_verified.png")

        assert len(page_errors) == 0, f"Unexpected page errors: {page_errors}"
        await browser.close()

    print("\n=== ALL STAGES (1, 2, 3) VERIFIED SUCCESSFULLY ===")


if __name__ == "__main__":
    asyncio.run(main())
