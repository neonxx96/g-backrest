"""
Strategy Base Class
Defines the standard interface for creating customizable trading strategies.
"""

from abc import ABC, abstractmethod
import pandas as pd
import numpy as np

class BaseStrategy(ABC):
    def __init__(self, name: str = "BaseStrategy", params: dict = None):
        self.name = name
        self.params = params or {}
        
        # Risk management defaults
        self.tp_mode = self.params.get('tp_mode', 'atr')  # 'atr', 'pct', 'rr'
        self.tp_value = self.params.get('tp_value', 2.0)  # 2.0x ATR or 2.0%
        
        self.sl_mode = self.params.get('sl_mode', 'atr')  # 'atr', 'pct', 'swing'
        self.sl_value = self.params.get('sl_value', 1.0)  # 1.0x ATR or 1.0%
        
        self.use_trailing = self.params.get('use_trailing', False)
        self.trailing_trigger = self.params.get('trailing_trigger', 1.5)  # in ATR or %
        self.trailing_step = self.params.get('trailing_step', 0.5)

    @abstractmethod
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Takes a dataframe with indicators and adds:
        - 'signal': 1 (Long), -1 (Short), 0 (No trade)
        - 'tp_price': target take profit price
        - 'sl_price': protective stop loss price
        - 'confidence': float between 0.0 and 1.0 (signal strength/probability)
        """
        pass

    def apply_risk_levels(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Helper to calculate TP/SL prices according to strategy configuration.
        """
        df['tp_price'] = np.nan
        df['sl_price'] = np.nan
        
        # Long entries
        long_mask = df['signal'] == 1
        if self.sl_mode == 'atr' and 'atr' in df.columns:
            df.loc[long_mask, 'sl_price'] = df.loc[long_mask, 'close'] - (df.loc[long_mask, 'atr'] * self.sl_value)
            if self.tp_mode == 'atr':
                df.loc[long_mask, 'tp_price'] = df.loc[long_mask, 'close'] + (df.loc[long_mask, 'atr'] * self.tp_value)
            elif self.tp_mode == 'rr':
                risk = df.loc[long_mask, 'close'] - df.loc[long_mask, 'sl_price']
                df.loc[long_mask, 'tp_price'] = df.loc[long_mask, 'close'] + (risk * self.tp_value)
        elif self.sl_mode == 'pct':
            df.loc[long_mask, 'sl_price'] = df.loc[long_mask, 'close'] * (1.0 - self.sl_value / 100.0)
            df.loc[long_mask, 'tp_price'] = df.loc[long_mask, 'close'] * (1.0 + self.tp_value / 100.0)
            
        # Short entries
        short_mask = df['signal'] == -1
        if self.sl_mode == 'atr' and 'atr' in df.columns:
            df.loc[short_mask, 'sl_price'] = df.loc[short_mask, 'close'] + (df.loc[short_mask, 'atr'] * self.sl_value)
            if self.tp_mode == 'atr':
                df.loc[short_mask, 'tp_price'] = df.loc[short_mask, 'close'] - (df.loc[short_mask, 'atr'] * self.tp_value)
            elif self.tp_mode == 'rr':
                risk = df.loc[short_mask, 'sl_price'] - df.loc[short_mask, 'close']
                df.loc[short_mask, 'tp_price'] = df.loc[short_mask, 'close'] - (risk * self.tp_value)
        elif self.sl_mode == 'pct':
            df.loc[short_mask, 'sl_price'] = df.loc[short_mask, 'close'] * (1.0 + self.sl_value / 100.0)
            df.loc[short_mask, 'tp_price'] = df.loc[short_mask, 'close'] * (1.0 - self.tp_value / 100.0)
            
        return df
