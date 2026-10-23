"""ema_trend в live paper: evaluate/explain семантика 1:1 с бэктестом."""

from __future__ import annotations

import pandas as pd

from backend.app.services.overnight_pilot import HISTORICAL_STRATEGIES
from backend.app.services.live_paper_runner import PAPER_HISTORICAL_STRATEGIES
from backend.app.services.orderflow_backtester import OrderFlowBacktester


def _frame_cross_up() -> pd.DataFrame:
    """Синтетика: на предпоследнем баре ema20<=ema50, на последнем ema20>ema50,
    vol_ratio выше порога, delta>0 — честный кросс вверх."""
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
    # Принудительный кросс на последних двух барах
    i_last = len(df) - 1
    df.iloc[i_last - 1, df.columns.get_loc("ema20")] = 105.0
    df.iloc[i_last - 1, df.columns.get_loc("ema50")] = 105.5
    df.iloc[i_last, df.columns.get_loc("ema20")] = 106.0
    df.iloc[i_last, df.columns.get_loc("ema50")] = 105.8
    df.iloc[i_last, df.columns.get_loc("vol_ratio")] = 2.0
    df.iloc[i_last, df.columns.get_loc("delta")] = 5.0
    return df


def test_ema_trend_whitelisted_in_pilot_and_runner():
    assert "ema_trend" in HISTORICAL_STRATEGIES
    assert "ema_trend" in PAPER_HISTORICAL_STRATEGIES


def test_evaluate_latest_signal_ema_trend_cross_up():
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        _frame_cross_up(), strategy_type="ema_trend",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is not None
    assert sig["direction"] == "LONG"
    assert any("EMA cross up" in r for r in sig["reasons"])


def test_evaluate_latest_signal_ema_trend_rejects_low_volume():
    frame = _frame_cross_up()
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        frame, strategy_type="ema_trend",
        volume_multiplier=5.0, min_density_usd=0,
    )
    assert sig is None


def test_explain_latest_signal_ema_trend_rejects_no_cross():
    bt = OrderFlowBacktester(initial_capital=1000)
    frame = _frame_cross_up()
    # Ломаем кросс: оба бара ниже ema50
    i = len(frame) - 1
    frame.iloc[i - 1, frame.columns.get_loc("ema20")] = 104.0
    frame.iloc[i, frame.columns.get_loc("ema20")] = 104.1
    frame.iloc[i - 1, frame.columns.get_loc("ema50")] = 105.0
    frame.iloc[i, frame.columns.get_loc("ema50")] = 105.0
    diag = bt.explain_latest_signal(
        frame, strategy_type="ema_trend",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert diag["status"] == "NO_TRADE"
    assert "ema_cross" in diag["failed_checks"]


def test_explain_ema_trend_reports_signal_when_valid():
    bt = OrderFlowBacktester(initial_capital=1000)
    diag = bt.explain_latest_signal(
        _frame_cross_up(), strategy_type="ema_trend",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert diag["status"] == "SIGNAL"
    assert diag["direction"] == "LONG"
