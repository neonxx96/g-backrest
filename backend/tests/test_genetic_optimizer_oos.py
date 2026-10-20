import pandas as pd

from backend.app.services.orderflow_backtester import OrderFlowBacktester


def _candles(count: int = 120) -> pd.DataFrame:
    return pd.DataFrame({
        "timestamp": list(range(count)),
        "open": [100.0] * count,
        "high": [101.0] * count,
        "low": [99.0] * count,
        "close": [100.0] * count,
        "volume": [10.0] * count,
        "taker_buy_base_volume": [5.0] * count,
    })


def test_genetic_optimizer_reports_chronological_oos_without_leakage(monkeypatch):
    engine = OrderFlowBacktester(initial_capital=10_000)

    monkeypatch.setattr(engine, "calculate_indicators", lambda df, **_: df.copy())

    def fake_backtest(df, **kwargs):
        # A deterministic stand-in makes the contract test independent of the
        # strategy signal implementation while preserving train/OOS ordering.
        return {
            "total_trades": 4 if len(df) >= 80 else 2,
            "roi_pct": 8.0 if len(df) >= 80 else -3.0,
            "net_pnl": 800.0 if len(df) >= 80 else -300.0,
            "gross_pnl": 900.0 if len(df) >= 80 else -250.0,
            "total_fees_usd": 100.0 if len(df) >= 80 else 50.0,
            "win_rate_pct": 75.0,
            "profit_factor": 1.8,
            "max_drawdown_pct": 4.0,
            "recovery_factor": 2.0,
            "sharpe_ratio": 1.2,
            "sortino_ratio": 1.4,
            "wins_count": 3,
            "losses_count": 1,
            "trades": [],
            "equity_curve": [],
        }

    monkeypatch.setattr(engine, "run_backtest", fake_backtest)
    result = engine.run_genetic_optimization(
        _candles(),
        strategy_type="confluence_ema",
        population_size=6,
        generations=2,
        oos_ratio=0.25,
        min_oos_candles=20,
    )

    assert result["oos"]["available"] is True
    assert result["oos"]["train_candles"] == 90
    assert result["oos"]["oos_candles"] == 30
    assert result["oos"]["train_to_time"] < result["oos"]["oos_from_time"]
    assert result["oos"]["metrics"]["total_trades"] == 2
    assert result["oos"]["warning"] is None


def test_genetic_optimizer_warns_when_oos_sample_is_too_small():
    result = OrderFlowBacktester().run_genetic_optimization(
        _candles(40),
        strategy_type="confluence_ema",
        population_size=6,
        generations=2,
        oos_ratio=0.25,
        min_oos_candles=20,
    )

    assert result["oos"]["available"] is False
    assert result["oos"]["warning"]
    assert result["oos"]["metrics"] is None
