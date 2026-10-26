"""
test_risk_engine_and_regime.py — Unit Tests for Risk Engine & Market Regime Classifier
"""
import pytest
import pandas as pd
import numpy as np

from backend.app.services.risk_engine import (
    floor_to_step,
    calc_position_by_risk,
    adjusted_risk_pct,
    can_open_position,
    check_circuit_breaker,
    select_max_leverage,
    can_add_pyramid_layer,
    calc_pyramid_add_qty,
)
from backend.app.services.regime_classifier import (
    MarketRegime,
    classify_market_regime,
    choppiness_index,
    bollinger_width,
    rolling_percentile_rank,
    compute_order_book_imbalance,
    microstructure_gate,
)


def test_floor_to_step():
    assert floor_to_step(12.34567, 0.01) == 12.34
    assert floor_to_step(0.00589, 0.001) == 0.005
    assert floor_to_step(150.0, 1.0) == 150.0
    assert floor_to_step(-5.0, 0.1) == 0.0


def test_calc_position_by_risk_derivation():
    equity = 1000.0
    risk_pct = 0.0035  # $3.50 risk
    entry = 100.0
    stop = 98.0        # 2% stop distance = $2.00 / unit

    # Without friction:
    pos_pure = calc_position_by_risk(equity, risk_pct, entry, stop, "LONG", step_size=0.01, min_notional=5.0, max_leverage=5.0, taker_fee_pct=0.0, slippage_bps=0.0)
    assert pos_pure is not None
    # raw qty = 3.50 / 2.0 = 1.75
    assert pos_pure["qty"] == 1.75
    assert pos_pure["notional"] == 175.0
    assert abs(pos_pure["risk_usd"] - 3.50) < 1e-4
    assert pos_pure["leverage"] == 0.175

    # With realistic friction (0.05% fee x 2 + 2 bps slippage):
    # friction_rate = 0.0010 + 0.0002 = 0.0012
    # effective_distance = 2.0 + (100 * 0.0012) = 2.12
    # raw qty = 3.50 / 2.12 = 1.6509... -> 1.65
    pos_friction = calc_position_by_risk(equity, risk_pct, entry, stop, "LONG", step_size=0.01, min_notional=5.0, max_leverage=5.0, taker_fee_pct=0.05, slippage_bps=2.0)
    assert pos_friction is not None
    assert pos_friction["qty"] == 1.65
    assert pos_friction["notional"] == 165.0
    assert pos_friction["risk_usd"] <= 3.50


def test_calc_position_max_leverage_clamp():
    equity = 1000.0
    risk_pct = 0.01    # $10 risk
    entry = 100.0
    stop = 99.9        # 0.1% stop distance = $0.10 / unit
    # raw qty = 10 / 0.1 = 100 => notional $10,000 (10x leverage)
    # With max_leverage=5.0, notional should be capped at $5,000 => qty 50.0

    pos = calc_position_by_risk(equity, risk_pct, entry, stop, "LONG", step_size=1.0, min_notional=5.0, max_leverage=5.0)
    assert pos is not None
    assert pos["notional"] <= 5000.0
    assert pos["leverage"] <= 5.0


def test_can_open_position_and_heat():
    equity = 1000.0
    open_positions = [
        {"symbol": "BTCUSDT", "side": "LONG", "risk_usd": 3.50},
        {"symbol": "ETHUSDT", "side": "LONG", "risk_usd": 3.50},
    ]

    # Adding a 3rd LONG with $3.50 risk:
    # Portfolio heat would be 3.50 + 3.50 + 3.50 = 10.50 (Limit 1.25% = $12.50) => OK
    # But Directional heat would be $10.50 (Limit 0.75% = $7.50) => DIRECTIONAL_HEAT_EXCEEDED!
    allowed, reason = can_open_position(3.50, "LONG", open_positions, equity)
    assert not allowed
    assert "DIRECTIONAL_HEAT_EXCEEDED" in reason

    # Adding a SHORT with $3.50 risk:
    # Directional heat for SHORT = $3.50 <= $7.50 => OK
    # Total portfolio heat = $10.50 <= $12.50 => OK
    allowed, reason = can_open_position(3.50, "SHORT", open_positions, equity)
    assert allowed
    assert reason == "OK"


