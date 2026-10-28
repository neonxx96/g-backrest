import pytest
from backend.app.services.market_data_provider import (
    OrderBookDepthData,
    OrderBookLevel,
    DepthDeltaSummary,
    LiqEstimatesData,
    LiqLevelEstimate,
    MarketSnapshot,
    UnifiedMarketDataResponse,
)
from backend.app.services.quant_engine import QuantEngine, quant_engine


def make_mock_unified_data(delta_pct: float = 20.0, price: float = 80000.0) -> UnifiedMarketDataResponse:
    snap = MarketSnapshot(
        symbol="BTCUSDT",
        timestamp=1700000000000,
        price=price,
        change_24h_pct=2.5,
        high_24h=82000.0,
        low_24h=79000.0,
        volume_24h_usd=25000000000.0,
        open_interest_usd=1500000000.0,
        funding_rate=0.0001,
        cvd_value=1200.5,
    )
    bids = [
        OrderBookLevel(price=79500.0, size=50.0, total=50.0, is_wall=True, wall_ratio=3.5),
        OrderBookLevel(price=79000.0, size=30.0, total=80.0, is_wall=False, wall_ratio=1.2),
    ]
    asks = [
        OrderBookLevel(price=80500.0, size=15.0, total=15.0, is_wall=False, wall_ratio=1.0),
        OrderBookLevel(price=81000.0, size=45.0, total=60.0, is_wall=True, wall_ratio=3.1),
    ]
    deltas = {
        "2.5%": DepthDeltaSummary(
            range_pct=2.5,
            bids_vol=40000000.0,
            asks_vol=20000000.0,
            delta_vol=20000000.0,
            delta_pct=delta_pct,
        ),
        "10%": DepthDeltaSummary(
            range_pct=10.0,
            bids_vol=90000000.0,
            asks_vol=60000000.0,
            delta_vol=30000000.0,
            delta_pct=20.0,
        ),
    }
    depth = OrderBookDepthData(
        symbol="BTCUSDT",
        timestamp=1700000000000,
        source="spot_collector",
        mid_price=price,
        bids=bids,
        asks=asks,
        walls=[bids[0], asks[1]],
        depth_deltas=deltas,
    )
    shorts = [
        LiqLevelEstimate(
            price=82500.0,
            pct_from_price=3.12,
            amount_usd=15000000.0,
            amount_str="$15.00M",
            intensity=0.9,
            leverage="25x",
            side="SHORT",
            is_max=True,
        )
    ]
    longs = [
        LiqLevelEstimate(
            price=78000.0,
            pct_from_price=-2.5,
            amount_usd=8000000.0,
            amount_str="$8.00M",
            intensity=0.5,
            leverage="50x",
            side="LONG",
            is_max=True,
        )
    ]
    liqs = LiqEstimatesData(
        symbol="BTCUSDT",
        timestamp=1700000000000,
        provider="FreeBinanceSelfCollector",
        is_synthetic=True,
        disclaimer="ESTIMATED (MODEL)",
        current_price=price,
        biggest_short=shorts[0],
        biggest_long=longs[0],
        shorts_above_usd=15000000.0,
        longs_below_usd=8000000.0,
        shorts_above=shorts,
        longs_below=longs,
        leverage_breakdown={"25x": {"shorts": 15000000.0, "longs": 0.0}, "50x": {"shorts": 0.0, "longs": 8000000.0}},
    )
    return UnifiedMarketDataResponse(snapshot=snap, orderbook_depth=depth, liq_estimates=liqs)


def test_core3_math_bullish_evaluation():
    data = make_mock_unified_data(delta_pct=25.0, price=80000.0)
    report = quant_engine.evaluate_core3_math(data)
    assert report.depth_bias == "BULLISH_SUPPORT"
    assert report.depth_delta_skew_pct == 25.0
    assert report.strongest_liq_magnet == "SHORTS_ABOVE"
    assert report.suggested_entry == 80000.0
    assert report.suggested_take_profit == 82500.0
    # Stop loss should be protected by bid wall at 79500
    assert report.suggested_stop_loss < 79500.0
    assert report.risk_reward_ratio >= 2.0
    assert report.verdict == "READY_FOR_PAPER"


def test_core3_math_veto_toxic_skew():
    data = make_mock_unified_data(delta_pct=1.0, price=80000.0)
    report = quant_engine.evaluate_core3_math(data)
    assert report.depth_bias == "BALANCED"
    assert "VETO" in report.verdict


def test_core3_vetoes_incomplete_market_snapshot_even_when_depth_looks_tradeable():
    data = make_mock_unified_data(delta_pct=25.0, price=80000.0)
    data.snapshot.data_status = "partial"
    data.snapshot.unavailable_fields = ["open_interest_usd"]

    report = quant_engine.evaluate_core3_math(data)

    assert report.verdict == "VETO_DATA_UNAVAILABLE"
    assert any("open_interest_usd" in reason for reason in report.verdict_reasons)


def test_build_snapshot_prompt_and_quarantine():
    data = make_mock_unified_data(delta_pct=20.0, price=80000.0)
    c3 = quant_engine.evaluate_core3_math(data)
    prompt = quant_engine.build_snapshot_prompt(data, c3)
    assert "INSTITUTIONAL QUANT SNAPSHOT: BTCUSDT" in prompt.markdown_prompt
    assert "SPOT ORDER BOOK DEPTH" in prompt.markdown_prompt
    assert prompt.json_snapshot["symbol"] == "BTCUSDT"

    # Test Quarantine save and list
    record = quant_engine.save_to_quarantine(data, c3)
    assert record.symbol == "BTCUSDT"
    assert record.entry_price == 80000.0
    assert record.status == "PENDING"

    records = quant_engine.list_quarantine_records()
    assert len(records) > 0
    assert records[0]["symbol"] == "BTCUSDT"
