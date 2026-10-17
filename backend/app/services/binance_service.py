"""
Binance Futures Service (REST + WebSocket)
Handles 24h tickers, Open Interest, Liquidations stream, and OHLCV klines with CVD.
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import aiohttp
import pandas as pd
import websockets
from sqlalchemy import select, func

from backend.app.config import BINANCE_API_KEY
from backend.app.db.database import AsyncSessionLocal
from backend.app.db.models import LiquidationEvent

logger = logging.getLogger(__name__)

BINANCE_FUTURES_REST = "https://fapi.binance.com"
BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws"

class BinanceService:
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.top_symbols: List[str] = []
        self.oi_cache: Dict[str, Dict[str, Any]] = {}
        self.is_ws_running = False

    async def get_session(self) -> aiohttp.ClientSession:
        if self.session is None or self.session.closed:
            headers = {}
            if BINANCE_API_KEY:
                headers["X-MBX-APIKEY"] = BINANCE_API_KEY
            timeout = aiohttp.ClientTimeout(total=10)
            self.session = aiohttp.ClientSession(headers=headers, timeout=timeout)
        return self.session

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    # --- 1. 24h Tickers & Top Symbols ---
    async def fetch_24h_tickers(self) -> Dict[str, Dict[str, Any]]:
        """
        Fetches 24h stats for all USDT-M perpetual contracts.
        Returns a dict keyed by symbol.
        """
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
                    # Update top 150 by 24h USDT volume
                    sorted_syms = sorted(tickers.values(), key=lambda x: x['quote_volume_24h'], reverse=True)
                    self.top_symbols = [x['symbol'] for x in sorted_syms[:150]]
                    return tickers
                else:
                    logger.error(f"Binance 24hr ticker error: {resp.status}")
        except Exception as e:
            logger.error(f"Failed to fetch 24h tickers: {e}")
        return {}

    # --- 2. Open Interest & 24h Change ---
    async def fetch_open_interest_24h_change(self, symbol: str) -> float:
        """
        Calculates 24h Open Interest change % using /fapi/v1/openInterestHist or live cache.
        """
        session = await self.get_session()
        url = f"{BINANCE_FUTURES_REST}/fapi/v1/openInterestHist"
        params = {'symbol': symbol, 'period': '1h', 'limit': 24}
        try:
            async with session.get(url, params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if len(data) >= 2:
                        first_oi = float(data[0]['sumOpenInterest'])
                        last_oi = float(data[-1]['sumOpenInterest'])
                        if first_oi > 0:
                            return round(((last_oi - first_oi) / first_oi) * 100.0, 2)
        except Exception:
            pass
        return 0.0

    # --- 3. Liquidations (24h Sum from SQLite) ---
    async def get_24h_liquidations_sum(self, symbol: str) -> float:
        """
        Sums recorded liquidation USD amount for the last 24h from SQLite.
        """
        cutoff = datetime.utcnow() - timedelta(hours=24)
        try:
            async with AsyncSessionLocal() as db:
                stmt = select(func.sum(LiquidationEvent.usd_amount)).where(
                    LiquidationEvent.symbol == symbol,
                    LiquidationEvent.timestamp >= cutoff
                )
                res = await db.execute(stmt)
                val = res.scalar()
                return float(val) if val is not None else 0.0
        except Exception as e:
            logger.error(f"Error querying liquidations for {symbol}: {e}")
            return 0.0

    # --- 4. Klines & Custom Timeframes (with CVD) ---
    async def fetch_klines(self, symbol: str, timeframe: str = "15m", limit: int = 100) -> pd.DataFrame:
        """
        Fetches OHLCV klines with taker buy volume, calculates CVD, and resamples 45m / 6h if needed.
        """
        session = await self.get_session()
        
        # Mapping custom timeframes
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
        params = {'symbol': symbol, 'interval': fetch_tf, 'limit': min(req_limit, 500)}

        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                raise ValueError(f"Binance klines error {resp.status} for {symbol}")
            data = await resp.json()

        # Parse kline columns
        records = []
        for k in data:
            open_time = int(k[0])
            open_p = float(k[1])
            high_p = float(k[2])
            low_p = float(k[3])
            close_p = float(k[4])
            vol = float(k[5])
            taker_buy_vol = float(k[9])
            
            # Exact candle delta = taker_buy - taker_sell
            # taker_sell = vol - taker_buy  => delta = 2*taker_buy - vol
            delta = (2.0 * taker_buy_vol) - vol

            records.append({
                'timestamp': open_time,
                'datetime': pd.to_datetime(open_time, unit='ms'),
                'open': open_p,
                'high': high_p,
                'low': low_p,
                'close': close_p,
                'volume': vol,
                'taker_buy_volume': taker_buy_vol,
                'delta': delta
            })

        df = pd.DataFrame(records)
        if df.empty:
            return df
            
        df.set_index('datetime', inplace=True)
        df.sort_index(inplace=True)

        # Resample if 45m or 6h
        if resample_rule:
            resampled = pd.DataFrame()
            resampled['open'] = df['open'].resample(resample_rule).first()
            resampled['high'] = df['high'].resample(resample_rule).max()
            resampled['low'] = df['low'].resample(resample_rule).min()
            resampled['close'] = df['close'].resample(resample_rule).last()
            resampled['volume'] = df['volume'].resample(resample_rule).sum()
            resampled['taker_buy_volume'] = df['taker_buy_volume'].resample(resample_rule).sum()
            resampled['delta'] = df['delta'].resample(resample_rule).sum()
            resampled.dropna(subset=['close'], inplace=True)
            resampled['timestamp'] = resampled.index.astype('int64') // 10**6
            df = resampled

        # Cumulative Volume Delta (CVD)
        df['cvd'] = df['delta'].cumsum()
        return df.tail(limit)

    # --- 5. WebSocket Liquidations Listener ---
    async def start_liquidation_listener(self):
        """
        Connects to Binance live liquidation stream: !forceOrder@arr
        Stores events into SQLite. Reconnects on errors.
        """
        ws_url = f"{BINANCE_FUTURES_WS}/!forceOrder@arr"
        self.is_ws_running = True
        logger.info(f"Connecting to Binance liquidation WS: {ws_url}")

        while self.is_ws_running:
            try:
                async with websockets.connect(ws_url, ping_interval=20, ping_timeout=10) as ws:
                    logger.info("Connected to Binance Liquidation WebSocket.")
                    while self.is_ws_running:
                        msg = await ws.recv()
                        data = json.loads(msg)
                        order = data.get('o', {})
                        if order:
                            sym = order.get('s')
                            side = order.get('S')
                            p = float(order.get('p', 0))
                            q = float(order.get('q', 0))
                            usd = p * q
                            
                            # Write to DB
                            async with AsyncSessionLocal() as db:
                                evt = LiquidationEvent(
                                    symbol=sym,
                                    side=side,
                                    price=p,
                                    quantity=q,
                                    usd_amount=usd,
                                    timestamp=datetime.utcnow()
                                )
                                db.add(evt)
                                await db.commit()
            except Exception as e:
                logger.warning(f"Liquidation WebSocket disconnected: {e}. Reconnecting in 5s...")
                await asyncio.sleep(5)

binance_service = BinanceService()
