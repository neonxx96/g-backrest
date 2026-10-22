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
    observed_ranges = []
    observed_configs = []

    monkeypatch.setattr(engine, "calculate_indicators", lambda df, **_: df.copy())

    def fake_backtest(df, **kwargs):
        # A deterministic stand-in makes the contract test independent of the
        # strategy signal implementation while preserving train/OOS ordering.
        observed_ranges.append((int(df.timestamp.iloc[0]), int(df.timestamp.iloc[-1]), len(df)))
        observed_configs.append(kwargs)
        holdout = int(df.timestamp.iloc[0]) >= 900
        return {
            "total_trades": 25 if holdout else 40,
            "roi_pct": 8.0 if len(df) >= 80 else -3.0,
            "net_pnl": 800.0 if holdout else 900.0,
            "gross_pnl": 900.0 if holdout else 1000.0,
            "total_fees_usd": 100.0,
            "win_rate_pct": 75.0,
            "profit_factor": 1.8,
            "max_drawdown_pct": 4.0,
            "recovery_factor": 2.0,
            "sharpe_ratio": 1.2,
            "sortino_ratio": 1.4,
            "wins_count": 30,
            "losses_count": 10,
            "trades": [],
            "equity_curve": [],
        }

    monkeypatch.setattr(engine, "run_backtest", fake_backtest)
    result = engine.run_genetic_optimization(
        _candles(1200),
        strategy_type="confluence_ema",
        population_size=6,
        generations=2,
        oos_ratio=0.25,
        baseline_params={
            "use_atr_filter": True, "use_oi_filter": True,
            "use_rsi_filter": True, "use_atr_sl": True,
            "atr_multiplier": 2.0, "risk_per_trade_pct": 0.5,
            "use_trailing": True, "trailing_pct": 0.7,
            "use_dynamic_breakeven": True, "dynamic_be_trigger_r": 0.6,
            "tp1_pct": 0.8, "tp1_atr_mult": 1.8,
        },
    )

    assert result["oos"]["available"] is True
    assert result["oos"]["train_candles"] == 900
    assert result["oos"]["oos_candles"] == 300
    assert result["oos"]["train_to_time"] < result["oos"]["oos_from_time"]
    assert result["oos"]["metrics"]["total_trades"] == 25
    assert result["oos"]["warning"] is None
    folds = result["walk_forward"]["folds"]
    assert len(folds) == 3
    assert all(fold["train_to_time"] < fold["validation_from_time"] for fold in folds)
    assert [fold["validation_from_time"] for fold in folds] == sorted(
        fold["validation_from_time"] for fold in folds
    )
    # All candidate/fold calls stay before the outer holdout; only the final
    # baseline and selected-candidate reports may touch it after selection.
    assert all(end < result["oos"]["oos_from_time"] for _, end, _ in observed_ranges[:-2])
    assert result["oos"]["evidence_status"] == "sufficient_evidence"
    assert observed_configs
    assert all(config["use_oi_filter"] and config["use_rsi_filter"] for config in observed_configs)
    assert all(config["risk_per_trade_pct"] == 0.5 for config in observed_configs)
    assert all(config["trailing_pct"] == 0.7 and config["tp1_pct"] == 0.8 for config in observed_configs)


def test_genetic_optimizer_warns_when_oos_sample_is_too_small():
    result = OrderFlowBacktester().run_genetic_optimization(
        _candles(300),
        strategy_type="confluence_ema",
        population_size=6,
        generations=2,
        oos_ratio=0.25,
    )

    assert result["oos"]["available"] is False
    assert result["oos"]["warning"]
    assert result["oos"]["metrics"] is None
    assert result["oos"]["evidence_status"] == "insufficient_evidence"


def test_oos_evidence_requires_both_100_candles_and_20_closed_trades(monkeypatch):
    engine = OrderFlowBacktester(initial_capital=10_000)
    monkeypatch.setattr(engine, "calculate_indicators", lambda df, **_: df.copy())

    def few_trades(df, **kwargs):
        return {
            "total_trades": 19,
            "roi_pct": 0.0,
            "net_pnl": 0.0,
            "gross_pnl": 1.0,
            "total_fees_usd": 1.0,
            "win_rate_pct": 0.0,
            "profit_factor": 0.0,
            "max_drawdown_pct": 0.0,
            "recovery_factor": 0.0,
            "sharpe_ratio": 0.0,
            "sortino_ratio": 0.0,
            "wins_count": 0,
            "losses_count": 19,
            "trades": [],
            "equity_curve": [],
        }

    monkeypatch.setattr(engine, "run_backtest", few_trades)
    result = engine.run_genetic_optimization(
        _candles(1200),
        strategy_type="confluence_ema",
        population_size=6,
        generations=2,
    )
    assert result["oos"]["oos_candles"] >= 100
    assert result["oos"]["metrics"] is None
    assert result["oos"]["evidence_status"] == "insufficient_evidence"
