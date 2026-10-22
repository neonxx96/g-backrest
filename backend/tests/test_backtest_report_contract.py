import pandas as pd

from backend.app.routers.backtest import _build_optimizer_report, _historical_oi_column, build_response


REPORT_KEYS = {"schema_version", "status", "metrics", "sample", "validation", "data_availability"}
METRIC_KEYS = {
    "net_pnl_usd", "net_pnl_pct", "gross_pnl_usd", "total_fees_usd",
    "total_slippage_usd", "win_rate_pct", "profit_factor",
    "max_drawdown_pct", "total_trades",
}


def test_backtest_report_has_stable_versioned_metrics_and_truthful_coverage():
    raw = {
        "net_pnl": 12.0, "gross_pnl": 15.0, "total_fees_usd": 2.0,
        "total_slippage_usd": 1.0, "roi_pct": 1.2, "win_rate_pct": 60.0,
        "profit_factor": 1.5, "max_drawdown_pct": 2.0, "total_trades": 5,
        "trades": [], "equity_curve": [],
    }
    result = build_response(raw, 1000, {
        "candles": 200,
        "data_availability": {
            "ohlcv_source": "Binance Futures OHLCV",
            "open_interest": {"available": False},
        },
    })

    assert set(result["report"]) == REPORT_KEYS
    assert set(result["report"]["metrics"]) == METRIC_KEYS
    assert result["report"]["metrics"]["net_pnl_usd"] == 12.0
    assert result["report"]["sample"] == {"candles": 200, "closed_trades": 5}
    assert result["data_availability"]["open_interest"]["available"] is False
    assert "Open Interest" not in result["data_engine"]["historical_sources"]


def test_optimizer_uses_same_report_envelope_and_marks_unproven_holdout():
    report = _build_optimizer_report(
        {
            "evidence_status": "insufficient_evidence", "metrics": None,
            "oos_candles": 150, "trade_count": 19,
        },
        {"fold_count": 3, "folds": []},
        {"open_interest": {"available": False}},
        1000,
    )

    assert set(report) == REPORT_KEYS
    assert report["metrics"] is None
    assert report["status"] == "insufficient_evidence"
    assert report["sample"] == {"candles": 150, "closed_trades": 19, "source_candles": 1000}
    assert report["validation"]["walk_forward"]["fold_count"] == 3
    assert report["data_availability"]["l2_history"]["available"] is False


def test_historical_oi_detection_requires_two_real_observations():
    candles = pd.DataFrame({
        "oi": [float("nan"), 42.0, float("nan")],
        "open_interest": [100.0, 101.0, 102.0],
    })
    assert _historical_oi_column(candles) == "open_interest"
    assert _historical_oi_column(pd.DataFrame({"oi": [100.0, float("nan")]})) is None
