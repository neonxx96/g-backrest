"""
Multi-Timeframe Pullback Strategy (MTF Trend + LTF Pullback & Confluence)
Ideal for crypto futures scalping and intraday trading in Tiger Trade.
"""

import pandas as pd
import numpy as np
from engine.strategy_base import BaseStrategy

class MTFPullbackStrategy(BaseStrategy):
    def __init__(self, params: dict = None):
        default_params = {
            'tp_mode': 'atr',
            'tp_value': 2.5,        # 2.5x ATR Take Profit
            'sl_mode': 'atr',
            'sl_value': 1.2,        # 1.2x ATR Stop Loss
            'use_trailing': True,
            'trailing_trigger': 1.5,
            'trailing_step': 0.8,
            'rsi_long_max': 38,     # Pullback entry threshold
            'rsi_short_min': 62,    # Pullback short entry threshold
            'vol_spike_min': 1.2,   # Volume > 1.2x MA20
            'require_htf_trend': True
        }
        if params:
            default_params.update(params)
        super().__init__(name="MTF_Pullback", params=default_params)

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        df['signal'] = 0
        df['confidence'] = 0.0

        # Check required columns
        req = ['close', 'ema_20', 'ema_50', 'rsi', 'atr']
        if not all(c in df.columns for c in req):
            return self.apply_risk_levels(df)

        # 1. HTF Trend filter (if aligned)
        if self.params.get('require_htf_trend') and 'htf_ema_50' in df.columns:
            htf_bull = (df['htf_close'] > df['htf_ema_50']) if 'htf_close' in df.columns else (df['close'] > df['htf_ema_50'])
            htf_bear = (df['htf_close'] < df['htf_ema_50']) if 'htf_close' in df.columns else (df['close'] < df['htf_ema_50'])
        else:
            # Fallback to local EMA 50 / 200
            htf_bull = df['close'] > df['ema_50']
            htf_bear = df['close'] < df['ema_50']

        # 2. LTF Pullback conditions
        rsi = df['rsi']
        vol_ratio = df.get('vol_ratio', pd.Series(1.0, index=df.index))
        
        # Bullish Pullback: Uptrend + RSI dip into oversold + Volume expansion
        long_cond = (
            htf_bull &
            (rsi <= self.params['rsi_long_max']) &
            (rsi > rsi.shift(1)) & # Turning back up
            (vol_ratio >= self.params.get('vol_spike_min', 1.0))
        )
        
        # Bearish Pullback: Downtrend + RSI spike into overbought + Volume expansion
        short_cond = (
            htf_bear &
            (rsi >= self.params['rsi_short_min']) &
            (rsi < rsi.shift(1)) & # Turning back down
            (vol_ratio >= self.params.get('vol_spike_min', 1.0))
        )

        df.loc[long_cond, 'signal'] = 1
        df.loc[short_cond, 'signal'] = -1
        
        # Confidence score calculation
        for idx in df[df['signal'] != 0].index:
            score = 0.50
            if df.loc[idx, 'signal'] == 1:
                if df.loc[idx, 'close'] > df.loc[idx, 'ema_200'] if 'ema_200' in df.columns and not pd.isna(df.loc[idx, 'ema_200']) else False:
                    score += 0.15
                if df.loc[idx, 'vol_ratio'] > 1.8:
                    score += 0.15
                if 'vwap' in df.columns and df.loc[idx, 'close'] > df.loc[idx, 'vwap']:
                    score += 0.10
                if df.loc[idx, 'rsi'] < 30:
                    score += 0.10
            elif df.loc[idx, 'signal'] == -1:
                if df.loc[idx, 'close'] < df.loc[idx, 'ema_200'] if 'ema_200' in df.columns and not pd.isna(df.loc[idx, 'ema_200']) else False:
                    score += 0.15
                if df.loc[idx, 'vol_ratio'] > 1.8:
                    score += 0.15
                if 'vwap' in df.columns and df.loc[idx, 'close'] < df.loc[idx, 'vwap']:
                    score += 0.10
                if df.loc[idx, 'rsi'] > 70:
                    score += 0.10
            df.loc[idx, 'confidence'] = min(score, 0.95)

        return self.apply_risk_levels(df)
