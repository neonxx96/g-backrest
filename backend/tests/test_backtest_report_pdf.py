"""Контрактные тесты PDF-отчёта бэктеста (задача 6.5).

Чистые функции (без TestClient, как принято в проекте):
- render_backtest_report_pdf — структура PDF, устойчивость к degenerate-входам;
- BacktestReportRequest — валидация payload фронта (только symbol обязателен).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.app.routers.backtest import BacktestReportRequest
from backend.app.services.backtest_report import render_backtest_report_pdf


def _full_payload() -> dict:
    base_ts = 1_790_000_000_000  # фиксированный epoch-ms
    return {
        "symbol": "BTCUSDT",
        "timeframe": "15m",
        "strategy_type": "confluence_ema",
        "initial_capital": 10000.0,
        "summary": {
            "total_pnl_pct": -4.72,
            "net_pnl_usd": -472.15,
            "gross_pnl_usd": -218.31,
            "gross_pnl_pct": -2.18,
            "total_fees_usd": 180.59,
            "total_slippage_usd": 73.25,
            "total_exchange_cost_usd": 253.84,
            "recovery_factor": -1.0,
            "win_rate_pct": 18.18,
            "total_trades": 4,
            "winning_trades": 1,
            "losing_trades": 3,
            "profit_factor": 0.38,
            "max_drawdown_pct": 4.72,
            "sharpe_ratio": -2.77,
            "sortino_ratio": -3.21,
        },
        "trades": [
            {
                "id": i + 1,
                "entry_time": base_ts + i * 3_600_000,
                "exit_time": base_ts + i * 3_600_000 + 1_800_000,
                "type": "SELL" if i % 2 else "BUY",
                "direction": "SHORT" if i % 2 else "LONG",
                "entry_price": 86000.0 + i * 10,
                "exit_price": 85900.0 + i * 10,
                "gross_pnl_usd": -10.0 + i,
                "fee_paid_usd": 4.0,
                "slippage_cost_usd": 1.5,
                "pnl_usd": -15.5 + i * 2,
                "pnl_pct": -0.5,
                "exit_reason": "Trailing Stop",
            }
            for i in range(4)
        ],
        "equity_curve": [
            {"time": base_ts + i * 3_600_000, "equity": 10000.0 - i * 50, "gross_equity": 10000.0 - i * 20}
            for i in range(12)
        ],
        "monte_carlo": {
            "simulations_count": 500,
            "verdict": "OVERFITTED",
            "reason": "Недостаточно прибыли над комиссиями",
            "badge_text": "⚠️ Риск переподгонки (Overfitted)",
            "robustness_score": 12,
            "prob_drawdown_gt_10_pct": 41.0,
            "worst_case_dd_pct": 12.5,
            "fan_chart": [
                {
                    "p5": 9900 - i * 5, "p25": 9950 - i * 3, "p50": 10000 - i * 2,
                    "p75": 10050 - i, "p95": 10100, "actual": 10000 - i * 10,
                    "gross": 10000 - i * 4,
                }
                for i in range(10)
            ],
            "sample_paths": [[10000 + j * (i - 3) for j in range(10)] for i in range(8)],
        },
        "meta": {
            "candles": 2880,
            "from_time": base_ts,
            "to_time": base_ts + 30 * 86_400_000,
            "requested_days": 30,
            "strategy_type": "confluence_ema",
        },
        # legacy-ключи ответа — extra="allow" не должен ломать генерацию
        "net_pnl": -472.15,
        "total_trades": 4,
    }


def _pdf_pages_count(pdf_bytes: bytes) -> int:
    """Количество страниц без внешних зависимостей: /Type /Page минус /Type /Pages."""
    return pdf_bytes.count(b"/Type /Page") - pdf_bytes.count(b"/Type /Pages")


def test_full_payload_renders_valid_three_page_pdf():
    pdf = render_backtest_report_pdf(_full_payload())

    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 10_000
    assert _pdf_pages_count(pdf) == 3


def test_degenerate_payload_still_renders_without_exceptions():
    pdf = render_backtest_report_pdf(
        {
            "symbol": "ETHUSDT",
            "summary": {},
            "trades": [],
            "equity_curve": [],
            "monte_carlo": None,
            "meta": {},
        }
    )

    assert pdf.startswith(b"%PDF-")
    assert _pdf_pages_count(pdf) == 3


def test_monte_carlo_without_sample_paths_and_empty_fan_chart():
    pdf = render_backtest_report_pdf(
        {
            "symbol": "SOLUSDT",
            "summary": {"net_pnl_usd": 0.0, "total_trades": 0},
            "trades": [],
            "equity_curve": [{"time": 1_790_000_000_000, "equity": 10000.0}],
            "monte_carlo": {
                "simulations_count": 0,
                "verdict": "OVERFITTED",
                "fan_chart": [],
                "sample_paths": [],
            },
            "meta": {},
        }
    )

    assert pdf.startswith(b"%PDF-")
    assert _pdf_pages_count(pdf) == 3


def test_trades_with_unparseable_timestamps_do_not_break_heatmap():
    payload = _full_payload()
    for t in payload["trades"]:
        t["entry_time"] = "not-a-timestamp"
    pdf = render_backtest_report_pdf(payload)

    assert pdf.startswith(b"%PDF-")


def test_report_request_requires_symbol_and_allows_extras():
    with pytest.raises(ValidationError):
        BacktestReportRequest(summary={})

    req = BacktestReportRequest(symbol="BTCUSDT", net_pnl=1.0, unknown_key={"a": 1})
    dumped = req.model_dump()
    assert dumped["symbol"] == "BTCUSDT"
    assert dumped["net_pnl"] == 1.0
    assert dumped["unknown_key"] == {"a": 1}
    assert dumped["trades"] == []
    assert dumped["monte_carlo"] is None
