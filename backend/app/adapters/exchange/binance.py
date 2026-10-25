"""
Binance Futures Exchange Adapter
Implements read-only market data retrieval for Binance USDT-M Futures.
"""

import asyncio
import aiohttp
import pandas as pd
from typing import Dict, List, Optional, Any
from backend.app.adapters.exchange.base import BaseExchangeAdapter
from backend.app.config import BINANCE_API_KEY

BINANCE_FUTURES_REST = "https://fapi.binance.com"
BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws"

# --- Deep-history klines support ---------------------------------------------
# Binance REST maximum bars per request differs per endpoint.
KLINE_ENDPOINTS = [
    {"url": f"{BINANCE_FUTURES_REST}/fapi/v1/klines", "max_limit": 1500},
    {"url": "https://api.binance.com/api/v3/klines", "max_limit": 1000},
    {"url": "https://data-api.binance.vision/api/v3/klines", "max_limit": 1000},
]

# Non-native intervals (45m, 6h) are assembled from a Binance-native base
# timeframe and resampled, so paginated deep history works for them too.
CUSTOM_TF_MAP = {
    "45m": {"base": "15m", "rule": "45min", "mult": 3},
    "6h": {"base": "1h", "rule": "6h", "mult": 6},
}

BASE_TF_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
    "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000,
    "12h": 43_200_000, "1d": 86_400_000, "1w": 604_800_000,
}

# Safety cap for paginated deep fetches (base-timeframe bars).
MAX_HISTORY_BASE_CANDLES = 100_000

KLINE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}


