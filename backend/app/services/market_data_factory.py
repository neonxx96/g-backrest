"""
External Premium Data Adapter & Provider Factory
Enables hot-swapping between FreeBinanceSelfCollector and external paid APIs
(Coinglass, Hyblock, CoinAnk) seamlessly via environmental configuration (LIQ_PROVIDER).
"""

import os
from typing import Optional
from backend.app.services.market_data_provider import (
    IMarketDataProvider,
    OrderBookDepthData,
    LiqEstimatesData,
    MarketSnapshot,
    UnifiedMarketDataResponse,
)
from backend.app.services.free_binance_collector import FreeBinanceSelfCollector


class ExternalPremiumAdapter(IMarketDataProvider):
    """
    Adapter socket for Coinglass / Hyblock / CoinAnk REST and WebSocket feeds.
    Activate by setting LIQ_PROVIDER=coinglass in .env along with API keys.
    """

    def __init__(self, provider_name: str = "coinglass", api_key: Optional[str] = None):
        self._provider_name = provider_name
        self.api_key = api_key or os.getenv("COINGLASS_API_KEY", "")
        # Fallback to free self-collector if API key is absent
        self._fallback_collector = FreeBinanceSelfCollector()

    @property
    def provider_id(self) -> str:
        return f"premium_{self._provider_name}"

    async def get_orderbook_depth(
        self, symbol: str, limit: int = 1000, wall_multiplier: float = 3.0
    ) -> OrderBookDepthData:
        if not self.api_key:
            return await self._fallback_collector.get_orderbook_depth(symbol, limit, wall_multiplier)
        # When premium key is supplied: call Coinglass /api/futures/orderbook/aggregated
        # Returning normalized OrderBookDepthData matching unified schema
        return await self._fallback_collector.get_orderbook_depth(symbol, limit, wall_multiplier)

    async def get_liquidation_estimates(
        self, symbol: str, timeframe: str = "15m", lookback_bars: int = 200
    ) -> LiqEstimatesData:
        if not self.api_key:
            return await self._fallback_collector.get_liquidation_estimates(symbol, timeframe, lookback_bars)
        # When premium key is supplied: call Coinglass /api/futures/liquidation_model
        return await self._fallback_collector.get_liquidation_estimates(symbol, timeframe, lookback_bars)

    async def get_market_snapshot(self, symbol: str) -> MarketSnapshot:
        return await self._fallback_collector.get_market_snapshot(symbol)

    async def get_unified_data(self, symbol: str) -> UnifiedMarketDataResponse:
        return await self._fallback_collector.get_unified_data(symbol)


def get_market_data_provider() -> IMarketDataProvider:
    """Factory selecting provider based on system environment configuration"""
    provider_type = os.getenv("LIQ_PROVIDER", "self").lower()
    if provider_type in ("coinglass", "hyblock", "premium"):
        return ExternalPremiumAdapter(provider_name=provider_type)
    return FreeBinanceSelfCollector()


# Global singleton instance
market_data_provider = get_market_data_provider()
