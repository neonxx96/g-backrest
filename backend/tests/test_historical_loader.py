"""
Unit and Integration Tests for HistoricalDataLoader and WalkForwardOptimizer.
Validates:
1. Parquet local caching, fast loading, and roundtrip data integrity
2. Cluster/Footprint schema presence: volume_delta, poc_price, cluster_profile, sell_volume
3. Incremental cache updating (missing head/tail chunks)
4. Train/Out-of-Sample (OOS) data splitting and anti-overfitting scoring
5. Fetching 6 months of 1h data (or simulated 6-month batch) with zero lookahead bias
"""

import os
import time
import tempfile
import pytest
import numpy as np
import pandas as pd

from backend.app.services.historical_data_loader import HistoricalDataLoader
from backend.app.engine.optimizer import (
    split_train_oos,
    generate_walk_forward_windows,
    evaluate_vectorized_signals,
    compute_institutional_score,
    WalkForwardOptimizer,
)


@pytest.fixture
def temp_history_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def synthetic_6m_1h_data():
    """Generates 6 months (180 days * 24 hours = 4320 bars) of synthetic 1h OHLCV data."""
    n_bars = 4320
    base_ts = 1704067200000  # 2024-01-01 00:00:00 UTC ms
    step_ms = 3600 * 1000

    np.random.seed(42)
    timestamps = [base_ts + i * step_ms for i in range(n_bars)]

    # Geometric random walk
    log_returns = np.random.normal(0.0001, 0.008, n_bars)
    prices = 40000.0 * np.exp(np.cumsum(log_returns))

    opens = prices
    highs = prices * (1.0 + np.abs(np.random.normal(0, 0.004, n_bars)))
    lows = prices * (1.0 - np.abs(np.random.normal(0, 0.004, n_bars)))
    closes = prices * (1.0 + np.random.normal(0, 0.003, n_bars))
    volumes = np.random.uniform(10.0, 500.0, n_bars)
    buy_vols = volumes * np.random.uniform(0.3, 0.7, n_bars)

    raw_rows = []
    for i in range(n_bars):
        raw_rows.append([
            timestamps[i],
            opens[i],
            highs[i],
            lows[i],
            closes[i],
            volumes[i],
            timestamps[i] + step_ms - 1,
            volumes[i] * closes[i],
            100,
            buy_vols[i],
            buy_vols[i] * closes[i],
            "0",
        ])

    return raw_rows


def test_schema_and_cluster_columns(synthetic_6m_1h_data):
    """Verifies that the raw_to_dataframe method creates the expected cluster & orderflow columns."""
    df = HistoricalDataLoader.raw_to_dataframe(synthetic_6m_1h_data)

    assert not df.empty
    assert len(df) == 4320

    # Required cluster columns
    required_cols = [
        "timestamp",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "taker_buy_base_volume",
        "sell_volume",
        "volume_delta",
        "poc_price",
        "cluster_profile",
    ]
    for col in required_cols:
        assert col in df.columns, f"Missing required column: {col}"

    # Footprint calculations
    assert np.all(df["sell_volume"] >= 0.0)
    expected_delta = 2.0 * df["taker_buy_base_volume"] - df["volume"]
    np.testing.assert_allclose(df["volume_delta"], expected_delta, rtol=1e-5)
    assert np.all(df["poc_price"] > 0.0)


def test_parquet_cache_save_and_fast_read(temp_history_dir, synthetic_6m_1h_data):
    """Verifies saving to Parquet with pyarrow and instant reading from disk."""
    loader = HistoricalDataLoader(storage_dir=temp_history_dir)
    df = loader.raw_to_dataframe(synthetic_6m_1h_data)

    symbol = "BTCUSDT"
    timeframe = "1h"

    # Save to Parquet
    saved_path = loader.save_cache(symbol, timeframe, df)
    assert saved_path.exists()
    assert saved_path.suffix == ".parquet"

    # Fast read from cache
    cached_df = loader.read_cache(symbol, timeframe)
    assert cached_df is not None
    assert len(cached_df) == 4320
    assert list(cached_df.columns) == list(df.columns)
    np.testing.assert_allclose(cached_df["close"], df["close"])
    np.testing.assert_array_equal(cached_df["timestamp"], df["timestamp"])


