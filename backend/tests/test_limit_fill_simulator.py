"""
Tests for the single limit order fill simulator (backend/app/services/limit_fill_simulator.py).

Covers:
- limit fill triggered for BUY and SELL
- no fill case
- TP exit with maker fee
- SL exit with taker fee + adverse slippage
- tie-break rule (SL first, conservative)
- look-ahead bias prevention (strict filtering of bars by created_at_ts)
- determinism (same input -> identical output)
"""

import pandas as pd
import pytest

from backend.app.services.limit_fill_simulator import (
    LimitSetupParams,
    LimitSetupResult,
    simulate_limit_setup,
)


def _make_df(rows):
    """
    rows: list of (timestamp, open, high, low, close)
    Returns a DataFrame with the columns required by the simulator.
    """
    return pd.DataFrame(
        rows,
        columns=["timestamp", "open", "high", "low", "close"],
    )


def _params(**kwargs) -> LimitSetupParams:
    base = dict(
        symbol="BTCUSDT",
        side="BUY",
        entry_price=65000.0,
        sl_price=64500.0,
        tp_price=66000.0,
        size=0.01,
        created_at_ts=1000,
        max_bars=10,
        maker_fee_pct=0.02,
        taker_fee_pct=0.05,
        slippage_ticks=1.0,
        tick_size=0.01,
    )
    base.update(kwargs)
    return LimitSetupParams(**base)


def test_limit_fill_triggered_buy():
    # BUY: bar2 low dips below entry -> filled at entry price
    df = _make_df(
        [
            (1000, 65500, 65800, 65400, 65700),
            (2000, 65700, 65900, 65200, 65800),  # low 65200 <= entry 65000? No (65000 < 65200)
            (3000, 65800, 66100, 64950, 66000),  # low 64950 <= 65000 -> fill, then high 66100 >= tp
        ]
    )
    res = simulate_limit_setup(df, _params())
    assert res.filled is True
    assert res.entry_price == 65000.0
    assert res.entry_bar_ts == 3000
    # In bar3: low hits entry, high hits TP -> tp hit
    assert res.exit_reason == "tp"
    assert res.exit_price == 66000.0
    assert res.bars_held == 0  # same bar entry+exit


def test_limit_fill_triggered_sell():
    # SELL: created_at_ts=999 so bar 1 is included (bars with ts <= created_at_ts are ignored)
    df = _make_df(
        [
            (1000, 65000, 65200, 64800, 65100),  # high 65200 >= entry 65100 -> fill in bar1
            (2000, 65100, 65250, 64900, 65200),  # no exit in this bar
            (3000, 65150, 65200, 64700, 64800),  # last bar
        ]
    )
    # Short setup: entry=65100, sl=65600, tp=64500
    res = simulate_limit_setup(
        df,
        _params(side="SELL", entry_price=65100.0, sl_price=65600.0, tp_price=64500.0, created_at_ts=999),
    )
    assert res.filled is True
    assert res.entry_price == 65100.0
    assert res.entry_bar_ts == 1000
    assert res.exit_reason == "open"  # max_bars reached without tp/sl
    assert res.exit_price == pytest.approx(64800.0)  # close of last bar
    assert res.bars_held == 3  # trade lived through all 3 bars (entry bar + 2 more)


def test_limit_not_filled():
    # Price never touches entry -> no_fill, PnL=0
    df = _make_df(
        [
            (1000, 65500, 65800, 65400, 65700),
            (2000, 65700, 65900, 65200, 65800),  # low never <= 65000
            (3000, 65800, 66000, 65400, 65900),
        ]
    )
    res = simulate_limit_setup(df, _params(max_bars=3))
    assert res.filled is False
    assert res.exit_reason == "no_fill"
    assert res.net_pnl == 0.0
    assert res.bars_held == 0


def test_tp_hit_maker_fee():
    # Entry then TP in next bar -> both fees maker
    df = _make_df(
        [
            (1000, 65500, 65800, 65400, 65700),
            (2000, 65700, 65900, 64900, 65500),  # low <= entry -> fill
            (3000, 65500, 66200, 65400, 66100),  # high >= tp -> tp exit
        ]
    )
    res = simulate_limit_setup(df, _params())
    assert res.filled is True
    assert res.exit_reason == "tp"
    # gross = (66000 - 65000) * 0.01 = 10.0
    # fees = entry*0.0002*0.01 + exit*0.0002*0.01 = 65000*0.01*0.0002 + 66000*0.01*0.0002
    #      = 0.13 + 0.132 = 0.262
    assert res.gross_pnl == pytest.approx(10.0)
    assert res.fees_paid == pytest.approx(0.262)
    assert res.slippage_cost == pytest.approx(0.0)
    assert res.net_pnl == pytest.approx(10.0 - 0.262)


