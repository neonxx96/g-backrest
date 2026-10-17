"""
Binance Futures Exchange Adapter
Implements read-only market data retrieval for Binance USDT-M Futures.
"""

import aiohttp
import pandas as pd
from typing import Dict, List, Optional, Any
from backend.app.adapters.exchange.base import BaseExchangeAdapter
from backend.app.config import BINANCE_API_KEY

BINANCE_FUTURES_REST = "https://fapi.binance.com"
BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws"

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
        if self.session is None or self.session.closed:
            headers = {}
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
        url = f"{BINANCE_FUTURES_REST}/fapi/v1/depth"
        params = {'symbol': symbol.upper(), 'limit': limit}
        try:
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    return await resp.json()
        except Exception:
            pass
        return {'bids': [], 'asks': []}

    async def fetch_klines(self, symbol: str, timeframe: str = "15m", limit: int = 100) -> pd.DataFrame:
        session = await self.get_session()
        fetch_tf = timeframe
        resample_rule = None
        req_limit = limit

        if timeframe == "45m":
            fetch_tf = "15m"
            resample_rule = "45min"
            req_limit = limit * 3
        elif timeframe == "6h":
            fetch_tf = "1h"
            resample_rule = "6h"
            req_limit = limit * 6

        url = f"{BINANCE_FUTURES_REST}/fapi/v1/klines"
        params = {'symbol': symbol.upper(), 'interval': fetch_tf, 'limit': min(req_limit, 500)}

        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                raise ValueError(f"Binance klines error {resp.status} for {symbol}")
            data = await resp.json()

        records = []
        for k in data:
            open_time = int(k[0])
            open_p = float(k[1])
            high_p = float(k[2])
            low_p = float(k[3])
            close_p = float(k[4])
            vol = float(k[5])
            taker_buy_vol = float(k[9])
            delta = taker_buy_vol - (vol - taker_buy_vol)

            records.append({
                'timestamp': open_time,
                'open': open_p,
                'high': high_p,
                'low': low_p,
                'close': close_p,
                'volume': vol,
                'taker_buy_base_volume': taker_buy_vol,
                'delta': delta
            })

        df = pd.DataFrame(records)
        if df.empty:
            return df

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
        return df.tail(limit).reset_index(drop=True)
