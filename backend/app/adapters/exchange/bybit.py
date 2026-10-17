"""
Bybit Futures Exchange Adapter
Implements read-only market data retrieval for Bybit V5 Linear Futures.
Strictly read-only: no trade execution or private API keys required.
"""

import aiohttp
import pandas as pd
from typing import Dict, List, Optional, Any
from backend.app.adapters.exchange.base import BaseExchangeAdapter

BYBIT_REST_URL = "https://api.bybit.com"
BYBIT_WS_URL = "wss://stream.bybit.com/v5/public/linear"

class BybitAdapter(BaseExchangeAdapter):
    """Adapter for Bybit Linear USDT Perpetual Futures."""

    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None

    @property
    def name(self) -> str:
        return "bybit"

    def get_ws_url(self) -> str:
        return BYBIT_WS_URL

    async def get_session(self) -> aiohttp.ClientSession:
        if self.session is None or self.session.closed:
            timeout = aiohttp.ClientTimeout(total=10)
            self.session = aiohttp.ClientSession(timeout=timeout)
        return self.session

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    async def fetch_24h_tickers(self) -> Dict[str, Dict[str, Any]]:
        session = await self.get_session()
        url = f"{BYBIT_REST_URL}/v5/market/tickers"
        params = {"category": "linear"}
        try:
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    res = await resp.json()
                    tickers = {}
                    for item in res.get("result", {}).get("list", []):
                        sym = item.get("symbol", "")
                        if sym.endswith("USDT"):
                            last_price = float(item.get("lastPrice", 0) or 0)
                            turnover_24h = float(item.get("turnover24h", 0) or 0)
                            chg_24h = float(item.get("price24hPcnt", 0) or 0) * 100.0
                            tickers[sym] = {
                                "symbol": sym,
                                "last_price": last_price,
                                "price_change_pct": chg_24h,
                                "high_price": float(item.get("highPrice24h", 0) or 0),
                                "low_price": float(item.get("lowPrice24h", 0) or 0),
                                "quote_volume_24h": turnover_24h,
                                "volume_24h": float(item.get("volume24h", 0) or 0),
                            }
                    return tickers
        except Exception:
            pass
        return {}

    async def fetch_top_symbols(self, limit: int = 150) -> List[str]:
        tickers = await self.fetch_24h_tickers()
        sorted_syms = sorted(tickers.values(), key=lambda x: x["quote_volume_24h"], reverse=True)
        return [x["symbol"] for x in sorted_syms[:limit]]

    async def fetch_order_book(self, symbol: str, limit: int = 20) -> Dict[str, Any]:
        session = await self.get_session()
        url = f"{BYBIT_REST_URL}/v5/market/orderbook"
        params = {"category": "linear", "symbol": symbol.upper(), "limit": min(limit, 50)}
        try:
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    res = await resp.json()
                    b_list = res.get("result", {}).get("b", [])
                    a_list = res.get("result", {}).get("a", [])
                    return {
                        "bids": [[float(p), float(q)] for p, q in b_list],
                        "asks": [[float(p), float(q)] for p, q in a_list]
                    }
        except Exception:
            pass
        return {"bids": [], "asks": []}

    async def fetch_klines(self, symbol: str, timeframe: str = "15m", limit: int = 100) -> pd.DataFrame:
        session = await self.get_session()
        # Bybit timeframe mapping: 1m, 3m, 5m, 15m, 30m, 60m (1h), 120m, 240m (4h), D (1d)
        tf_map = {
            "1m": "1",
            "5m": "5",
            "15m": "15",
            "30m": "30",
            "45m": "15",  # Resampled
            "1h": "60",
            "4h": "240",
            "6h": "60",   # Resampled
            "1d": "D"
        }
        interval = tf_map.get(timeframe, "15")
        resample_rule = None
        req_limit = limit

        if timeframe == "45m":
            resample_rule = "45min"
            req_limit = limit * 3
        elif timeframe == "6h":
            resample_rule = "6h"
            req_limit = limit * 6

        url = f"{BYBIT_REST_URL}/v5/market/kline"
        params = {
            "category": "linear",
            "symbol": symbol.upper(),
            "interval": interval,
            "limit": min(req_limit, 200)
        }

        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                raise ValueError(f"Bybit klines error {resp.status} for {symbol}")
            res = await resp.json()
            raw_list = res.get("result", {}).get("list", [])

        # Bybit returns klines in reverse chronological order: [startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover]
        records = []
        for row in reversed(raw_list):
            records.append({
                "timestamp": int(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
                "taker_buy_base_volume": float(row[5]) * 0.5, # Bybit public kline doesn't separate taker buy in v5 kline
                "delta": 0.0
            })

        df = pd.DataFrame(records)
        if df.empty:
            return df

        if resample_rule:
            df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
            df.set_index("datetime", inplace=True)
            resampled = df.resample(resample_rule, closed="left", label="left").agg({
                "timestamp": "first",
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last",
                "volume": "sum",
                "taker_buy_base_volume": "sum",
                "delta": "sum"
            }).dropna()
            df = resampled.reset_index(drop=True)

        df["cvd"] = df["delta"].cumsum()
        return df.tail(limit).reset_index(drop=True)
