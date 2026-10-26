"""
Monte Carlo Robustness Stress-Test (MODULARIZATION_PLAN п.3, слайс 6.4).

Тело перенесено из OrderFlowBacktester.run_monte_carlo ДОСЛОВНО (поведение 1:1,
детерминированный seed rng=42 сохранён). Реэкспортируется методом-колбэком
класса OrderFlowBacktester — внешние вызовы bt.run_monte_carlo(...) не меняются.
"""
from typing import Any, Dict, List, Optional

import numpy as np


def run_monte_carlo_simulation(
    trades: List[Dict[str, Any]],
    initial_capital: float = 10000.0,
    n_simulations: int = 500,
    actual_equity_curve: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """ТАКТ 3: 500 Bootstrap & Permutation runs (тело дословно из run_monte_carlo)."""
    n_sims = max(50, int(n_simulations))
    cap0 = max(100.0, float(initial_capital))

    if not trades:
        return {
            "simulations_count": n_sims,
            "prob_drawdown_gt_10_pct": 0.0,
            "worst_case_dd_pct": 0.0,
            "median_pnl_pct": 0.0,
            "median_pnl_usd": 0.0,
            "p5_pnl_pct": 0.0,
            "p95_pnl_pct": 0.0,
            "randomized_win_rate_p10_pct": 0.0,
            "randomized_win_rate_median_pct": 0.0,
            "robustness_score": 0,
            "verdict": "OVERFITTED",
            "badge_text": "⚠️ Риск переподгонки (Overfitted)",
            "reason": "Недостаточно сделок для подтверждения статистической устойчивости.",
            "fan_chart": [],
            "sample_paths": [],
        }

    pnl_usd_arr = np.array([float(t.get("pnl_usd", 0.0)) for t in trades], dtype=float)
    n_trades = len(pnl_usd_arr)
    rng = np.random.default_rng(42)

    # Generate 500 trajectories:
    # Half exact permutations (order stress-test for path drawdown) +
    # Half bootstrap resampling with replacement (for WinRate & PnL distribution stress-test)
    n_perm = n_sims // 2
    n_boot = n_sims - n_perm

    sim_equities = np.zeros((n_sims, n_trades + 1), dtype=float)
    sim_equities[:, 0] = cap0
    sim_win_rates = np.zeros(n_sims, dtype=float)
    sim_max_dds = np.zeros(n_sims, dtype=float)

    for s in range(n_sims):
        if s < n_perm:
            sampled = rng.permutation(pnl_usd_arr)
        else:
            idx = rng.integers(0, n_trades, size=n_trades)
            sampled = pnl_usd_arr[idx]

        eq_path = cap0 + np.cumsum(sampled)
        eq_path = np.maximum(100.0, eq_path)
        sim_equities[s, 1:] = eq_path

        wins_s = int(np.sum(sampled > 0))
        sim_win_rates[s] = (wins_s / max(1, n_trades)) * 100.0

        # Compute Max Drawdown (%) of this trajectory
        full_path = sim_equities[s]
        peaks = np.maximum.accumulate(full_path)
        dds = np.where(peaks > 0, (peaks - full_path) / peaks * 100.0, 0.0)
        sim_max_dds[s] = float(np.max(dds))

    final_pnls_usd = sim_equities[:, -1] - cap0
    final_pnls_pct = (final_pnls_usd / cap0) * 100.0

    prob_dd_gt_10 = float(np.mean(sim_max_dds > 10.0) * 100.0)
    worst_case_dd = float(np.percentile(sim_max_dds, 95))
    median_pnl_pct = float(np.median(final_pnls_pct))
    median_pnl_usd = float(np.median(final_pnls_usd))
    p5_pnl_pct = float(np.percentile(final_pnls_pct, 5))
    p95_pnl_pct = float(np.percentile(final_pnls_pct, 95))
    wr_p10 = float(np.percentile(sim_win_rates, 10))
    wr_median = float(np.median(sim_win_rates))

    # Check outlier dependency: does removing top 2 winning trades destroy profitability?
    sorted_pnls = np.sort(pnl_usd_arr)
    pnl_without_top2 = float(np.sum(sorted_pnls[:-2])) if n_trades > 2 else -1.0
    total_actual_pnl = float(np.sum(pnl_usd_arr))
    outlier_dependent = (total_actual_pnl <= 0) or (n_trades <= 3) or (n_trades >= 5 and pnl_without_top2 < 0 and total_actual_pnl > 0)

    # ТАКТ 3.2: Verdict logic
    # Robust if randomized winrate stays >= 50% (or median WR >= 50% and not dependent on 1-2 outlier trades)
    is_robust = (wr_median >= 50.0 and wr_p10 >= 45.0 and not outlier_dependent and median_pnl_pct > 0)
    if is_robust:
        verdict = "ROBUST"
        badge_text = "✅ Устойчива к рынку (Robust)"
        score = min(98, max(72, int(65 + (wr_median - 50.0) * 1.1 + min(15.0, median_pnl_pct) - prob_dd_gt_10 * 0.2)))
        reason = (
            f"При 500 перестановках Монте-Карло медианный WinRate держится на уровне {wr_median:.1f}% "
            f"(нижний квантиль {wr_p10:.1f}%), а прибыль сохраняется даже без топ-2 сделок."
        )
    else:
        verdict = "OVERFITTED"
        badge_text = "⚠️ Риск переподгонки (Overfitted)"
        score = max(18, min(58, int(45 + (wr_median - 50.0) * 0.8 - (15 if outlier_dependent else 0))))
        if outlier_dependent and total_actual_pnl > 0:
            reason = "Результат стратегии критически зависит от 1–2 случайных прибыльных сделок или малой выборки."
        else:
            reason = (
                f"При рандомизации сделок WinRate опускается до {wr_p10:.1f}% (медиана {wr_median:.1f}%), "
                f"ожидаемый Worst-Case DD достигает -{worst_case_dd:.1f}%."
            )

    # Build Fan Chart points (up to 30 steps along trade index)
    step_indices = np.linspace(0, n_trades, num=min(n_trades + 1, 30), dtype=int)
    step_indices = np.unique(step_indices)

    actual_eq_step = cap0 + np.concatenate(([0.0], np.cumsum(pnl_usd_arr)))
    gross_pnl_arr = np.array([float(t.get("gross_pnl_usd", t.get("pnl_usd", 0.0))) for t in trades], dtype=float)
    gross_eq_step = cap0 + np.concatenate(([0.0], np.cumsum(gross_pnl_arr)))

    fan_chart = []
    for idx in step_indices:
        col = sim_equities[:, idx]
        fan_chart.append({
            "step": int(idx),
            "actual": round(float(actual_eq_step[idx]), 2),
            "gross": round(float(gross_eq_step[idx]), 2),
            "p5": round(float(np.percentile(col, 5)), 2),
            "p25": round(float(np.percentile(col, 25)), 2),
            "p50": round(float(np.percentile(col, 50)), 2),
            "p75": round(float(np.percentile(col, 75)), 2),
            "p95": round(float(np.percentile(col, 95)), 2),
        })

    sample_paths = []
    for s_idx in range(min(10, n_sims)):
        sample_paths.append([round(float(sim_equities[s_idx, idx]), 2) for idx in step_indices])

    return {
        "simulations_count": n_sims,
        "prob_drawdown_gt_10_pct": round(prob_dd_gt_10, 1),
        "worst_case_dd_pct": round(worst_case_dd, 2),
        "median_pnl_pct": round(median_pnl_pct, 2),
        "median_pnl_usd": round(median_pnl_usd, 2),
        "p5_pnl_pct": round(p5_pnl_pct, 2),
        "p95_pnl_pct": round(p95_pnl_pct, 2),
        "randomized_win_rate_p10_pct": round(wr_p10, 1),
        "randomized_win_rate_median_pct": round(wr_median, 1),
        "robustness_score": int(score),
        "verdict": verdict,
        "badge_text": badge_text,
        "reason": reason,
        "fan_chart": fan_chart,
        "sample_paths": sample_paths,
    }
