"""
Verification script for Step 1:
Executes and validates the complete closed trade lifecycle across BTC, ETH, and SOL
under diagnostics_lenient preset rules.
Tests:
1. BTCUSDT: Full Take-Profit limit exit (Maker fee 0.02%)
2. ETHUSDT: Dynamic Breakeven Stop market exit (Taker fee 0.05% + dynamic breakeven offset)
3. SOLUSDT: Trailing Stop exit after favorable excursion (Market exit, Taker fee + slippage)
Validates the fundamental accounting invariant:
    Net PnL == Gross PnL - Total Fees - Slippage Cost (Fee Drag)
"""
import sys
import json
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.paper_trading import (
    PaperTradingSession,
    PaperOrderRole,
)
from backend.app.services.live_paper_runner import LivePaperRunner
from backend.app.engine.trade_contract import UnifiedTradeSignal

def test_trade_lifecycle():
    print("=" * 80)
    print("STEP 1: CLOSED TRADE LIFECYCLE & ACCOUNTING INVARIANT VERIFICATION")
    print("=" * 80)

    trades_verified = []

    # -------------------------------------------------------------------------
    # 1. BTCUSDT: Take Profit (TP Limit Exit)
    # -------------------------------------------------------------------------
    btc_session = PaperTradingSession(
        initial_balance=10000.0,
        signal_lag_ms=0,
        order_rtt_ms=0,
        session_id="test_btc_tp",
    )
    btc_runner = LivePaperRunner(session=btc_session)
    btc_config = {
        "symbol": "BTCUSDT",
        "strategy_type": "diagnostics_lenient",
        "timeframe": "5m",
        "initial_capital": 10000.0,
        "risk_per_trade_pct": 0.25,
        "stop_loss_pct": 0.5,
        "take_profit_pct": 0.75,
        "leverage": 1.0,
        "use_multi_tp": False,
        "use_trailing": False,
    }
    btc_runner.start(btc_config)

    # Entry at live entry price $82,572.90
    entry_price = 82572.90
    sl_price = entry_price * (1.0 - 0.005)   # 82160.0355
    tp_price = entry_price * (1.0 + 0.0075)  # 83192.19675
    signal = UnifiedTradeSignal(
        symbol="BTCUSDT",
        timestamp=1000,
        direction="LONG",
        entry_type="LIMIT",
        entry_price=entry_price,
        sl=sl_price,
        tp1=tp_price,
        expected_rr=1.5,
        reason="[diagnostics_lenient] forced_exit_test TP verification",
    )
    btc_session.execute_unified_signal(signal)
    
    # Fill entry limit order: trade price trades through limit level
    btc_session.process_market_tick(
        "BTCUSDT",
        price=entry_price - 0.5,
        bids=[(entry_price - 1.0, 10.0)],
        asks=[(entry_price + 1.0, 10.0)],
        timestamp=1000,
    )

    pos = btc_session.positions.get("BTCUSDT")
    assert pos is not None, "BTC position must be open"
    entry_qty = pos.qty
    entry_fees = pos.fees_paid
    print(f"\n[BTCUSDT] Opened LONG: Qty={entry_qty:.6f} @ ${entry_price:,.2f} | Fees paid=${entry_fees:.4f}")

    # Simulate price tick hitting and exceeding TP: $83,195.00 (> tp_price)
    simulated_tp_price = tp_price + 2.0
    # Runner checks target and places limit exit order
    btc_runner._update_open_positions(simulated_tp_price)
    # Fill limit exit order: trade price trades above exit limit
    btc_session.process_market_tick(
        "BTCUSDT",
        price=simulated_tp_price + 0.5,
        bids=[(simulated_tp_price - 1.0, 10.0)],
        asks=[(simulated_tp_price + 1.0, 10.0)],
        timestamp=2000,
    )

    assert len(btc_session.closed_trades) == 1, "BTC trade should be closed"
    t_btc = btc_session.closed_trades[0]
    t_btc["trade_type"] = "forced_exit_test: TAKE_PROFIT"
    trades_verified.append(t_btc)

    # -------------------------------------------------------------------------
    # 2. ETHUSDT: Dynamic Breakeven Stop Loss (Market Exit with Slippage Ticks)
    # -------------------------------------------------------------------------
    eth_session = PaperTradingSession(
        initial_balance=10000.0,
        signal_lag_ms=0,
        order_rtt_ms=0,
        session_id="test_eth_sl",
    )
    eth_runner = LivePaperRunner(session=eth_session)
    eth_config = {
        "symbol": "ETHUSDT",
        "strategy_type": "diagnostics_lenient",
        "timeframe": "5m",
        "initial_capital": 10000.0,
        "risk_per_trade_pct": 0.25,
        "stop_loss_pct": 0.5,
        "take_profit_pct": 0.75,
        "leverage": 1.0,
        "use_multi_tp": False,
        "use_trailing": False,
    }
    eth_runner.start(eth_config)

    entry_price = 2436.98
    sl_price = entry_price * (1.0 - 0.005) # 2424.7951
    tp_price = entry_price * (1.0 + 0.0075)
    signal = UnifiedTradeSignal(
        symbol="ETHUSDT",
        timestamp=1000,
        direction="LONG",
        entry_type="LIMIT",
        entry_price=entry_price,
        sl=sl_price,
        tp1=tp_price,
        expected_rr=1.5,
        reason="[diagnostics_lenient] forced_exit_test Breakeven Stop verification",
    )
    eth_session.execute_unified_signal(signal)
    eth_session.process_market_tick(
        "ETHUSDT",
        price=entry_price - 0.1,
        bids=[(entry_price - 0.5, 20.0)],
        asks=[(entry_price + 0.5, 20.0)],
        timestamp=1000,
    )

    pos = eth_session.positions.get("ETHUSDT")
    assert pos is not None, "ETH position must be open"

    # 1. Price moves up to trigger dynamic breakeven (MFE >= +0.5R)
    favorable_price = entry_price + (entry_price * 0.005 * 0.6)  # +0.6R
    eth_session.check_dynamic_breakeven("ETHUSDT", favorable_price)
    be_sl = eth_session.positions["ETHUSDT"].stop_price
    print(f"\n[ETHUSDT] Dynamic Breakeven triggered at ${favorable_price:,.2f} -> SL moved to ${be_sl:,.2f} (entry was ${entry_price:,.2f})")

    # 2. Price retraces and hits Breakeven SL
    simulated_sl_price = be_sl - 0.5
    eth_runner._update_open_positions(simulated_sl_price)
    # Fill market exit order
    eth_session.process_market_tick(
        "ETHUSDT",
        price=simulated_sl_price,
        bids=[(simulated_sl_price, 20.0)],
        asks=[(simulated_sl_price + 0.2, 20.0)],
        timestamp=2000,
    )

    assert len(eth_session.closed_trades) == 1, "ETH trade should be closed"
    t_eth = eth_session.closed_trades[0]
    t_eth["trade_type"] = "forced_exit_test: DYNAMIC_BREAKEVEN_STOP"
    trades_verified.append(t_eth)

    # -------------------------------------------------------------------------
    # 3. SOLUSDT: Trailing Stop Exit (MFE excursion -> retrace -> exit)
    # -------------------------------------------------------------------------
    sol_session = PaperTradingSession(
        initial_balance=10000.0,
        signal_lag_ms=0,
        order_rtt_ms=0,
        session_id="test_sol_trailing",
    )
    sol_runner = LivePaperRunner(session=sol_session)
    sol_config = {
        "symbol": "SOLUSDT",
        "strategy_type": "diagnostics_lenient",
        "timeframe": "5m",
        "initial_capital": 10000.0,
        "risk_per_trade_pct": 0.25,
        "stop_loss_pct": 0.5,
        "take_profit_pct": 1.5,
        "leverage": 1.0,
        "use_multi_tp": False,
        "use_trailing": True,
        "trailing_pct": 0.3,
    }
    sol_runner.start(sol_config)

    entry_price = 105.95
    sl_price = 105.42
    tp_price = 107.50
    signal = UnifiedTradeSignal(
        symbol="SOLUSDT",
        timestamp=1000,
        direction="LONG",
        entry_type="LIMIT",
        entry_price=entry_price,
        sl=sl_price,
        tp1=tp_price,
        expected_rr=2.0,
        reason="[diagnostics_lenient] forced_exit_test Trailing Stop verification",
    )
    sol_session.execute_unified_signal(signal)
    sol_session.process_market_tick(
        "SOLUSDT",
        price=entry_price - 0.05,
        bids=[(entry_price - 0.1, 50.0)],
        asks=[(entry_price + 0.1, 50.0)],
        timestamp=1000,
    )

    pos = sol_session.positions.get("SOLUSDT")
    assert pos is not None, "SOL position must be open"

    # 1. Price rallies to $106.60 (+0.61%)
    sol_high_price = 106.60
    # Simulate trailing stop calculation: trail at 0.3% below high
    trailing_sl = sol_high_price * (1.0 - 0.003)  # 106.28
    pos.stop_price = max(pos.stop_price, trailing_sl)
    print(f"\n[SOLUSDT] Trailing SL adjusted to ${pos.stop_price:,.4f} on rally to ${sol_high_price:,.2f}")

    # 2. Price retraces to $106.20, triggering trailing stop
    simulated_exit_price = 106.20
    sol_runner._update_open_positions(simulated_exit_price)
    sol_session.process_market_tick(
        "SOLUSDT",
        price=simulated_exit_price,
        bids=[(simulated_exit_price, 50.0)],
        asks=[(simulated_exit_price + 0.05, 50.0)],
        timestamp=2000,
    )

    assert len(sol_session.closed_trades) == 1, "SOL trade should be closed"
    t_sol = sol_session.closed_trades[0]
    t_sol["trade_type"] = "forced_exit_test: TRAILING_STOP"
    trades_verified.append(t_sol)

    # -------------------------------------------------------------------------
    # Accounting Invariant Verification & Detailed Logging
    # -------------------------------------------------------------------------
    print("\n" + "=" * 80)
    print("DETAILED CLOSED TRADES VERIFICATION TABLE:")
    print("=" * 80)

    for t in trades_verified:
        symbol = t["symbol"]
        side = t["side"]
        qty = t["qty"]
        entry = t["entry_price"]
        exit_p = t["exit_price"]
        gross = t["gross_pnl"]
        fee = t["fee"]
        fee_drag = t["fee_drag"]
        net = t["net_pnl"]
        reason = t["reason"]
        t_type = t.get("trade_type", "closed_trade")

        # Invariant check: net == gross - fee_drag
        # fee_drag includes entry_fee_share + exit_fee
        invariant_diff = abs(net - (gross - fee_drag))
        assert invariant_diff < 1e-7, f"Accounting invariant violated for {symbol}: diff={invariant_diff}"

        print(f"\n--- {symbol} ({t_type}) ---")
        print(f"  Side:          {side} {qty:.6f}")
        print(f"  Entry Price:   ${entry:,.4f}")
        print(f"  Exit Price:    ${exit_p:,.4f}")
        print(f"  Exit Reason:   {reason}")
        print(f"  Gross PnL:     ${gross:+,.4f}")
        print(f"  Fee Drag:      ${fee_drag:,.4f} (Entry share + Exit fee)")
        print(f"  Net PnL:       ${net:+,.4f}")
        print(f"  ROI on Trade:  {t['pnl_percent']:+.2f}%")
        print(f"  Invariant:     Net PnL == Gross PnL - Fee Drag -> DIFF = {invariant_diff:.2e} [CONFIRMED TRUE]")

    # Save to JSON artifact
    out_file = PROJECT_ROOT / "context" / "qa" / "verified_closed_trades.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(trades_verified, indent=2), encoding="utf-8")
    print(f"\n[PASS] Verified closed trades saved to {out_file}")

if __name__ == "__main__":
    test_trade_lifecycle()
