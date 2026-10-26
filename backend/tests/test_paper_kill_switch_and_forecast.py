"""
Unit tests for Paper Trading Kill Switch, Safety Pipeline, and Probabilistic Forecast.

Validates:
1. Kill Switch activation:
   - Sets is_halted=True, cancels pending orders, and closes open positions at market.
   - Subsequent signals/orders are strictly rejected while HALTED.
2. Resume functionality:
   - Re-enables order placement and unhalts session.
3. Order validation & geometry safeguards:
   - Rejects non-positive price/SL/TP.
   - Rejects inverted Long/Short geometry (e.g. SL > Entry for Long).
4. Probabilistic Forecast API:
   - Returns base scenario, ±1σ and ±2σ bands, horizon (16 bars), anchor price and timestamp.
   - Produces a valid UnifiedTradeSignal.
   - Rejects insufficient data (< 60 bars) with status 400.
"""

import asyncio
from unittest.mock import patch
import pytest
import pandas as pd

from backend.app.services.paper_trading import PaperTradingSession, PaperPosition, PaperOrderRole
from backend.app.services.orderflow_backtester import OrderFlowBacktester
from backend.app.routers.ai_copilot import compute_probabilistic_forecast, build_forecast_signal, classify_forecast_regime
from fastapi import HTTPException


# ==============================================================================
# 1. KILL SWITCH & SAFETY PIPELINE TESTS
# ==============================================================================
def test_kill_switch_closes_positions_and_cancels_orders():
    """
    Proves that triggering the Kill Switch immediately:
    - Sets is_halted to True with recorded reason.
    - Cancels any active unfilled orders.
    - Closes active positions at market price with Taker fee.
    """
    session = PaperTradingSession(initial_balance=100.0)

    # Setup an active position directly
    session.last_prices["BTCUSDT"] = 50000.0
    session.positions["BTCUSDT"] = PaperPosition(
        symbol="BTCUSDT",
        side="LONG",
        qty=0.001,
        avg_entry_price=50000.0,
        stop_price=49000.0,
        target_price=52000.0,
        reason="Manual Entry",
    )
    session.locked_margin = 50.0
    session.available_margin = 50.0

    # Also add an unfilled pending order
    unfilled_order = session.place_order(
        symbol="ETHUSDT",
        side="BUY",
        order_type="LIMIT",
        price=3000.0,
        quantity=0.01,
        role=PaperOrderRole.ENTRY.value,
        reason="Pending Order",
    )
    unfilled_id = unfilled_order["order_id"]

    # Trigger Kill Switch
    res = session.kill_switch(reason="Overnight risk limit breached")

    assert res["status"] == "HALTED"
    assert session.is_halted is True
    assert session.halt_reason == "Overnight risk limit breached"
    assert session.halt_ts is not None

    # Verify positions closed
    assert session.positions["BTCUSDT"].closed is True
    assert session.positions["BTCUSDT"].qty == 0.0
    assert len(session.closed_trades) == 1
    assert "KILL_SWITCH" in session.closed_trades[0]["reason"]

    # Verify pending order cancelled
    assert session.orders[unfilled_id].sim.state.status.value == "CANCELLED"


def test_kill_switch_rejects_subsequent_orders_until_resumed():
    """
    Proves that while the system is HALTED, all new signals and entry orders are rejected.
    """
    session = PaperTradingSession(initial_balance=100.0)
    session.kill_switch(reason="Emergency Stop")

    # Attempting to execute a trade signal must return REJECTED status
    res = session.execute_trade_signal(
        symbol="BTCUSDT",
        side="BUY",
        price=50000.0,
        stop_price=49000.0,
        target_price=52000.0,
        reason="Signal during halt",
    )
    assert res["status"] == "REJECTED"
    assert "System HALTED" in res["reason"]

    # Attempting direct place_order entry must raise ValueError
    with pytest.raises(ValueError, match="System is HALTED"):
        session.place_order(
            symbol="BTCUSDT",
            side="BUY",
            order_type="LIMIT",
            price=50000.0,
            quantity=0.001,
            role=PaperOrderRole.ENTRY.value,
        )

    # Resume trading
    res_resume = session.resume(reason="Operator cleared halt")
    assert res_resume["status"] == "ACTIVE"
    assert session.is_halted is False
    assert session.halt_reason is None

    # Now signal is accepted
    res_after = session.execute_trade_signal(
        symbol="BTCUSDT",
        side="BUY",
        price=50000.0,
        stop_price=49000.0,
        target_price=52000.0,
        reason="Signal after resume",
    )
    assert res_after.get("status") != "REJECTED"


