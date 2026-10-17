import asyncio
import math
import sys
from playwright.async_api import async_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

SCREENSHOT_PATH = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5\scalper_trade_desk_verified.png"


async def main():
    print("=" * 72)
    print("🧪 ЗАПУСК ПРОВЕРКИ SCALPER TRADE DESK И ТРЕКЕРА СПУФИНГА DOM")
    print("=" * 72)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        print("1️⃣ Открытие терминала SignalScript (1920x1080)...")
        await page.goto("http://127.0.0.1:5173/?symbol=BTCUSDT&tf=15m", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="scalper-trade-desk"]', timeout=15000)
        await asyncio.sleep(2.5)

        # Ensure sidebar width is comfortable for full visibility
        await page.evaluate("""() => {
            const raw = localStorage.getItem('terminal_layout_v1');
            const cfg = raw ? JSON.parse(raw) : {};
            cfg.sidebarWidth = 560;
            cfg.domWidthPct = 64;
            cfg.showTradeDesk = true;
            cfg.showOrderBook = true;
            cfg.showTape = true;
            cfg.showSignals = true;
            localStorage.setItem('terminal_layout_v1', JSON.stringify(cfg));
        }""")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="scalper-trade-desk"]', timeout=15000)
        await asyncio.sleep(2.5)

        # ------------------------------------------------------------------
        # ТАКТ 1.1: Проверка пресетов объема и расчета позиции по риску на стоп
        # ------------------------------------------------------------------
        print("2️⃣ Проверка быстрых пресетов объема ($500, $1,000, $5,000, $10,000)...")
        for preset in [500, 1000, 5000, 10000]:
            await page.click(f'[data-testid="volume-preset-{preset}"]')
            await asyncio.sleep(0.1)
            desk_state = await page.evaluate("() => window.__scalperDesk")
            assert desk_state["sizingMode"] == "fixed_volume", "Режим должен быть fixed_volume"
            assert desk_state["effectiveVolumeUsd"] == preset, f"Ожидался объем {preset}, получен {desk_state['effectiveVolumeUsd']}"
        print("   ✅ Все 4 пресета объема ($500, $1,000, $5,000, $10,000) работают корректно!")

        print("3️⃣ Проверка режима «Фиксированный риск ($ на стоп)» и авто-расчета объема от стенки SL...")
        await page.click('[data-testid="mode-fixed-risk"]')
        await asyncio.sleep(0.15)
        await page.click('[data-testid="risk-preset-20"]')
        await asyncio.sleep(0.15)

        desk_state = await page.evaluate("() => window.__scalperDesk")
        cur_p = desk_state["currentPrice"]
        sl_p = desk_state["riskCalculation"]["slPrice"]
        dist_abs = desk_state["riskCalculation"]["distAbs"]
        calc_vol = desk_state["effectiveVolumeUsd"]
        expected_vol = round(20.0 / (dist_abs / cur_p), 2)

        print(f"   • Текущая цена: ${cur_p:,.2f} | Стенка SL: ${sl_p:,.2f} (дистанция: ${dist_abs:,.2f})")
        print(f"   • Риск на стоп: $20.00 -> Расчетный объем позиции: ${calc_vol:,.2f} (ожидалось: ${expected_vol:,.2f})")
        assert math.isclose(calc_vol, expected_vol, rel_tol=1e-2), (
            f"Ошибка расчета позиции по риску: {calc_vol} != {expected_vol}"
        )
        print("   ✅ Формула расчета объема позиции по риску до ближайшей стенки SL подтверждена!")

        # ------------------------------------------------------------------
        # ТАКТ 1.2: Проверка лимиток перед стенками, хоткеев Q/W/E и живого PnL
        # ------------------------------------------------------------------
        print("4️⃣ Проверка выставления лимиток перед стенкой ([Лимитка перед Wall BID/ASK]) и отмены [E]...")
        await page.click('[data-testid="btn-limit-wall-bid"]')
        await page.click('[data-testid="btn-limit-wall-ask"]')
        await asyncio.sleep(0.2)

        desk_state = await page.evaluate("() => window.__scalperDesk")
        assert len(desk_state["limitOrders"]) == 2, f"Ожидалось 2 лимитных ордера, получено {len(desk_state['limitOrders'])}"
        print(f"   • Выставлены 2 лимитные заявки перед стенками: {[o['side'] + ' @ $' + str(o['price']) for o in desk_state['limitOrders']]}")

        # Press 'e' hotkey to cancel all limits
        await page.keyboard.press("KeyE")
        await asyncio.sleep(0.2)
        desk_state = await page.evaluate("() => window.__scalperDesk")
        assert len(desk_state["limitOrders"]) == 0, "Клавиша E должна отменять все лимитные заявки"
        print("   ✅ Горячая клавиша [E] мгновенно отменила все лимитные заявки!")

        # Put one limit order back in front of BID wall so it's visible in DOM & Trade Desk
        await page.click('[data-testid="btn-limit-wall-bid"]')
        await asyncio.sleep(0.15)

        print("5️⃣ Открытие виртуальной позиции LONG и проверка живого пересчета PnL при изменении цены тика...")
        await page.click('[data-testid="btn-market-buy"]')
        await asyncio.sleep(0.2)

        desk_state = await page.evaluate("() => window.__scalperDesk")
        pos = desk_state["position"]
        assert pos is not None and pos["side"] == "LONG", "Позиция LONG должна быть открыта"
        entry_price = pos["entryPrice"]
        pos_qty = pos["qty"]

        # Simulate upward tick (+0.45% from entry price)
        new_tick_price = round(entry_price * 1.0045, 1)
        await page.evaluate(f"() => window.__scalperDesk.setSimulatedPrice({new_tick_price})")
        await asyncio.sleep(0.25)

        desk_state = await page.evaluate("() => window.__scalperDesk")
        live_pnl = desk_state["livePnl"]
        expected_pnl_usd = pos_qty * (new_tick_price - entry_price)
        expected_pnl_pct = ((new_tick_price - entry_price) / entry_price) * 100

        pos_bar_text = await page.inner_text('[data-testid="active-position-bar"]')
        print(f"   • Позиция: {pos['symbol']} | {pos['side']} | Вход: ${entry_price:,.1f} -> Тик: ${new_tick_price:,.1f}")
        print(f"   • Расчетный PnL: +${live_pnl['pnlUsd']:,.2f} (+{live_pnl['pnlPct']:.2f}%) | Ожидалось: +${expected_pnl_usd:,.2f}")
        print(f"   • Текст бара позиции: {pos_bar_text.replace(chr(10), ' ')}")

        assert live_pnl["pnlUsd"] > 0, "PnL должен быть положительным при росте цены в LONG"
        assert math.isclose(live_pnl["pnlUsd"], expected_pnl_usd, rel_tol=1e-2), "PnL ($) не совпадает с математическим расчетом"
        assert math.isclose(live_pnl["pnlPct"], expected_pnl_pct, rel_tol=1e-2), "PnL (%) не совпадает с математическим расчетом"
        print("   ✅ Открытие виртуальной позиции и пересчет PnL ($ и %) при изменении тика работают безупречно!")

        # ------------------------------------------------------------------
        # ТАКТ 2: Проверка таймеров жизни стенок ([>30s] / [<10s]) и детектора спуфинга [SPOOF REMOVED]
        # ------------------------------------------------------------------
        print("6️⃣ Проверка таймеров удержания стенок ([>30s] и [<10s]) и детектора спуфинга [SPOOF REMOVED] в DOM...")
        mature_count = await page.locator('[data-testid="wall-timer-mature"]').count()
        fresh_count = await page.locator('[data-testid="wall-timer-fresh"]').count()
        print(f"   • Найдено бейджей [>30s] (устойчивая плотность): {mature_count}")
        print(f"   • Найдено бейджей [<10s] (свежая заявка): {fresh_count}")
        assert mature_count >= 1, "В стакане должен отображаться минимум 1 янтарный бейдж [>30s]"
        assert fresh_count >= 1, "В стакане должен отображаться минимум 1 бейдж [<10s]"

        # Trigger a >$1M spoof wall that stays for 350ms (<5s) and disappears without market trades
        spoof_info = await page.evaluate("() => window.__domLadderState.simulateSpoofWall(null, 1750000, 350)")
        print(f"   • Симулирована спуф-стенка ${spoof_info['usd']:,.0f} на уровне ${spoof_info['price']} (<5 сек без сделок)...")
        await asyncio.sleep(0.55)

        spoof_badge_count = await page.locator('[data-testid="spoof-removed-badge"]').count()
        assert spoof_badge_count >= 1, "После снятия стенки >$1M (<5s) должна появиться красная плашка [SPOOF REMOVED]"
        spoof_badge_text = await page.locator('[data-testid="spoof-removed-badge"]').first.inner_text()
        print(f"   ✅ Зафиксирована красная плашка на уровне цены в DOM: {spoof_badge_text}")

        # Capture visual verification screenshot while [SPOOF REMOVED], [>30s], [<10s], and ScalperTradeDesk are active
        await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
        print(f"📸 Скриншот сохранен: {SCREENSHOT_PATH}")

        # Wait 3.2s to verify the [SPOOF REMOVED] badge automatically disappears after 3 seconds
        await asyncio.sleep(3.2)
        spoof_badge_after = await page.locator('[data-testid="spoof-removed-badge"]').count()
        assert spoof_badge_after == 0, "Плашка [SPOOF REMOVED] должна автоматически исчезать через 3 секунды"
        print("   ✅ Плашка [SPOOF REMOVED] автоматически исчезла ровно через 3 секунды!")

        await browser.close()

    print("=" * 72)
    print("🎉 ВСЕ ПРОВЕРКИ SCALPER TRADE DESK И DOM SPOOF TRACKER ПРОЙДЕНЫ УСПЕШНО!")
    print("=" * 72)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"❌ ОШИБКА ВЕРИФИКАЦИИ: {exc}", file=sys.stderr)
        sys.exit(1)
