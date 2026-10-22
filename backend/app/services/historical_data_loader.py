"""
Deep Historical Data Pipeline & Local Parquet Cache for SignalScript.
Provides institutional-grade, chunked kline fetching from Binance with:
- Zero look-ahead bias and strict UTC millisecond timestamps
- Rate-limit (HTTP 429/418) handling with exponential backoff
- High-performance local caching using Apache Parquet (pyarrow)
- Pre-allocated schema supporting Cluster / Footprint Analysis:
  `volume_delta`, `poc_price`, `cluster_profile`, `sell_volume`
"""

import os
import json
import time
import math
import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
import aiohttp
import requests

logger = logging.getLogger(__name__)

# Default history storage directory: backend/data/history/
BASE_DIR = Path(__file__).resolve().parents[2]
DEFAULT_HISTORY_DIR = BASE_DIR / "data" / "history"

# Timeframe to minutes & milliseconds mapping
TF_MAP: Dict[str, int] = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "2h": 120,
    "4h": 240,
    "6h": 360,
    "8h": 480,
    "12h": 720,
    "1d": 1440,
    "3d": 4320,
    "1w": 10080,
}

FUTURES_KLINES_URL = "https://fapi.binance.com/fapi/v1/klines"
SPOT_KLINES_URL = "https://api.binance.com/api/v3/klines"
VISION_KLINES_URL = "https://data-api.binance.vision/api/v3/klines"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
}


