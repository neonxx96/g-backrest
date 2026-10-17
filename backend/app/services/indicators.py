"""
Technical Indicators Calculation Engine
Pure, fast calculation of EMA, RSI, Volume Spikes, CVD, and ATR.
"""

import numpy as np
import pandas as pd
from typing import Dict, Any, Optional

def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds EMA 20, RSI 14, Volume MA20, ATR 14, and CVD metrics to the dataframe.
    """
    if df.empty or len(df) < 5:
        return df

    df = df.copy()

    # 1. EMA 20
    df['ema_20'] = df['close'].ewm(span=20, adjust=False).mean()

    # 2. Volume MA 20 & Volume Ratio
    df['vol_ma20'] = df['volume'].rolling(window=20).mean()
    df['vol_ratio'] = df['volume'] / df['vol_ma20'].replace(0, np.nan)

    # 3. RSI 14
    delta = df['close'].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(com=13, adjust=False).mean()
    avg_loss = loss.ewm(com=13, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    df['rsi'] = 100 - (100 / (1 + rs))

    # 4. ATR 14 & Volatility %
    high_low = df['high'] - df['low']
    high_close = (df['high'] - df['close'].shift()).abs()
    low_close = (df['low'] - df['close'].shift()).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    df['atr'] = tr.rolling(window=14).mean()
    df['atr_pct'] = (df['atr'] / df['close']) * 100.0

    # 5. CVD (if not already calculated)
    if 'cvd' not in df.columns and 'delta' in df.columns:
        df['cvd'] = df['delta'].cumsum()

    return df

def check_ema20_cross(df: pd.DataFrame) -> Optional[str]:
    """
    Checks if the last completed candle crossed EMA 20.
    Returns: 'BULLISH' (crossed above), 'BEARISH' (crossed below), or None.
    """
    if len(df) < 2 or 'ema_20' not in df.columns:
        return None

    prev = df.iloc[-2]
    curr = df.iloc[-1]

    # Bullish cross: prev close <= prev ema AND curr close > curr ema
    if prev['close'] <= prev['ema_20'] and curr['close'] > curr['ema_20']:
        return 'BULLISH'
    # Bearish cross: prev close >= prev ema AND curr close < curr ema
    elif prev['close'] >= prev['ema_20'] and curr['close'] < curr['ema_20']:
        return 'BEARISH'

    return None

def check_volume_spike(df: pd.DataFrame, multiplier: float = 2.0) -> bool:
    """
    Returns True if current candle volume is >= multiplier * MA20 volume.
    """
    if len(df) < 1 or 'vol_ratio' not in df.columns:
        return False
    val = df.iloc[-1]['vol_ratio']
    return bool(not pd.isna(val) and val >= multiplier)

def check_rsi_condition(df: pd.DataFrame, rsi_min: float = 30.0, rsi_max: float = 70.0) -> Optional[str]:
    """
    Checks if RSI is in extreme zone (< rsi_min or > rsi_max).
    """
    if len(df) < 1 or 'rsi' not in df.columns:
        return None
    curr_rsi = df.iloc[-1]['rsi']
    if pd.isna(curr_rsi):
        return None
    if curr_rsi <= rsi_min:
        return 'OVERSOLD'
    elif curr_rsi >= rsi_max:
        return 'OVERBOUGHT'
    return None

def check_cvd_divergence(df: pd.DataFrame) -> Optional[str]:
    """
    Detects CVD divergence over the last 3 bars.
    """
    if len(df) < 3 or 'cvd' not in df.columns:
        return None
        
    p1, p2, p3 = df['close'].iloc[-3], df['close'].iloc[-2], df['close'].iloc[-1]
    c1, c2, c3 = df['cvd'].iloc[-3], df['cvd'].iloc[-2], df['cvd'].iloc[-1]

    # Bullish divergence: price down but CVD up
    if p3 < p1 and c3 > c1:
        return 'BULLISH'
    # Bearish divergence: price up but CVD down
    elif p3 > p1 and c3 < c1:
        return 'BEARISH'

    return None
