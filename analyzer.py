"""
Market Data & Technical Analysis Tool for Antigravity & Tiger Trade Traders
Fetches real-time candles, calculates indicators, generates dark-mode charts, and provides structured analytics.
"""

import os
import sys
import argparse
from datetime import datetime
import io

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import ccxt
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Headless backend
import matplotlib.pyplot as plt
import mplfinance as mpf
import ta

CHARTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "charts")
os.makedirs(CHARTS_DIR, exist_ok=True)

def get_exchange_instance(exchange_id="bybit", market_type="swap"):
    """
    Initializes a CCXT exchange instance with swap (perpetual futures) or spot defaults.
    No API keys needed for public market data!
    """
    exchange_class = getattr(ccxt, exchange_id.lower(), None)
    if not exchange_class:
        raise ValueError(f"Биржа '{exchange_id}' не поддерживается ccxt.")
    
    options = {}
    if market_type == "swap":
        options['defaultType'] = 'swap'
    elif market_type == "spot":
        options['defaultType'] = 'spot'
        
    exchange = exchange_class({
        'enableRateLimit': True,
        'options': options
    })
    return exchange

def format_symbol(symbol, exchange_id="bybit", market_type="swap"):
    """
    Normalizes symbols: e.g. BTCUSDT -> BTC/USDT:USDT for Bybit swap, or BTC/USDT for spot
    """
    sym = symbol.upper().replace("-", "/").replace("_", "/")
    if "/" not in sym:
        # e.g. BTCUSDT
        if sym.endswith("USDT"):
            base = sym[:-4]
            sym = f"{base}/USDT"
        elif sym.endswith("USDC"):
            base = sym[:-4]
            sym = f"{base}/USDC"
        elif sym.endswith("USD"):
            base = sym[:-3]
            sym = f"{base}/USD"
            
    if market_type == "swap" and ":" not in sym:
        # ccxt unified symbol for linear swap: e.g. BTC/USDT:USDT
        quote = sym.split("/")[-1]
        sym = f"{sym}:{quote}"
        
    return sym

def fetch_market_data(exchange, symbol, timeframe="15m", limit=120):
    """
    Fetches OHLCV candles, ticker, and orderbook.
    """
    try:
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    except Exception as e:
        # Fallback if unified linear swap formatting differs
        alt_sym = symbol.split(":")[0] if ":" in symbol else symbol
        ohlcv = exchange.fetch_ohlcv(alt_sym, timeframe=timeframe, limit=limit)
        symbol = alt_sym

    df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
    df.set_index('datetime', inplace=True)
    
    ticker = {}
    try:
        ticker = exchange.fetch_ticker(symbol)
    except Exception:
        pass
        
    orderbook = {}
    try:
        orderbook = exchange.fetch_order_book(symbol, limit=10)
    except Exception:
        pass

    return df, ticker, orderbook, symbol

def calculate_indicators(df):
    """
    Calculates technical indicators using the 'ta' library.
    """
    # Moving averages
    df['ema_9'] = ta.trend.EMAIndicator(close=df['close'], window=9).ema_indicator()
    df['ema_20'] = ta.trend.EMAIndicator(close=df['close'], window=20).ema_indicator()
    df['ema_50'] = ta.trend.EMAIndicator(close=df['close'], window=50).ema_indicator()
    df['ema_200'] = ta.trend.EMAIndicator(close=df['close'], window=200).ema_indicator()
    
    # RSI
    df['rsi'] = ta.momentum.RSIIndicator(close=df['close'], window=14).rsi()
    
    # MACD
    macd = ta.trend.MACD(close=df['close'], window_slow=26, window_fast=12, window_sign=9)
    df['macd'] = macd.macd()
    df['macd_signal'] = macd.macd_signal()
    df['macd_diff'] = macd.macd_diff()
    
    # Bollinger Bands
    bb = ta.volatility.BollingerBands(close=df['close'], window=20, window_dev=2)
    df['bb_high'] = bb.bollinger_hband()
    df['bb_mid'] = bb.bollinger_mavg()
    df['bb_low'] = bb.bollinger_lband()
    
    # ATR (Volatility)
    df['atr'] = ta.volatility.AverageTrueRange(high=df['high'], low=df['low'], close=df['close'], window=14).average_true_range()
    
    # Volume MA
    df['vol_ma20'] = df['volume'].rolling(window=20).mean()
    
    return df

def find_key_levels(df, lookback=50):
    """
    Finds swing highs and swing lows for support & resistance.
    """
    sub_df = df.iloc[-lookback:]
    highs = sub_df['high'].nlargest(3).tolist()
    lows = sub_df['low'].nsmallest(3).tolist()
    return sorted(list(set(highs))), sorted(list(set(lows)))

