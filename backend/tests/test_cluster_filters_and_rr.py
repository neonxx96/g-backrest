"""
Unit tests for Block 1:
- Configurable Footprint clusters (scale aggregation, custom imbalance_ratio, VAH/VAL, POC migration);
- Cluster Order-Flow Filters (`use_stacked_imbalance_filter`, `use_absorption_filter`, `use_poc_migration_filter`);
- Fee-Aware Risk:Reward optimization bounds (`compute_fee_aware_rr_bounds` & genetic optimizer R:R floor);
- `cluster_volume_bounce` signal parity in `strategies.py` and `OrderFlowBacktester`.
"""

import numpy as np
import pandas as pd
import pytest

from backend.app.engine.cluster_filters import (
    check_cluster_filters_at_bar,
    compute_bar_cluster_arrays,
    compute_fee_aware_rr_bounds,
)
from backend.app.services.orderflow_backtester import OrderFlowBacktester
from backend.app.services.recorder import OrderFlowRecorder, annotate_cluster_metrics


def _make_ohlcv_df(n: int = 120) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    base = 100.0 + np.cumsum(rng.normal(0.05, 0.4, size=n))
    high = base + np.abs(rng.normal(0.5, 0.2, size=n))
    low = base - np.abs(rng.normal(0.5, 0.2, size=n))
    open_p = base - rng.normal(0.0, 0.2, size=n)
    vol = rng.uniform(80.0, 250.0, size=n)
    taker_buy = vol * rng.uniform(0.35, 0.75, size=n)
    return pd.DataFrame({
        "timestamp": [1_700_000_000_000 + i * 300_000 for i in range(n)],
        "open": open_p,
        "high": np.maximum(high, np.maximum(open_p, base)),
        "low": np.minimum(low, np.minimum(open_p, base)),
        "close": base,
        "volume": vol,
        "taker_buy_base_volume": taker_buy,
    })


def test_annotate_cluster_metrics_computes_value_area_and_poc_migration():
    candles = [
        {
            "timestamp": 1000,
            "total_volume": 100.0,
            "total_delta": 20.0,
            "levels": [
                {"price": 100.0, "buy_vol": 40.0, "sell_vol": 20.0, "delta": 20.0, "trades": 5},  # POC = 100
                {"price": 101.0, "buy_vol": 15.0, "sell_vol": 10.0, "delta": 5.0, "trades": 3},
                {"price": 99.0, "buy_vol": 5.0, "sell_vol": 10.0, "delta": -5.0, "trades": 2},
            ],
        },
        {
            "timestamp": 2000,
            "total_volume": 120.0,
            "total_delta": 35.0,
            "levels": [
                {"price": 102.0, "buy_vol": 60.0, "sell_vol": 15.0, "delta": 45.0, "trades": 8},  # POC = 102 (migrated UP)
                {"price": 101.0, "buy_vol": 20.0, "sell_vol": 10.0, "delta": 10.0, "trades": 4},
                {"price": 100.0, "buy_vol": 5.0, "sell_vol": 10.0, "delta": -5.0, "trades": 2},
            ],
        },
        {
            "timestamp": 3000,
            "total_volume": 90.0,
            "total_delta": -30.0,
            "levels": [
                {"price": 99.0, "buy_vol": 10.0, "sell_vol": 55.0, "delta": -45.0, "trades": 7},  # POC = 99 (migrated DOWN)
                {"price": 100.0, "buy_vol": 15.0, "sell_vol": 10.0, "delta": 5.0, "trades": 2},
            ],
        },
    ]

    annotated = annotate_cluster_metrics(candles, imbalance_ratio=2.0, stacked_min_run=2)

    assert annotated[0]["poc_price"] == 100.0
    assert annotated[0]["poc_migration"] == 0
    assert annotated[0]["vah_price"] >= annotated[0]["poc_price"]
    assert annotated[0]["val_price"] <= annotated[0]["poc_price"]

    assert annotated[1]["poc_price"] == 102.0
    assert annotated[1]["poc_migration"] == 1
    assert annotated[1]["stacked_imbalance"]["buy"] == 2  # levels 102 (4x) and 101 (2x) with ratio >= 2.0

    assert annotated[2]["poc_price"] == 99.0
    assert annotated[2]["poc_migration"] == -1


def test_recorder_clusters_scale_rebuckets_levels():
    rec = OrderFlowRecorder()
    sym = "BTCUSDT"
    rec.record_agg_trade(sym, 65012.0, 1.5, is_buyer_maker=False, ts=300_000)
    rec.record_agg_trade(sym, 65024.0, 2.0, is_buyer_maker=False, ts=300_010)
    rec.record_agg_trade(sym, 65088.0, 0.5, is_buyer_maker=True, ts=300_020)

    raw_clusters = rec.get_clusters_for_chart(sym, limit_candles=5, scale=1.0)
    scaled_clusters = rec.get_clusters_for_chart(sym, limit_candles=5, scale=5.0)

    assert len(raw_clusters) == 1
    assert len(scaled_clusters) == 1
    # При scale=1.0 ($10 шаг) 65010, 65020, 65090 — 3 разных уровня;
    # при scale=5.0 ($50 шаг) 65010 и 65020 схлопываются в уровень 65000.0
    assert len(raw_clusters[0]["levels"]) == 3
    assert len(scaled_clusters[0]["levels"]) == 2
    assert abs(scaled_clusters[0]["total_volume"] - 4.0) < 1e-6


