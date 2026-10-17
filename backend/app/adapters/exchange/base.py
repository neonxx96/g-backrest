"""
Base Exchange Adapter Interface
Defines read-only abstraction for crypto futures market data.
Strictly read-only: no trade execution or private API keys required.
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
import pandas as pd

class BaseExchangeAdapter(ABC):
    """Abstract interface for futures exchanges (Binance, Bybit, OKX, etc.)."""
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Returns the identifier name of the exchange, e.g. 'binance', 'bybit'."""
        pass

    @abstractmethod
    async def fetch_klines(self, symbol: str, timeframe: str = "15m", limit: int = 200) -> pd.DataFrame:
        """
        Fetches historical candlestick bars.
        Returns DataFrame with columns: ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'taker_buy_base_volume'].
        """
        pass

    @abstractmethod
    async def fetch_order_book(self, symbol: str, limit: int = 20) -> Dict[str, Any]:
        """
        Fetches L2 order book snapshot.
        Returns: {'lastUpdateId': int, 'bids': [[price, qty], ...], 'asks': [[price, qty], ...]}
        """
        pass

    @abstractmethod
    async def fetch_24h_tickers(self) -> Dict[str, Dict[str, Any]]:
        """
        Fetches 24-hour ticker statistics.
        Returns dict keyed by symbol with keys: 'last_price', 'price_change_pct', 'quote_volume_24h'.
        """
        pass

    @abstractmethod
    async def fetch_top_symbols(self, limit: int = 150) -> List[str]:
        """Fetches top active symbols ranked by 24h quote volume."""
        pass

    @abstractmethod
    def get_ws_url(self) -> str:
        """Returns base WebSocket URL for real-time streams."""
        pass