def render_chart(df, symbol, timeframe, exchange_id, filename=None):
    """
    Renders a Tiger Trade / TradingView dark style chart with Candles, EMAs, Volume, RSI, MACD.
    """
    if filename is None:
        safe_sym = symbol.replace("/", "_").replace(":", "_")
        filename = os.path.join(CHARTS_DIR, f"{exchange_id}_{safe_sym}_{timeframe}.png")
        
    plot_df = df.iloc[-80:].copy()
    
    # Tiger Trade / TV dark theme styling
    mc = mpf.make_marketcolors(
        up='#089981', down='#f23645',
        edge={'up': '#089981', 'down': '#f23645'},
        wick={'up': '#089981', 'down': '#f23645'},
        volume={'up': '#089981', 'down': '#f23645'}
    )
    s = mpf.make_mpf_style(
        base_mpf_style='nightclouds',
        marketcolors=mc,
        facecolor='#131722',
        edgecolor='#1e222d',
        figcolor='#131722',
        gridcolor='#2a2e39',
        gridstyle='--',
        y_on_right=True
    )
    
    # Additional plots
    plots = [
        mpf.make_addplot(plot_df['ema_20'], color='#2962ff', width=1.5, label='EMA 20'),
        mpf.make_addplot(plot_df['ema_50'], color='#ff9800', width=1.5, label='EMA 50'),
        mpf.make_addplot(plot_df['bb_high'], color='#787b86', width=1, linestyle=':'),
        mpf.make_addplot(plot_df['bb_low'], color='#787b86', width=1, linestyle=':'),
        # Panel 2: RSI
        mpf.make_addplot(plot_df['rsi'], panel=2, color='#ab47bc', width=1.5, ylabel='RSI (14)'),
        # Panel 3: MACD
        mpf.make_addplot(plot_df['macd'], panel=3, color='#2962ff', width=1.2, ylabel='MACD'),
        mpf.make_addplot(plot_df['macd_signal'], panel=3, color='#ff9800', width=1.2),
        mpf.make_addplot(plot_df['macd_diff'], panel=3, type='bar', color=np.where(plot_df['macd_diff'] >= 0, '#089981', '#f23645'), alpha=0.6)
    ]
    
    if 'ema_200' in plot_df and not plot_df['ema_200'].isna().all():
        plots.insert(2, mpf.make_addplot(plot_df['ema_200'], color='#e91e63', width=1.8, label='EMA 200'))

    fig, axes = mpf.plot(
        plot_df,
        type='candle',
        style=s,
        volume=True,
        volume_panel=1,
        addplot=plots,
        panel_ratios=(5, 1.5, 1.8, 1.8),
        figsize=(16, 11),
        returnfig=True,
        tight_layout=True
    )
    
    # Title on top price axis
    price_ax = axes[0]
    price_ax.set_title(
        f"{exchange_id.upper()}  |  {symbol}  |  TF: {timeframe}  |  {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}",
        fontsize=14, color='#e0e3eb', pad=15, fontweight='bold', loc='left'
    )
    
    # RSI overbought/oversold guide lines on panel 2
    rsi_ax = axes[4] # panel 2
    rsi_ax.axhline(70, color='#f23645', linestyle='--', alpha=0.5, linewidth=0.8)
    rsi_ax.axhline(30, color='#089981', linestyle='--', alpha=0.5, linewidth=0.8)
    rsi_ax.set_ylim(10, 90)
    
    fig.savefig(filename, dpi=120, facecolor='#131722')
    plt.close(fig)
    return filename

def analyze_market(symbol="BTC/USDT", timeframe="15m", exchange_id="bybit", market_type="swap", generate_chart=True):
    """
    Main function to analyze market and return structured summary + chart file.
    """
    norm_symbol = format_symbol(symbol, exchange_id, market_type)
    exchange = get_exchange_instance(exchange_id, market_type)
    
    df, ticker, orderbook, active_symbol = fetch_market_data(exchange, norm_symbol, timeframe=timeframe, limit=250)
    df = calculate_indicators(df)
    
    last = df.iloc[-1]
    prev = df.iloc[-2]
    
    # Orderbook analysis
    bid_vol = sum([b[1] for b in orderbook.get('bids', [])[:10]]) if orderbook else 0
    ask_vol = sum([a[1] for a in orderbook.get('asks', [])[:10]]) if orderbook else 0
    orderbook_imbalance = ((bid_vol - ask_vol) / (bid_vol + ask_vol) * 100) if (bid_vol + ask_vol) > 0 else 0
    
    # Support & Resistance
    res_levels, sup_levels = find_key_levels(df)
    
    # Chart rendering
    chart_path = None
    if generate_chart:
        chart_path = render_chart(df, active_symbol, timeframe, exchange_id)
        
    analysis_data = {
        'exchange': exchange_id.upper(),
        'symbol': active_symbol,
        'timeframe': timeframe,
        'current_price': last['close'],
        'open_price': last['open'],
        'high': last['high'],
        'low': last['low'],
        'change_candle_pct': ((last['close'] - last['open']) / last['open']) * 100,
        'ticker_24h_change': ticker.get('percentage'),
        'ticker_24h_high': ticker.get('high'),
        'ticker_24h_low': ticker.get('low'),
        'ticker_24h_volume': ticker.get('quoteVolume'),
        'rsi_14': round(last['rsi'], 2),
        'rsi_status': 'Перекуплен (>70)' if last['rsi'] > 70 else ('Перепродан (<30)' if last['rsi'] < 30 else 'Нейтральный'),
        'ema_20': round(last['ema_20'], 4),
        'ema_50': round(last['ema_50'], 4),
        'ema_200': round(last['ema_200'], 4) if not pd.isna(last['ema_200']) else None,
        'macd_value': round(last['macd'], 4),
        'macd_signal': round(last['macd_signal'], 4),
        'macd_histogram': round(last['macd_diff'], 4),
        'macd_cross': 'Бычье пересечение' if (last['macd'] > last['macd_signal'] and prev['macd'] <= prev['macd_signal']) else (
                      'Медвежье пересечение' if (last['macd'] < last['macd_signal'] and prev['macd'] >= prev['macd_signal']) else (
                      'Выше сигнальной (бычий)' if last['macd'] > last['macd_signal'] else 'Ниже сигнальной (медвежий)')),
        'bb_upper': round(last['bb_high'], 4),
        'bb_middle': round(last['bb_mid'], 4),
        'bb_lower': round(last['bb_low'], 4),
        'atr_14': round(last['atr'], 4),
        'vol_vs_ma20': round((last['volume'] / last['vol_ma20']), 2) if last['vol_ma20'] > 0 else 1.0,
        'orderbook_imbalance_pct': round(orderbook_imbalance, 2),
        'resistance_levels': [round(r, 4) for r in res_levels],
        'support_levels': [round(s, 4) for s in sup_levels],
        'chart_path': chart_path
    }
    
    return analysis_data