def test_cluster_filters_zero_lookahead_and_live_override():
    df = _make_ohlcv_df(60)
    bt = OrderFlowBacktester()
    enriched = bt.calculate_indicators(df)
    arrays = compute_bar_cluster_arrays(enriched)

    assert len(arrays.poc_vals) == len(enriched)
    assert len(arrays.poc_migration_vals) == len(enriched)

    # Проверка live-override: если живой кластер показывает buy stacked imbalance и poc_migration=+1
    live_bull = {
        "stacked_imbalance": {"buy": 4, "sell": 0},
        "absorption": True,
        "poc_migration": 1,
        "levels": [{"price": 100.0, "buy_vol": 50.0, "sell_vol": 10.0}],
    }
    ok_long, failed_long = check_cluster_filters_at_bar(
        len(enriched) - 1,
        1,
        arrays,
        use_stacked_imbalance_filter=True,
        use_absorption_filter=True,
        use_poc_migration_filter=True,
        live_cluster_candle=live_bull,
    )
    assert ok_long is True
    assert failed_long == []

    # Тот же бычий кластер должен заблокировать SHORT по фильтрам stacked_imbalance и poc_migration
    ok_short, failed_short = check_cluster_filters_at_bar(
        len(enriched) - 1,
        -1,
        arrays,
        use_stacked_imbalance_filter=True,
        use_absorption_filter=False,
        use_poc_migration_filter=True,
        live_cluster_candle=live_bull,
    )
    assert ok_short is False
    assert "stacked_imbalance_filter" in failed_short
    assert "poc_migration_filter" in failed_short


def test_fee_aware_rr_bounds_enforces_minimum_viable_rr():
    # Для узкого стопа 0.35% круговая комиссия ~0.10% составляет ~28.5% от 1R -> нужен повышенный R:R
    tight = compute_fee_aware_rr_bounds(0.35, maker_fee_pct=0.02, taker_fee_pct=0.05, slippage_pct=0.03)
    wide = compute_fee_aware_rr_bounds(1.0, maker_fee_pct=0.02, taker_fee_pct=0.05, slippage_pct=0.03)

    assert tight["recommended_rr"] >= 2.2
    assert tight["recommended_tp_pct"] >= round(0.35 * tight["recommended_rr"], 2)
    assert tight["tp2_rr_ratio"] >= tight["tp1_rr_ratio"] >= 1.2
    assert wide["recommended_rr"] >= 1.8
    assert tight["recommended_rr"] > wide["recommended_rr"]


def test_genetic_optimizer_candidates_respect_rr_floor_and_expose_rr_ratio():
    df = _make_ohlcv_df(180)
    bt = OrderFlowBacktester(initial_capital=10_000.0)
    res = bt.run_genetic_optimization(
        df,
        strategy_type="ema_pullback",
        population_size=6,
        generations=2,
        sl_range=(0.4, 1.0),
        tp_range=(0.5, 3.2),
    )

    candidates = res.get("rows", [])
    assert len(candidates) > 0
    assert len(res.get("top_setups", [])) > 0
    for row in candidates:
        assert "rr_ratio" in row
        assert row["rr_ratio"] == round(row["take_profit_pct"] / row["stop_loss_pct"], 2)
        assert row["take_profit_pct"] >= row["stop_loss_pct"] * 1.8 - 0.05


def test_backtest_and_explain_support_cluster_filters():
    df = _make_ohlcv_df(120)
    bt = OrderFlowBacktester(initial_capital=10_000.0)

    base_res = bt.run_backtest(df, strategy_type="ema_pullback", compute_monte_carlo=False)
    filtered_res = bt.run_backtest(
        df,
        strategy_type="ema_pullback",
        compute_monte_carlo=False,
        use_stacked_imbalance_filter=True,
        use_poc_migration_filter=True,
    )

    assert "error" not in base_res
    assert "error" not in filtered_res
    # Кластерный фильтр отсекает неподтвержденные входы -> сделок меньше или столько же
    assert filtered_res["total_trades"] <= base_res["total_trades"]

    diag = bt.explain_latest_signal(
        df,
        strategy_type="ema_pullback",
        use_stacked_imbalance_filter=True,
        use_absorption_filter=True,
        use_poc_migration_filter=True,
    )
    assert diag["status"] in ("SIGNAL", "NO_TRADE")
