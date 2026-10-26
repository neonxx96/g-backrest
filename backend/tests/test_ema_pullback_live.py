"""ema_pullback в live paper: evaluate/explain семантика 1:1 с бэктестом.

Сетап: тренд вверх (ema20 > ema50) на последнем баре, low касается EMA20,
close возвращается выше EMA20, vol_ratio выше порога, delta > 0.
"""

from __future__ import annotations

import pandas as pd

from backend.app.services.overnight_pilot import HISTORICAL_STRATEGIES, OPTIMIZABLE_STRATEGIES
from backend.app.services.live_paper_runner import MARKET_ENTRY_STRATEGIES, PAPER_HISTORICAL_STRATEGIES
from backend.app.services.orderflow_backtester import OrderFlowBacktester


def _frame_pullback_up() -> pd.DataFrame:
    """Синтетика: uptrend (ema20>ema50), low <= ema20, close > ema20 на последнем баре."""
    rows = []
    for i in range(60):
        close = 100.0 + i * 0.1
        rows.append({
            "timestamp": 1_790_000_000_000 + i * 300_000,
            "open": close - 0.05, "high": close + 0.1, "low": close - 0.1,
            "close": close, "volume": 1000.0, "delta": 1.0,
        })
    df = pd.DataFrame(rows)
    df = OrderFlowBacktester(initial_capital=1000).calculate_indicators(df)
    i_last = len(df) - 1
    ema20_col = df.columns.get_loc("ema20")
    ema50_col = df.columns.get_loc("ema50")
    low_col = df.columns.get_loc("low")
    high_col = df.columns.get_loc("high")
    close_col = df.columns.get_loc("close")
    # Тренд вверх на обоих последних барах
    df.iloc[i_last - 1, ema20_col] = 105.0
    df.iloc[i_last - 1, ema50_col] = 104.0
    df.iloc[i_last, ema20_col] = 105.5
    df.iloc[i_last, ema50_col] = 104.5
    # Касание EMA20 и возврат: low ниже EMA20, close выше EMA20
    df.iloc[i_last, low_col] = 105.2
    df.iloc[i_last, close_col] = 106.0
    df.iloc[i_last, high_col] = 106.2
    df.iloc[i_last, df.columns.get_loc("vol_ratio")] = 2.0
    df.iloc[i_last, df.columns.get_loc("delta")] = 5.0
    return df


def test_ema_pullback_whitelisted_in_pilot_and_runner():
    assert "ema_pullback" in HISTORICAL_STRATEGIES
    assert "ema_pullback" in OPTIMIZABLE_STRATEGIES
    assert "ema_pullback" in PAPER_HISTORICAL_STRATEGIES
    assert "ema_pullback" in MARKET_ENTRY_STRATEGIES


def test_evaluate_latest_signal_ema_pullback_touch_reject_up():
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        _frame_pullback_up(), strategy_type="ema_pullback",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is not None
    assert sig["direction"] == "LONG"
    assert any("touch-reject" in r for r in sig["reasons"])


def test_evaluate_latest_signal_ema_pullback_rejects_without_trend():
    frame = _frame_pullback_up()
    bt = OrderFlowBacktester(initial_capital=1000)
    # Ломаем тренд: ema20 < ema50 (флэт/даунтренд) — касание не считается
    i = len(frame) - 1
    ema50_col = frame.columns.get_loc("ema50")
    frame.iloc[i - 1, ema50_col] = 106.0
    frame.iloc[i, ema50_col] = 106.5
    sig = bt.evaluate_latest_signal(
        frame, strategy_type="ema_pullback",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is None


def test_evaluate_latest_signal_ema_pullback_rejects_low_volume():
    frame = _frame_pullback_up()
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        frame, strategy_type="ema_pullback",
        volume_multiplier=5.0, min_density_usd=0,
    )
    assert sig is None


def test_explain_latest_signal_ema_pullback_reports_rejections():
    bt = OrderFlowBacktester(initial_capital=1000)
    frame = _frame_pullback_up()
    # Ломаем касание: low выше EMA20 (не было отскока)
    i = len(frame) - 1
    frame.iloc[i, frame.columns.get_loc("low")] = 105.8  # > ema20 105.5
    diag = bt.explain_latest_signal(
        frame, strategy_type="ema_pullback",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert diag["status"] == "NO_TRADE"
    assert "ema20_touch_reject" in diag["failed_checks"]


def test_explain_latest_signal_ema_pullback_rejects_flat_market():
    bt = OrderFlowBacktester(initial_capital=1000)
    frame = _frame_pullback_up()
    i = len(frame) - 1
    ema20_col = frame.columns.get_loc("ema20")
    ema50_col = frame.columns.get_loc("ema50")
    # Флэт: ema20 == ema50
    frame.iloc[i - 1, ema20_col] = 105.0
    frame.iloc[i - 1, ema50_col] = 105.0
    frame.iloc[i, ema20_col] = 105.5
    frame.iloc[i, ema50_col] = 105.5
    diag = bt.explain_latest_signal(
        frame, strategy_type="ema_pullback",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert diag["status"] == "NO_TRADE"
    assert "trend_structure" in diag["failed_checks"]


def test_explain_ema_pullback_reports_signal_when_valid():
    bt = OrderFlowBacktester(initial_capital=1000)
    diag = bt.explain_latest_signal(
        _frame_pullback_up(), strategy_type="ema_pullback",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert diag["status"] == "SIGNAL"
    assert diag["direction"] == "LONG"
