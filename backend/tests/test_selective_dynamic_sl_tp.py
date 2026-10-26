"""Unit tests for Block 2: Selective Dynamic SL/TP (ATR Cone & Liquidity Magnet Hybrid)
and Block 1.4: Klines Clock-Skew Resilience."""

import asyncio
import numpy as np
import pandas as pd

from backend.app.engine.dynamic_sl_tp import (
    compute_dynamic_sl_tp_levels,
    recommend_pair_sl_tp_mode,
)
from backend.app.services.orderflow_backtester import OrderFlowBacktester


def test_recommend_pair_sl_tp_mode_majors_vs_volatile_alts():
    """Deep-book Tier 1 majors default to magnet_hybrid (when wall density is valid),
    while volatile altcoins default to atr_cone."""
    assert recommend_pair_sl_tp_mode("BTCUSDT")["recommended_mode"] == "magnet_hybrid"
    assert recommend_pair_sl_tp_mode("ETHUSDT")["recommended_mode"] == "magnet_hybrid"
    assert recommend_pair_sl_tp_mode("SOLUSDT")["recommended_mode"] == "atr_cone"
    assert recommend_pair_sl_tp_mode("DOGEUSDT")["recommended_mode"] == "atr_cone"
    assert recommend_pair_sl_tp_mode("PEPEUSDT")["recommended_mode"] == "atr_cone"


def test_recommend_pair_sl_tp_mode_downgrades_spoofed_walls():
    """Even on BTCUSDT, if wall_volume_usd is below the spoofing threshold, magnet_hybrid
    downgrades to atr_cone."""
    mode = recommend_pair_sl_tp_mode(
        "BTCUSDT",
        wall_volume_usd=50_000.0,
        min_density_usd=500_000.0,
    )
    assert mode["recommended_mode"] == "atr_cone"

    valid_mode = recommend_pair_sl_tp_mode(
        "BTCUSDT",
        wall_volume_usd=750_000.0,
        min_density_usd=500_000.0,
    )
    assert valid_mode["recommended_mode"] == "magnet_hybrid"


def test_compute_dynamic_sl_tp_levels_atr_cone():
    """ATR Cone scales SL and TP dynamically with current ATR and enforces Fee-Aware R:R."""
    res = compute_dynamic_sl_tp_levels(
        symbol="SOLUSDT",
        side="LONG",
        entry_price=150.0,
        sl_pct=0.8,
        tp_pct=1.6,
        atr=1.8,  # 1.2% of price
        sl_tp_mode="atr_cone",
        atr_multiplier=1.35,
    )
    assert res["applied_mode"] == "atr_cone"
    assert res["magnet_veto"] is False
    assert res["sl_price"] < 150.0
    assert res["tp1_price"] > 150.0
    assert res["tp2_price"] >= res["tp1_price"]
    assert res["expected_rr"] >= 1.8


def test_compute_dynamic_sl_tp_levels_magnet_hybrid_frontruns_walls_and_vetoes_close_wall():
    """Magnet Hybrid places SL behind support wall and TP in front of resistance wall,
    and vetoes entry when an opposing wall blocks profit at < 1.2R."""
    # Case 1: Valid resistance wall at +2.2% and support wall at -0.7%
    res = compute_dynamic_sl_tp_levels(
        symbol="BTCUSDT",
        side="LONG",
        entry_price=60000.0,
        sl_pct=0.8,
        tp_pct=2.0,
        atr=420.0,
        sl_tp_mode="magnet_hybrid",
        nearest_support_wall_price=59580.0,
        nearest_support_wall_usd=1_200_000.0,
        nearest_resistance_wall_price=61320.0,
        nearest_resistance_wall_usd=1_500_000.0,
        min_density_usd=500_000.0,
    )
    assert res["applied_mode"] == "magnet_hybrid"
    assert res["magnet_veto"] is False
    # SL should be tucked behind support wall (59580 - 3 ticks)
    assert res["sl_price"] < 59580.0
    # TP2 should front-run resistance wall (61320 - 3 ticks)
    assert res["tp2_price"] < 61320.0

    # Case 2: Opposing resistance wall sits right above entry (< 1.2R away) -> magnet_veto
    veto_res = compute_dynamic_sl_tp_levels(
        symbol="BTCUSDT",
        side="LONG",
        entry_price=60000.0,
        sl_pct=0.8,
        tp_pct=2.0,
        atr=420.0,
        sl_tp_mode="magnet_hybrid",
        nearest_support_wall_price=59500.0,
        nearest_support_wall_usd=1_200_000.0,
        nearest_resistance_wall_price=60250.0,  # Only ~0.5R away!
        nearest_resistance_wall_usd=1_800_000.0,
        min_density_usd=500_000.0,
    )
    assert veto_res["magnet_veto"] is True


