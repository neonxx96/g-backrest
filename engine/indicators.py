"""
Technical Indicators Engine for g-backrest
Calculates indicators vectorially with zero lookahead bias.
"""

import pandas as pd
import numpy as np
import ta

def add_all_indicators(df: pd.DataFrame, config: dict = None) -> pd.DataFrame:
    """
    Appends full indicator suite to the dataframe based on configuration.
    """
    if df.empty or len(df) < 5:
        return df

    cfg = config or {}
    
    # 1. Moving Averages
    df['ema_9'] = ta.trend.EMAIndicator(close=df['close'], window=cfg.get('ema_fast', 9)).ema_indicator()
    df['ema_20'] = ta.trend.EMAIndicator(close=df['close'], window=cfg.get('ema_mid', 20)).ema_indicator()
    df['ema_50'] = ta.trend.EMAIndicator(close=df['close'], window=cfg.get('ema_slow', 50)).ema_indicator()
    df['ema_200'] = ta.trend.EMAIndicator(close=df['close'], window=cfg.get('ema_trend', 200)).ema_indicator()
    
    # 2. RSI
    rsi_window = cfg.get('rsi_window', 14)
    df['rsi'] = ta.momentum.RSIIndicator(close=df['close'], window=rsi_window).rsi()
    
    # 3. MACD
    macd = ta.trend.MACD(
        close=df['close'],
        window_slow=cfg.get('macd_slow', 26),
        window_fast=cfg.get('macd_fast', 12),
        window_sign=cfg.get('macd_sign', 9)
    )
    df['macd'] = macd.macd()
    df['macd_signal'] = macd.macd_signal()
    df['macd_diff'] = macd.macd_diff()
    
    # 4. Bollinger Bands
    bb = ta.volatility.BollingerBands(
        close=df['close'],
        window=cfg.get('bb_window', 20),
        window_dev=cfg.get('bb_dev', 2)
    )
    df['bb_high'] = bb.bollinger_hband()
    df['bb_mid'] = bb.bollinger_mavg()
    df['bb_low'] = bb.bollinger_lband()
    df['bb_width'] = (df['bb_high'] - df['bb_low']) / df['bb_mid']
    
    # 5. ATR (Average True Range)
    atr_window = cfg.get('atr_window', 14)
    df['atr'] = ta.volatility.AverageTrueRange(
        high=df['high'], low=df['low'], close=df['close'], window=atr_window
    ).average_true_range()
    
    # 6. Volume Moving Average & Volume Spike
    vol_window = cfg.get('vol_window', 20)
    df['vol_ma'] = df['volume'].rolling(window=vol_window).mean()
    df['vol_ratio'] = df['volume'] / df['vol_ma'].replace(0, np.nan)
    
    # 7. VWAP (Intraday cumulative)
    typical_price = (df['high'] + df['low'] + df['close']) / 3.0
    tp_vol = typical_price * df['volume']
    
    # Group by date for session VWAP
    dates = df.index.date
    df['session_id'] = dates
    df['cum_tp_vol'] = tp_vol.groupby(df['session_id']).cumsum()
    df['cum_vol'] = df['volume'].groupby(df['session_id']).cumsum()
    df['vwap'] = df['cum_tp_vol'] / df['cum_vol'].replace(0, np.nan)
    df.drop(columns=['session_id', 'cum_tp_vol', 'cum_vol'], inplace=True)
    
    # 8. Local Swings (Support & Resistance)
    lookback = cfg.get('swing_lookback', 10)
    df['swing_high'] = df['high'].rolling(window=lookback, center=False).max()
    df['swing_low'] = df['low'].rolling(window=lookback, center=False).min()
    
    return df
