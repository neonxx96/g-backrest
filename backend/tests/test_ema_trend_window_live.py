"""ema_trend_window в live paper: evaluate/explain семантика 1:1 с бэктестом.

Сетап: свежий кросс EMA20/50 строго раньше текущего бара (в окне 8 баров),
тренд сохранён, close вернулся по стороне кросса относительно EMA20,
vol_ratio выше порога, delta по направлению.
"""

from __future__ import annotations

import pandas as pd

from backend.app.services.overnight_pilot import HISTORICAL_STRATEGIES, OPTIMIZABLE_STRATEGIES
from backend.app.services.live_paper_runner import MARKET_ENTRY_STRATEGIES, PAPER_HISTORICAL_STRATEGIES
from backend.app.services.orderflow_backtester import OrderFlowBacktester


def _base_frame() -> pd.DataFrame:
    rows = []
    for i in range(60):
        close = 100.0 + i * 0.1
        rows.append({
            "timestamp": 1_790_000_000_000 + i * 300_000,
            "open": close - 0.05, "high": close + 0.1, "low": close - 0.1,
            "close": close, "volume": 1000.0, "delta": 1.0,
        })
    df = pd.DataFrame(rows)
    return OrderFlowBacktester(initial_capital=1000).calculate_indicators(df)


def _frame_with_cross(bars_ago: int, confirm: bool = True) -> pd.DataFrame:
    """Кросс вверх ровно bars_ago баров до конца; тренд после кросса вверх.

    bars_ago=0 — кросс на текущем баре (должен быть исключён окном).
    """
    df = _base_frame()
    i = len(df) - 1
    e20 = df.columns.get_loc("ema20")
    e50 = df.columns.get_loc("ema50")
    # Базовое состояние: флэт ниже кросса
    for k in range(max(1, i - bars_ago - 1), i + 1):
        df.iloc[k, e20] = 104.0
        df.iloc[k, e50] = 105.0
    j = i - bars_ago
    if j >= 1:
        df.iloc[j - 1, e20] = 104.9
        df.iloc[j - 1, e50] = 105.0
        df.iloc[j, e20] = 105.2
        df.iloc[j, e50] = 105.0
    # После кросса тренд вверх
    for k in range(max(j, 1), i + 1):
        df.iloc[k, e20] = 105.2 + (k - j) * 0.05
        df.iloc[k, e50] = 105.0
    cur_ema20 = float(df.iloc[i, e20])
    close_col = df.columns.get_loc("close")
    low_col = df.columns.get_loc("low")
    high_col = df.columns.get_loc("high")
    df.iloc[i, close_col] = cur_ema20 + 0.5 if confirm else cur_ema20 - 0.5
    df.iloc[i, low_col] = float(df.iloc[i, close_col]) - 0.3
    df.iloc[i, high_col] = float(df.iloc[i, close_col]) + 0.3
    df.iloc[i, df.columns.get_loc("vol_ratio")] = 2.0
    df.iloc[i, df.columns.get_loc("delta")] = 5.0
    return df


def test_ema_trend_window_whitelisted_in_pilot_and_runner():
    assert "ema_trend_window" in HISTORICAL_STRATEGIES
    assert "ema_trend_window" in OPTIMIZABLE_STRATEGIES
    assert "ema_trend_window" in PAPER_HISTORICAL_STRATEGIES
    assert "ema_trend_window" in MARKET_ENTRY_STRATEGIES


def test_evaluate_signals_3_bars_after_cross_up():
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        _frame_with_cross(3), strategy_type="ema_trend_window",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is not None
    assert sig["direction"] == "LONG"
    assert any("Cross up 3 bar(s) ago" in r for r in sig["reasons"])


def test_no_signal_on_the_cross_bar_itself():
    # Кросс на текущем баре — зона ema_trend; окно его исключает (j < i)
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        _frame_with_cross(0), strategy_type="ema_trend_window",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is None


def test_no_signal_when_cross_expired():
    # Кросс 12 баров назад — вне окна 8 баров
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        _frame_with_cross(12), strategy_type="ema_trend_window",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is None


def test_no_signal_without_close_confirmation():
    # Close ниже EMA20 после ап-кросса — подтверждения нет
    bt = OrderFlowBacktester(initial_capital=1000)
    sig = bt.evaluate_latest_signal(
        _frame_with_cross(2, confirm=False), strategy_type="ema_trend_window",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is None


def test_no_signal_on_delta_mismatch():
    bt = OrderFlowBacktester(initial_capital=1000)
    frame = _frame_with_cross(2)
    frame.iloc[len(frame) - 1, frame.columns.get_loc("delta")] = -5.0
    sig = bt.evaluate_latest_signal(
        frame, strategy_type="ema_trend_window",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert sig is None


def test_explain_rejects_cross_window_when_no_recent_cross():
    bt = OrderFlowBacktester(initial_capital=1000)
    expl = bt.explain_latest_signal(
        _frame_with_cross(12), strategy_type="ema_trend_window",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert expl["status"] == "NO_TRADE"
    assert "cross_window" in expl["failed_checks"]


def test_explain_rejects_close_vs_ema20_without_confirmation():
    bt = OrderFlowBacktester(initial_capital=1000)
    expl = bt.explain_latest_signal(
        _frame_with_cross(2, confirm=False), strategy_type="ema_trend_window",
        volume_multiplier=0.5, min_density_usd=0,
    )
    assert expl["status"] == "NO_TRADE"
    assert "close_vs_ema20" in expl["failed_checks"]
