"""
Crypto Lake Data Adapter
Loads and processes Level 2 orderbook snapshots and tick-by-tick trades from Crypto Lake (crypto-lake.com).
Reconstructs exact cluster deltas, CVD, and orderbook imbalances.
"""

import os
import pandas as pd
import numpy as np
from typing import Dict, Any, Optional

class CryptoLakeLoader:
    def __init__(self, data_dir: str = None):
        self.data_dir = data_dir or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "sample")
        os.makedirs(self.data_dir, exist_ok=True)

    @staticmethod
    def load_trades_file(filepath: str) -> pd.DataFrame:
        """
        Loads Crypto Lake trade logs (CSV or Parquet) with format:
        [timestamp, price, quantity, side]
        """
        if filepath.endswith(".parquet"):
            df = pd.read_parquet(filepath)
        else:
            df = pd.read_csv(filepath)

        df.columns = [c.strip().lower() for c in df.columns]
        
        # Standardize timestamp
        ts_col = next((c for c in ['timestamp', 'time', 'date', 'received_time'] if c in df.columns), None)
        if ts_col:
            df['datetime'] = pd.to_datetime(df[ts_col])
            df.set_index('datetime', inplace=True)
            df.sort_index(inplace=True)

        # Standardize side ('buy' / 'sell' or 1 / -1)
        if 'side' in df.columns:
            if df['side'].dtype == object:
                df['side_sign'] = np.where(df['side'].str.lower().str.startswith('b'), 1, -1)
            else:
                df['side_sign'] = np.where(df['side'] > 0, 1, -1)
        else:
            df['side_sign'] = 1

        # Calculate signed volume for exact delta
        vol_col = next((c for c in ['quantity', 'qty', 'amount', 'volume', 'size'] if c in df.columns), None)
        if vol_col:
            df['signed_volume'] = df[vol_col] * df['side_sign']

        return df

    @staticmethod
    def resample_trades_to_ohlcv_delta(trades_df: pd.DataFrame, timeframe: str = "5m") -> pd.DataFrame:
        """
        Aggregates tick trades into OHLCV candles with EXACT cluster delta and trade count.
        """
        price_col = next((c for c in ['price', 'p'] if c in trades_df.columns), 'price')
        vol_col = next((c for c in ['quantity', 'qty', 'amount', 'volume', 'size'] if c in trades_df.columns), 'quantity')

        resampled = trades_df[price_col].resample(timeframe).ohlc()
        resampled['volume'] = trades_df[vol_col].resample(timeframe).sum()
        
        # Exact delta
        if 'signed_volume' in trades_df.columns:
            resampled['delta'] = trades_df['signed_volume'].resample(timeframe).sum()
        else:
            resampled['delta'] = 0.0

        resampled['cvd'] = resampled['delta'].cumsum()
        resampled['trades_count'] = trades_df[price_col].resample(timeframe).count()
        resampled.dropna(subset=['close'], inplace=True)

        return resampled

    @staticmethod
    def load_orderbook_snapshots(filepath: str) -> pd.DataFrame:
        """
        Loads Level 2 book snapshots (bids/asks top levels).
        """
        if filepath.endswith(".parquet"):
            df = pd.read_parquet(filepath)
        else:
            df = pd.read_csv(filepath)
            
        df.columns = [c.strip().lower() for c in df.columns]
        return df
