from backend.app.services.cluster_engine import ClusterEngine, TradeEvent


def test_footprint_aggregates_bid_ask_delta_by_price_step():
    result = ClusterEngine(price_step=1.0).aggregate_trades([
        TradeEvent(price=100.2, quantity=2.0, is_buyer_maker=False, timestamp=1),
        TradeEvent(price=100.7, quantity=1.0, is_buyer_maker=True, timestamp=2),
    ])
    cell = result.cells[100.0]
    assert cell.ask_volume == 2.0
    assert cell.bid_volume == 1.0
    assert cell.delta == 1.0
    assert cell.imbalance == 3.0


def test_volume_profile_returns_poc_and_70_percent_value_area():
    engine = ClusterEngine(price_step=1.0)
    snapshot = engine.aggregate_trades([
        TradeEvent(price=100, quantity=10, is_buyer_maker=False, timestamp=1),
        TradeEvent(price=101, quantity=4, is_buyer_maker=False, timestamp=2),
        TradeEvent(price=99, quantity=3, is_buyer_maker=True, timestamp=3),
    ])
    profile = engine.volume_profile(snapshot)
    assert profile.poc_price == 100.0
    assert profile.val_price <= profile.poc_price <= profile.vah_price
    assert profile.total_volume == 17.0


def test_wall_detection_uses_local_mean_and_liquidation_tiers_are_explicit():
    engine = ClusterEngine(price_step=1.0)
    walls = engine.detect_walls([(99, 1), (100, 1), (101, 40)], multiplier=3)
    assert walls[0].price == 101
    levels = engine.liquidation_levels(current_price=100.0, leverage_tiers=(25, 50, 75, 100))
    assert {level.leverage for level in levels} == {"25x", "50x", "75x", "100x"}
    assert all(level.price < 100 for level in levels if level.side == "LONG")
