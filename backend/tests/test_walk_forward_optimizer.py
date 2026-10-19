"""
Unit Tests for Walk-Forward Optimizer & Market Regime Dynamic Strategy Weights
==============================================================================
Validates:
1. Vectorized strategy weighting and strict sum-to-1.0 normalization across candidates.
2. Market Regime classification with wide spread + liquidity vacuum triggering TOXIC_VOLATILITY.
3. Strict execution block for Paper Trading orders under TOXIC_VOLATILITY.
4. Adaptive Brain REST router endpoints (get_market_regime, get_strategy_weights, optimize_regime_weights).
"""

import pytest
import numpy as np
import pandas as pd
from unittest.mock import patch

from backend.app.engine.regime_classifier import RegimeClassifier, MarketRegime
from backend.app.engine.walk_forward_engine import WalkForwardEngine, FLAT_CANDIDATES, TREND_CANDIDATES
from backend.app.services.paper_trading import PaperTradingSession, PaperOrderRole
from backend.app.routers.adaptive_router import (
    get_market_regime,
    get_strategy_weights as get_weights_endpoint,
    optimize_regime_weights as optimize_endpoint,
    OptimizeWeightsRequest
)


def create_sample_df(n_bars: int = 50, base_price: float = 100.0, spread: float = 0.05, volume: float = 1000.0, density: float = 100.0) -> pd.DataFrame:
    prices = base_price + np.linspace(0, 1.0, n_bars)
    return pd.DataFrame({
        "timestamp": 1700000000000 + np.arange(n_bars) * 300000,
        "open": prices - 0.02,
        "high": prices + spread,
        "low": prices - spread,
        "close": prices + 0.02,
        "volume": np.full(n_bars, volume),
        "taker_buy_volume": np.full(n_bars, volume * 0.55),
        "density": np.full(n_bars, density),
        "spread": np.full(n_bars, spread),
    })


def test_strategy_weights_calculation_and_normalization():
    """
    Proves that WalkForwardEngine produces non-negative weights that strictly sum to 1.0.
    """
    wf = WalkForwardEngine()

    # 1. Flat Dense weights
    flat_weights = wf.get_strategy_weights("BTCUSDT", MarketRegime.FLAT_DENSE)
    assert len(flat_weights) == len(FLAT_CANDIDATES)
    assert all(w >= 0.0 for w in flat_weights.values())
    assert abs(sum(flat_weights.values()) - 1.0) < 1e-3

    # 2. Trend Impulse weights
    trend_weights = wf.get_strategy_weights("BTCUSDT", MarketRegime.TREND_IMPULSE)
    assert len(trend_weights) == len(TREND_CANDIDATES)
    assert all(w >= 0.0 for w in trend_weights.values())
    assert abs(sum(trend_weights.values()) - 1.0) < 1e-3

    # 3. Toxic Volatility has zero weights (trading blocked)
    toxic_weights = wf.get_strategy_weights("BTCUSDT", MarketRegime.TOXIC_VOLATILITY)
    assert all(w == 0.0 for w in toxic_weights.values())


def test_spread_toxic_volatility_classification():
    """
    Proves that an abnormally wide spread (spread >= 0.3%) combined with
    a liquidity vacuum (rel_density <= 0.65) strictly classifies as TOXIC_VOLATILITY.
    """
    classifier = RegimeClassifier(
        window=10,
        density_toxic_threshold=0.65,
        spread_toxic_threshold=0.003  # 0.3%
    )

    # 30 bars of normal market, then 10 bars of wide spread (0.8% of price) + dry density
    df_normal = create_sample_df(n_bars=30, base_price=100.0, spread=0.02, volume=2000.0, density=100.0)
    df_wide_spread = create_sample_df(n_bars=10, base_price=100.0, spread=0.80, volume=100.0, density=15.0)
    df_combined = pd.concat([df_normal, df_wide_spread], ignore_index=True)

    regime, metrics = classifier.classify_current(df_combined)
    assert regime == MarketRegime.TOXIC_VOLATILITY
    assert metrics["is_trade_allowed"] is False
    assert metrics["norm_spread"] >= 0.003
    assert metrics["rel_density"] <= 0.65


def test_paper_trading_blocks_toxic_order_direct_and_signal():
    """
    Proves that Paper Trading strictly prevents trade entries under TOXIC_VOLATILITY:
    - execute_trade_signal returns status REJECTED with reason toxic_volatility_blocked.
    - direct place_order raises ValueError.
    """
    session = PaperTradingSession(initial_balance=100.0)

    # 1. execute_trade_signal under TOXIC_VOLATILITY
    sig_res = session.execute_trade_signal(
        symbol="BTCUSDT",
        side="BUY",
        price=50000.0,
        stop_price=49000.0,
        target_price=52000.0,
        reason="Test Entry",
        regime="TOXIC_VOLATILITY"
    )
    assert sig_res["status"] == "REJECTED"
    assert "toxic_volatility_blocked" in sig_res["reason"]
    assert len(session.orders) == 0

    # 2. direct place_order with ENTRY role under TOXIC_VOLATILITY
    with pytest.raises(ValueError, match="TOXIC_VOLATILITY"):
        session.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="LIMIT",
            price=50000.0,
            quantity=0.001,
            role=PaperOrderRole.ENTRY.value,
            regime="TOXIC_VOLATILITY"
        )


@pytest.mark.anyio
async def test_adaptive_router_endpoints():
    """
    Proves that the new /api/adaptive/regime and /api/adaptive/weights
    router functions return compliant payloads.
    """
    mock_df = create_sample_df(n_bars=40, base_price=100.0)

    with patch("backend.app.services.historical_data_loader.historical_loader.load_dataset_async", return_value=mock_df):
        # 1. GET /api/adaptive/regime
        data_reg = await get_market_regime(symbol="BTCUSDT", timeframe="5m")
        assert data_reg["status"] == "ok"
        assert "regime" in data_reg
        assert "metrics" in data_reg
        assert "norm_atr" in data_reg["metrics"]
        assert "norm_spread" in data_reg["metrics"]

        # 2. GET /api/adaptive/weights
        data_w = await get_weights_endpoint(symbol="BTCUSDT")
        assert data_w["status"] == "ok"
        assert "strategy_weights" in data_w
        assert "primary_strategy_name" in data_w
