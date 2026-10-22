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
from backend.app.adapters.exchange import BinanceAdapter

logger = logging.getLogger(__name__)

BINANCE_FUTURES_REST = "https://fapi.binance.com"
BINANCE_FUTURES_WS = "wss://fstream.binance.com/ws"

class BinanceService:
    def __init__(self):
        self.adapter = BinanceAdapter(api_key=BINANCE_API_KEY)
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
        """Fetches 24h stats for all USDT-M contracts via adapter."""
        tickers = await self.adapter.fetch_24h_tickers()
        if tickers:
            sorted_syms = sorted(tickers.values(), key=lambda x: x['quote_volume_24h'], reverse=True)
            self.top_symbols = [x['symbol'] for x in sorted_syms[:150]]
        return tickers

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

    # --- 3b. Order Book Depth ---
    async def fetch_order_book(self, symbol: str, limit: int = 20) -> Dict[str, Any]:
        """Fetches Level 2 depth snapshot for orderbook via adapter."""
        return await self.adapter.fetch_order_book(symbol=symbol, limit=limit)

    # --- 4. Klines & Custom Timeframes (with CVD) ---
    async def fetch_klines(self, symbol: str, timeframe: str = "15m", limit: int = 100,
                           start_time: Optional[int] = None,
                           end_time: Optional[int] = None) -> pd.DataFrame:
        """
        Fetches OHLCV klines with CVD and resampled timeframes via adapter.
        With start_time set -> paginated deep history over [start_time, end_time].
        """
        return await self.adapter.fetch_klines(
            symbol=symbol, timeframe=timeframe, limit=limit,
            start_time=start_time, end_time=end_time,
        )


    # --- 5. WebSocket Liquidations Listener ---
    async def start_liquidation_listener(self):
        """
        Connects to Binance live liquidation stream: !forceOrder@arr
        Stores events into SQLite. Reconnects on errors.
        """
        ws_url = f"{BINANCE_FUTURES_WS}/!forceOrder@arr"
        self.is_ws_running = True
        logger.info(f"Connecting to Binance liquidation WS: {ws_url}")

        reconnect_attempts = 0
        while self.is_ws_running:
            try:
                async with websockets.connect(ws_url, ping_interval=20, ping_timeout=10) as ws:
                    logger.info("Connected to Binance Liquidation WebSocket.")
                    reconnect_attempts = 0  # Reset on successful connection
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
            except asyncio.CancelledError:
                break
            except Exception as e:
                delay = min(60.0, 2.0 * (2 ** reconnect_attempts))
                logger.warning(
                    f"[WARNING] Liquidation WebSocket disconnected: {e}. "
                    f"Reconnecting in {delay:.1f}s (retry={reconnect_attempts + 1})...",
                    exc_info=True
                )
                reconnect_attempts += 1
                await asyncio.sleep(delay)

binance_service = BinanceService()
