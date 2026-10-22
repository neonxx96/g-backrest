#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Multi-Coin & Multi-Strategy Quantitative Matrix Sweep
=====================================================
Executes an exhaustive quant stress test across multiple cryptocurrencies and strategies:
- Analyzes PnL, Fee Drag, Slippage, MFE/MAE excursions, Profit Bleed, and Holding Time.
- Diagnoses specific weaknesses per asset class and regime.
- Produces actionable recommendations and exports full markdown + JSON reports.
"""

import sys
import json
import time
import datetime
from pathlib import Path
from typing import Dict, List, Any

import pandas as pd
import numpy as np

# Set UTF-8 encoding
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.deep_backtest_analyzer import load_parquet_history, run_quant_backtest, analyze_deep_trades

COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "LINKUSDT", "BNBUSDT", "ADAUSDT"]
STRATEGIES = [
    {"id": "confluence_ema", "name": "Confluence EMA (CVD+RSI+ATR)"},
    {"id": "delta_absorption", "name": "CVD Delta Absorption"},
    {"id": "density_bounce", "name": "Density Wall Bounce"},
]


def run_sweep(days: int = 7) -> Dict[str, Any]:
    print("=" * 80)
    print(f"🚀 ЗАПУСК МУЛЬТИ-МОНЕТНОГО КВАНТОВОГО СКРИНИНГА СТРАТЕГИЙ (Период: {days} дней)")
    print("=" * 80)

    results = []
    weaknesses_log = []

    for coin in COINS:
        print(f"\n📂 Загрузка данных для {coin}...")
        try:
            df, actual_days = load_parquet_history(coin, "5m", days=days)
        except Exception as e:
            print(f"   ⚠️ Ошибка загрузки {coin}: {e}")
            continue

        for strat in STRATEGIES:
            strat_id = strat["id"]
            strat_name = strat["name"]
            print(f"   ⚙️ Тестирование: {coin} | {strat_name}...", end="", flush=True)

            try:
                bt_res = run_quant_backtest(
                    df=df,
                    strategy=strat_id,
                    initial_capital=10000.0,
                    maker_fee_pct=0.02,
                    taker_fee_pct=0.05,
                    slippage_ticks=2,
                    stop_loss_pct=0.8,
                    take_profit_pct=1.6,
                    leverage=1.0,
                )

                if "error" in bt_res or not bt_res.get("trades"):
                    print(" ❌ Нет сделок или ошибка")
                    continue

                analyzed_trades, summary = analyze_deep_trades(
                    raw_trades=bt_res["trades"],
                    df=df,
                    initial_capital=10000.0,
                    stop_loss_pct=0.8,
                    actual_days=actual_days,
                )

                # Diagnosing specific quant weaknesses
                weaknesses = []
                if summary["fee_drag_pct"] > 80.0:
                    weaknesses.append(f"Критическое трение комиссий: {summary['fee_drag_pct']}% от валового PnL уходит бирже")
                if summary["edge_ratio"] < 1.0:
                    weaknesses.append(f"Отрицательный Edge Ratio ({summary['edge_ratio']}x): MAE превосходит MFE")
                if summary["mfe_bleed_rate_pct"] > 20.0:
                    weaknesses.append(f"Высокий MFE Bleed ({summary['mfe_bleed_rate_pct']}%): позиции с прибылью >= 0.5R закрываются в стоп/безубыток")
                if summary["time_ratio_win_to_loss"] < 0.5:
                    weaknesses.append(f"Пересиживание лоссов: убыточные позиции удерживаются в {1/max(0.01, summary['time_ratio_win_to_loss']):.1f}x дольше прибыльных")
                if summary["max_consec_losses"] >= 5:
                    weaknesses.append(f"Опасная серия просадки: {summary['max_consec_losses']} убытков подряд")

                entry = {
                    "coin": coin,
                    "strategy_id": strat_id,
                    "strategy_name": strat_name,
                    "summary": summary,
                    "weaknesses": weaknesses,
                    "trades_count": len(analyzed_trades),
                }
                results.append(entry)

                status_emoji = "🟢" if summary["total_net_pnl_usd"] > 0 else "🔴"
                print(f" {status_emoji} Сделок: {summary['total_trades']} | WR: {summary['win_rate_pct']}% | Net: ${summary['total_net_pnl_usd']:+,.2f} | Drag: -${summary['total_exchange_cost_usd']:,.2f}")

            except Exception as e:
                print(f" ❌ Ошибка выполнения: {e}")

    # Generate Markdown Report
    report_md_path = REPO_ROOT / "docs" / "STRATEGY_WEAKNESSES_AND_UPGRADES.md"
    report_json_path = REPO_ROOT / "backend" / "logs" / "quant_matrix_report.json"
    report_md_path.parent.mkdir(parents=True, exist_ok=True)
    report_json_path.parent.mkdir(parents=True, exist_ok=True)

    with open(report_json_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    md_content = generate_markdown_summary(results, days)
    with open(report_md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    print("\n" + "=" * 80)
    print(f"✅ СКРИНИНГ ЗАВЕРШЁН. Обработано комбинаций: {len(results)}")
    print(f"   📄 Отчет сохранен в: {report_md_path.resolve()}")
    print(f"   💾 JSON-матрица:     {report_json_path.resolve()}")
    print("=" * 80)
    return {"results": results, "report_path": str(report_md_path)}


def generate_markdown_summary(results: List[Dict[str, Any]], days: int) -> str:
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"# 📊 СВОДНЫЙ ОТЧЁТ КВАНТОВОГО СКРИНИНГА СТРАТЕГИЙ И МОНЕТ",
        f"\n**Дата генерации:** {now_str} | **Период бэктеста:** {days} дней (5m свечи)\n",
        f"Данный отчет сформирован скриптом `scripts/run_quant_matrix_sweep.py` на основе реальной биржевой истории (Parquet) с учетом реалистичного исполнения (Maker 0.02%, Taker 0.05%, Stop Slippage 2 тика, Multi-TP scaling).\n",
        f"## 🏆 Таблица сводных результатов по всем парам и стратегиям\n",
        "| Монета | Стратегия | Сделок | WinRate | Gross PnL | Net PnL | Fee Drag ($) | MFE/MAE Edge | MFE Bleed % | Sharpe (Ann) |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]

    for r in results:
        s = r["summary"]
        gross_color = f"+${s['total_gross_pnl_usd']:,.2f}" if s['total_gross_pnl_usd'] >= 0 else f"-${abs(s['total_gross_pnl_usd']):,.2f}"
        net_color = f"+${s['total_net_pnl_usd']:,.2f}" if s['total_net_pnl_usd'] >= 0 else f"-${abs(s['total_net_pnl_usd']):,.2f}"
        edge_mark = f"{s['edge_ratio']}x" if s['edge_ratio'] >= 1.0 else f"⚠️ {s['edge_ratio']}x"
        bleed_mark = f"🔥 {s['mfe_bleed_rate_pct']}%" if s['mfe_bleed_rate_pct'] > 15 else f"{s['mfe_bleed_rate_pct']}%"

        lines.append(
            f"| **{r['coin']}** | {r['strategy_name']} | {s['total_trades']} | {s['win_rate_pct']}% | {gross_color} | **{net_color}** | -${s['total_exchange_cost_usd']:,.2f} | {edge_mark} | {bleed_mark} | {s['annualized_sharpe']} |"
        )

    lines.append("\n## 🔍 Детальный реестр слабостей и уязвимостей по монетам\n")
    for r in results:
        s = r["summary"]
        weaknesses = r["weaknesses"]
        lines.append(f"### 📍 {r['coin']} — {r['strategy_name']}")
        lines.append(f"- **Win Rate:** {s['win_rate_pct']}% ({s['win_count']} побед / {s['loss_count']} убытков)")
        lines.append(f"- **Gross vs Net PnL:** ${s['total_gross_pnl_usd']:,.2f} ➔ ${s['total_net_pnl_usd']:,.2f} (Потери на комиссиях/слипе: -${s['total_exchange_cost_usd']:,.2f})")
        lines.append(f"- **MFE vs MAE:** Peak +{s['avg_mfe_pct']}% (+{s['avg_mfe_r']}R) vs Adverse -{s['avg_mae_pct']}% (-{s['avg_mae_r']}R) | Edge Ratio: {s['edge_ratio']}x")
        lines.append(f"- **MFE Bleed:** {s['mfe_bleeds_count']} сделок ({s['mfe_bleed_rate_pct']}%) выходили в плюс $\ge 0.5R$, но откатились в безубыток или лосс")
        lines.append(f"- **Время удержания:** Прибыльные сделки ~{s['avg_duration_wins_min']} мин | Убыточные сделки ~{s['avg_duration_losses_min']} мин (Holding Ratio: {s['time_ratio_win_to_loss']}x)")
        lines.append(f"- **Макс. серия убытков:** {s['max_consec_losses']} сделок подряд")
        
        if weaknesses:
            lines.append("- **Обнаруженные слабые места стратегии:**")
            for w in weaknesses:
                lines.append(f"  - ⚠️ {w}")
        else:
            lines.append("- **Статус:** Параметры сбалансированы, критических аномалий не выявлено.")
        lines.append("")

    lines.append("\n## 🛠️ План квантовых правок для устранения слабостей (Actionable Roadmap)\n")
    lines.append("""
1. **Авто-безубыток при достижении +0.5R (Устранение MFE Bleed):**
   - Во всех стратегиях переносить Stop-Loss в точку входа (+0.05% на комиссию), как только позиция коснулась 0.5R.
2. **Адаптивный порог плотности (Turnover Normalization):**
   - На высоковолатильных монетах (SOL, DOGE) фиксированный порог стенки в долларах работает некорректно. Заменить его на `dynamic_wall = median(Volume * Close, 50) * 2.5`.
3. **Фильтр сессий и затухания импульса (Time-Stop):**
   - Закрывать позицию по рынку, если за 45 минут сделка не дала хотя бы +0.3R движения.
4. **Контроль комиссионного трения:**
   - Перейти на лимитные выходы (Take-Profit Maker 0.02%) вместо рыночных закрытий по трейлингу (Taker 0.05%).
""")

    return "\n".join(lines)


if __name__ == "__main__":
    run_sweep(days=7)
