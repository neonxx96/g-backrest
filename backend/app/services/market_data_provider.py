"""
Market Data Provider: Unified Schema and Abstract Adapter Interface
Defines the standard data structure for Orderbook Depth, Liquidation Estimates,
and Market Snapshots, allowing interchangeable data backends (Free Binance, Coinglass, Hyblock, etc.)
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any, Literal
from pydantic import BaseModel, Field


class OrderBookLevel(BaseModel):
    price: float
    size: float
    total: float
    is_wall: bool = False
    wall_ratio: float = 1.0


class DepthDeltaSummary(BaseModel):
    range_pct: float
    bids_vol: float
    asks_vol: float
    delta_vol: float
    delta_pct: float  # (bids - asks) / (bids + asks) * 100


class OrderBookDepthData(BaseModel):
    symbol: str
    timestamp: int
    source: Literal["spot_collector", "futures_collector", "coinglass", "hyblock"] = "spot_collector"
    mid_price: float
    bids: List[OrderBookLevel]
    asks: List[OrderBookLevel]
    walls: List[OrderBookLevel]
    depth_deltas: Dict[str, DepthDeltaSummary]  # "2.5%", "5%", "10%", "25%"


class LiqLevelEstimate(BaseModel):
    price: float
    pct_from_price: float
    amount_usd: float
    amount_str: str
    intensity: float = Field(ge=0.0, le=1.0)
    leverage: str  # "25x", "50x", "75x", "100x"
    side: Literal["SHORT", "LONG"]
    is_max: bool = False


class LiqEstimatesData(BaseModel):
    symbol: str
    timestamp: int
    provider: str
    is_synthetic: bool = True
    disclaimer: str = "ESTIMATED (MODEL) - Calculated cascade pool levels, not order book orders"
    current_price: float
    biggest_short: Optional[LiqLevelEstimate] = None
    biggest_long: Optional[LiqLevelEstimate] = None
    shorts_above_usd: float
    longs_below_usd: float
    shorts_above: List[LiqLevelEstimate]
    longs_below: List[LiqLevelEstimate]
    leverage_breakdown: Dict[str, Dict[str, float]]  # "25x": {"shorts": X, "longs": Y}


class MarketSnapshot(BaseModel):
    schema_version: Literal[1] = 1
    symbol: str
    timestamp: int
    observed_at: int = 0
    source: str = "binance_futures_rest"
    data_status: Literal["available", "partial", "unavailable"] = "available"
    unavailable_fields: List[str] = Field(default_factory=list)
    closed_candles_only: bool = True
    closed_candle_count: int = 0
    price: float
    change_24h_pct: float
    high_24h: float
    low_24h: float
    volume_24h_usd: float
    open_interest_usd: float
    funding_rate: float
    cvd_value: float


class UnifiedMarketDataResponse(BaseModel):
    snapshot: MarketSnapshot
    orderbook_depth: OrderBookDepthData
    liq_estimates: LiqEstimatesData


class IMarketDataProvider(ABC):
    """Abstract interface for all Market Data Providers (self-collected or paid APIs)"""

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """e.g. 'self_binance', 'coinglass', 'hyblock'"""
        pass

    @abstractmethod
    async def get_orderbook_depth(
        self, symbol: str, limit: int = 1000, wall_multiplier: float = 3.0
    ) -> OrderBookDepthData:
        """Fetch spot/real order book and compute walls + depth deltas"""
        pass

    @abstractmethod
    async def get_liquidation_estimates(
        self, symbol: str, timeframe: str = "15m", lookback_bars: int = 200
    ) -> LiqEstimatesData:
        """Fetch or calculate synthetic/real liquidation pool map"""
        pass

    @abstractmethod
    async def get_market_snapshot(self, symbol: str) -> MarketSnapshot:
        """Fetch funding, OI, 24h ticker, CVD snapshot"""
        pass

    @abstractmethod
    async def get_unified_data(self, symbol: str) -> UnifiedMarketDataResponse:
        """Aggregated one-shot unified data bundle for UI rendering"""
        pass