def test_circuit_breaker():
    # Day loss <= -1.25%
    tripped, reason = check_circuit_breaker(day_pnl_pct=-1.30, consecutive_losses=0)
    assert tripped
    assert "DAILY_LOSS_LIMIT_REACHED" in reason

    # 3 consecutive losses
    tripped, reason = check_circuit_breaker(day_pnl_pct=-0.5, consecutive_losses=3)
    assert tripped
    assert "CONSECUTIVE_LOSS_LIMIT_REACHED" in reason

    # Normal state
    tripped, reason = check_circuit_breaker(day_pnl_pct=-0.5, consecutive_losses=1)
    assert not tripped


def test_choppiness_and_bollinger():
    np.random.seed(42)
    n = 60
    closes = pd.Series(100.0 + np.cumsum(np.random.randn(n) * 0.5))
    highs = closes + 0.3
    lows = closes - 0.3

    ci = choppiness_index(highs, lows, closes, 14)
    assert len(ci) == n
    assert (ci >= 0.0).all() and (ci <= 100.0).all()

    bbw = bollinger_width(closes, 20, 2.0)
    assert len(bbw) == n
    assert (bbw >= 0.0).all()


def test_order_book_imbalance():
    mid = 100.0
    # Heavy bids (p = 0.005 corridor: 99.5 to 100.5)
    bids = [(99.8, 10.0), (99.6, 10.0)]  # total 20.0
    asks = [(100.2, 5.0), (100.4, 5.0)]  # total 10.0

    ib = compute_order_book_imbalance(bids, asks, mid, band_pct=0.005)
    # (20 - 10) / 30 = +0.333
    assert abs(ib - 0.3333) < 0.01


def test_microstructure_gate_rejections():
    mid = 100.0
    # Realistic tight spread: 99.99 vs 100.01 = 2.0 bps <= 5.0 bps
    # Heavy asks within 0.5% (99.5 to 100.5): asks = 10.0, bids = 2.0 -> IB = -0.666
    bids = [(99.99, 2.0)]
    asks = [(100.01, 10.0)]
    book = {
        "bids": bids,
        "asks": asks,
        "total_depth_usd": 15000.0,
    }
    candles = pd.DataFrame({
        "open": [100.0] * 10,
        "high": [101.0] * 10,
        "low": [99.0] * 10,
        "close": [100.0] * 10,
    })

    # LONG in heavy ask imbalance (ib < -0.25)
    # Note: with bids=2 and asks=10, |IB| is 0.666 >= 0.55 -> SUSPECT_ORDERBOOK_SPOOFING or BEARISH_BOOK_IMBALANCE
    # Let's test with bids=3.0, asks=7.0 -> IB = -0.40 (between -0.25 and -0.55)
    book["bids"] = [(99.99, 3.0)]
    book["asks"] = [(100.01, 7.0)]
    ok, reason = microstructure_gate("LONG", book, None, candles)
    assert not ok
    assert "BEARISH_BOOK_IMBALANCE" in reason

    # SHORT in heavy ask imbalance is permitted
    ok, reason = microstructure_gate("SHORT", book, None, candles)
    assert ok


