"""Golden (characterization) test for the order-flow backtest core.

Purpose: freeze the numerical behaviour of ``OrderFlowBacktester.run_backtest``
so that ANY change in the money/risk math (fees, slippage, TP/SL, trailing,
scaling-out, drawdown, Sharpe/Sortino, Monte Carlo) makes the suite fail.

Properties required by the task:
- No network access: the OHLCV fixture is a static CSV committed to the repo.
- No randomness at test time: the fixture was generated once with a fixed seed
  (see ``fixture_seed`` in the expected file) and Monte Carlo inside the engine
  uses its own fixed ``default_rng(42)``.
- Expected metrics live in a separate data file (``golden_backtest_expected.json``).

If a deliberate engine change is made, the expected file must be regenerated and
the diff reviewed by a human — that is exactly the point of this test.
"""

import json
from pathlib import Path

import pandas as pd
import pytest

from backend.app.services.orderflow_backtester import OrderFlowBacktester

FIXTURES_DIR = Path(__file__).parent / "fixtures"
FIXTURE_CSV = FIXTURES_DIR / "golden_ohlcv.csv"
EXPECTED_JSON = FIXTURES_DIR / "golden_backtest_expected.json"

# Float metrics are compared exactly: the engine already rounds every value it
# returns, so any drift in the math changes the JSON snapshot.
EXACT_METRIC_KEYS = [
    "final_equity", "gross_final_equity", "net_pnl", "roi_pct", "gross_pnl", "gross_roi_pct",
    "total_fees_usd", "total_slippage_usd", "total_exchange_cost_usd", "recovery_factor",
    "sharpe_ratio", "sortino_ratio", "total_trades", "wins_count", "losses_count",
    "win_rate_pct", "profit_factor", "max_drawdown_pct", "max_drawdown_usd",
]
EXACT_MC_KEYS = [
    "simulations_count", "prob_drawdown_gt_10_pct", "worst_case_dd_pct", "median_pnl_pct",
    "median_pnl_usd", "p5_pnl_pct", "p95_pnl_pct", "randomized_win_rate_p10_pct",
    "randomized_win_rate_median_pct", "robustness_score", "verdict",
]


@pytest.fixture(scope="module")
def expected() -> dict:
    with open(EXPECTED_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def golden_df() -> pd.DataFrame:
    return pd.read_csv(FIXTURE_CSV)


def _run_scenario(golden_df: pd.DataFrame, params: dict) -> dict:
    backtester = OrderFlowBacktester(initial_capital=10000.0)
    return backtester.run_backtest(golden_df, compute_monte_carlo=True, **params)


def test_golden_fixture_is_frozen(expected: dict, golden_df: pd.DataFrame) -> None:
    """The fixture itself must not change silently."""
    assert len(golden_df) == expected["fixture_bars"]
    assert list(golden_df.columns) == [
        "timestamp", "open", "high", "low", "close", "volume", "taker_buy_volume",
    ]
    assert expected["fixture_seed"] == 42


def test_golden_scenario_names_match(expected: dict) -> None:
    """Guard against an expected-file/scenario drift."""
    assert sorted(expected["scenarios"].keys()) == sorted([
        "trailing_default", "tp_scaling_out", "breakeven_scalp", "wide_tp_stop_loss",
    ])


@pytest.mark.parametrize("scenario_name", [
    "trailing_default",
    "tp_scaling_out",
    "breakeven_scalp",
    "wide_tp_stop_loss",
])
def test_golden_backtest_metrics_are_stable(expected: dict, golden_df: pd.DataFrame, scenario_name: str) -> None:
    """Exact snapshot of every money/risk metric for each frozen scenario."""
    scenario = expected["scenarios"][scenario_name]
    result = _run_scenario(golden_df, scenario["params"])

    assert "error" not in result, f"engine returned an error: {result.get('error')}"

    actual_metrics = {k: result[k] for k in EXACT_METRIC_KEYS}
    assert actual_metrics == scenario["metrics"], (
        f"Backtest metrics changed for scenario '{scenario_name}'.\n"
        f"Expected: {scenario['metrics']}\n"
        f"Actual:   {actual_metrics}"
    )

    actual_mc = {k: result["monte_carlo"][k] for k in EXACT_MC_KEYS}
    assert actual_mc == scenario["monte_carlo"], (
        f"Monte Carlo metrics changed for scenario '{scenario_name}'.\n"
        f"Expected: {scenario['monte_carlo']}\n"
        f"Actual:   {actual_mc}"
    )


@pytest.mark.parametrize("scenario_name", [
    "trailing_default",
    "tp_scaling_out",
    "breakeven_scalp",
    "wide_tp_stop_loss",
])
def test_golden_exit_reasons_are_stable(expected: dict, golden_df: pd.DataFrame, scenario_name: str) -> None:
    """Exit-path coverage is frozen too (trailing / TP1+TP2 / breakeven / stop loss)."""
    scenario = expected["scenarios"][scenario_name]
    result = _run_scenario(golden_df, scenario["params"])

    exit_reasons: dict = {}
    for trade in result["trades"]:
        reason = trade.get("exit_reason")
        exit_reasons[reason] = exit_reasons.get(reason, 0) + 1

    assert exit_reasons == scenario["exit_reasons"], (
        f"Exit reasons changed for scenario '{scenario_name}'.\n"
        f"Expected: {scenario['exit_reasons']}\n"
        f"Actual:   {exit_reasons}"
    )


def test_golden_fixture_has_no_nan_and_is_ordered(golden_df: pd.DataFrame) -> None:
    """Sanity: the frozen fixture is clean and strictly time-ordered."""
    assert not golden_df.isna().any().any()
    assert golden_df["timestamp"].is_monotonic_increasing
    assert (golden_df["high"] >= golden_df["low"]).all()
    assert (golden_df["volume"] > 0).all()