def test_incremental_cache_stitching(temp_history_dir, synthetic_6m_1h_data):
    """
    Verifies that when partial history is cached, new chunks are seamlessly
    merged, deduplicated, and persisted without look-ahead or overlap bugs.
    """
    loader = HistoricalDataLoader(storage_dir=temp_history_dir)
    full_df = loader.raw_to_dataframe(synthetic_6m_1h_data)

    # Cache only the middle section (bars 1000..3000)
    mid_df = full_df.iloc[1000:3000].copy()
    loader.save_cache("ETHUSDT", "1h", mid_df)

    cached_initial = loader.read_cache("ETHUSDT", "1h")
    assert len(cached_initial) == 2000

    # Simulate fetching older and newer chunks
    head_df = full_df.iloc[0:1050].copy()  # has overlap with mid
    tail_df = full_df.iloc[2950:4320].copy()  # has overlap with mid

    # Merge chunks
    merged = pd.concat([cached_initial, head_df, tail_df], ignore_index=True)
    loader.save_cache("ETHUSDT", "1h", merged)

    cached_updated = loader.read_cache("ETHUSDT", "1h")
    assert len(cached_updated) == 4320
    # Strict monotonically increasing timestamps
    assert cached_updated["timestamp"].is_monotonic_increasing


def test_train_oos_split_and_walk_forward(synthetic_6m_1h_data):
    """Validates In-Sample / Out-of-Sample splitting and WFA windows."""
    df = HistoricalDataLoader.raw_to_dataframe(synthetic_6m_1h_data)

    train_df, oos_df = split_train_oos(df, train_ratio=0.7)
    assert len(train_df) + len(oos_df) == len(df)
    assert len(train_df) == int(len(df) * 0.7)

    # Zero look-ahead check: train max timestamp < OOS min timestamp
    assert train_df["timestamp"].max() < oos_df["timestamp"].min()

    # Walk-forward windows
    windows = generate_walk_forward_windows(df, train_bars=1000, test_bars=300, step_bars=300)
    assert len(windows) > 5
    for train_w, test_w, idx in windows:
        assert len(train_w) == 1000
        assert len(test_w) == 300
        assert train_w["timestamp"].max() < test_w["timestamp"].min()


def test_optimizer_vectorized_scoring_and_penalties(synthetic_6m_1h_data):
    """Validates vectorized strategy evaluations and institutional penalty scoring."""
    df = HistoricalDataLoader.raw_to_dataframe(synthetic_6m_1h_data)
    optimizer = WalkForwardOptimizer(min_trades=10, max_acceptable_dd=20.0)

    # Run vectorized EMA cross
    param_grid = {
        "fast_period": [9, 12, 20],
        "slow_period": [26, 50],
    }

    results = optimizer.optimize_train_oos(
        df=df,
        param_grid=param_grid,
        strategy_type="ema_cross",
        train_ratio=0.7,
        top_k=3,
    )

    assert results["combinations_tested"] == 6
    assert results["best_candidate"] is not None
    leaderboard = results["leaderboard"]
    assert len(leaderboard) <= 3

    for item in leaderboard:
        assert "train_metrics" in item
        assert "oos_metrics" in item
        assert "verdict" in item
        assert item["verdict"] in {"ROBUST", "MODERATE", "OVERFITTED"}

        # Drawdown and Sharpe sanity
        assert item["train_metrics"]["max_drawdown_pct"] >= 0.0
        assert item["oos_metrics"]["max_drawdown_pct"] >= 0.0