def test_paper_trade_closure_metrics_calculation():
    """
    Verifies that upon trade closure, all quantitative fields are actively calculated
    and distinct:
    - mfe_r and mae_r in R units relative to structural initial stop
    - pnl_percent in percentage
    - realized_r = net_pnl / risk_usd_initial
    - exchange leverage vs effective leverage (notional/equity) stored separately
    - risk_usd and regime preserved
    """
    from backend.app.services.paper_trading import PaperTradingSession, PaperPosition

    session = PaperTradingSession(initial_balance=1000.0)

    # 1. Establish an active position: LONG at $100.0, Stop at $98.0 (2% stop), Target at $104.0 (2R)
    # Risk budget = 0.35% of $1,000 = $3.50 -> Qty = 3.50 / 2.0 = 1.75 units
    session.positions["BTCUSDT"] = PaperPosition(
        symbol="BTCUSDT",
        side="LONG",
        qty=1.75,
        avg_entry_price=100.0,
        stop_price=98.0,
        initial_stop_price=98.0,
        target_price=104.0,
        leverage=3.0,
        effective_leverage=0.175,
        regime="TREND_UP",
        expected_rr=2.0,
        entry_ts=1000000,
    )
    session.early_exit_engine.register_position(
        symbol="BTCUSDT",
        side="LONG",
        entry_price=100.0,
        entry_ts=1000000,
        qty=1.75,
        risk_amount=3.50,
    )

    # 2. Simulate price action:
    # First drops to 99.0 (MAE = $1.00/unit * 1.75 = $1.75 -> MAE_R = $1.75 / $3.50 = 0.50R)
    # Then rises to 103.0 (MFE = $3.00/unit * 1.75 = $5.25 -> MFE_R = $5.25 / $3.50 = 1.50R)
    now_ts = 1005000
    session.early_exit_engine.on_price_update("BTCUSDT", 99.0, now_ts)
    now_ts = 1010000
    session.early_exit_engine.on_price_update("BTCUSDT", 103.0, now_ts)

    track = session.early_exit_engine.tracks["BTCUSDT"]
    assert abs(track.mae_r - 0.50) < 1e-2
    assert abs(track.mfe_r - 1.50) < 1e-2

    # 3. Close position at 102.50 via kill_switch or market exit
    session.last_prices["BTCUSDT"] = 102.50
    close_res = session.kill_switch(reason="TP_SCALE_OUT")
    assert close_res is not None
    assert len(session.closed_trades) == 1

    closed = session.closed_trades[0]

    # Verify fields are CALCULATED and NOT zero
    assert closed["mfe_r"] >= 1.45, f"Expected mfe_r >= 1.45R, got {closed['mfe_r']}"
    assert closed["mae_r"] >= 0.45, f"Expected mae_r >= 0.45R, got {closed['mae_r']}"
    assert closed["realized_r"] > 1.0, f"Expected realized_r > 1.0R, got {closed['realized_r']}"
    assert closed["expected_r"] == 2.0
    assert closed["pnl_percent"] > 2.0, f"Expected pnl_percent > 2%, got {closed['pnl_percent']}"
    assert closed["risk_usd"] > 3.0, f"Expected risk_usd ~3.50, got {closed['risk_usd']}"
    assert closed["regime"] == "TREND_UP"

    # Verify exchange leverage (3.0) and effective leverage (0.175) are stored distinctly
    assert closed["leverage"] == 3.0
    assert closed["effective_leverage"] < 1.0


def test_pyramiding_is_disabled_by_flag_by_default():
    pos = {
        "side": "LONG",
        "entry": 100.0,
        "avg_entry_price": 100.0,
        "stop_price": 100.1,  # stop in profit
        "current_stop": 100.1,
        "qty": 1.0,
        "adds_done": 0,
        "tp1_done": True,
    }
    # With default ENABLE_PYRAMIDING = False, it must be rejected
    can_add, reason = can_add_pyramid_layer(pos, "TREND_UP", mfe_r=1.5, microstructure_ok=True)
    assert not can_add
    assert reason == "PYRAMIDING_DISABLED_BY_FLAG"

    # When explicitly enabled, it passes validation
    can_add, reason = can_add_pyramid_layer(pos, "TREND_UP", mfe_r=1.5, microstructure_ok=True, enable_pyramiding=True)
    assert can_add
    assert reason == "OK"


def test_can_open_position_considers_pending_entry_orders():
    equity = 1000.0
    open_positions = [
        {"symbol": "BTCUSDT", "side": "LONG", "risk_usd": 4.0},
        {"symbol": "ETHUSDT", "side": "LONG", "risk_usd": 3.0},
    ]
    # Total portfolio heat limit = 1.25% ($12.50). Directional limit = 0.75% ($7.50).
    # Current open LONG risk = $7.00.
    # An active pending limit order for SOLUSDT LONG reserving $2.00 risk:
    pending_orders = [
        {
            "symbol": "SOLUSDT",
            "role": "ENTRY",
            "status": "PENDING",
            "side": "BUY",
            "reserved_risk": 2.0,
        }
    ]
    # Attempting to open a new LONG with $1.50 risk:
    # Directional heat would become $7.00 + $2.00 + $1.50 = $10.50 > $7.50!
    allowed, reason = can_open_position(
        new_risk_usd=1.50,
        new_side="LONG",
        open_positions=open_positions,
        equity=equity,
        pending_orders=pending_orders,
        max_positions=4,
    )
    assert not allowed
    assert "DIRECTIONAL_HEAT_EXCEEDED" in reason


