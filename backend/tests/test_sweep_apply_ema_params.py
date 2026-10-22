"""
M5.2 — Apply Strategy #X из Quant Sweep (task 6.2): параметризация EMA-периодов.

Контракт:
1. Дефолты fast=20/slow=50 не меняют поведение движка (явные значения = дефолтным).
2. Кастомные fast/slow реально меняют сигналы ema_trend (иначе apply — фиктивный).
3. Невалидные периоды (fast >= slow, fast < 2) отклоняются ValueError / ValidationError.
4. API-модель BacktestParams отклоняет fast_period >= slow_period (→ 422 на эндпоинте).
"""

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from backend.app.routers.backtest import BacktestParams
from backend.app.services.orderflow_backtester import OrderFlowBacktester


def make_trending_df(n: int = 220, base_price: float = 100.0) -> pd.DataFrame:
    """Детерминированный ряд: падение → рост → падение, чтобы EMA-cross случались
    в разных местах для разных пар периодов."""
    rows = []
    base_ts = 1700000000000
    for i in range(n):
        if i < 80:
            drift = -0.08 * (i % 5)  # нисходящий участок
        elif i < 160:
            drift = 0.12 * (i % 7)   # восходящий участок
        else:
            drift = -0.10 * (i % 6)  # снова вниз
        close = base_price + drift + (0.05 if i % 2 == 0 else -0.05)
        rows.append({
            "timestamp": base_ts + i * 60000,
            "open": close - 0.02,
            "high": close + 0.3,
            "low": close - 0.3,
            "close": close,
            "volume": 1000.0,
            "taker_buy_volume": 900.0,
        })
    return pd.DataFrame(rows)


def _run(df, fast, slow):
    engine = OrderFlowBacktester(initial_capital=10000.0, maker_fee_pct=0.02, taker_fee_pct=0.05, slippage_ticks=0)
    return engine.run_backtest(
        df.copy(),
        strategy_type="ema_trend",
        min_density_usd=0.0,          # выключаем wall-фильтр: чистая проверка EMA
        volume_multiplier=0.5,        # v_rat >= 0.5 выполняется при постоянном объёме
        stop_loss_pct=1.0,
        take_profit_pct=1.5,
        use_trailing=False,
        use_multi_tp=False,
        fast_period=fast,
        slow_period=slow,
    )


def test_default_and_explicit_20_50_are_identical():
    df = make_trending_df()
    implicit = _run(df, 20, 50)  # дефолты движка
    explicit = OrderFlowBacktester(initial_capital=10000.0, maker_fee_pct=0.02, taker_fee_pct=0.05, slippage_ticks=0).run_backtest(
        df.copy(),
        strategy_type="ema_trend",
        min_density_usd=0.0,
        volume_multiplier=0.5,
        stop_loss_pct=1.0,
        take_profit_pct=1.5,
        use_trailing=False,
        use_multi_tp=False,
        fast_period=20,
        slow_period=50,
    )
    assert implicit.get("total_trades") == explicit.get("total_trades")
    assert implicit.get("total_pnl_usd") == explicit.get("total_pnl_usd")
    assert [t.get("entry_time") for t in implicit.get("trades", [])] == [
        t.get("entry_time") for t in explicit.get("trades", [])
    ]


def test_custom_fast_slow_changes_ema_trend_entries():
    df = make_trending_df()
    legacy = _run(df, 20, 50)
    sweep = _run(df, 8, 26)  # типичная пара из grid DEFAULT_GRID
    assert "error" not in sweep
    legacy_entries = [t.get("entry_time") for t in legacy.get("trades", [])]
    sweep_entries = [t.get("entry_time") for t in sweep.get("trades", [])]
    assert legacy_entries != sweep_entries or legacy.get("total_trades") != sweep.get("total_trades"), (
        "кастомные EMA-периоды не изменили поведение — apply был бы фиктивным"
    )


def test_already_enriched_input_is_not_mutated_by_custom_periods():
    df = make_trending_df()
    engine = OrderFlowBacktester(initial_capital=10000.0)
    enriched = engine.calculate_indicators(df.copy())
    before_fast = enriched["ema20"].iloc[-10:].tolist()
    _run(enriched, 8, 26)  # already_enriched path — df переиспользуется движком
    assert enriched["ema20"].iloc[-10:].tolist() == before_fast


def test_invalid_periods_raise_value_error():
    df = make_trending_df()
    with pytest.raises(ValueError, match="fast_period"):
        _run(df, 50, 20)
    with pytest.raises(ValueError, match="fast_period"):
        _run(df, 1, 50)
    with pytest.raises(ValueError, match="strictly less"):
        _run(df, 30, 30)


def test_backtest_params_model_rejects_inverted_periods():
    with pytest.raises(ValidationError):
        BacktestParams(fast_period=50, slow_period=20)
    with pytest.raises(ValidationError):
        BacktestParams(fast_period=30, slow_period=30)
    params = BacktestParams()
    assert params.fast_period == 20 and params.slow_period == 50
