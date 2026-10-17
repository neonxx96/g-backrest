"""
Data Loader & Historical Market Data Manager
Handles fetching, caching, MTF alignment, and parsing CryptoDataDownload / Crypto Lake CSVs.
"""

import os
import io
import sys
import time
from datetime import datetime, timedelta
import pandas as pd
import ccxt

DATA_CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cache")
os.makedirs(DATA_CACHE_DIR, exist_ok=True)

class DataLoader:
    def __init__(self, exchange_id="bybit", market_type="swap"):
        self.exchange_id = exchange_id.lower()
        self.market_type = market_type
        exchange_class = getattr(ccxt, self.exchange_id, ccxt.bybit)
        options = {}
        if market_type == "swap":
            options['defaultType'] = 'swap'
        elif market_type == "spot":
            options['defaultType'] = 'spot'
            
        self.exchange = exchange_class({
            'enableRateLimit': True,
            'options': options
        })

    def get_cache_path(self, symbol: str, timeframe: str) -> str:
        safe_sym = symbol.replace("/", "_").replace(":", "_").replace("-", "_")
        return os.path.join(DATA_CACHE_DIR, f"{self.exchange_id}_{safe_sym}_{timeframe}.parquet")

    def fetch_historical_ohlcv(self, symbol: str, timeframe: str = "15m", days: int = 30, force_refresh: bool = False) -> pd.DataFrame:
        """
        Fetches historical candles with pagination and local Parquet caching.
        """
        cache_file = self.get_cache_path(symbol, timeframe)
        
        # Check cache if fresh
        if os.path.exists(cache_file) and not force_refresh:
            try:
                df = pd.read_parquet(cache_file)
                if not df.empty:
                    last_time = df.index[-1]
                    # If cached data is reasonably recent (within 30 mins)
                    if (datetime.now() - last_time.to_pydatetime()).total_seconds() < 1800:
                        return df
            except Exception:
                pass

        # Pagination download
        since = int((datetime.now() - timedelta(days=days)).timestamp() * 1000)
        all_ohlcv = []
        limit = 200
        
        norm_sym = symbol
        if self.market_type == "swap" and ":" not in symbol and "/" in symbol:
            norm_sym = f"{symbol}:{symbol.split('/')[1]}"
            
        curr_since = since
        max_loops = 50  # Safeguard
        
        while max_loops > 0:
            max_loops -= 1
            try:
                candles = self.exchange.fetch_ohlcv(norm_sym, timeframe=timeframe, since=curr_since, limit=limit)
            except Exception:
                # Fallback to simple symbol
                candles = self.exchange.fetch_ohlcv(symbol, timeframe=timeframe, since=curr_since, limit=limit)
                
            if not candles:
                break
                
            all_ohlcv.extend(candles)
            last_ts = candles[-1][0]
            if last_ts == curr_since or len(candles) < limit:
                break
            curr_since = last_ts + 1
            time.sleep(self.exchange.rateLimit / 1000.0)

        if not all_ohlcv:
            raise ValueError(f"Не удалось загрузить данные для {symbol} ({timeframe})")

        df = pd.DataFrame(all_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df.drop_duplicates(subset=['timestamp'], inplace=True)
        df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('datetime', inplace=True)
        df.sort_index(inplace=True)
        
        # Save cache
        try:
            df.to_parquet(cache_file)
        except Exception:
            pass
            
        return df

    @staticmethod
    def load_cryptodatadownload_csv(filepath: str) -> pd.DataFrame:
        """
        Loads and standardizes historical CSVs from cryptodatadownload.com
        """
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            lines = [f.readline() for _ in range(5)]
            
        skiprows = 1 if "http" in lines[0].lower() else 0
        df = pd.read_csv(filepath, skiprows=skiprows)
        df.columns = [c.strip().lower() for c in df.columns]
        
        # Identify date column
        date_col = next((c for c in ['date', 'unix', 'timestamp'] if c in df.columns), None)
        if not date_col:
            raise ValueError("Колонка даты не найдена в файле")
            
        if date_col == 'unix':
            df['datetime'] = pd.to_datetime(df['unix'], unit='ms' if df['unix'].iloc[0] > 1e11 else 's')
        else:
            df['datetime'] = pd.to_datetime(df[date_col])
            
        df.set_index('datetime', inplace=True)
        df.sort_index(inplace=True)
        
        # Rename standard columns
        cols = {
            'open': 'open',
            'high': 'high',
            'low': 'low',
            'close': 'close',
            'vol': 'volume',
            'volume': 'volume',
            'volume usdt': 'volume',
            'volume usd': 'volume'
        }
        for k, v in cols.items():
            if k in df.columns and v not in df.columns:
                df.rename(columns={k: v}, inplace=True)
                
        req_cols = ['open', 'high', 'low', 'close', 'volume']
        return df[[c for c in req_cols if c in df.columns]]

    @staticmethod
    def align_multi_timeframe(ltf_df: pd.DataFrame, htf_df: pd.DataFrame, prefix: str = "htf_") -> pd.DataFrame:
        """
        Aligns higher timeframe indicators to lower timeframe bars without lookahead bias.
        Uses backward asof merge.
        """
        htf_cols = [c for c in htf_df.columns if c not in ['open', 'high', 'low', 'close', 'volume', 'timestamp']]
        if not htf_cols:
            # If htf has no separate indicators, prefix all
            htf_cols = htf_df.columns
            
        sub_htf = htf_df[htf_cols].copy()
        sub_htf.rename(columns={c: f"{prefix}{c}" for c in sub_htf.columns}, inplace=True)
        
        # Merge asof backward
        merged = pd.merge_asof(
            ltf_df.sort_index(),
            sub_htf.sort_index(),
            left_index=True,
            right_index=True,
            direction='backward'
        )
        return merged
