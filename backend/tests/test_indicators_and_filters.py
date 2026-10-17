"""
Unit Tests for Indicators, CVD, and Scanner Filters (Pytest)
"""

import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

from backend.app.services.indicators import (
    compute_indicators,
    check_ema20_cross,
    check_volume_spike,
    check_rsi_condition,
    check_cvd_divergence
)
from backend.app.services.scanner import MarketScanner

def create_sample_df(n=30, trend='up'):
    dates = pd.date_range("2026-01-01", periods=n, freq="15min")
    if trend == 'up':
        close = np.linspace(100, 150, n)
    elif trend == 'down':
        close = np.linspace(150, 100, n)
    else:
        close = np.ones(n) * 100

    high = close + 2.0
    low = close - 2.0
    open_p = close - 0.5
    volume = np.ones(n) * 1000.0
    delta = np.ones(n) * 200.0

    df = pd.DataFrame({
        'open': open_p,
        'high': high,
        'low': low,
        'close': close,
        'volume': volume,
        'delta': delta
    }, index=dates)
    return df

def test_compute_indicators():
    df = create_sample_df(30, 'up')
    res = compute_indicators(df)
    
    assert 'ema_20' in res.columns
    assert 'vol_ma20' in res.columns
    assert 'rsi' in res.columns
    assert 'atr' in res.columns
    assert 'cvd' in res.columns
    assert not res['ema_20'].isna().all()

def test_ema_cross_detection():
    df = create_sample_df(25, 'down')
    df = compute_indicators(df)
    
    # Force a bullish cross on last bar
    df.loc[df.index[-2], 'close'] = df.loc[df.index[-2], 'ema_20'] - 5.0
    df.loc[df.index[-1], 'close'] = df.loc[df.index[-1], 'ema_20'] + 5.0
    
    cross = check_ema20_cross(df)
    assert cross == 'BULLISH'

def test_volume_spike():
    df = create_sample_df(25, 'up')
    df = compute_indicators(df)
    
    # Set last bar volume to 3x average
    df.loc[df.index[-1], 'volume'] = df['vol_ma20'].iloc[-2] * 3.0
    df['vol_ratio'] = df['volume'] / df['vol_ma20']
    
    assert check_volume_spike(df, multiplier=2.0) is True
    assert check_volume_spike(df, multiplier=4.0) is False

def test_rsi_extremes():
    df = create_sample_df(30, 'up')
    df = compute_indicators(df)
    
    # Artificially set RSI
    df.loc[df.index[-1], 'rsi'] = 25.0
    assert check_rsi_condition(df, rsi_min=30, rsi_max=70) == 'OVERSOLD'
    
    df.loc[df.index[-1], 'rsi'] = 75.0
    assert check_rsi_condition(df, rsi_min=30, rsi_max=70) == 'OVERBOUGHT'
    
    df.loc[df.index[-1], 'rsi'] = 50.0
    assert check_rsi_condition(df, rsi_min=30, rsi_max=70) is None

def test_scanner_cooldown():
    scanner = MarketScanner()
    symbol = "BTCUSDT"
    cond = "EMA_CROSS"
    
    assert scanner.is_in_cooldown(symbol, cond, cooldown_minutes=30) is False
    scanner.update_cooldown(symbol, cond)
    assert scanner.is_in_cooldown(symbol, cond, cooldown_minutes=30) is True
