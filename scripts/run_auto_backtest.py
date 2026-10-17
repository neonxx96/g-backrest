"""
Automated Multi-Coin Backtester for SignalScript
Executes strategy 'confluence_ema' across top assets: BTCUSDT, ETHUSDT, SOLUSDT (15m, 14 days)
with full Confluence Suite (ATR Dynamic SL, CVD delta absorption, OI accumulation, RSI).
Formats summary cards in console and applies the most stable setup to terminal config.
"""

import sys
import os
import json
import urllib.request
import urllib.error

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

API_URL = "http://127.0.0.1:8000/api/backtest/run"
SETTINGS_URL = "http://127.0.0.1:8000/api/settings"

TARGET_COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
TIMEFRAME = "15m"
DAYS = 14
STRATEGY = "confluence_ema"

def run_backtest_for_symbol(symbol: str) -> dict:
    payload = {
        "symbol": symbol,
        "timeframe": TIMEFRAME,
        "days": DAYS,
        "strategy_type": STRATEGY,
        "initial_capital": 10000.0,
        "params": {
            "stop_loss_pct": 0.8,
            "take_profit_pct": 1.6,
            "volume_multiplier": 1.0,
            "leverage": 2.0,
            "use_atr_filter": True,
            "use_atr_sl": True,
            "atr_multiplier": 1.5,
            "use_cvd_filter": True,
            "use_oi_filter": True,
            "use_rsi_filter": True,
        }
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Error backtesting {symbol}: {e}")
        return {}

def apply_best_settings(best_sym: str, best_stats: dict):
    try:
        req_get = urllib.request.Request(f"{SETTINGS_URL}?user_id=0")
        with urllib.request.urlopen(req_get, timeout=10) as r:
            settings = json.loads(r.read().decode("utf-8"))

        # Update active trading strategy profile
        settings["auto_backtest_best"] = {
            "symbol": best_sym,
            "strategy": STRATEGY,
            "timeframe": TIMEFRAME,
            "win_rate_pct": best_stats.get("win_rate_pct", 0),
            "total_pnl_pct": best_stats.get("total_pnl_pct", 0),
            "profit_factor": best_stats.get("profit_factor", 0),
            "applied_at": "auto"
        }

        req_post = urllib.request.Request(
            SETTINGS_URL,
            data=json.dumps(settings).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req_post, timeout=10) as r:
            pass
        return True
    except Exception as e:
        print(f"Warning: could not persist best settings: {e}")
        return False

def print_card(title: str, lines: list):
    width = 68
    print("┌" + "─" * (width - 2) + "┐")
    print(f"│ {title:<{width - 4}} │")
    print("├" + "─" * (width - 2) + "┤")
    for line in lines:
        print(f"│ {line:<{width - 4}} │")
    print("└" + "─" * (width - 2) + "┘")

def main():
    print("\n" + "=" * 68)
    print("  🚀 SIGNAL SCRIPT: AUTOMATED MULTI-COIN BACKTEST ENGINE")
    print(f"  Стратегия: {STRATEGY} | ТФ: {TIMEFRAME} | Период: {DAYS} дн | Фильтры: Confluence ON")
    print("=" * 68 + "\n")

    results = {}
    for sym in TARGET_COINS:
        print(f"⏳ Тестирование {sym} ({DAYS}д, {TIMEFRAME})...", end=" ", flush=True)
        res = run_backtest_for_symbol(sym)
        if res and "summary" in res:
            s = res["summary"]
            results[sym] = s
            print(f"Готово! (PnL: {s['total_pnl_pct']:+5.2f}%, WR: {s['win_rate_pct']:4.1f}%, PF: {s['profit_factor']})")
        else:
            print("Ошибка / нет данных")

    print("\n" + "─" * 68)
    print(" 📊 СВОДНЫЙ ОТЧЁТ РЕЗУЛЬТАТОВ (MULTI-COIN CONFLUENCE BACKTEST)")
    print("─" * 68)
    print(f" {'МОНЕТА':<10} | {'PnL %':<10} | {'WIN RATE':<10} | {'СДЕЛОК':<8} | {'PF':<8} | {'MAX DD':<8}")
    print("─" * 68)

    best_sym = None
    best_score = -1e9

    for sym, s in results.items():
        pf_display = "∞" if s["profit_factor"] >= 999 else f"{s['profit_factor']:.2f}"
        pnl_str = f"{s['total_pnl_pct']:+6.2f}%"
        wr_str = f"{s['win_rate_pct']:.1f}%"
        trades_str = f"{s['total_trades']} ({s['winning_trades']}W/{s['losing_trades']}L)"
        dd_str = f"-{s['max_drawdown_pct']:.2f}%"

        print(f" {sym:<10} | {pnl_str:<10} | {wr_str:<10} | {trades_str:<8} | {pf_display:<8} | {dd_str:<8}")

        # Stability score calculation (PnL * WinRate / MaxDD)
        dd = max(0.5, s["max_drawdown_pct"])
        score = (s["total_pnl_pct"] * (s["win_rate_pct"] + 10)) / dd
        if score > best_score:
            best_score = score
            best_sym = sym

    print("─" * 68)

    if best_sym and best_sym in results:
        best_stats = results[best_sym]
        applied = apply_best_settings(best_sym, best_stats)
        
        card_lines = [
            f"Рекомендованная монета:  {best_sym} ({TIMEFRAME})",
            f"Чистый PnL за 14 дней:    {best_stats['total_pnl_pct']:+6.2f}%",
            f"Процент побед (Win Rate): {best_stats['win_rate_pct']:.1f}% ({best_stats['winning_trades']}W / {best_stats['losing_trades']}L)",
            f"Фактор прибыли (PF):      {'∞' if best_stats['profit_factor'] >= 999 else best_stats['profit_factor']}",
            f"Макс. просадка (Drawdown):-{best_stats['max_drawdown_pct']:.2f}%",
            f"Статус конфигурации:      {'✅ Автоматически применено в терминал' if applied else 'Конфигурация проверена'}"
        ]
        print("\n")
        print_card("🏆 ТОП СТАБИЛЬНЫЙ СЕТАП СТРАТЕГИИ", card_lines)

    print("\n✅ Автоматический бэктест успешно завершён.\n")

if __name__ == "__main__":
    main()
