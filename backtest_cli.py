"""
Backtest & Strategy Optimization CLI for g-backrest
Usage:
    python backtest_cli.py --symbol BTC/USDT --timeframe 15m --days 30
    python backtest_cli.py --symbol ETH/USDT --timeframe 5m --htf 1h --days 14 --optimize
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

from engine.data_loader import DataLoader
from engine.indicators import add_all_indicators
from engine.backtester import Backtester
from engine.optimizer import StrategyOptimizer
from strategies.mtf_pullback import MTFPullbackStrategy

def main():
    parser = argparse.ArgumentParser(description="g-backrest Backtest & Optimizer")
    parser.add_argument("--symbol", "-s", type=str, default="BTC/USDT", help="Trading pair")
    parser.add_argument("--timeframe", "-t", type=str, default="15m", help="Base LTF timeframe (e.g. 5m, 15m)")
    parser.add_argument("--htf", type=str, default="1h", help="Higher timeframe (e.g. 1h, 4h)")
    parser.add_argument("--days", "-d", type=int, default=30, help="Days of history to backtest")
    parser.add_argument("--capital", type=float, default=10000.0, help="Initial capital in USD")
    parser.add_argument("--optimize", "-opt", action="store_true", help="Run parameter grid optimization")
    parser.add_argument("--exchange", "-e", type=str, default="bybit", help="Exchange (bybit, binance, okx)")
    parser.add_argument("--csv", type=str, default=None, help="Path to local CryptoDataDownload CSV file")
    
    args = parser.parse_args()
    
    print("=" * 70)
    print(f"🚀 g-backrest | Запуск бэктеста: {args.symbol} ({args.timeframe} + HTF: {args.htf})")
    print(f"📅 Период: последние {args.days} дней | Биржа: {args.exchange.upper()}")
    print("=" * 70)
    
    loader = DataLoader(exchange_id=args.exchange)
    
    # 1. Load data
    if args.csv:
        print(f"📂 Загрузка данных из CSV: {args.csv}")
        ltf_df = DataLoader.load_cryptodatadownload_csv(args.csv)
    else:
        print(f"⏳ Загрузка свечей {args.timeframe} с биржи...")
        ltf_df = loader.fetch_historical_ohlcv(args.symbol, timeframe=args.timeframe, days=args.days)
        
    ltf_df = add_all_indicators(ltf_df)
    
    # 2. HTF confirmation
    if args.htf and not args.csv:
        print(f"⏳ Загрузка старшего ТФ ({args.htf})...")
        htf_df = loader.fetch_historical_ohlcv(args.symbol, timeframe=args.htf, days=args.days + 10)
        htf_df = add_all_indicators(htf_df)
        df = DataLoader.align_multi_timeframe(ltf_df, htf_df, prefix="htf_")
    else:
        df = ltf_df

    print(f"✅ Данные готовы: {len(df)} свечей с {df.index[0]} по {df.index[-1]}")
    print("-" * 70)

    backtester = Backtester(initial_capital=args.capital)

    if args.optimize:
        print("🔍 Запуск оптимизации параметров сетки (Grid Search)...")
        optimizer = StrategyOptimizer(backtester=backtester)
        param_grid = {
            'tp_value': [1.5, 2.0, 2.5, 3.0],
            'sl_value': [1.0, 1.2, 1.5],
            'rsi_long_max': [32, 36, 40],
            'rsi_short_min': [60, 64, 68]
        }
        top_results = optimizer.optimize(df, MTFPullbackStrategy, param_grid, top_n=5)
        
        table_data = []
        for rank, r in enumerate(top_results, 1):
            p = r['params']
            table_data.append([
                rank,
                f"TP:{p['tp_value']}x | SL:{p['sl_value']}x | RSI:{p['rsi_long_max']}/{p['rsi_short_min']}",
                r['total_trades'],
                f"{r['win_rate_pct']}%",
                f"{r['profit_factor']}",
                f"{r['net_profit_pct']:+.2f}%",
                f"{r['max_drawdown_pct']:.2f}%",
                f"{r['risk_reward']}"
            ])
            
        headers = ["#", "Параметры", "Сделок", "Винрейт", "Профит-фактор", "Доходность", "Макс. Просадка", "R:R факт"]
        print("\n🏆 ТОП-5 НАИБОЛЕЕ ЭФФЕКТИВНЫХ КОНФИГУРАЦИЙ:")
        print(tabulate(table_data, headers=headers, tablefmt="fancy_grid"))
        
    else:
        # Single strategy run
        strategy = MTFPullbackStrategy()
        stats = backtester.run(df, strategy)
        
        print("📊 РЕЗУЛЬТАТЫ СТРАТЕГИИ MTF PULLBACK:")
        print(f"• Всего сделок:       {stats['total_trades']} (Прибыльных: {stats['wins']}, Убыточных: {stats['losses']})")
        print(f"• Винрейт (Win Rate): {stats['win_rate_pct']}%")
        print(f"• Профит-фактор:      {stats['profit_factor']}")
        print(f"• Чистая прибыль:     {stats['net_profit_pct']:+.2f}% (${stats['net_profit_usd']:+,.2f})")
        print(f"• Макс. просадка:     {stats['max_drawdown_pct']:.2f}%")
        print(f"• Средняя сделка:     {stats['avg_trade_pct']:+.2f}% (Win: +{stats['avg_win_pct']}%, Loss: {stats['avg_loss_pct']}%)")
        print(f"• Реализованный R:R:  1 : {stats['risk_reward_ratio']}")
        print(f"• Серии побед/пораж.: {stats['max_win_streak']} подряд / {stats['max_loss_streak']} подряд")
        
        if stats['trades']:
            print("-" * 70)
            print("📝 ПОСЛЕДНИЕ 5 СДЕЛОК:")
            last_trades = stats['trades'][-5:]
            trade_rows = []
            for t in last_trades:
                trade_rows.append([
                    t['entry_time'].strftime('%m-%d %H:%M'),
                    t['exit_time'].strftime('%m-%d %H:%M'),
                    t['direction'],
                    f"{t['entry_price']:.2f}",
                    f"{t['exit_price']:.2f}",
                    f"{t['net_pnl_pct']:+.2f}%",
                    t['exit_reason']
                ])
            headers = ["Вход", "Выход", "Тип", "Цена входа", "Цена выхода", "PnL %", "Причина выхода"]
            print(tabulate(trade_rows, headers=headers, tablefmt="presto"))

    print("=" * 70)

if __name__ == "__main__":
    main()
