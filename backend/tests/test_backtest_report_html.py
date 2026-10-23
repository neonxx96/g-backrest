"""Контрактные тесты HTML-отчёта бэктеста (задача 6.4 HTML).

Чистые функции (без TestClient, как принято в проекте):
- render_backtest_report_html — структура HTML, устойчивость к degenerate-входам;
- эндпоинт /api/backtest/report-html — тот же контракт тела, что у PDF.

Особенности HTML-рендера: inline CSS/SVG, тёмная тема, html.escape на всех
пользовательских строках, тепловая карта как таблица 7×24 с rgba-заливкой.
"""

from __future__ import annotations

import pytest

from backend.app.services.backtest_report import render_backtest_report_html


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


def test_full_payload_renders_complete_html_document():
    html = render_backtest_report_html(_full_payload())

    assert html.startswith("<!DOCTYPE html>")
    assert "</html>" in html
    assert "BTCUSDT" in html
    assert "confluence_ema" in html
    # Сводка
    assert "Net PnL" in html
    assert "-472.15$" in html
    assert "Win Rate" in html
    # Equity SVG
    assert "<svg" in html and "<polyline" in html
    # Монте-Карло
    assert "Риск переподгонки" in html
    assert "P5" in html and "P95" in html
    # Тепловая карта и сделки
    assert 'class="heatmap"' in html
    assert "Trailing Stop" in html


def test_net_pnl_color_class_follows_sign():
    pos = render_backtest_report_html(
        {"symbol": "BTCUSDT", "summary": {"net_pnl_usd": 150.0, "total_pnl_pct": 1.5}}
    )
    neg = render_backtest_report_html(
        {"symbol": "BTCUSDT", "summary": {"net_pnl_usd": -150.0, "total_pnl_pct": -1.5}}
    )
    assert 'net-pnl pos' in pos
    assert 'net-pnl neg' in neg


def test_degenerate_payload_still_renders_without_exceptions():
    html = render_backtest_report_html(
        {
            "symbol": "ETHUSDT",
            "summary": {},
            "trades": [],
            "equity_curve": [],
            "monte_carlo": None,
            "meta": {},
        }
    )

    assert html.startswith("<!DOCTYPE html>")
    assert "ETHUSDT" in html
    assert "Нет данных equity_curve" in html
    assert "Монте-Карло: нет данных" in html
    assert "Нет сделок" in html
    assert "Нет закрытых сделок" in html


def test_monte_carlo_without_sample_paths_and_empty_fan_chart():
    html = render_backtest_report_html(
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

    assert "SOLUSDT" in html
    assert "недостаточно сделок" in html.lower()


def test_trades_with_unparseable_timestamps_do_not_break_heatmap():
    payload = _full_payload()
    for t in payload["trades"]:
        t["entry_time"] = "not-a-timestamp"
    html = render_backtest_report_html(payload)

    assert html.startswith("<!DOCTYPE html>")
    # Сделки с валидными timestamp отсутствуют — все слоты пустые, но таблица есть
    assert 'class="heatmap"' in html


def test_heatmap_cells_colored_by_sign_and_magnitude():
    payload = _full_payload()
    payload["trades"] = [
        {"id": 1, "entry_time": 1_790_000_000_000, "type": "BUY",
         "entry_price": 100.0, "exit_price": 101.0, "pnl_usd": 200.0, "exit_reason": "TP"},
        {"id": 2, "entry_time": 1_790_003_600_000, "type": "SELL",
         "entry_price": 100.0, "exit_price": 99.0, "pnl_usd": -50.0, "exit_reason": "SL"},
    ]
    html = render_backtest_report_html(payload)

    assert "rgba(22,163,74," in html   # зелёная заливка прибыли
    assert "rgba(220,38,38," in html  # красная заливка убытка
    assert "Лучший слот" in html and "Худший слот" in html


def test_user_strings_escaped_against_html_injection():
    html = render_backtest_report_html(
        {
            "symbol": "<script>alert(1)</script>",
            "summary": {},
            "trades": [
                {"id": 1, "entry_time": 1_790_000_000_000, "type": "<b>BUY</b>",
                 "entry_price": 1.0, "exit_price": 1.0, "pnl_usd": 0.0,
                 "exit_reason": "<img src=x onerror=alert(1)>"}
            ],
            "meta": {},
        }
    )

    assert "<script>alert(1)</script>" not in html
    assert "<img src=x" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;img src=x" in html


@pytest.mark.parametrize("bad_value", [float("nan"), float("inf"), "oops", None])
def test_equity_curve_survives_bad_values(bad_value):
    html = render_backtest_report_html(
        {
            "symbol": "BTCUSDT",
            "summary": {},
            "equity_curve": [
                {"time": 1_790_000_000_000, "equity": bad_value},
                {"time": 1_790_003_600_000, "equity": 10000.0},
                {"time": 1_790_007_200_000, "equity": 9900.0},
            ],
            "meta": {},
        }
    )
    assert html.startswith("<!DOCTYPE html>")