def test_trade_geometry_safeguards():
    """
    Proves strict validation of entry/SL/TP geometry:
    - Long requires stop_price < price < target_price.
    - Short requires target_price < price < stop_price.
    - Positive prices required.
    """
    session = PaperTradingSession(initial_balance=100.0)

    # 1. Negative or zero price
    res1 = session.execute_trade_signal("BTCUSDT", "BUY", price=0.0, stop_price=49000.0, target_price=52000.0)
    assert res1["status"] == "REJECTED"
    assert res1["reason"] == "invalid_entry_sl_tp"

    # 2. Inverted Long geometry (SL above Entry)
    res2 = session.execute_trade_signal("BTCUSDT", "BUY", price=50000.0, stop_price=51000.0, target_price=52000.0)
    assert res2["status"] == "REJECTED"
    assert res2["reason"] == "invalid_long_geometry"

    # 3. Inverted Long geometry (TP below Entry)
    res3 = session.execute_trade_signal("BTCUSDT", "BUY", price=50000.0, stop_price=49000.0, target_price=48000.0)
    assert res3["status"] == "REJECTED"
    assert res3["reason"] == "invalid_long_geometry"

    # 4. Inverted Short geometry (SL below Entry)
    res4 = session.execute_trade_signal("BTCUSDT", "SELL", price=50000.0, stop_price=49000.0, target_price=48000.0)
    assert res4["status"] == "REJECTED"
    assert res4["reason"] == "invalid_short_geometry"


# ==============================================================================
# 2. PROBABILISTIC FORECAST TESTS
# ==============================================================================
def test_probabilistic_forecast_output_contract():
    """
    Proves that compute_probabilistic_forecast returns:
    - Base scenario with direction, bias, and drift.
    - Anchor price and timestamp matching last bar.
    - Expected move cone with 16 fan points containing ±1σ and ±2σ.
    - Valid UnifiedTradeSignal.
    """
    base_ts = 1700000000000
    rows = []
    for i in range(70):
        osc = 0.5 if i % 2 == 0 else -0.5
        rows.append({
            "timestamp": base_ts + i * 900000,
            "open": 50000.0 + osc,
            "high": 50100.0 + osc,
            "low": 49900.0 + osc,
            "close": 50000.0 + osc,
            "volume": 1000.0,
            "taker_buy_volume": 520.0,
        })
    df_mock = pd.DataFrame(rows)

    with patch("backend.app.services.ai_copilot_service.fetch_history", return_value=df_mock):
        res = asyncio.run(compute_probabilistic_forecast("BTCUSDT", "15m", horizon_bars=16))

    assert res["status"] == "success"
    assert res["symbol"] == "BTCUSDT"
    assert res["timeframe"] == "15m"
    assert res["is_probabilistic_forecast"] is True
    assert "anchor_price" in res
    assert res["anchor_price"] > 0
    assert res["anchor_timestamp"] == int(df_mock["timestamp"].iloc[-1])
    assert res["horizon_bars"] == 16
    assert "bands" in res and len(res["bands"]) == 16

    cone = res["expected_move_cone"]
    assert cone["bars_forward"] == 16
    assert len(cone["fan_points"]) == 16

    # Verify probability bands order: lower_2s < lower_1s < price_mid < upper_1s < upper_2s
    first_pt = cone["fan_points"][0]
    assert first_pt["lower_2s"] < first_pt["lower_1s"] <= first_pt["price_mid"] <= first_pt["upper_1s"] < first_pt["upper_2s"]

    # A forecast must not manufacture an order when the selected strategy has
    # no valid latest-candle setup. The cone remains available for context.
    assert res["base_scenario"]["direction"] == "NO_TRADE"
    assert res["unified_signal"] is None
    assert res["decision_diagnostic"]["status"] == "NO_TRADE"
    assert isinstance(res["decision_diagnostic"]["failed_checks"], list)
    assert res["base_scenario"]["reason"].startswith("NO_TRADE:")


def test_probabilistic_forecast_rejects_insufficient_bars():
    """
    Proves that if historical candles count < 60, forecast raises HTTPException(400).
    """
    df_short = pd.DataFrame([{"timestamp": 1, "open": 1, "high": 2, "low": 0.5, "close": 1, "volume": 100}])
    with patch("backend.app.services.ai_copilot_service.fetch_history", return_value=df_short):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(compute_probabilistic_forecast("BTCUSDT", "15m", horizon_bars=16))
        assert exc_info.value.status_code == 400
        assert "минимум 60 свечей" in exc_info.value.detail


def test_forecast_signal_parameters_preserve_leverage_and_risk():
    signal = build_forecast_signal(
        symbol="BTCUSDT",
        timeframe="15m",
        timestamp=1700000000000,
        direction="LONG",
        entry_price=50000.0,
        sl=49600.0,
        tp1=50600.0,
        tp2=50800.0,
        leverage=3.0,
        risk_per_trade_pct=0.75,
        expected_rr=2.0,
        confidence=0.72,
        reason="EMA/CVD confirmation",
        strategy_type="confluence_ema",
    )

    assert signal.leverage == 3.0
    assert signal.risk_pct == 0.0075


def test_forecast_regime_contract_exposes_classifier_label_and_metrics():
    rows = [
        {
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.0,
            "volume": 1000.0,
        }
        for _ in range(10)
    ]

    regime, metrics = classify_forecast_regime(pd.DataFrame(rows))

    assert regime == "FLAT_DENSE"
    assert metrics["regime"] == regime
    assert metrics["is_trade_allowed"] is True
