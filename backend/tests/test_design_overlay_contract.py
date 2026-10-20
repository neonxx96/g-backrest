from backend.app.services.design_contracts import build_design_overlay
from backend.app.services.market_data_provider import (
    DepthDeltaSummary,
    LiqEstimatesData,
    LiqLevelEstimate,
    OrderBookDepthData,
    OrderBookLevel,
)


def test_design_overlay_matches_canvas_contracts():
    depth = OrderBookDepthData(
        symbol="BTCUSDT",
        timestamp=1,
        mid_price=100.0,
        bids=[OrderBookLevel(price=99.0, size=2.0, total=198.0, is_wall=True, wall_ratio=3.2)],
        asks=[OrderBookLevel(price=101.0, size=1.0, total=101.0, is_wall=False, wall_ratio=1.0)],
        walls=[OrderBookLevel(price=99.0, size=2.0, total=198.0, is_wall=True, wall_ratio=3.2)],
        depth_deltas={
            "2.5%": DepthDeltaSummary(range_pct=2.5, bids_vol=5, asks_vol=3, delta_vol=2, delta_pct=25),
            "5%": DepthDeltaSummary(range_pct=5, bids_vol=5, asks_vol=4, delta_vol=1, delta_pct=11),
        },
    )
    liqs = LiqEstimatesData(
        symbol="BTCUSDT", timestamp=1, provider="test", current_price=100.0,
        biggest_short=LiqLevelEstimate(price=103, pct_from_price=3, amount_usd=1000, amount_str="$1k", intensity=0.8, leverage="25x", side="SHORT"),
        biggest_long=LiqLevelEstimate(price=97, pct_from_price=-3, amount_usd=800, amount_str="$800", intensity=0.5, leverage="50x", side="LONG"),
        shorts_above_usd=1000, longs_below_usd=800, shorts_above=[], longs_below=[],
        leverage_breakdown={"25x": {"shorts": 1000, "longs": 0}},
    )

    overlay = build_design_overlay(depth, liqs)
    assert overlay.liq_levels[0].leverage == "25x"
    assert overlay.depth_walls[0].side == "bid"
    assert overlay.depth_walls[0].total_usd == 198.0
    assert overlay.depth_deltas.delta_2_5_pct == 25.0