def print_summary(data):
    print("=" * 65)
    print(f"📊 {data['exchange']} | {data['symbol']} | ТФ: {data['timeframe']}")
    print("=" * 65)
    print(f"💰 Текущая цена:     {data['current_price']}")
    print(f"📈 Свеча Open/H/L:   O:{data['open_price']} | H:{data['high']} | L:{data['low']}")
    print(f"⚡ Изменение свечи:  {data['change_candle_pct']:.2f}%")
    if data['ticker_24h_change'] is not None:
        print(f"🌐 24ч Изменение:    {data['ticker_24h_change']:.2f}% | Max: {data['ticker_24h_high']} | Min: {data['ticker_24h_low']}")
    print("-" * 65)
    print("📐 ТЕХНИЧЕСКИЕ ИНДИКАТОРЫ:")
    print(f"• RSI (14):          {data['rsi_14']} -> {data['rsi_status']}")
    print(f"• EMA 20:            {data['ema_20']}")
    print(f"• EMA 50:            {data['ema_50']}")
    if data['ema_200']:
        print(f"• EMA 200:           {data['ema_200']}")
    print(f"• MACD:              {data['macd_value']} | Signal: {data['macd_signal']} | Hist: {data['macd_histogram']}")
    print(f"  Статус MACD:       {data['macd_cross']}")
    print(f"• Bollinger Bands:   [Low: {data['bb_lower']} | Mid: {data['bb_middle']} | High: {data['bb_upper']}]")
    print(f"• ATR (волатильность):{data['atr_14']}")
    print(f"• Объем к MA20:      x{data['vol_vs_ma20']} (относительно среднего)")
    print(f"• Дисбаланс стакана: {data['orderbook_imbalance_pct']:+.1f}% ({'покупатели' if data['orderbook_imbalance_pct'] > 0 else 'продавцы'})")
    print("-" * 65)
    print(f"🎯 Ближайшие уровни сопротивления: {data['resistance_levels']}")
    print(f"🛡️  Ближайшие уровни поддержки:     {data['support_levels']}")
    if data['chart_path']:
        print("-" * 65)
        print(f"🖼️  График сохранен: {data['chart_path']}")
    print("=" * 65)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Real-time market analyzer & chart generator")
    parser.add_argument("--symbol", "-s", type=str, default="BTC/USDT", help="Trading pair (e.g. BTC/USDT, ETH/USDT, SOL/USDT)")
    parser.add_argument("--timeframe", "-t", type=str, default="15m", help="Timeframe (1m, 5m, 15m, 1h, 4h, 1d)")
    parser.add_argument("--exchange", "-e", type=str, default="bybit", help="Exchange (bybit, binance, okx, bitget)")
    parser.add_argument("--type", "-m", type=str, default="swap", choices=["swap", "spot"], help="Market type (swap=futures, spot=spot)")
    parser.add_argument("--no-chart", action="store_true", help="Disable chart image generation")
    
    args = parser.parse_args()
    
    try:
        data = analyze_market(
            symbol=args.symbol,
            timeframe=args.timeframe,
            exchange_id=args.exchange,
            market_type=args.type,
            generate_chart=not args.no_chart
        )
        print_summary(data)
    except Exception as e:
        print(f"❌ Ошибка получения данных: {e}", file=sys.stderr)
        sys.exit(1)
