import json

import pandas as pd
import pytest

from backend.app.services.deep_history import (
    aggregate_footprints,
    build_footprint_1m,
)


def test_footprint_uses_agg_trades_for_poc_and_delta():
    trades = pd.DataFrame(
        [
            {"timestamp": 1_700_000_001_000, "price": 100.01, "quantity": 2.0, "is_buyer_maker": False},
            {"timestamp": 1_700_000_010_000, "price": 100.04, "quantity": 1.0, "is_buyer_maker": True},
            {"timestamp": 1_700_000_020_000, "price": 100.11, "quantity": 4.0, "is_buyer_maker": False},
        ]
    )

    footprint = build_footprint_1m(trades, tick_size=0.1)

    assert len(footprint) == 1
    row = footprint.iloc[0]
    assert row["volume_delta"] == pytest.approx(5.0)
    assert row["poc_price"] == pytest.approx(100.1)
    profile = json.loads(row["cluster_profile"])
    assert profile["100.0"]["buy_volume"] == pytest.approx(2.0)
    assert profile["100.0"]["sell_volume"] == pytest.approx(1.0)
    assert profile["100.1"]["buy_volume"] == pytest.approx(4.0)


def test_higher_timeframe_is_sum_of_minute_profiles():
    base = 1_700_000_000_000
    trades = pd.DataFrame(
        [
            {"timestamp": base + 1_000, "price": 100.0, "quantity": 2.0, "is_buyer_maker": False},
            {"timestamp": base + 61_000, "price": 100.0, "quantity": 1.0, "is_buyer_maker": True},
        ]
    )
    minute = build_footprint_1m(trades, tick_size=0.1)
    result = aggregate_footprints(minute, timeframe="5m")

    assert len(result) == 1
    assert result.iloc[0]["volume_delta"] == pytest.approx(1.0)
    assert result.iloc[0]["poc_price"] == pytest.approx(100.0)


def test_minute_buckets_do_not_depend_on_pandas_datetime_precision():
    trades = pd.DataFrame(
        [
            {"timestamp": 1_788_220_800_003, "price": 100.0, "quantity": 1.0, "is_buyer_maker": False},
            {"timestamp": 1_788_220_859_999, "price": 100.0, "quantity": 1.0, "is_buyer_maker": False},
            {"timestamp": 1_788_220_860_000, "price": 100.0, "quantity": 1.0, "is_buyer_maker": True},
        ]
    )
    result = build_footprint_1m(trades, tick_size=0.1)

    assert len(result) == 2


def test_empty_footprint_has_no_synthetic_poc():
    result = build_footprint_1m(pd.DataFrame(), tick_size=0.1)

    assert result.empty
    assert "poc_price" in result.columns
