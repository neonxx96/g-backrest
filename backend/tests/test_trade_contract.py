"""
Unit Tests for Unified Trade Contract & Adapters
================================================
Validates UnifiedTradeSignal schema enforcement, deterministic unique_id generation,
and conversion adapters from Backtest, Scanner, and Paper Trading.
"""

import pytest
from pydantic import ValidationError
from backend.app.engine.trade_contract import (
    UnifiedTradeSignal,
    from_backtest_trade,
    from_backtest_setup,
    from_scanner_signal,
    from_paper_order,
    to_paper_order_request
)
from backend.app.services.paper_trading import PaperTradingSession


def test_unified_trade_signal_creation_and_deterministic_id():
    sig = UnifiedTradeSignal(
        symbol="btcusdt",
        timeframe="5m",
        timestamp=1700000000000,
        direction="BUY",
        entry_type="limit",
        entry_price=50000.0,
        sl=49500.0,
        tp1=51000.0,
        leverage=2.0,
        risk_pct=1.5,
        expected_rr=2.0,
        confidence=0.9,
        reason=["EMA20 crossed up", "CVD slope > 0"],
        strategy_type="confluence_ema"
    )

    # Symbol uppercase normalization
    assert sig.symbol == "BTCUSDT"
    # Direction mapped to LONG
    assert sig.direction == "LONG"
    # Entry type uppercase
    assert sig.entry_type == "LIMIT"
    # Deterministic ID generated
    assert len(sig.unique_id) == 16
    assert isinstance(sig.unique_id, str)

    # Identical parameters must produce identical unique_id
    sig2 = UnifiedTradeSignal(
        symbol="BTCUSDT",
        timeframe="5m",
        timestamp=1700000000000,
        direction="LONG",
        entry_type="LIMIT",
        entry_price=50000.0,
        sl=49500.0,
        tp1=51000.0,
        leverage=2.0,
        risk_pct=1.5,
        expected_rr=2.0,
        confidence=0.9,
        reason=["EMA20 crossed up", "CVD slope > 0"],
        strategy_type="confluence_ema"
    )
    assert sig.unique_id == sig2.unique_id


def test_unified_trade_signal_validation_failures():
    # Negative entry price
    with pytest.raises(ValidationError):
        UnifiedTradeSignal(
            symbol="BTCUSDT",
            timestamp=1700000000000,
            direction="LONG",
            entry_price=-100.0,
            sl=90.0,
            tp1=120.0
        )

    # Invalid direction
    with pytest.raises(ValidationError):
        UnifiedTradeSignal(
            symbol="BTCUSDT",
            timestamp=1700000000000,
            direction="SIDEWAYS",
            entry_price=100.0,
            sl=90.0,
            tp1=120.0
        )

    # Zero SL
    with pytest.raises(ValidationError):
        UnifiedTradeSignal(
            symbol="BTCUSDT",
            timestamp=1700000000000,
            direction="LONG",
            entry_price=100.0,
            sl=0.0,
            tp1=120.0
        )


def test_adapter_from_backtest_trade():
    trade_raw = {
        "direction": "LONG",
        "entry_price": 60000.0,
        "exit_price": 61200.0,
        "entry_time": 1700000100000,
        "exit_time": 1700000200000,
        "pnl_pct": 2.0,
        "entry_reason": ["EMA20 crossed above EMA50", "CVD slope = +42.0"],
        "exit_reason": "Take Profit Target Hit"
    }

    sig = from_backtest_trade(
        trade=trade_raw,
        symbol="BTCUSDT",
        timeframe="15m",
        strategy_type="confluence_ema",
        leverage=3.0,
        risk_pct=1.0
    )

    assert sig.symbol == "BTCUSDT"
    assert sig.direction == "LONG"
    assert sig.entry_price == 60000.0
    assert sig.sl < sig.entry_price
    assert sig.tp1 > sig.entry_price
    assert sig.leverage == 3.0
    assert sig.risk_pct == 1.0
    assert sig.reason == ["EMA20 crossed above EMA50", "CVD slope = +42.0"]
    assert sig.data_source == "historical_backtest"


