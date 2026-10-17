"""
Cluster Delta & Volume Absorption Strategy (Tiger Trade Order Flow Model)
Enters on delta divergences and absorption at key Volume Profile levels (POC / VAH / VAL).
"""

import pandas as pd
import numpy as np
from engine.strategy_base import BaseStrategy
from engine.volume_profile import VolumeProfileEngine

class ClusterAbsorptionStrategy(BaseStrategy):
    def __init__(self, params: dict = None):
        default_params = {
            'tp_mode': 'atr',
            'tp_value': 2.2,
            'sl_mode': 'atr',
            'sl_value': 1.1,
            'use_trailing': True,
            'trailing_trigger': 1.4,
            'trailing_step': 0.6,
            'use_divergence': True,
            'min_confidence': 0.65
        }
        if params:
            default_params.update(params)
        super().__init__(name="Cluster_Absorption", params=default_params)

    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        
        # Calculate Delta and CVD if not already present
        if 'delta' not in df.columns or 'cvd' not in df.columns:
            df = VolumeProfileEngine.calculate_candle_delta_and_cvd(df)

        df['signal'] = 0
        df['confidence'] = 0.0

        req = ['close', 'ema_20', 'ema_50', 'atr']
        if not all(c in df.columns for c in req):
            return self.apply_risk_levels(df)

        # Bullish absorption:
        # Price testing below EMA 20, but Bullish Delta Divergence occurs OR CVD turns up with high volume
        cvd_turning_up = (df['cvd'] > df['cvd'].shift(1)) & (df['cvd'].shift(1) <= df['cvd'].shift(2))
        bull_div = df.get('delta_divergence_bull', pd.Series(False, index=df.index))
        long_cond = (bull_div | cvd_turning_up) & (df['close'] < df['ema_20']) & (df.get('vol_ratio', 1.0) >= 1.1)

        # Bearish absorption:
        # Price testing above EMA 20, but Bearish Delta Divergence occurs OR CVD turns down with high volume
        cvd_turning_down = (df['cvd'] < df['cvd'].shift(1)) & (df['cvd'].shift(1) >= df['cvd'].shift(2))
        bear_div = df.get('delta_divergence_bear', pd.Series(False, index=df.index))
        short_cond = (bear_div | cvd_turning_down) & (df['close'] > df['ema_20']) & (df.get('vol_ratio', 1.0) >= 1.1)

        df.loc[long_cond, 'signal'] = 1
        df.loc[short_cond, 'signal'] = -1

        # Calculate confidence
        for idx in df[df['signal'] != 0].index:
            score = 0.60
            if df.loc[idx, 'signal'] == 1:
                if df.loc[idx].get('delta_divergence_bull', False):
                    score += 0.20
                if df.loc[idx].get('vol_ratio', 1.0) > 1.5:
                    score += 0.15
            elif df.loc[idx, 'signal'] == -1:
                if df.loc[idx].get('delta_divergence_bear', False):
                    score += 0.20
                if df.loc[idx].get('vol_ratio', 1.0) > 1.5:
                    score += 0.15
            df.loc[idx, 'confidence'] = min(score, 0.95)

        return self.apply_risk_levels(df)
