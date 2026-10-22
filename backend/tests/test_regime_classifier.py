import pytest
import numpy as np
import pandas as pd

from backend.app.engine.regime_classifier import RegimeClassifier, MarketRegime, regime_classifier
from backend.app.engine.walk_forward_engine import WalkForwardEngine
from backend.app.services.paper_trading import PaperTradingSession


def generate_synthetic_ohlcv(
    n_bars: int = 50,
    base_price: float = 100.0,
    price_drift: float = 0.0,
    spread: float = 0.05,
    volume: float = 1000.0,
    buy_ratio: float = 0.5,
    density_val: float = 100.0
) -> pd.DataFrame:
    """Helper to generate synthetic OHLCV + Order flow data."""
    prices = base_price + price_drift * np.arange(n_bars)
    highs = prices + spread
    lows = prices - spread
    opens = prices - (spread * 0.2)
    closes = prices + (spread * 0.2)
    vols = np.full(n_bars, volume)
    taker_buys = vols * buy_ratio

    df = pd.DataFrame({
        "open": opens,
        "high": highs,
        "low": lows,
        "close": closes,
        "volume": vols,
        "taker_buy_volume": taker_buys,
        "density": np.full(n_bars, density_val)
    })
    return df


def test_regime_classifier_features_vectorized():
    classifier = RegimeClassifier(window=14)
    df = generate_synthetic_ohlcv(n_bars=40)
    features = classifier.compute_features(df)

    assert not features.empty
    assert "norm_atr" in features.columns
    assert "rel_density" in features.columns
    assert "cvd" in features.columns
    assert "cvd_slope" in features.columns
    assert "cvd_slope_norm" in features.columns
    assert len(features) == 40
    # Last rows should have non-null, valid numeric values
    assert not np.isnan(features["norm_atr"].iloc[-1])
    assert not np.isnan(features["rel_density"].iloc[-1])


def test_classify_flat_dense_regime():
    classifier = RegimeClassifier(window=15, vol_medium_threshold=0.0025, slope_threshold=0.35)
    # Tight range: spread 0.02 on price 100.0 -> ATR/Price ~ 0.0004 (< 0.0025)
    # Balanced flow: buy_ratio 0.5 -> CVD slope near 0
    # High density
    df = generate_synthetic_ohlcv(
        n_bars=50,
        base_price=100.0,
        price_drift=0.0,
        spread=0.02,
        volume=5000.0,
        buy_ratio=0.5,
        density_val=150.0
    )

    regime, metrics = classifier.classify_current(df)
    assert regime == MarketRegime.FLAT_DENSE
    assert metrics["regime"] == "FLAT_DENSE"
    assert metrics["is_trade_allowed"] is True
    assert metrics["norm_atr"] < 0.0025


def test_classify_trend_impulse_regime():
    classifier = RegimeClassifier(
        window=15,
        vol_medium_threshold=0.001,
        vol_toxic_threshold=0.05,
        density_toxic_threshold=0.5,
        slope_threshold=0.2
    )
    # Strong upward trend with active buy-side aggression
    # Close climbs 0.25 per bar, taker_buys = 90% of volume
    df = generate_synthetic_ohlcv(
        n_bars=50,
        base_price=100.0,
        price_drift=0.35,
        spread=0.15,
        volume=2000.0,
        buy_ratio=0.95,
        density_val=80.0
    )

    regime, metrics = classifier.classify_current(df)
    assert regime == MarketRegime.TREND_IMPULSE
    assert metrics["regime"] == "TREND_IMPULSE"
    assert metrics["is_trade_allowed"] is True
    assert metrics["cvd_slope_norm"] > 0.2


def test_classify_toxic_volatility_regime():
    classifier = RegimeClassifier(
        window=10,
        vol_toxic_threshold=0.015,  # 1.5%
        density_toxic_threshold=0.6   # 60% of average density
    )
    # 35 normal bars with high density, followed by 15 bars of extreme volatility spike + severe density dry-up
    normal_df = generate_synthetic_ohlcv(
        n_bars=35,
        base_price=100.0,
        spread=0.05,
        volume=2000.0,
        density_val=100.0
    )

    spike_df = generate_synthetic_ohlcv(
        n_bars=15,
        base_price=100.0,
        spread=3.5,  # Huge 7.0 bar range on 100 price (7% range)
        volume=100.0,
        density_val=10.0  # Liquidity vacuum (< 10% of 100 average)
    )

    combined_df = pd.concat([normal_df, spike_df], ignore_index=True)

    regime, metrics = classifier.classify_current(combined_df)
    assert regime == MarketRegime.TOXIC_VOLATILITY
    assert metrics["regime"] == "TOXIC_VOLATILITY"
    assert metrics["is_trade_allowed"] is False
    assert metrics["norm_atr"] > 0.015
    assert metrics["rel_density"] < 0.6


def test_walk_forward_engine_toxic_gate():
    wf = WalkForwardEngine()

    # In TOXIC_VOLATILITY, must enforce strict NO_TRADE
    allowed, reason = wf.is_trade_allowed("BTCUSDT", MarketRegime.TOXIC_VOLATILITY)
    assert allowed is False
    assert "TOXIC_VOLATILITY" in reason

    params = wf.get_adapted_parameters("BTCUSDT", MarketRegime.TOXIC_VOLATILITY)
    assert params["is_trade_allowed"] is False
    assert params["strategy_type"] == "none"

    # In FLAT_DENSE or TREND_IMPULSE, trading is allowed
    allowed_flat, _ = wf.is_trade_allowed("BTCUSDT", MarketRegime.FLAT_DENSE)
    assert allowed_flat is True
    flat_params = wf.get_adapted_parameters("BTCUSDT", MarketRegime.FLAT_DENSE)
    assert flat_params["is_trade_allowed"] is True

    allowed_trend, _ = wf.is_trade_allowed("BTCUSDT", MarketRegime.TREND_IMPULSE)
    assert allowed_trend is True
    trend_params = wf.get_adapted_parameters("BTCUSDT", MarketRegime.TREND_IMPULSE)
    assert trend_params["is_trade_allowed"] is True


def test_paper_trading_blocks_toxic_orders():
    session = PaperTradingSession(initial_balance=100.0)

    # 1. Attempt order under TOXIC_VOLATILITY
    res_toxic = session.execute_trade_signal(
        symbol="SOLUSDT",
        side="BUY",
        price=150.0,
        stop_price=145.0,
        target_price=160.0,
        reason="Breakout test",
        regime="TOXIC_VOLATILITY"
    )

    assert res_toxic["status"] == "REJECTED"
    assert "toxic_volatility_blocked" in res_toxic["reason"]
    assert len(session.orders) == 0
    assert len(session.positions) == 0
    assert session.get_state().balance == 100.0

    # 2. Same order under TREND_IMPULSE should be accepted
    res_normal = session.execute_trade_signal(
        symbol="SOLUSDT",
        side="BUY",
        price=150.0,
        stop_price=145.0,
        target_price=160.0,
        reason="Breakout test",
        regime="TREND_IMPULSE"
    )

    assert res_normal["status"] == "PENDING"
    assert len(session.orders) == 1
    assert session.get_state().balance == 100.0