def test_sl_hit_taker_slippage():
    # Entry then SL in next bar -> taker fee + adverse slippage
    df = _make_df(
        [
            (1000, 65500, 65800, 65400, 65700),
            (2000, 65700, 65900, 64900, 65500),  # low <= entry -> fill
            (3000, 65500, 65600, 64400, 64500),  # low <= sl -> sl exit
        ]
    )
    res = simulate_limit_setup(df, _params())
    assert res.filled is True
    assert res.exit_reason == "sl"
    assert res.exit_price == pytest.approx(64500.0)
    # gross = (64500 - 65000) * 0.01 = -5.0
    # fees = 65000*0.01*0.0002 (maker entry) + 64500*0.01*0.0005 (taker exit)
    #      = 0.13 + 0.3225 = 0.4525
    # slippage = 1.0 tick * 0.01 * 0.01 size = 0.0001
    assert res.gross_pnl == pytest.approx(-5.0)
    assert res.fees_paid == pytest.approx(0.4525)
    assert res.slippage_cost == pytest.approx(0.0001)
    assert res.net_pnl == pytest.approx(-5.0 - 0.4525 - 0.0001)


def test_tie_break_sl_first():
    # In entry bar both SL and TP are touched -> conservative SL first
    df = _make_df(
        [
            (1000, 65500, 65800, 65400, 65700),
            (2000, 65500, 66100, 64400, 65000),  # low <= entry (fill), high >= tp, low <= sl
        ]
    )
    res = simulate_limit_setup(df, _params())
    assert res.filled is True
    assert res.entry_bar_ts == 2000
    assert res.exit_reason == "sl"  # worst case
    assert res.exit_price == pytest.approx(64500.0)
    assert res.bars_held == 0


def test_lookahead_bias_prevention():
    """
    Anti look-ahead: bars with timestamp <= created_at_ts are strictly ignored.
    A profitable trade that exists ONLY in the ignored bars must not be returned.
    """
    rows = [
        (1000, 65500, 65800, 64950, 65700),  # low <= entry (65000) -> fill in bar1
        (2000, 65700, 66200, 65400, 66100),  # high >= tp (66000) -> tp exit in bar2
        (3000, 66100, 66400, 65900, 66300),  # entry never touched
        (4000, 66300, 66400, 65100, 65200),  # low > entry -> still no fill
    ]
    df = _make_df(rows)

    # Baseline: created_at_ts=0 -> all bars available -> profitable trade
    base_res = simulate_limit_setup(df, _params(created_at_ts=0))
    assert base_res.filled is True
    assert base_res.entry_bar_ts == 1000
    assert base_res.exit_reason == "tp"
    assert base_res.net_pnl > 0

    # Shifted past bar1: created_at_ts=1500 -> bar1 is excluded.
    # Entry (65000) is never touched in bars 2-4 (lows: 65400, 65900, 65100).
    shifted_res = simulate_limit_setup(df, _params(created_at_ts=1500))
    assert shifted_res.filled is False
    assert shifted_res.exit_reason == "no_fill"
    assert shifted_res.net_pnl == 0.0


def test_determinism_same_input():
    df = _make_df(
        [
            (1000, 65500, 65800, 65400, 65700),
            (2000, 65700, 65900, 64900, 65500),
            (3000, 65500, 66200, 65400, 66100),
        ]
    )
    params = _params()
    r1 = simulate_limit_setup(df, params)
    r2 = simulate_limit_setup(df, params)
    assert r1 == r2  # frozen dataclass -> field-by-field equality


def test_golden_csv_integration():
    """Sanity check on the real golden fixture: simulator must run without errors."""
    df = pd.read_csv("backend/tests/fixtures/golden_ohlcv.csv")
    res = simulate_limit_setup(
        df,
        _params(
            entry_price=df["close"].iloc[0],
            sl_price=df["close"].iloc[0] * 0.995,
            tp_price=df["close"].iloc[0] * 1.01,
            created_at_ts=int(df["timestamp"].iloc[0]),
            max_bars=50,
        ),
    )
    assert res.exit_reason in ("tp", "sl", "open", "no_fill")
    assert isinstance(res, LimitSetupResult)

