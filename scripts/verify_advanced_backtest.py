import asyncio
import json
import math
import sys
import time
import urllib.request
from playwright.async_api import async_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

SCREENSHOT_MC_PATH = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5\advanced_backtest_monte_carlo.png"
SCREENSHOT_OPT_PATH = r"C:\Users\danil\.gemini\antigravity\brain\ed4e7b46-732d-4623-be60-6c1e12127aa5\advanced_backtest_genetic_opt.png"


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def main():
    print("=" * 76)
    print("🧪 ЗАПУСК ПРОВЕРКИ КВАНТ-БЭКТЕСТЕРА (FEES, SLIPPAGE, GENETIC, MONTE CARLO)")
    print("=" * 76)

    # 1. Wait for backend readiness
    for _ in range(15):
        try:
            with urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=3) as r:
                if r.status == 200:
                    break
        except Exception:
            await asyncio.sleep(0.5)

    # ----------------------------------------------------------------------
    # ТАКТ 1 & 3: API-проверка реализма исполнения (Fees, Slippage, Multi-TP) и Монте-Карло
    # ----------------------------------------------------------------------
    print("1️⃣ Проверка бэктеста с комиссиями (Maker 0.02%, Taker 0.05%), скольжением (2 тика) и Multi-TP...")
    bt_res = post_json(
        "http://127.0.0.1:8000/api/backtest/run",
        {
            "symbol": "BTCUSDT",
            "timeframe": "5m",
            "days": 14,
            "strategy_type": "delta_absorption",
            "params": {
                "stop_loss_pct": 0.6,
                "take_profit_pct": 1.8,
                "min_density_usd": 100000.0,
                "volume_multiplier": 1.0,
                "leverage": 3.0,
                "maker_fee_pct": 0.02,
                "taker_fee_pct": 0.05,
                "slippage_ticks": 2,
                "use_multi_tp": True,
            },
        },
    )

    summary = bt_res["summary"]
    mc = bt_res["monte_carlo"]
    gross_pnl_usd = summary["gross_pnl_usd"]
    net_pnl_usd = summary["net_pnl_usd"]
    fees_usd = summary["total_fees_usd"]
    slip_usd = summary["total_slippage_usd"]
    exch_cost = summary["total_exchange_cost_usd"]
    rec_factor = summary["recovery_factor"]

    print(f"   • Сделок: {summary['total_trades']} | WinRate: {summary['win_rate_pct']}% | PF: {summary['profit_factor']}")
    print(f"   • PnL ДО комиссий (Gross): ${gross_pnl_usd:,.2f} ({summary['gross_pnl_pct']:+.2f}%)")
    print(f"   • Уплачено бирже ($): ${exch_cost:,.2f} (Комиссии Maker/Taker: ${fees_usd:,.2f}, Скольжение стопов: ${slip_usd:,.2f})")
    print(f"   • Чистый PnL с учётом комиссий (Net): ${net_pnl_usd:,.2f} ({summary['total_pnl_pct']:+.2f}%) | Recovery Factor: {rec_factor}")

    assert summary["total_trades"] > 0, "Должна быть хотя бы 1 сделка"
    assert fees_usd > 0, "Комиссии биржи должны быть > 0"
    assert gross_pnl_usd > net_pnl_usd, "Чистый PnL должен учитывать вычет комиссий и скольжения"
    assert mc is not None and mc["simulations_count"] == 500, "Должно выполняться 500 симуляций Монте-Карло"
    assert len(mc["fan_chart"]) >= 2, "Веер Монте-Карло (fan_chart) должен содержать точки эквити"
    print(
        f"   • Монте-Карло (500 прогонов): P(DD > 10%) = {mc['prob_drawdown_gt_10_pct']}%, "
        f"Worst-Case DD = -{mc['worst_case_dd_pct']}%, Медианный PnL = {mc['median_pnl_pct']:+.2f}%"
    )
    print(f"   • Вердикт устойчивости: {mc['badge_text']} (Score: {mc['robustness_score']}/100)")

    # ----------------------------------------------------------------------
    # Проверка защиты от деления на ноль (0 сделок -> экстремальный порог стенки)
    # ----------------------------------------------------------------------
    print("2️⃣ Проверка защиты от деления на ноль при 0 сделок...")
    zero_res = post_json(
        "http://127.0.0.1:8000/api/backtest/run",
        {
            "symbol": "BTCUSDT",
            "timeframe": "15m",
            "days": 2,
            "strategy_type": "density_bounce",
            "params": {
                "stop_loss_pct": 0.5,
                "take_profit_pct": 1.5,
                "min_density_usd": 999999999999.0,
                "volume_multiplier": 19.0,
                "leverage": 1.0,
            },
        },
    )
    assert zero_res["summary"]["total_trades"] == 0
    assert zero_res["monte_carlo"]["verdict"] == "OVERFITTED"
    print("   ✅ Нулевая выборка обработана без ошибок и делений на ноль!")

    # ----------------------------------------------------------------------
    # ТАКТ 2: Проверка скорости и качества Генетического Оптимизатора (< 3 сек)
    # ----------------------------------------------------------------------
    print("3️⃣ Проверка генетического оптимизатора (POST /api/backtest/optimize)...")
    t0 = time.perf_counter()
    opt_res = post_json(
        "http://127.0.0.1:8000/api/backtest/optimize",
        {
            "symbol": "BTCUSDT",
            "timeframe": "5m",
            "days": 14,
            "strategy_type": "delta_absorption",
            "optimizer_mode": "genetic",
            "sl_min": 0.2,
            "sl_max": 1.2,
            "tp_min": 0.5,
            "tp_max": 3.0,
            "wall_min_usd": 300000.0,
            "wall_max_usd": 3000000.0,
            "leverage": 3.0,
            "maker_fee_pct": 0.02,
            "taker_fee_pct": 0.05,
            "slippage_ticks": 2,
            "use_multi_tp": True,
            "population_size": 14,
            "generations": 5,
        },
    )
    elapsed_sec = time.perf_counter() - t0
    before = opt_res["before_optimization"]
    after = opt_res["after_optimization"]
    iters = opt_res["meta"]["combinations_tested"]

    print(f"   • Выполнено итераций генетики: {iters} за {elapsed_sec:.2f} сек (движок: {opt_res['meta']['elapsed_ms']} мс)")
    print(
        f"   • До оптимизации:    PnL {before['total_pnl_pct']:+.2f}% | WR {before['win_rate_pct']}% | "
        f"Sharpe {before['sharpe_ratio']} | Max DD -{before['max_drawdown_pct']}%"
    )
    print(
        f"   • После оптимизации: PnL {after['total_pnl_pct']:+.2f}% | WR {after['win_rate_pct']}% | "
        f"Sharpe {after['sharpe_ratio']} | Max DD -{after['max_drawdown_pct']}% "
        f"(SL {after['stop_loss_pct']}%, TP {after['take_profit_pct']}%, Wall ${int(after['min_density_usd']//1000)}k)"
    )
    assert elapsed_sec < 3.5, f"Оптимизация должна выполняться быстрее 3.5 сек, заняло {elapsed_sec:.2f}с"
    assert len(opt_res["top_setups"]) > 0, "Должен возвращаться топ сетапов"
    print("   ✅ Генетическая оптимизация успешно нашла оптимальный пул параметров!")

    # ----------------------------------------------------------------------
    # ТАКТ 4: Браузерная проверка UI BacktestPanel.jsx (Playwright)
    # ----------------------------------------------------------------------
    print("4️⃣ Браузерная проверка интерфейса BacktestPanel.jsx и рендера кривой Монте-Карло...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1920, "height": 1080})
        page = await context.new_page()

        await page.goto("http://127.0.0.1:5173/?symbol=BTCUSDT&tf=15m", wait_until="domcontentloaded")
        await asyncio.sleep(2.0)

        # Open Backtest drawer (Hotkey 'B')
        await page.keyboard.press("KeyB")
        await page.wait_for_selector('[data-testid="backtest-panel"]', timeout=10000)

        # Switch to Optimizer tab & run Genetic Optimizer
        await page.click('[data-testid="bt-mode-optimizer"]')
        await asyncio.sleep(0.2)
        await page.click('[data-testid="btn-run-genetic"]')

        # Wait for results & Before/After cards
        await page.wait_for_selector('[data-testid="card-before-opt"]', timeout=15000)
        await page.wait_for_selector('[data-testid="card-after-opt"]', timeout=15000)
        await asyncio.sleep(0.4)

        await page.screenshot(path=SCREENSHOT_OPT_PATH, full_page=False)
        print(f"   📸 Скриншот вкладки Генетического Оптимизатора (До/После): {SCREENSHOT_OPT_PATH}")

        # Switch to Equity & Monte Carlo Fan Cloud tab
        await page.click('[data-testid="tab-equity-mc"]')
        await page.wait_for_selector('[data-testid="monte-carlo-svg"]', timeout=10000)
        await page.wait_for_selector('[data-testid="monte-carlo-report"]', timeout=10000)
        await asyncio.sleep(0.4)

        verdict_text = await page.inner_text('[data-testid="mc-verdict-badge"]')
        fees_card_text = await page.inner_text('[data-testid="metric-fees-paid"]')
        print(f"   • Бейдж Монте-Карло в UI: {verdict_text}")
        print(f"   • Карточка комиссий биржи в UI: {fees_card_text.replace(chr(10), ' | ')}")

        await page.screenshot(path=SCREENSHOT_MC_PATH, full_page=False)
        print(f"   📸 Скриншот кривой Equity с облаком вееров Монте-Карло: {SCREENSHOT_MC_PATH}")

        await browser.close()

    print("=" * 76)
    print("🎉 ВСЕ ПРОВЕРКИ КВАНТ-ДВИЖКА БЭКТЕСТА И МОНТЕ-КАРЛО ПРОЙДЕНЫ УСПЕШНО!")
    print("=" * 76)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"❌ ОШИБКА ВЕРИФИКАЦИИ: {exc}", file=sys.stderr)
        sys.exit(1)
