import numpy as np
import pandas as pd
import pytest

from backend.app.services.indicators.plugins.open_interest import OpenInterestIndicator
from backend.app.services.indicators.registry import IndicatorRegistry

SRS_M21_SET = {"ema", "rsi", "atr", "vwap", "cvd", "volume_spike", "oi"}


def _df_with_oi(values):
    size = len(values)
    return pd.DataFrame(
        {
            "high": [101.0] * size,
            "low": [99.0] * size,
            "close": [100.0] * size,
            "volume": [10.0] * size,
            "oi": values,
        }
    )


def test_registry_covers_full_srs_m21_set():
    registry = IndicatorRegistry()
    names = {item["name"] for item in registry.list_indicators()}

    assert SRS_M21_SET <= names


def test_oi_plugin_computes_delta_and_pct():
    indicator = OpenInterestIndicator()
    df = indicator.compute(_df_with_oi([100.0, 101.0, 102.0, 103.0, 110.0]), params={"delta_periods": 4})

    assert df["oi"].iloc[-1] == 110.0
    assert df["oi_delta"].iloc[-1] == pytest.approx(10.0)
    assert df["oi_delta_pct"].iloc[-1] == pytest.approx(10.0)


def test_oi_plugin_does_not_synthesize_missing_data():
    indicator = OpenInterestIndicator()
    df = pd.DataFrame({"high": [1.0], "low": [1.0], "close": [1.0], "volume": [1.0]})

    result = indicator.compute(df)

    assert list(result.columns) == list(df.columns)
    assert indicator.check_signal(result) is None


def test_oi_plugin_accepts_open_interest_column_name():
    indicator = OpenInterestIndicator()
    df = pd.DataFrame({"open_interest": [50.0, 55.0, 60.0, 65.0, 70.0]})

    result = indicator.compute(df, params={"delta_periods": 4})

    assert result["oi_delta_pct"].iloc[-1] == pytest.approx(40.0)


def test_oi_check_signal_buildup_and_flush():
    indicator = OpenInterestIndicator()

    buildup = indicator.check_signal(
        indicator.compute(_df_with_oi([100.0, 100.0, 100.0, 100.0, 105.0]), params={"delta_periods": 4}),
        params={"signal_threshold_pct": 1.0},
    )
    assert buildup["condition_type"] == "OI_BUILDUP"
    assert buildup["direction"] == "BULLISH"

    flush = indicator.check_signal(
        indicator.compute(_df_with_oi([100.0, 100.0, 100.0, 100.0, 95.0]), params={"delta_periods": 4}),
        params={"signal_threshold_pct": 1.0},
    )
    assert flush["condition_type"] == "OI_FLUSH"
    assert flush["direction"] == "BEARISH"


def test_oi_check_signal_none_below_threshold_or_nan():
    indicator = OpenInterestIndicator()
    flat = indicator.compute(_df_with_oi([100.0, 100.1, 100.0, 100.1, 100.0]), params={"delta_periods": 4})

    assert indicator.check_signal(flat, params={"signal_threshold_pct": 1.0}) is None
    # NaN delta (window longer than history) must never signal
    short = indicator.compute(_df_with_oi([100.0, 101.0]), params={"delta_periods": 4})
    assert indicator.check_signal(short) is None


def test_registry_computes_oi_through_compute_all():
    registry = IndicatorRegistry()
    df = registry.compute_all(_df_with_oi([100.0, 101.0, 102.0, 103.0, 110.0]), params_overrides={"oi": {"delta_periods": 4}})

    assert "oi_delta_pct" in df.columns
    assert df["oi_delta_pct"].iloc[-1] == pytest.approx(10.0)
