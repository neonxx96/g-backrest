"""Tests for TPO / Volume Profile service (SRS M1.2a, roadmap phase 4.1).

Covers the truth-first contract: no recorded aggTrades -> poc_price and all
value-area bounds are None (JSON null), never synthesized.
"""

import pandas as pd
import pytest

from backend.app.services.tpo_profile import (
    build_tpo_profile,
    infer_tick_size,
    list_recorded_dates,
    load_recorded_trades,
)

MIN = 60_000


def _trades(rows):
    return pd.DataFrame(rows, columns=["timestamp", "price", "quantity", "is_taker_buy"])


@pytest.fixture
def classic_session():
    """Three 30-min periods; TPO and volume distributions deliberately diverge:
    TPO is concentrated at 100 (touched in all 3 periods), volume POC is 102
    (one 10-lot sell print)."""
    return _trades([
        (0 * MIN, 100.0, 1.0, True),
        (1 * MIN, 100.0, 1.0, False),
        (2 * MIN, 101.0, 1.0, True),
        (30 * MIN, 100.0, 1.0, True),
        (31 * MIN, 102.0, 10.0, False),
        (60 * MIN, 100.0, 1.0, True),
    ])


def test_tpo_counts_periods_touched_per_bucket(classic_session):
    profile = build_tpo_profile(classic_session, symbol="btcusdt", date="2026-10-22",
                                tick_size=1.0, period_minutes=30)

    counts = {r.price: r.tpo_count for r in profile.rows}
    assert counts == {100.0: 3, 101.0: 1, 102.0: 1}
    assert profile.total_tpo == 5
    assert profile.data_available is True
    assert profile.symbol == "BTCUSDT"


def test_tpoc_tvah_tval_classic_expansion(classic_session):
    profile = build_tpo_profile(classic_session, tick_size=1.0, period_minutes=30)

    # TPOC = 100 (count 3); target = 5*0.7 = 3.5 -> add 101 (count 1) => 80% covered.
    assert profile.tpoc_price == 100.0
    assert profile.tval_price == 100.0
    assert profile.tvah_price == 101.0
    covered = sum(r.tpo_count for r in profile.rows if r.tpo_in_value_area)
    assert covered >= 0.70 * profile.total_tpo


def test_volume_poc_and_value_area_differ_from_tpo(classic_session):
    profile = build_tpo_profile(classic_session, tick_size=1.0, period_minutes=30)

    # Volume POC = 102 (10 lots); VA target = 15*0.7 = 10.5 -> 102 (10) + 101 (1) = 73%.
    assert profile.poc_price == 102.0
    assert profile.poc_price != profile.tpoc_price
    assert profile.vah_price == 102.0
    assert profile.val_price == 101.0
    assert profile.total_volume == pytest.approx(15.0)


def test_empty_trades_return_null_profile_contract():
    profile = build_tpo_profile(pd.DataFrame(), symbol="ETHUSDT", date="2026-10-22")

    assert profile.data_available is False
    assert profile.poc_price is None
    assert profile.tpoc_price is None
    assert profile.vah_price is None
    assert profile.val_price is None
    assert profile.tvah_price is None
    assert profile.tval_price is None
    assert profile.rows == []
    assert profile.total_tpo == 0
    # JSON-сериализация даёт null, не 0.0
    assert profile.to_dict()["poc_price"] is None


def test_invalid_and_nan_rows_do_not_synthesize_profile():
    dirty = _trades([
        (0, float("nan"), 1.0, True),
        (MIN, 100.0, 0.0, True),      # нулевой объём
        (2 * MIN, -5.0, 1.0, False),  # отрицательная цена
    ])
    profile = build_tpo_profile(dirty)

    assert profile.data_available is False
    assert profile.poc_price is None


def test_validation_rejects_bad_params(classic_session):
    with pytest.raises(ValueError):
        build_tpo_profile(classic_session, tick_size=0)
    with pytest.raises(ValueError):
        build_tpo_profile(classic_session, period_minutes=0)
    with pytest.raises(ValueError):
        build_tpo_profile(classic_session, value_area_fraction=1.5)


def test_infer_tick_size_picks_round_bucket():
    prices = pd.Series([100.0, 150.0, 200.0])
    assert infer_tick_size(prices, target_rows=200) == 0.5
    assert infer_tick_size(pd.Series([100.0, 100.0]), target_rows=200) > 0
    assert infer_tick_size(pd.Series([], dtype=float)) == 1.0


def test_load_recorded_trades_roundtrip(tmp_path):
    sym_dir = tmp_path / "BTCUSDT"
    sym_dir.mkdir(parents=True)
    df = _trades([(0, 100.0, 1.0, True)])
    df.to_parquet(sym_dir / "trades_2026-10-22.parquet")

    loaded = load_recorded_trades(tmp_path, "btcusdt", "2026-10-22")
    assert loaded is not None and len(loaded) == 1
    assert load_recorded_trades(tmp_path, "btcusdt", "2026-10-23") is None
    assert list_recorded_dates(tmp_path, "BTCUSDT") == ["2026-10-22"]
    assert list_recorded_dates(tmp_path, "NOPE") == []