class HistoricalDataLoader:
    """
    Institutional historical data loader and caching engine.
    Fetches multi-year OHLCV + Footprint data in safe chunks and maintains
    a local Parquet dataset with incremental synchronization.
    """

    def __init__(self, storage_dir: Optional[Union[str, Path]] = None):
        self.storage_dir = Path(storage_dir or DEFAULT_HISTORY_DIR)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def get_cache_path(self, symbol: str, timeframe: str) -> Path:
        """Returns the local Parquet file path for symbol and timeframe."""
        clean_sym = symbol.strip().upper()
        clean_tf = timeframe.strip().lower()
        return self.storage_dir / f"{clean_sym}_{clean_tf}.parquet"

    @staticmethod
    def timeframe_to_ms(timeframe: str) -> int:
        """Converts timeframe string to milliseconds."""
        mins = TF_MAP.get(timeframe.lower(), 15)
        return mins * 60 * 1000

    @staticmethod
    def raw_to_dataframe(rows: List[list]) -> pd.DataFrame:
        """
        Transforms raw Binance kline arrays into the standardized
        SignalScript quantitative schema supporting cluster data.
        """
        if not rows:
            return pd.DataFrame(
                columns=[
                    "timestamp",
                    "open",
                    "high",
                    "low",
                    "close",
                    "volume",
                    "taker_buy_base_volume",
                    "sell_volume",
                    "volume_delta",
                    "poc_price",
                    "cluster_profile",
                ]
            )

        ts = [int(r[0]) for r in rows]
        opens = [float(r[1]) for r in rows]
        highs = [float(r[2]) for r in rows]
        lows = [float(r[3]) for r in rows]
        closes = [float(r[4]) for r in rows]
        volumes = [float(r[5]) for r in rows]
        buy_vols = [float(r[9]) for r in rows]

        df = pd.DataFrame(
            {
                "timestamp": ts,
                "open": opens,
                "high": highs,
                "low": lows,
                "close": closes,
                "volume": volumes,
                "taker_buy_base_volume": buy_vols,
            }
        )

        # Kline-only order-flow fields.  POC and cluster delta may only be
        # populated by the aggTrades footprint pipeline; a candle has no
        # defensible price-level profile on its own.
        df["sell_volume"] = (df["volume"] - df["taker_buy_base_volume"]).clip(lower=0.0)
        df["volume_delta"] = np.nan
        df["poc_price"] = np.nan
        df["cluster_profile"] = ""

        # Clean duplicates and sort ascending
        df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
        return df

    def read_cache(self, symbol: str, timeframe: str) -> Optional[pd.DataFrame]:
        """Reads cached DataFrame from local Parquet storage."""
        path = self.get_cache_path(symbol, timeframe)
        if not path.exists():
            return None
        try:
            df = pd.read_parquet(path, engine="pyarrow")
            if not df.empty and "timestamp" in df.columns:
                # Caches written before the truth-first footprint contract used
                # an OHLC proxy for POC.  Empty profiles must remain visibly
                # empty rather than leak a fabricated price-level metric.
                if "cluster_profile" not in df.columns:
                    df["cluster_profile"] = ""
                empty_profiles = df["cluster_profile"].fillna("").astype(str).isin(["", "{}"])
                if "poc_price" in df.columns:
                    df.loc[empty_profiles, "poc_price"] = np.nan
                if "volume_delta" in df.columns:
                    df.loc[empty_profiles, "volume_delta"] = np.nan
                df.loc[empty_profiles, "cluster_profile"] = ""
                return df.sort_values("timestamp").reset_index(drop=True)
        except Exception as e:
            logger.warning(f"Failed reading cache for {path}: {e}")
        return None

    def save_cache(self, symbol: str, timeframe: str, df: pd.DataFrame) -> Path:
        """Saves DataFrame to local Parquet storage with Snappy compression."""
        path = self.get_cache_path(symbol, timeframe)
        df_sorted = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
        # Ensure correct column types for PyArrow
        df_sorted["timestamp"] = df_sorted["timestamp"].astype(np.int64)
        for col in ["open", "high", "low", "close", "volume", "taker_buy_base_volume", "sell_volume", "volume_delta", "poc_price"]:
            if col in df_sorted.columns:
                df_sorted[col] = df_sorted[col].astype(np.float64)
        df_sorted["cluster_profile"] = df_sorted["cluster_profile"].fillna("").astype(str)

        df_sorted.to_parquet(path, engine="pyarrow", compression="snappy", index=False)
        return path

    def fetch_chunk_sync(
        self,
        symbol: str,
        interval: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 1500,
        max_retries: int = 5,
    ) -> List[list]:
        """
        Synchronously fetches a single batch of klines with HTTP 429/418 handling.
        """
        params: Dict[str, Any] = {
            "symbol": symbol.strip().upper(),
            "interval": interval,
            "limit": min(1500, limit),
        }
        if start_time is not None:
            params["startTime"] = int(start_time)
        if end_time is not None:
            params["endTime"] = int(end_time)

        endpoints = [FUTURES_KLINES_URL, SPOT_KLINES_URL, VISION_KLINES_URL]

        for attempt in range(max_retries):
            for url in endpoints:
                try:
                    resp = requests.get(url, params=params, headers=HEADERS, timeout=8)
                    if resp.status_code == 200:
                        data = resp.json()
                        if isinstance(data, list):
                            return data
                    elif resp.status_code in (429, 418):
                        retry_after = int(resp.headers.get("Retry-After", 2))
                        sleep_time = max(retry_after, 2 ** attempt)
                        logger.warning(f"Binance rate limit hit ({resp.status_code}). Backoff {sleep_time}s")
                        time.sleep(sleep_time)
                        continue
                    else:
                        logger.debug(f"Endpoint {url} returned {resp.status_code}")
                except Exception as ex:
                    logger.debug(f"Request error to {url}: {ex}")

            time.sleep(0.5 * (2 ** attempt))

        return []

    async def fetch_chunk_async(
        self,
        session: aiohttp.ClientSession,
        symbol: str,
        interval: str,
        start_time: Optional[int] = None,
        end_time: Optional[int] = None,
        limit: int = 1500,
        max_retries: int = 5,
    ) -> List[list]:
        """
        Asynchronously fetches a single batch of klines with rate limit backoff.
        """
        params: Dict[str, Any] = {
            "symbol": symbol.strip().upper(),
            "interval": interval,
            "limit": min(1500, limit),
        }
        if start_time is not None:
            params["startTime"] = int(start_time)
        if end_time is not None:
            params["endTime"] = int(end_time)

        endpoints = [FUTURES_KLINES_URL, SPOT_KLINES_URL, VISION_KLINES_URL]

        for attempt in range(max_retries):
            for url in endpoints:
                try:
                    async with session.get(
                        url, params=params, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=8)
                    ) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            if isinstance(data, list):
                                return data
                        elif resp.status in (429, 418):
                            retry_after = int(resp.headers.get("Retry-After", 2))
                            sleep_time = max(retry_after, 2 ** attempt)
                            logger.warning(f"Async Binance rate limit hit ({resp.status}). Backoff {sleep_time}s")
                            await asyncio.sleep(sleep_time)
                            continue
                except Exception as ex:
                    logger.debug(f"Async request error to {url}: {ex}")

            await asyncio.sleep(0.5 * (2 ** attempt))

        return []

    def fetch_range_sync(
        self,
        symbol: str,
        timeframe: str,
        start_time_ms: int,
        end_time_ms: int,
        pacing_sec: float = 0.05,
    ) -> pd.DataFrame:
        """
        Fetches an arbitrary time range in sequential safe batches.
        """
        all_rows: List[list] = []
        curr_start = int(start_time_ms)
        tf_ms = self.timeframe_to_ms(timeframe)
        chunk_limit = 1500

        while curr_start < end_time_ms:
            chunk = self.fetch_chunk_sync(
                symbol=symbol,
                interval=timeframe,
                start_time=curr_start,
                end_time=end_time_ms,
                limit=chunk_limit,
            )
            if not chunk:
                break

            all_rows.extend(chunk)
            last_ts = int(chunk[-1][0])

            # Advance to the next bar
            next_start = last_ts + tf_ms
            if next_start <= curr_start:
                break
            curr_start = next_start

            if len(chunk) < chunk_limit:
                break

            if pacing_sec > 0:
                time.sleep(pacing_sec)

        return self.raw_to_dataframe(all_rows)

    async def fetch_range_async(
        self,
        symbol: str,
        timeframe: str,
        start_time_ms: int,
        end_time_ms: int,
        pacing_sec: float = 0.05,
    ) -> pd.DataFrame:
        """
        Asynchronously fetches an arbitrary time range in sequential batches.
        """
        all_rows: List[list] = []
        curr_start = int(start_time_ms)
        tf_ms = self.timeframe_to_ms(timeframe)
        chunk_limit = 1500

        async with aiohttp.ClientSession() as session:
            while curr_start < end_time_ms:
                chunk = await self.fetch_chunk_async(
                    session=session,
                    symbol=symbol,
                    interval=timeframe,
                    start_time=curr_start,
                    end_time=end_time_ms,
                    limit=chunk_limit,
                )
                if not chunk:
                    break

                all_rows.extend(chunk)
                last_ts = int(chunk[-1][0])

                next_start = last_ts + tf_ms
                if next_start <= curr_start:
                    break
                curr_start = next_start

                if len(chunk) < chunk_limit:
                    break

                if pacing_sec > 0:
                    await asyncio.sleep(pacing_sec)

        return self.raw_to_dataframe(all_rows)

    def load_dataset_sync(
        self,
        symbol: str,
        timeframe: str,
        days: Optional[int] = None,
        start_time_ms: Optional[int] = None,
        end_time_ms: Optional[int] = None,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        """
        High-performance data loader with local Parquet cache & incremental sync.
        Returns the requested historical slice as a standardized DataFrame.
        """
        now_ms = int(time.time() * 1000)
        tf_ms = self.timeframe_to_ms(timeframe)

        if end_time_ms is None:
            end_time_ms = now_ms

        if start_time_ms is None:
            days = days or 30
            start_time_ms = end_time_ms - int(days * 24 * 60 * 60 * 1000)

        # 1. Read existing cache if not forcing refresh
        cached_df = None if force_refresh else self.read_cache(symbol, timeframe)

        if cached_df is None or cached_df.empty:
            # Fetch entire range from scratch
            fetched_df = self.fetch_range_sync(symbol, timeframe, start_time_ms, end_time_ms)
            if not fetched_df.empty:
                self.save_cache(symbol, timeframe, fetched_df)
                return fetched_df[
                    (fetched_df["timestamp"] >= start_time_ms) & (fetched_df["timestamp"] <= end_time_ms)
                ].reset_index(drop=True)
            return fetched_df

        # 2. Check for missing head or tail in cache
        cached_min = int(cached_df["timestamp"].min())
        cached_max = int(cached_df["timestamp"].max())
        chunks_to_merge = [cached_df]

        # Missing older head data
        if start_time_ms < cached_min - tf_ms:
            head_df = self.fetch_range_sync(symbol, timeframe, start_time_ms, cached_min - 1)
            if not head_df.empty:
                chunks_to_merge.append(head_df)

        # Missing newer tail data
        if end_time_ms > cached_max + tf_ms:
            tail_df = self.fetch_range_sync(symbol, timeframe, cached_max + 1, end_time_ms)
            if not tail_df.empty:
                chunks_to_merge.append(tail_df)

        # 3. If any missing chunks were fetched, merge & persist
        if len(chunks_to_merge) > 1:
            merged_df = pd.concat(chunks_to_merge, ignore_index=True)
            merged_df = merged_df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
            self.save_cache(symbol, timeframe, merged_df)
            full_df = merged_df
        else:
            full_df = cached_df

        # Return exact requested slice
        mask = (full_df["timestamp"] >= start_time_ms) & (full_df["timestamp"] <= end_time_ms)
        return full_df[mask].reset_index(drop=True)

    async def load_dataset_async(
        self,
        symbol: str,
        timeframe: str,
        days: Optional[int] = None,
        start_time_ms: Optional[int] = None,
        end_time_ms: Optional[int] = None,
        force_refresh: bool = False,
    ) -> pd.DataFrame:
        """
        Asynchronous version of load_dataset with Parquet cache and incremental sync.
        """
        now_ms = int(time.time() * 1000)
        tf_ms = self.timeframe_to_ms(timeframe)

        if end_time_ms is None:
            end_time_ms = now_ms

        if start_time_ms is None:
            days = days or 30
            start_time_ms = end_time_ms - int(days * 24 * 60 * 60 * 1000)

        cached_df = None if force_refresh else self.read_cache(symbol, timeframe)

        if cached_df is None or cached_df.empty:
            fetched_df = await self.fetch_range_async(symbol, timeframe, start_time_ms, end_time_ms)
            if not fetched_df.empty:
                self.save_cache(symbol, timeframe, fetched_df)
                return fetched_df[
                    (fetched_df["timestamp"] >= start_time_ms) & (fetched_df["timestamp"] <= end_time_ms)
                ].reset_index(drop=True)
            return fetched_df

        cached_min = int(cached_df["timestamp"].min())
        cached_max = int(cached_df["timestamp"].max())
        chunks_to_merge = [cached_df]

        if start_time_ms < cached_min - tf_ms:
            head_df = await self.fetch_range_async(symbol, timeframe, start_time_ms, cached_min - 1)
            if not head_df.empty:
                chunks_to_merge.append(head_df)

        if end_time_ms > cached_max + tf_ms:
            tail_df = await self.fetch_range_async(symbol, timeframe, cached_max + 1, end_time_ms)
            if not tail_df.empty:
                chunks_to_merge.append(tail_df)

        if len(chunks_to_merge) > 1:
            merged_df = pd.concat(chunks_to_merge, ignore_index=True)
            merged_df = merged_df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
            self.save_cache(symbol, timeframe, merged_df)
            full_df = merged_df
        else:
            full_df = cached_df

        mask = (full_df["timestamp"] >= start_time_ms) & (full_df["timestamp"] <= end_time_ms)
        return full_df[mask].reset_index(drop=True)


# Singleton instance for quick module access
historical_loader = HistoricalDataLoader()
