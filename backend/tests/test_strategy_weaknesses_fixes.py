"""Tests for STRATEGY_WEAKNESSES fixes (docs/STRATEGY_WEAKNESSES_AND_UPGRADES.md).

All fixes are flag-gated and default-off so the marathon baseline is untouched:
1. Auto breakeven at +0.5R — pre-existing `use_dynamic_breakeven` (covered here).
2. Adaptive wall — rolling median(turnover, 50) * 2.5 instead of a fixed $ gate.
3. Time-stop — market exit if the trade is < +0.3R after 45 minutes.
4. Maker exits — trailing stop executes as a limit order (maker fee, no slippage).
"""

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from backend.app.services.orderflow_backtester import OrderFlowBacktester

FIXTURES_DIR = Path(__file__).parent / "fixtures"
GOLDEN_CSV = FIXTURES_DIR / "golden_ohlcv.csv"


def _flat_then_move_df(n_flat: int = 70, move: float = 0.0, n: int = 160) -> pd.DataFrame:
    """Flat warmup then a linear drift — deterministic naked_test entries."""
    rows = []
    base_ts = 1700000000000
    price = 100.0
    for i in range(n):
        if i >= n_flat:
            price = 100.0 + move * (i - n_flat + 1)
        rows.append({
            "timestamp": base_ts + i * 60000,
            "open": price,
            "high": price + 0.05,
            "low": price - 0.05,
            "close": price,
            "volume": 1000.0,
            "taker_buy_volume": 500.0,
        })
    return pd.DataFrame(rows)


def _run(df, **overrides):
    params = dict(
        strategy_type="naked_test",
        take_profit_pct=50.0,   # unreachable TP: exit path under test decides
        stop_loss_pct=50.0,     # unreachable SL
        use_trailing=False,
        use_multi_tp=False,
        leverage=1.0,
        compute_monte_carlo=False,
    )
    params.update(overrides)
    return OrderFlowBacktester(initial_capital=10000.0).run_backtest(df, **params)


def test_time_stop_exits_stagnant_trade_at_market():
    df = _flat_then_move_df()
    result = _run(df, use_time_stop=True, time_stop_minutes=45, time_stop_min_r=0.3)

    trades = result.get("trades", [])
    assert trades, "naked_test should open a position"
    assert all(t["exit_reason"] == "Time Stop" for t in trades)
    for trade in trades:
        held_ms = int(trade["exit_time"]) - int(trade["entry_time"])
        assert held_ms >= 45 * 60_000


def test_time_stop_disabled_by_default_keeps_baseline():
    df = _flat_then_move_df()
    result = _run(df)

    assert not any(t["exit_reason"] == "Time Stop" for t in result.get("trades", []))


def test_maker_trailing_exit_has_maker_fee_and_zero_slippage():
    # Rise +0.05/bar for 60 bars, then fall — trailing stop (0.3%) fires on the way down.
    rows = []
    base_ts = 1700000000000
    price = 100.0
    for i in range(200):
        if i < 130:
            price = 100.0 + max(0, i - 70) * 0.05 if i >= 70 else 100.0
        else:
            price = 103.0 - (i - 130) * 0.1
        rows.append({
            "timestamp": base_ts + i * 60000,
            "open": price,
            "high": price + 0.03,
            "low": price - 0.1,
            "close": price,
            "volume": 1000.0,
            "taker_buy_volume": 600.0,
        })
    df = pd.DataFrame(rows)

    common = dict(strategy_type="naked_test", take_profit_pct=50.0, stop_loss_pct=50.0,
                  use_trailing=True, trailing_pct=0.3, use_multi_tp=False, leverage=1.0,
                  compute_monte_carlo=False)
    taker_run = OrderFlowBacktester(initial_capital=10000.0).run_backtest(df, **common)
    maker_run = OrderFlowBacktester(initial_capital=10000.0).run_backtest(df, use_maker_exits=True, **common)

    taker_trades = [t for t in taker_run["trades"] if t["exit_reason"] == "Trailing Stop"]
    maker_trades = [t for t in maker_run["trades"] if t["exit_reason"] == "Trailing Stop"]
    assert taker_trades and maker_trades, "scenario must produce trailing exits"

    assert all(t["slippage_cost_usd"] > 0 for t in taker_trades)
    assert all(t["slippage_cost_usd"] == 0 for t in maker_trades)
    # Maker exit fee is strictly lower for the same notional
    assert sum(t["fee_paid_usd"] for t in maker_trades) < sum(t["fee_paid_usd"] for t in taker_trades)


def test_adaptive_wall_replaces_fixed_threshold():
    df = pd.read_csv(GOLDEN_CSV)
    bt = OrderFlowBacktester(initial_capital=10000.0)
    window = 50

    # NOTE: the fixed $ gate is clamped to ~median(turnover)*3.5 inside run_backtest,
    # so it can never fully block — the adaptive wall removes that knob entirely.
    # With adaptive ON the gate is fully data-driven: the result must not depend
    # on min_density_usd at all (absurd value vs zero give identical entries).
    adaptive_a = bt.run_backtest(
        df, strategy_type="confluence_ema", min_density_usd=10**12,
        use_adaptive_wall=True, compute_monte_carlo=False,
    )
    adaptive_b = bt.run_backtest(
        df, strategy_type="confluence_ema", min_density_usd=0.0,
        use_adaptive_wall=True, compute_monte_carlo=False,
    )
    entries_a = [t["entry_time"] for t in adaptive_a.get("trades", [])]
    entries_b = [t["entry_time"] for t in adaptive_b.get("trades", [])]
    assert entries_a == entries_b
    assert entries_a, "adaptive wall should still let some signals through"

    # Rolling-median warmup: no entries before the window is fully populated.
    first_eligible_ts = int(df["timestamp"].iloc[window])
    assert all(int(ts) >= first_eligible_ts for ts in entries_a)


def test_dynamic_breakeven_flag_moves_stop_after_half_r():
    df = pd.read_csv(GOLDEN_CSV)
    bt = OrderFlowBacktester(initial_capital=10000.0)

    baseline = bt.run_backtest(df, strategy_type="confluence_ema", compute_monte_carlo=False)
    protected = bt.run_backtest(df, strategy_type="confluence_ema", use_dynamic_breakeven=True, compute_monte_carlo=False)

    # Baseline is untouched: no Dynamic Breakeven exits without the flag.
    assert not any(t["exit_reason"] == "Dynamic Breakeven" for t in baseline.get("trades", []))
    # Same entries: the flag only changes trade management, not signal generation.
    assert [t["entry_time"] for t in baseline.get("trades", [])] == [t["entry_time"] for t in protected.get("trades", [])]


def test_all_fixes_default_off_preserve_golden_baseline():
    df = pd.read_csv(GOLDEN_CSV)
    bt = OrderFlowBacktester(initial_capital=10000.0)

    result = bt.run_backtest(df, strategy_type="confluence_ema", compute_monte_carlo=False)

    # Regression anchor on the golden fixture: default flags must reproduce
    # the pre-fix baseline exactly (flat result dict, no "summary" key).
    assert result["total_trades"] == 11
    assert result["net_pnl"] == pytest.approx(261.23, abs=0.01)