class BinanceAdapter(BaseExchangeAdapter):
    """Adapter for Binance USDT-M Futures."""

    def __init__(self, api_key: Optional[str] = BINANCE_API_KEY):
        self.api_key = api_key
        self.session: Optional[aiohttp.ClientSession] = None

    @property
    def name(self) -> str:
        return "binance"

    def get_ws_url(self) -> str:
        return BINANCE_FUTURES_WS

    async def get_session(self) -> aiohttp.ClientSession:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if self.session is None or self.session.closed or (loop and getattr(self.session, "_loop", None) != loop):
            headers = dict(KLINE_HEADERS)
            if self.api_key:
                headers["X-MBX-APIKEY"] = self.api_key
            timeout = aiohttp.ClientTimeout(total=10)
            self.session = aiohttp.ClientSession(headers=headers, timeout=timeout)
        return self.session

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    async def fetch_24h_tickers(self) -> Dict[str, Dict[str, Any]]:
        session = await self.get_session()
        url = f"{BINANCE_FUTURES_REST}/fapi/v1/ticker/24hr"
        try:
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    tickers = {}
                    for item in data:
                        sym = item['symbol']
                        if sym.endswith("USDT"):
                            tickers[sym] = {
                                'symbol': sym,
                                'last_price': float(item['lastPrice']),
                                'price_change_pct': float(item['priceChangePercent']),
                                'high_price': float(item['highPrice']),
                                'low_price': float(item['lowPrice']),
                                'quote_volume_24h': float(item['quoteVolume']),
                                'volume_24h': float(item['volume'])
                            }
                    return tickers
        except Exception:
            pass
        return {}

    async def fetch_top_symbols(self, limit: int = 150) -> List[str]:
        tickers = await self.fetch_24h_tickers()
        sorted_syms = sorted(tickers.values(), key=lambda x: x['quote_volume_24h'], reverse=True)
        return [x['symbol'] for x in sorted_syms[:limit]]

    async def fetch_order_book(self, symbol: str, limit: int = 20) -> Dict[str, Any]:
        session = await self.get_session()
        sym = symbol.upper()
        endpoints = [
            f"{BINANCE_FUTURES_REST}/fapi/v1/depth",
            "https://data-api.binance.vision/api/v3/depth",
            "https://api.binance.com/api/v3/depth",
        ]
        params = {'symbol': sym, 'limit': limit}
        for url in endpoints:
            try:
                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=4)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data and "bids" in data and len(data["bids"]) > 0:
                            return data
            except Exception:
                continue
        return {'bids': [], 'asks': []}

    async def fetch_klines(self, symbol: str, timeframe: str = "15m", limit: int = 100,
                           start_time: Optional[int] = None,
                           end_time: Optional[int] = None) -> pd.DataFrame:
        """
        Fetch OHLCV klines (with CVD) via Binance REST with multi-endpoint failover.

        Modes:
        - start_time=None: latest `limit` bars (single request per endpoint).
        - start_time set: PAGINATED deep fetch over [start_time, end_time] using
          startTime/endTime chunks of up to 1500 bars (Binance maximum per
          request). `limit` is ignored in this mode.
        Non-native intervals 45m/6h are assembled from 15m/1h base candles and
        resampled, so paginated deep history works for them too.
        """
        session = await self.get_session()
        custom = CUSTOM_TF_MAP.get(timeframe)
        fetch_tf = custom["base"] if custom else timeframe
        resample_rule = custom["rule"] if custom else None

        rows, ok = await self._fetch_klines_rows(
            session, symbol, fetch_tf, limit, start_time, end_time
        )
        # Clock-skew resilience: if initial window (start_time set, end_time None) returned empty
        # because client clock is ahead of exchange server time, retry in latest-batch mode.
        used_latest_fallback = False
        if not rows and start_time is not None and end_time is None:
            rows, ok = await self._fetch_klines_rows(
                session, symbol, fetch_tf, max(int(limit), 1000), None, None
            )
            used_latest_fallback = True
        if not ok:
            raise ValueError(f"Binance klines error across all endpoints for {symbol}")

        df = self._rows_to_dataframe(rows, resample_rule)
        if df.empty:
            return df

        if start_time is not None and not used_latest_fallback:
            # Deep mode: exact [start_time, end_time] window (resample-aligned).
            filtered = df[df["timestamp"] >= int(start_time)]
            if end_time is not None:
                filtered = filtered[filtered["timestamp"] <= int(end_time)]
            if not filtered.empty or end_time is not None:
                return filtered.reset_index(drop=True)

        # Latest-batch mode: trim to the requested count (backwards compatible).
        return df.tail(limit).reset_index(drop=True)

    async def _request_klines(self, session, endpoint, params):
        """Single GET to a Binance klines endpoint. Returns raw rows or None."""
        try:
            async with session.get(endpoint["url"], params=params, headers=KLINE_HEADERS,
                                   timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if isinstance(data, list):
                        return data
        except Exception:
            pass
        return None

    async def _fetch_klines_rows(self, session, symbol, fetch_tf, limit,
                                 start_time, end_time):
        """
        Raw kline rows with multi-endpoint failover (Futures -> Spot -> Vision).

        - start_time=None: single latest request of `limit` bars.
        - start_time set: forward pagination over [start_time, end_time];
          each chunk uses the endpoint's maximum bars per request (1500/1000),
          the cursor advances via startTime until the window is covered,
          Binance history is exhausted, or MAX_HISTORY_BASE_CANDLES is hit.
        Returns (rows, ok); ok=False when every endpoint failed.
        """
        sym = symbol.upper()
        base_ms = BASE_TF_MS.get(fetch_tf, 900_000)
        for ep in KLINE_ENDPOINTS:
            rows = []
            ok = True
            cursor = None
            chunk = min(int(limit), ep["max_limit"])
            if start_time is not None:
                chunk = ep["max_limit"]
                # One extra base bar back so a resampled group covering
                # start_time is complete; trimmed after resample.
                cursor = int(start_time) - base_ms
            while True:
                params = {"symbol": sym, "interval": fetch_tf, "limit": chunk}
                if cursor is not None:
                    params["startTime"] = cursor
                if end_time is not None:
                    params["endTime"] = int(end_time)
                data = await self._request_klines(session, ep, params)
                if data is None:
                    ok = False
                    break
                if not data:
                    break
                rows.extend(data)
                if start_time is None:
                    break
                cursor = int(data[-1][0]) + base_ms
                if len(data) < ep["max_limit"]:
                    break  # history exhausted (or window covered)
                if len(rows) >= MAX_HISTORY_BASE_CANDLES:
                    break  # safety cap
                if end_time is not None and cursor > int(end_time):
                    break  # window covered
            if ok and rows:
                return rows, True
        return [], False

    @staticmethod
    def _rows_to_dataframe(rows, resample_rule=None):
        """Raw Binance rows -> DataFrame (dedupe, sort, resample, CVD)."""
        records = []
        for k in rows:
            vol = float(k[5])
            taker_buy_vol = float(k[9])
            records.append({
                'timestamp': int(k[0]),
                'open': float(k[1]),
                'high': float(k[2]),
                'low': float(k[3]),
                'close': float(k[4]),
                'volume': vol,
                'taker_buy_base_volume': taker_buy_vol,
                'delta': taker_buy_vol - (vol - taker_buy_vol),
            })
        df = pd.DataFrame(records)
        if df.empty:
            return df
        df = df.drop_duplicates(subset='timestamp').sort_values('timestamp').reset_index(drop=True)
        if resample_rule:
            df['datetime'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('datetime', inplace=True)
            resampled = df.resample(resample_rule, closed='left', label='left').agg({
                'timestamp': 'first',
                'open': 'first',
                'high': 'max',
                'low': 'min',
                'close': 'last',
                'volume': 'sum',
                'taker_buy_base_volume': 'sum',
                'delta': 'sum'
            }).dropna()
            df = resampled.reset_index(drop=True)
        df['cvd'] = df['delta'].cumsum()
        return df
