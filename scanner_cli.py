"""
Real-Time Confluence & Probability Scanner CLI for g-backrest
Usage:
    python scanner_cli.py
    python scanner_cli.py --symbols BTC/USDT,ETH/USDT,SOL/USDT --ltf 15m --htf 1h
"""

import sys
import io
import argparse
from tabulate import tabulate

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from engine.scanner import RealtimeScanner

DEFAULT_WATCHLIST = [
    "BTC/USDT",
    "ETH/USDT",
    "SOL/USDT",
    "DOGE/USDT",
    "XRP/USDT"
]

def main():
    parser = argparse.ArgumentParser(description="g-backrest Real-Time Scanner")
    parser.add_argument("--symbols", "-s", type=str, default=",".join(DEFAULT_WATCHLIST), help="Comma-separated trading pairs")
    parser.add_argument("--ltf", "-t", type=str, default="15m", help="Base trigger timeframe")
    parser.add_argument("--htf", type=str, default="1h", help="Higher timeframe trend confirmation")
    parser.add_argument("--exchange", "-e", type=str, default="bybit", help="Exchange (bybit, binance, okx)")
    
    args = parser.parse_args()
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()]
    
    print("=" * 80)
    print(f"📡 g-backrest | СКАНЕР СИГНАЛОВ И ВЕРОЯТНОСТЕЙ В РЕАЛЬНОМ ВРЕМЕНИ")
    print(f"🔍 Пар в мониторинге: {len(symbols)} | Базовый ТФ: {args.ltf} | Старший ТФ: {args.htf}")
    print(f"🏦 Биржа: {args.exchange.upper()}")
    print("=" * 80)
    
    scanner = RealtimeScanner(exchange_id=args.exchange)
    results = scanner.scan_watchlist(symbols, ltf=args.ltf, htf=args.htf)
    
    table_rows = []
    signals_found = 0
    
    for r in results:
        if 'error' in r:
            table_rows.append([r['symbol'], "ОШИБКА", "-", "-", "-", "-", "-", r['error']])
            continue
            
        signal_badge = "⚪ Ждем"
        if r['has_signal']:
            signals_found += 1
            if r['signal_dir'] == 'LONG':
                signal_badge = f"🟢 LONG ({r['confidence_pct']}%)"
            else:
                signal_badge = f"🔴 SHORT ({r['confidence_pct']}%)"
                
        tp_str = str(r['tp_price']) if r['tp_price'] else "-"
        sl_str = str(r['sl_price']) if r['sl_price'] else "-"
        
        table_rows.append([
            r['symbol'],
            signal_badge,
            r['current_price'],
            f"RSI: {r['rsi']}",
            f"Vol: x{r['vol_ratio']}",
            tp_str,
            sl_str,
            r['bar_status'] or "Мониторинг"
        ])

    headers = ["Инструмент", "Сигнал / Вероятность", "Цена", "Индикаторы", "Объем", "Take Profit", "Stop Loss", "Статус"]
    print(tabulate(table_rows, headers=headers, tablefmt="fancy_grid"))
    
    print("-" * 80)
    print(f"ℹ️  Обнаружено активных сигналов: {signals_found} из {len(symbols)}")
    print("=" * 80)

if __name__ == "__main__":
    main()