def test_backtester_supports_all_selective_sl_tp_modes():
    """OrderFlowBacktester.run_backtest runs cleanly across fixed, atr_cone, magnet_hybrid,
    and auto_calibrated modes without look-ahead bias."""
    n = 160
    rng = np.random.default_rng(42)
    base = 100.0 + np.cumsum(rng.normal(0.05, 0.45, n))
    df = pd.DataFrame(
        {
            "timestamp": [1700000000000 + i * 900_000 for i in range(n)],
            "open": base,
            "high": base + rng.uniform(0.3, 1.1, n),
            "low": base - rng.uniform(0.3, 1.1, n),
            "close": base + rng.normal(0.02, 0.25, n),
            "volume": rng.uniform(1000, 5000, n),
        }
    )
    bt = OrderFlowBacktester(initial_capital=10000.0)
    for mode in ("fixed", "atr_cone", "magnet_hybrid", "auto_calibrated"):
        out = bt.run_backtest(
            df,
            symbol="SOLUSDT" if mode != "magnet_hybrid" else "BTCUSDT",
            strategy_type="confluence_ema",
            stop_loss_pct=0.8,
            take_profit_pct=2.0,
            sl_tp_mode=mode,
            atr_multiplier=1.35,
            use_atr_filter=False,
            use_cvd_filter=False,
            use_rsi_filter=False,
            compute_monte_carlo=False,
        )
        assert "total_trades" in out
        assert out["sl_tp_mode"] in ("fixed", "atr_cone", "magnet_hybrid")
        assert out["execution_config"]["sl_tp_mode"] in ("fixed", "atr_cone", "magnet_hybrid")


def _drive_pure_coro(coro):
    """Drive an async coroutine whose awaits are all pure/mocked without creating an OS socket event loop."""
    try:
        coro.send(None)
    except StopIteration as stop:
        return stop.value
    raise RuntimeError("Coroutine yielded an unmocked future")


def test_binance_fetch_klines_clock_skew_fallback(monkeypatch):
    """If local PC clock is ahead of exchange time and startTime returns empty rows,
    BinanceAdapter.fetch_klines automatically retries with start_time=None."""
    from backend.app.adapters.exchange.binance import BinanceAdapter

    adapter = BinanceAdapter()
    calls = []

    async def fake_get_session():
        return object()

    async def fake_fetch_klines_rows(session, symbol, fetch_tf, limit, start_time, end_time):
        calls.append({"limit": limit, "start_time": start_time, "end_time": end_time})
        if start_time is not None:
            return [], True
        return [
            [1700000000000, "60000", "60100", "59900", "60050", "120.5", 1700000299999, "7200000", 500, "65.0"]
        ], True

    monkeypatch.setattr(adapter, "get_session", fake_get_session)
    monkeypatch.setattr(adapter, "_fetch_klines_rows", fake_fetch_klines_rows)
    df = _drive_pure_coro(adapter.fetch_klines("BTCUSDT", "5m", limit=100, start_time=1999999999000))
    assert len(calls) == 2
    assert calls[0]["start_time"] == 1999999999000
    assert calls[1]["start_time"] is None
    assert len(df) == 1
    assert float(df.iloc[0]["close"]) == 60050.0
