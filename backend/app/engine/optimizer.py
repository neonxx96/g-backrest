"""
Institutional Walk-Forward Optimizer & Anti-Overfitting Engine for SignalScript.
Provides vectorized hyperparameter optimization over massive Parquet datasets with:
- Strict In-Sample (Train) / Out-of-Sample (OOS) chronological splitting (Zero Look-Ahead)
- Rolling Walk-Forward Analysis (WFA) windows
- Pure Pandas / NumPy vectorization (Zero `iterrows()`)
- Institutional scoring with penalties for high drawdown, low trade frequency, and overfitting degradation
"""

import itertools
import math
from typing import Dict, Any, List, Optional, Tuple, Callable, Union

import numpy as np
import pandas as pd

from backend.app.engine.indicators import (
    compute_ema,
    compute_atr,
    compute_cvd,
    compute_rsi,
    compute_supertrend,
)


def split_train_oos(df: pd.DataFrame, train_ratio: float = 0.7) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Chronologically splits DataFrame into In-Sample (Train) and Out-of-Sample (OOS, Test).
    Zero future leakage: strictly first `train_ratio` bars for train, remaining for OOS.
    """
    if df.empty:
        return df.copy(), df.copy()

    split_idx = int(len(df) * float(train_ratio))
    train_df = df.iloc[:split_idx].reset_index(drop=True)
    oos_df = df.iloc[split_idx:].reset_index(drop=True)
    return train_df, oos_df


def generate_walk_forward_windows(
    df: pd.DataFrame, train_bars: int, test_bars: int, step_bars: Optional[int] = None
) -> List[Tuple[pd.DataFrame, pd.DataFrame, int]]:
    """
    Generates sequential rolling Walk-Forward Analysis (WFA) windows:
    [Train Window] -> [Unseen Test Window], rolling forward by `step_bars`.
    """
    total_bars = len(df)
    step = step_bars or test_bars
    windows = []
    window_idx = 0
    start = 0

    while start + train_bars + test_bars <= total_bars:
        train_end = start + train_bars
        test_end = train_end + test_bars

        train_slice = df.iloc[start:train_end].reset_index(drop=True)
        test_slice = df.iloc[train_end:test_end].reset_index(drop=True)

        windows.append((train_slice, test_slice, window_idx))
        window_idx += 1
        start += step

    return windows


def evaluate_vectorized_signals(
    df: pd.DataFrame,
    signals: np.ndarray,
    maker_fee_pct: float = 0.02,
    taker_fee_pct: float = 0.05,
    slippage_pct: float = 0.03,
) -> Dict[str, Any]:
    """
    High-speed vectorized performance evaluation without iterating rows.
    Calculates returns, equity curve, max drawdown, Sharpe, win-rate, and trade count.
    """
    n = len(df)
    if n < 5 or len(signals) != n:
        return {
            "net_return_pct": 0.0,
            "sharpe": 0.0,
            "sortino": 0.0,
            "max_drawdown_pct": 100.0,
            "trade_count": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
        }

    closes = df["close"].values
    # Next-bar price returns: r_{t+1} = close_{t+1} / close_t - 1.0
    price_returns = np.zeros(n)
    price_returns[:-1] = (closes[1:] / closes[:-1]) - 1.0

    # Strategy returns = position_{t} * price_return_{t} (zero lookahead: signal on bar t affects bar t+1)
    pos = signals.astype(float)
    strat_returns = pos * price_returns

    # Fee and slippage calculation on position transitions
    pos_diff = np.zeros(n)
    pos_diff[1:] = np.abs(pos[1:] - pos[:-1])
    pos_diff[0] = 1.0 if pos[0] != 0 else 0.0

    # Entry/exit turnover cost = fee + slippage
    cost_pct = (taker_fee_pct + slippage_pct) / 100.0
    turnover_costs = pos_diff * cost_pct

    net_returns = strat_returns - turnover_costs

    # Equity curve
    equity = np.cumprod(1.0 + net_returns)
    total_net_return_pct = float((equity[-1] - 1.0) * 100.0)

    # Maximum Drawdown (Vectorized peak-to-trough)
    running_max = np.maximum.accumulate(equity)
    drawdowns = (equity - running_max) / running_max
    max_dd_pct = float(np.abs(np.min(drawdowns)) * 100.0) if len(drawdowns) > 0 else 0.0

    # Annualized Sharpe (assuming 15m/1h bars scaled to 365 days)
    mean_ret = float(np.mean(net_returns))
    std_ret = float(np.std(net_returns))
    periods_per_year = 365.0 * 24.0  # default 1h scale
    sharpe = float((mean_ret / (std_ret + 1e-9)) * math.sqrt(periods_per_year)) if std_ret > 1e-9 else 0.0

    # Trade counting & win rate
    entries = np.where((pos[:-1] == 0) & (pos[1:] != 0))[0]
    trade_count = int(len(entries))

    # Segment PnL per trade block
    diff_mask = np.diff(pos, prepend=0) != 0
    trade_ids = np.cumsum(diff_mask)
    if trade_count > 0:
        trades_df = pd.DataFrame({"trade_id": trade_ids, "ret": net_returns, "pos": pos})
        trade_pnls = trades_df[trades_df["pos"] != 0].groupby("trade_id")["ret"].sum()
        wins = (trade_pnls > 0).sum()
        win_rate = float((wins / len(trade_pnls)) * 100.0) if len(trade_pnls) > 0 else 0.0

        pos_sum = trade_pnls[trade_pnls > 0].sum()
        neg_sum = np.abs(trade_pnls[trade_pnls < 0].sum())
        profit_factor = float(pos_sum / (neg_sum + 1e-9)) if neg_sum > 1e-9 else 9.99
    else:
        win_rate = 0.0
        profit_factor = 0.0

    return {
        "net_return_pct": round(total_net_return_pct, 2),
        "sharpe": round(sharpe, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "trade_count": trade_count,
        "win_rate": round(win_rate, 1),
        "profit_factor": round(profit_factor, 2),
    }


def compute_institutional_score(
    metrics: Dict[str, Any], min_trades: int = 25, max_acceptable_dd_pct: float = 20.0
) -> float:
    """
    Calculates penalized institutional score.
    Penalizes:
    - High max drawdown (quadratic penalty beyond max_acceptable_dd_pct)
    - Low trade sample size (< min_trades)
    """
    sharpe = metrics.get("sharpe", 0.0)
    dd = metrics.get("max_drawdown_pct", 100.0)
    trades = metrics.get("trade_count", 0)

    if trades < 3:
        return -999.0

    # 1. Trade count penalty: min(1.0, (trades / min_trades)^1.2)
    trade_penalty = min(1.0, (trades / float(min_trades)) ** 1.2) if min_trades > 0 else 1.0

    # 2. Drawdown penalty
    if dd <= max_acceptable_dd_pct:
        dd_penalty = 1.0 - (dd / 100.0) * 0.5
    else:
        excess_dd = dd - max_acceptable_dd_pct
        dd_penalty = max(0.01, 1.0 - (excess_dd / 50.0) ** 1.5)

    base = max(0.0, sharpe + 1.0) if sharpe >= -1.0 else 0.0
    score = base * trade_penalty * dd_penalty
    return round(float(score), 3)


class WalkForwardOptimizer:
    """
    Institutional Walk-Forward & Train/OOS Hyperparameter Optimizer.
    Finds optimal parameter combinations on In-Sample data, evaluates robustness
    on Out-of-Sample (OOS) data, and flags overfitted parameter sets.
    """

    def __init__(
        self,
        min_trades: int = 20,
        max_acceptable_dd: float = 25.0,
        oos_degradation_threshold: float = 0.45,
    ):
        self.min_trades = min_trades
        self.max_acceptable_dd = max_acceptable_dd
        self.oos_degradation_threshold = oos_degradation_threshold

    @staticmethod
    def generate_ema_trend_signals(df: pd.DataFrame, fast_period: int, slow_period: int) -> np.ndarray:
        """Vectorized EMA trend signals (1 = Long, -1 = Short)."""
        ema_fast = compute_ema(df["close"], fast_period).values
        ema_slow = compute_ema(df["close"], slow_period).values

        signals = np.zeros(len(df))
        signals[ema_fast > ema_slow] = 1.0
        signals[ema_fast < ema_slow] = -1.0
        return signals

    @staticmethod
    def generate_supertrend_signals(df: pd.DataFrame, period: int, multiplier: float) -> np.ndarray:
        """Vectorized SuperTrend direction signals (1 = Long, -1 = Short)."""
        st_df = compute_supertrend(df, period=period, multiplier=multiplier)
        return st_df["direction"].values

    def run_strategy_vectorized(
        self, df: pd.DataFrame, strategy_type: str, params: Dict[str, Any]
    ) -> np.ndarray:
        """Generates signal array for requested strategy and parameters."""
        if strategy_type == "ema_cross":
            fast = int(params.get("fast_period", 12))
            slow = int(params.get("slow_period", 26))
            return self.generate_ema_trend_signals(df, fast, slow)
        elif strategy_type == "supertrend":
            period = int(params.get("period", 10))
            mult = float(params.get("multiplier", 3.0))
            return self.generate_supertrend_signals(df, period, mult)
        elif strategy_type == "cvd_momentum":
            fast = int(params.get("fast_period", 10))
            slow = int(params.get("slow_period", 30))
            ema_sig = self.generate_ema_trend_signals(df, fast, slow)
            # Add CVD volume delta confirmation
            cvd_df = compute_cvd(df, smooth_period=14)
            cvd_slope = np.zeros(len(df))
            cvd_slope[1:] = np.diff(cvd_df["cvd_ema"].values)
            cvd_filter = np.sign(cvd_slope)
            return np.where(ema_sig == cvd_filter, ema_sig, 0.0)
        else:
            # Default fallback to EMA cross
            return self.generate_ema_trend_signals(df, 12, 26)

    def optimize_train_oos(
        self,
        df: pd.DataFrame,
        param_grid: Dict[str, List[Any]],
        strategy_type: str = "ema_cross",
        train_ratio: float = 0.7,
        top_k: int = 5,
    ) -> Dict[str, Any]:
        """
        Executes Train (In-Sample) optimization and evaluates top performers on Out-of-Sample (OOS).
        Returns complete leaderboard and Overfitting diagnostics.
        """
        train_df, oos_df = split_train_oos(df, train_ratio=train_ratio)

        keys = list(param_grid.keys())
        combinations = [dict(zip(keys, v)) for v in itertools.product(*param_grid.values())]

        train_results = []

        # 1. Evaluate all combinations on In-Sample (Train)
        for p in combinations:
            signals_train = self.run_strategy_vectorized(train_df, strategy_type, p)
            metrics_train = evaluate_vectorized_signals(train_df, signals_train)
            score_train = compute_institutional_score(
                metrics_train, min_trades=self.min_trades, max_acceptable_dd_pct=self.max_acceptable_dd
            )

            train_results.append({
                "params": p,
                "train_metrics": metrics_train,
                "train_score": score_train,
            })

        # Rank by In-Sample score
        train_results.sort(key=lambda x: x["train_score"], reverse=True)
        top_candidates = train_results[:top_k]

        # 2. Evaluate top candidates on Unseen Out-of-Sample (OOS)
        leaderboard = []
        for cand in top_candidates:
            p = cand["params"]
            signals_oos = self.run_strategy_vectorized(oos_df, strategy_type, p)
            metrics_oos = evaluate_vectorized_signals(oos_df, signals_oos)
            score_oos = compute_institutional_score(
                metrics_oos, min_trades=max(5, int(self.min_trades * (1.0 - train_ratio))),
                max_acceptable_dd_pct=self.max_acceptable_dd
            )

            # Overfitting degradation calculation
            train_sharpe = max(0.01, cand["train_metrics"]["sharpe"])
            oos_sharpe = metrics_oos["sharpe"]
            sharpe_degradation = round(float(oos_sharpe / train_sharpe), 2)

            if oos_sharpe <= 0 or sharpe_degradation < self.oos_degradation_threshold:
                verdict = "OVERFITTED"
            elif sharpe_degradation >= 0.7 and metrics_oos["trade_count"] >= 5:
                verdict = "ROBUST"
            else:
                verdict = "MODERATE"

            leaderboard.append({
                "params": p,
                "train_metrics": cand["train_metrics"],
                "train_score": cand["train_score"],
                "oos_metrics": metrics_oos,
                "oos_score": score_oos,
                "sharpe_degradation": sharpe_degradation,
                "verdict": verdict,
            })

        best_candidate = leaderboard[0] if leaderboard else None

        return {
            "strategy_type": strategy_type,
            "total_bars": len(df),
            "train_bars": len(train_df),
            "oos_bars": len(oos_df),
            "combinations_tested": len(combinations),
            "best_candidate": best_candidate,
            "leaderboard": leaderboard,
        }

    def optimize_walk_forward(
        self,
        df: pd.DataFrame,
        param_grid: Dict[str, List[Any]],
        train_bars: int = 1000,
        test_bars: int = 300,
        strategy_type: str = "ema_cross",
        top_k: int = 3,
    ) -> Dict[str, Any]:
        """
        Executes rolling Walk-Forward Analysis (WFA) across historical periods.
        """
        windows = generate_walk_forward_windows(df, train_bars=train_bars, test_bars=test_bars)
        if not windows:
            return {"error": "Insufficient bars for specified train/test window sizes", "windows_count": 0}

        wfa_results = []
        for train_slice, test_slice, w_idx in windows:
            opt_step = self.optimize_train_oos(
                df=pd.concat([train_slice, test_slice], ignore_index=True),
                param_grid=param_grid,
                strategy_type=strategy_type,
                train_ratio=float(len(train_slice)) / float(len(train_slice) + len(test_slice)),
                top_k=top_k,
            )
            wfa_results.append({
                "window": w_idx,
                "train_from_ts": int(train_slice["timestamp"].iloc[0]),
                "train_to_ts": int(train_slice["timestamp"].iloc[-1]),
                "test_from_ts": int(test_slice["timestamp"].iloc[0]),
                "test_to_ts": int(test_slice["timestamp"].iloc[-1]),
                "best_params": opt_step["best_candidate"]["params"] if opt_step["best_candidate"] else {},
                "oos_metrics": opt_step["best_candidate"]["oos_metrics"] if opt_step["best_candidate"] else {},
                "verdict": opt_step["best_candidate"]["verdict"] if opt_step["best_candidate"] else "UNKNOWN",
            })

        # Aggregated OOS performance
        robust_count = sum(1 for w in wfa_results if w["verdict"] == "ROBUST")
        overfit_count = sum(1 for w in wfa_results if w["verdict"] == "OVERFITTED")

        return {
            "windows_count": len(windows),
            "train_bars": train_bars,
            "test_bars": test_bars,
            "robust_windows": robust_count,
            "overfit_windows": overfit_count,
            "wfa_windows": wfa_results,
        }


# Singleton optimizer instance
wf_optimizer = WalkForwardOptimizer()