def test_adapter_from_backtest_setup():
    setup_raw = {
        "direction": "SHORT",
        "order_type": "SELL LIMIT",
        "entry_price": 65000.0,
        "sl_price": 65500.0,
        "tp1_price": 64000.0,
        "tp2_price": 63000.0,
        "rr_ratio": 2.0,
        "entry_mode": "limit_bounce"
    }

    sig = from_backtest_setup(
        setup=setup_raw,
        symbol="BTCUSDT",
        timeframe="5m",
        timestamp=1700000300000
    )

    assert sig.symbol == "BTCUSDT"
    assert sig.direction == "SHORT"
    assert sig.entry_type == "LIMIT"
    assert sig.entry_price == 65000.0
    assert sig.sl == 65500.0
    assert sig.tp1 == 64000.0
    assert sig.tp2 == 63000.0
    assert sig.expected_rr == 2.0
    assert any("limit_bounce" in item for item in sig.reason)


def test_adapter_from_scanner_signal():
    scanner_sig = {
        "symbol": "SOLUSDT",
        "timeframe": "15m",
        "price": 150.0,
        "condition_type": "EMA_CROSS",
        "direction": "BULLISH",
        "description": "EMA 20/50 Bullish Crossover detected"
    }

    sig = from_scanner_signal(scanner_sig, default_sl_pct=1.0, default_tp_pct=2.0)

    assert sig.symbol == "SOLUSDT"
    assert sig.direction == "LONG"
    assert sig.entry_price == 150.0
    assert sig.sl == 148.5
    assert sig.tp1 == 153.0
    assert sig.expected_rr == 2.0
    assert sig.strategy_type == "scanner_ema_cross"


def test_adapter_from_paper_order_and_to_request():
    order_data = {
        "symbol": "ETHUSDT",
        "side": "BUY",
        "price": 3200.0,
        "stop_price": 3150.0,
        "target_price": 3300.0,
        "order_type": "LIMIT",
        "reason": "Test Paper Entry",
        "created_ts": 1700000500000
    }

    sig = from_paper_order(order_data, timeframe="5m")
    assert sig.symbol == "ETHUSDT"
    assert sig.direction == "LONG"
    assert sig.entry_price == 3200.0
    assert sig.sl == 3150.0
    assert sig.tp1 == 3300.0

    # Convert back to paper order request payload
    req = to_paper_order_request(sig, quantity=0.5)
    assert req["symbol"] == "ETHUSDT"
    assert req["side"] == "BUY"
    assert req["price"] == 3200.0
    assert req["stop_price"] == 3150.0
    assert req["target_price"] == 3300.0
    assert req["quantity"] == 0.5
    assert "Test Paper Entry" in req["reason"]


def test_signal_reason_is_normalized_to_a_nonempty_list():
    """Legacy string reasons remain readable, while every contract stores conditions as a list."""
    sig = UnifiedTradeSignal(
        symbol="BTCUSDT",
        timestamp=1700000600000,
        direction="LONG",
        entry_price=100.0,
        sl=99.0,
        tp1=102.0,
        reason="EMA20 crossed up",
    )

    assert sig.reason == ["EMA20 crossed up"]

    req = to_paper_order_request(sig)
    assert req["reason"].endswith("EMA20 crossed up")


def test_paper_order_adapter_preserves_structured_manual_conditions():
    sig = from_paper_order({
        "symbol": "BTCUSDT",
        "side": "BUY",
        "price": 100.0,
        "stop_price": 99.0,
        "target_price": 102.0,
        "reason": ["EMA20 crossed up", "CVD slope = +1.2"],
        "created_ts": 1700000700000,
    })

    assert sig.reason == ["EMA20 crossed up", "CVD slope = +1.2"]


def test_paper_session_executes_entry_from_unified_signal_only():
    signal = UnifiedTradeSignal(
        symbol="BTCUSDT",
        timestamp=1700000700000,
        direction="LONG",
        entry_type="MARKET",
        entry_price=100.0,
        sl=99.0,
        tp1=102.0,
        reason=["EMA20 crossed up", "CVD slope > 0"],
    )
    session = PaperTradingSession(initial_balance=1000.0, session_id="unified_contract")

    order = session.execute_unified_signal(signal, regime="TREND_IMPULSE")

    assert order["symbol"] == "BTCUSDT"
    assert "EMA20 crossed up" in order["reason"]
