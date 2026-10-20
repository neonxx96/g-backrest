"""Stable backend payloads consumed by the design overlay components."""

from typing import List, Literal
from pydantic import BaseModel, Field

from backend.app.services.market_data_provider import LiqEstimatesData, OrderBookDepthData


class DesignLiqLevel(BaseModel):
    price: float
    volume_usd: float
    leverage: Literal["25x", "50x", "75x", "100x"]
    intensity: float = Field(ge=0.0, le=1.0)


class DesignDepthWall(BaseModel):
    price: float
    amount: float
    total_usd: float
    side: Literal["bid", "ask"]
    multiplier: float


class DesignDepthDeltas(BaseModel):
    delta_2_5_pct: float = 0.0
    delta_5_0_pct: float = 0.0
    delta_10_0_pct: float = 0.0
    delta_25_0_pct: float = 0.0


class DesignOverlayPayload(BaseModel):
    symbol: str
    timestamp: int
    liq_levels: List[DesignLiqLevel]
    depth_walls: List[DesignDepthWall]
    depth_deltas: DesignDepthDeltas


def build_design_overlay(depth: OrderBookDepthData, liqs: LiqEstimatesData) -> DesignOverlayPayload:
    levels = [*liqs.shorts_above, *liqs.longs_below]
    if not levels:
        levels = [x for x in (liqs.biggest_short, liqs.biggest_long) if x is not None]
    walls = [
        DesignDepthWall(
            price=wall.price,
            amount=wall.size,
            total_usd=wall.total,
            side="bid" if wall.price < depth.mid_price else "ask",
            multiplier=wall.wall_ratio,
        )
        for wall in depth.walls
    ]
    deltas = depth.depth_deltas
    def delta(name: str) -> float:
        value = deltas.get(name)
        return float(value.delta_pct) if value else 0.0

    return DesignOverlayPayload(
        symbol=depth.symbol,
        timestamp=max(depth.timestamp, liqs.timestamp),
        liq_levels=[DesignLiqLevel(price=x.price, volume_usd=x.amount_usd, leverage=x.leverage, intensity=x.intensity) for x in levels],
        depth_walls=walls,
        depth_deltas=DesignDepthDeltas(
            delta_2_5_pct=delta("2.5%"),
            delta_5_0_pct=delta("5%"),
            delta_10_0_pct=delta("10%"),
            delta_25_0_pct=delta("25%"),
        ),
    )