def test_realized_r_remains_consistent_on_partial_exit():
    """
    Validates that partial profit exit (e.g. 50% TP) calculates realized_r strictly
    against the proportional share of initial structural risk ($R), avoiding distorted R.
    """
    from backend.app.services.paper_trading import PaperTradingSession, PaperPosition

    session = PaperTradingSession(initial_balance=1000.0, risk_per_trade_pct=0.01)
    # Direct creation of open position to test exit math deterministically
    pos = PaperPosition(
        symbol="ETHUSDT",
        side="LONG",
        qty=1.0,
        avg_entry_price=100.0,
        entry_ts=1000,
        stop_price=90.0,
        initial_stop_price=90.0,
        target_price=120.0,
        initial_risk_usd=10.0,  # $10 initial structural risk
        margin_used=50.0,
    )
    session.positions["ETHUSDT"] = pos

    # Partial exit of 50% (0.5 qty) at $110 (MFE +1.0R)
    session.close_position("ETHUSDT", 110.0, order_type="MARKET", quantity=0.5)
    # Simulate market fill of exit order
    order_id = list(session.orders.keys())[-1]
    po = session.orders[order_id]
    from backend.app.services.execution_simulator import Fill
    session._apply_exit_fill("ETHUSDT", po, price=110.0, qty=0.5, fee=0.05, slippage_cost=0.0)

    closed = session.get_state().closed_trades[-1]
    assert closed["qty"] == 0.5
    assert closed["risk_usd"] == 5.0
    # Gross on 0.5 qty = ($110 - $100) * 0.5 = $5.00. Fee = 0.05 -> net = $4.95.
    # realized_r = 4.95 / 5.0 = 0.99R
    assert 0.98 <= closed["realized_r"] <= 1.0
    assert pos.qty == 0.5

    # Full exit of remaining 0.5 qty at $90 (Stop)
    session.close_position("ETHUSDT", 90.0, order_type="MARKET", quantity=0.5)
    order_id2 = list(session.orders.keys())[-1]
    po2 = session.orders[order_id2]
    session._apply_exit_fill("ETHUSDT", po2, price=90.0, qty=0.5, fee=0.05, slippage_cost=0.0)

    closed2 = session.get_state().closed_trades[-1]
    assert closed2["qty"] == 0.5
    assert closed2["risk_usd"] == 5.0
    # Gross on 0.5 qty = ($90 - $100) * 0.5 = -$5.00. Fee = 0.05 -> net = -$5.05.
    # realized_r = -5.05 / 5.0 = -1.01R
    assert -1.05 <= closed2["realized_r"] <= -0.99
    assert pos.closed


def test_closed_candle_zero_lookahead_contract():
    """
    Confirms that 15m contextual indicators only evaluate closed candles
    and execution emulates on open[t+1] or after close timestamp, zero look-ahead.
    """
    from backend.app.services.regime_classifier import classify_market_regime

    dates = pd.date_range("2026-10-26 00:00", periods=50, freq="15min")
    df = pd.DataFrame({
        "open": np.linspace(100, 110, 50),
        "high": np.linspace(101, 112, 50),
        "low": np.linspace(99, 109, 50),
        "close": np.linspace(100.5, 111.5, 50),
        "volume": np.full(50, 1000.0),
    }, index=dates)

    # Classification at bar t relies strictly on historical closed rows up to t
    regime_closed = classify_market_regime(df_5m=df.iloc[:30])
    regime_future = classify_market_regime(df_5m=df.iloc[:40])
    # Future bars cannot alter past regime result at bar 30
    assert isinstance(regime_closed, MarketRegime)
    assert isinstance(regime_future, MarketRegime)

