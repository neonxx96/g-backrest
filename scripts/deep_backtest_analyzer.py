#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Deep Backtest Analyzer (Lead Quant Data Scientist Suite)
=========================================================
Performs institutional deep analytics on order-flow backtests:
1. Historical Parquet dataset ingestion with zero look-ahead bias
2. Realistic execution engine simulation (Maker/Taker fees, slippage ticks, Multi-TP)
3. Deep Quantitative Excursion Metrics:
   - MFE / MAE (Maximum Favorable/Adverse Excursion) in %, $ and R-multiples
   - Edge Ratio (Avg MFE / Avg MAE) & MFE Capture Efficiency
   - MFE Bleed identification (peak >= 0.5R -> closed at BE/SL)
4. Fee Drag & Slippage Cost (Gross PnL vs Net PnL friction analysis)
5. Time-in-Trade holding period dynamics (Winners vs Losers)
6. Consecutive win/loss streaks and drawdown tracking
7. Trade frequency-adjusted Sharpe and Sortino ratios
8. Full CSV history export to backend/logs/deep_trades_export.csv
"""

import sys
import os
import argparse
import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

import numpy as np
import pandas as pd

# Set UTF-8 output encoding for Windows terminal
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.orderflow_backtester import OrderFlowBacktester
from backend.app.services.execution_simulator import (
    ExecutionSimulator,
    OrderConfig,
    OrderSide,
    OrderType,
    DEFAULT_MAKER_FEE,
    DEFAULT_TAKER_FEE,
)


def load_parquet_history(
    symbol: str = "BTCUSDT",
    timeframe: str = "5m",
    days: int = 3,
) -> Tuple[pd.DataFrame, float]:
    """
    Loads local Parquet dataset from backend/data/history/{symbol}_{timeframe}.parquet.
    Filters for the last `days` window.
    """
    clean_sym = symbol.strip().upper()
    clean_tf = timeframe.strip().lower()
    parquet_path = REPO_ROOT / "backend" / "data" / "history" / f"{clean_sym}_{clean_tf}.parquet"

    if not parquet_path.exists():
        # Fallback to historical_loader if file is missing
        print(f"[DATA] Parquet {parquet_path.name} not found. Attempting historical_data_loader...")
        from backend.app.services.historical_data_loader import historical_loader
        df = historical_loader.load_dataset_sync(clean_sym, clean_tf, days=days)
    else:
        print(f"[DATA] Loading local institutional cache: {parquet_path.relative_to(REPO_ROOT)}")
        df = pd.read_parquet(parquet_path)

    if df is None or df.empty:
        raise ValueError(f"No historical data available for {clean_sym} {clean_tf}")

    df = df.sort_values("timestamp").reset_index(drop=True)

    # Standardize column naming
    if "taker_buy_base_volume" in df.columns and "taker_buy_volume" not in df.columns:
        df["taker_buy_volume"] = df["taker_buy_base_volume"]
    if "delta" not in df.columns and "taker_buy_volume" in df.columns:
        df["delta"] = 2.0 * df["taker_buy_volume"] - df["volume"]
    elif "delta" not in df.columns and "volume_delta" in df.columns:
        df["delta"] = df["volume_delta"]

    # Filter by days
    max_ts = int(df["timestamp"].max())
    min_ts_overall = int(df["timestamp"].min())
    window_ms = int(days * 24 * 3600 * 1000)
    cutoff_ts = max_ts - window_ms

    df_slice = df[df["timestamp"] >= cutoff_ts].copy().reset_index(drop=True)

    # If window gave fewer than 60 bars (warmup requirement), expand window
    if len(df_slice) < 60:
        bars_needed = max(60, int(days * 24 * 60 / 5))
        df_slice = df.tail(bars_needed).copy().reset_index(drop=True)

    actual_days = (df_slice["timestamp"].max() - df_slice["timestamp"].min()) / (1000.0 * 86400.0)
    print(
        f"[DATA] Active window: {len(df_slice)} bars ({actual_days:.2f} days) | "
        f"From: {pd.to_datetime(df_slice['timestamp'].min(), unit='ms', utc=True)} | "
        f"To: {pd.to_datetime(df_slice['timestamp'].max(), unit='ms', utc=True)}"
    )
    return df_slice, actual_days


def run_quant_backtest(
    df: pd.DataFrame,
    strategy: str = "confluence_ema",
    initial_capital: float = 10000.0,
    maker_fee_pct: float = 0.02,
    taker_fee_pct: float = 0.05,
    slippage_ticks: int = 2,
    stop_loss_pct: float = 0.8,
    take_profit_pct: float = 1.5,
    leverage: float = 1.0,
) -> Dict[str, Any]:
    """
    Initializes and executes OrderFlowBacktester with realistic execution simulation.
    """
    print(
        f"[EXEC] Initializing OrderFlowBacktester with ExecutionSimulator parameters:\n"
        f"       Capital: ${initial_capital:,.2f} | Leverage: {leverage}x | SL: {stop_loss_pct}% | TP: {take_profit_pct}%\n"
        f"       Maker Fee: {maker_fee_pct}% | Taker Fee: {taker_fee_pct}% | Impulse Slippage: {slippage_ticks} ticks"
    )
    backtester = OrderFlowBacktester(
        initial_capital=initial_capital,
        maker_fee_pct=maker_fee_pct,
        taker_fee_pct=taker_fee_pct,
        slippage_ticks=slippage_ticks,
    )

    result = backtester.run_backtest(
        df,
        strategy_type=strategy,
        take_profit_pct=take_profit_pct,
        stop_loss_pct=stop_loss_pct,
        use_trailing=True,
        trailing_pct=0.5,
        leverage=leverage,
        maker_fee_pct=maker_fee_pct,
        taker_fee_pct=taker_fee_pct,
        slippage_ticks=slippage_ticks,
        use_multi_tp=True,
        tp1_pct=0.6,
        tp1_atr_mult=1.5,
        compute_monte_carlo=True,
    )

    return result


def analyze_deep_trades(
    raw_trades: List[Dict[str, Any]],
    df: pd.DataFrame,
    initial_capital: float,
    stop_loss_pct: float,
    actual_days: float,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Calculates institutional quant metrics across all trades:
    - MFE, MAE, R-multiples, MFE capture efficiency
    - MFE bleed identification
    - Time-in-trade holding statistics
    - Consecutive win/loss streaks
    - Trade-frequency adjusted Sharpe and Sortino ratios
    """
    if not raw_trades:
        return [], {}

    planned_risk_usd = (stop_loss_pct / 100.0) * initial_capital
    analyzed_trades: List[Dict[str, Any]] = []

    cum_gross = 0.0
    cum_net = 0.0

    # Ensure df is indexed or ready for fast timestamp slicing
    ts_array = df["timestamp"].values
    high_array = df["high"].values
    low_array = df["low"].values

    for idx, t in enumerate(raw_trades, start=1):
        entry_ts = int(t["entry_time"])
        exit_ts = int(t["exit_time"])
        direction = t["direction"].upper()
        entry_px = float(t["entry_price"])
        exit_px = float(t["exit_price"])
        pnl_usd = float(t["pnl_usd"])
        pnl_pct = float(t["pnl_pct"])
        gross_usd = float(t.get("gross_pnl_usd", pnl_usd))
        gross_pct = float(t.get("gross_pnl_pct", pnl_pct))
        fee_usd = float(t.get("fee_paid_usd", 0.0))
        slip_usd = float(t.get("slippage_cost_usd", 0.0))
        total_exchange_cost = fee_usd + slip_usd

        cum_gross += gross_usd
        cum_net += pnl_usd

        # Slice bars during the active life of the trade
        mask = (ts_array >= entry_ts) & (ts_array <= exit_ts)
        sub_highs = high_array[mask]
        sub_lows = low_array[mask]

        if len(sub_highs) == 0:
            # Fallback to single bar closest to entry
            closest_idx = int(np.argmin(np.abs(ts_array - entry_ts)))
            sub_highs = np.array([high_array[closest_idx]])
            sub_lows = np.array([low_array[closest_idx]])

        max_high = float(np.max(sub_highs))
        min_low = float(np.min(sub_lows))

        # Calculate MFE & MAE
        if direction == "LONG":
            mfe_pct = max(0.0, ((max_high - entry_px) / entry_px) * 100.0)
            mae_pct = max(0.0, ((entry_px - min_low) / entry_px) * 100.0)
        else:  # SHORT
            mfe_pct = max(0.0, ((entry_px - min_low) / entry_px) * 100.0)
            mae_pct = max(0.0, ((max_high - entry_px) / entry_px) * 100.0)

        # Dollar equivalents (based on initial capital per trade)
        mfe_usd = (mfe_pct / 100.0) * initial_capital
        mae_usd = (mae_pct / 100.0) * initial_capital

        # R-Multiples
        mfe_r = mfe_usd / max(1e-6, planned_risk_usd)
        mae_r = mae_usd / max(1e-6, planned_risk_usd)
        realized_r = pnl_usd / max(1e-6, planned_risk_usd)

        # MFE Capture Efficiency (% of peak favorable move captured in net PnL)
        mfe_capture_pct = (pnl_usd / mfe_usd * 100.0) if mfe_usd > 1e-6 else 0.0

        # MFE Bleed Alert: Position was up >= 0.5R, but closed <= 0.1R (sl or breakeven)
        mfe_bleed_flag = bool((mfe_r >= 0.5) and (realized_r <= 0.1))

        # Duration
        duration_ms = max(0, exit_ts - entry_ts)
        duration_min = round(duration_ms / 60000.0, 1)

        entry_iso = datetime.datetime.fromtimestamp(entry_ts / 1000.0, tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")
        exit_iso = datetime.datetime.fromtimestamp(exit_ts / 1000.0, tz=datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")

        analyzed_trades.append({
            "trade_id": idx,
            "entry_time_utc": entry_iso,
            "exit_time_utc": exit_iso,
            "entry_ts": entry_ts,
            "exit_ts": exit_ts,
            "direction": direction,
            "entry_price": round(entry_px, 4),
            "exit_price": round(exit_px, 4),
            "duration_min": duration_min,
            "gross_pnl_usd": round(gross_usd, 2),
            "gross_pnl_pct": round(gross_pct, 2),
            "fee_paid_usd": round(fee_usd, 2),
            "slippage_cost_usd": round(slip_usd, 2),
            "total_exchange_cost_usd": round(total_exchange_cost, 2),
            "net_pnl_usd": round(pnl_usd, 2),
            "net_pnl_pct": round(pnl_pct, 2),
            "mfe_pct": round(mfe_pct, 2),
            "mfe_usd": round(mfe_usd, 2),
            "mfe_r": round(mfe_r, 2),
            "mae_pct": round(mae_pct, 2),
            "mae_usd": round(mae_usd, 2),
            "mae_r": round(mae_r, 2),
            "mfe_capture_pct": round(mfe_capture_pct, 1),
            "mfe_bleed_flag": mfe_bleed_flag,
            "tp1_hit": bool(t.get("tp1_hit", False)),
            "exit_reason": t.get("exit_reason", "Unknown"),
            "cum_gross_pnl_usd": round(cum_gross, 2),
            "cum_net_pnl_usd": round(cum_net, 2),
        })

    # --- AGGREGATE SUMMARY METRICS ---
    total_trades = len(analyzed_trades)
    winning_trades = [t for t in analyzed_trades if t["net_pnl_usd"] > 0]
    losing_trades = [t for t in analyzed_trades if t["net_pnl_usd"] < 0]
    be_trades = [t for t in analyzed_trades if t["net_pnl_usd"] == 0]

    win_count = len(winning_trades)
    loss_count = len(losing_trades)
    win_rate = (win_count / total_trades * 100.0) if total_trades > 0 else 0.0

    # PnL Aggregates
    total_gross_pnl = sum(t["gross_pnl_usd"] for t in analyzed_trades)
    total_net_pnl = sum(t["net_pnl_usd"] for t in analyzed_trades)
    total_fees = sum(t["fee_paid_usd"] for t in analyzed_trades)
    total_slippage = sum(t["slippage_cost_usd"] for t in analyzed_trades)
    total_exchange_cost = total_fees + total_slippage
    fee_drag_pct = (total_exchange_cost / abs(total_gross_pnl) * 100.0) if abs(total_gross_pnl) > 0 else 0.0

    gross_wins = sum(t["gross_pnl_usd"] for t in winning_trades)
    gross_losses = abs(sum(t["gross_pnl_usd"] for t in losing_trades))
    net_wins = sum(t["net_pnl_usd"] for t in winning_trades)
    net_losses = abs(sum(t["net_pnl_usd"] for t in losing_trades))

    profit_factor_gross = (gross_wins / gross_losses) if gross_losses > 0 else (999.0 if gross_wins > 0 else 0.0)
    profit_factor_net = (net_wins / net_losses) if net_losses > 0 else (999.0 if net_wins > 0 else 0.0)

    # Excursion (MFE / MAE)
    avg_mfe_pct = float(np.mean([t["mfe_pct"] for t in analyzed_trades]))
    avg_mae_pct = float(np.mean([t["mae_pct"] for t in analyzed_trades]))
    avg_mfe_usd = float(np.mean([t["mfe_usd"] for t in analyzed_trades]))
    avg_mae_usd = float(np.mean([t["mae_usd"] for t in analyzed_trades]))
    avg_mfe_r = float(np.mean([t["mfe_r"] for t in analyzed_trades]))
    avg_mae_r = float(np.mean([t["mae_r"] for t in analyzed_trades]))

    avg_win_mfe_pct = float(np.mean([t["mfe_pct"] for t in winning_trades])) if winning_trades else 0.0
    avg_loss_mfe_pct = float(np.mean([t["mfe_pct"] for t in losing_trades])) if losing_trades else 0.0
    avg_win_mae_pct = float(np.mean([t["mae_pct"] for t in winning_trades])) if winning_trades else 0.0
    avg_loss_mae_pct = float(np.mean([t["mae_pct"] for t in losing_trades])) if losing_trades else 0.0

    edge_ratio = (avg_mfe_pct / avg_mae_pct) if avg_mae_pct > 0 else 0.0
    mfe_bleeds_count = sum(1 for t in analyzed_trades if t["mfe_bleed_flag"])
    mfe_bleed_rate = (mfe_bleeds_count / total_trades * 100.0) if total_trades > 0 else 0.0

    # Time-in-Trade
    avg_duration_all = float(np.mean([t["duration_min"] for t in analyzed_trades]))
    avg_duration_wins = float(np.mean([t["duration_min"] for t in winning_trades])) if winning_trades else 0.0
    avg_duration_losses = float(np.mean([t["duration_min"] for t in losing_trades])) if losing_trades else 0.0
    time_ratio = (avg_duration_wins / avg_duration_losses) if avg_duration_losses > 0 else 0.0

    # Consecutive Streaks
    max_consec_wins = 0
    max_consec_losses = 0
    curr_wins = 0
    curr_losses = 0

    for t in analyzed_trades:
        if t["net_pnl_usd"] > 0:
            curr_wins += 1
            curr_losses = 0
            if curr_wins > max_consec_wins:
                max_consec_wins = curr_wins
        elif t["net_pnl_usd"] < 0:
            curr_losses += 1
            curr_wins = 0
            if curr_losses > max_consec_losses:
                max_consec_losses = curr_losses
        else:
            curr_wins = 0
            curr_losses = 0

    # Frequency Adjusted Sharpe & Sortino
    returns_pct = np.array([t["net_pnl_pct"] for t in analyzed_trades], dtype=float)
    trades_per_day = total_trades / max(0.1, actual_days)
    trades_per_year = trades_per_day * 365.0
    annual_freq_factor = np.sqrt(trades_per_year)

    ret_mean = float(np.mean(returns_pct))
    ret_std = float(np.std(returns_pct))
    neg_returns = returns_pct[returns_pct < 0]
    downside_std = float(np.std(neg_returns)) if len(neg_returns) > 1 else (float(np.sqrt(np.mean(returns_pct[returns_pct < 0]**2))) if len(neg_returns) == 1 else 1e-6)

    per_trade_sharpe = (ret_mean / ret_std) if ret_std > 1e-9 else 0.0
    annualized_sharpe = per_trade_sharpe * annual_freq_factor

    per_trade_sortino = (ret_mean / downside_std) if downside_std > 1e-9 else 0.0
    annualized_sortino = per_trade_sortino * annual_freq_factor

    summary = {
        "total_trades": total_trades,
        "win_count": win_count,
        "loss_count": loss_count,
        "win_rate_pct": round(win_rate, 2),
        "total_gross_pnl_usd": round(total_gross_pnl, 2),
        "total_net_pnl_usd": round(total_net_pnl, 2),
        "total_fees_usd": round(total_fees, 2),
        "total_slippage_usd": round(total_slippage, 2),
        "total_exchange_cost_usd": round(total_exchange_cost, 2),
        "fee_drag_pct": round(fee_drag_pct, 2),
        "profit_factor_gross": round(profit_factor_gross, 2),
        "profit_factor_net": round(profit_factor_net, 2),
        "avg_mfe_pct": round(avg_mfe_pct, 2),
        "avg_mae_pct": round(avg_mae_pct, 2),
        "avg_mfe_usd": round(avg_mfe_usd, 2),
        "avg_mae_usd": round(avg_mae_usd, 2),
        "avg_mfe_r": round(avg_mfe_r, 2),
        "avg_mae_r": round(avg_mae_r, 2),
        "avg_win_mfe_pct": round(avg_win_mfe_pct, 2),
        "avg_loss_mfe_pct": round(avg_loss_mfe_pct, 2),
        "avg_win_mae_pct": round(avg_win_mae_pct, 2),
        "avg_loss_mae_pct": round(avg_loss_mae_pct, 2),
        "edge_ratio": round(edge_ratio, 2),
        "mfe_bleeds_count": mfe_bleeds_count,
        "mfe_bleed_rate_pct": round(mfe_bleed_rate, 2),
        "avg_duration_all_min": round(avg_duration_all, 1),
        "avg_duration_wins_min": round(avg_duration_wins, 1),
        "avg_duration_losses_min": round(avg_duration_losses, 1),
        "time_ratio_win_to_loss": round(time_ratio, 2),
        "max_consec_wins": max_consec_wins,
        "max_consec_losses": max_consec_losses,
        "trades_per_day": round(trades_per_day, 1),
        "trades_per_year": round(trades_per_year, 1),
        "per_trade_sharpe": round(per_trade_sharpe, 2),
        "annualized_sharpe": round(annualized_sharpe, 2),
        "per_trade_sortino": round(per_trade_sortino, 2),
        "annualized_sortino": round(annualized_sortino, 2),
    }

    return analyzed_trades, summary


def render_quant_report(
    summary: Dict[str, Any],
    symbol: str,
    timeframe: str,
    days: float,
    strategy: str,
) -> None:
    """Prints a beautiful formatted ASCII terminal report."""
    line_w = 78
    sep = "=" * line_w
    sub_sep = "-" * line_w

    print("\n" + sep)
    print(f"🏛️  SIGNAL_SCRIPT QUANT LAB: DEEP BACKTEST ANALYZER")
    print(f"    Symbol: {symbol} | TF: {timeframe} | Period: {days:.1f} days | Strategy: {strategy}")
    print(sep)

    print("📊 1. EXECUTIVE PNL & FRICTION DRAG SUMMARY")
    print(sub_sep)
    print(f"  • Total Trades:           {summary['total_trades']:>6}   |  Win Rate:               {summary['win_rate_pct']:>6.2f}%")
    print(f"  • Winning / Losing:       {summary['win_count']:>2} / {summary['loss_count']:<3}  |  Profit Factor (Net):    {summary['profit_factor_net']:>6.2f}")
    print(f"  • Gross PnL (Before Cost): ${summary['total_gross_pnl_usd']:>8,.2f}  |  Profit Factor (Gross):  {summary['profit_factor_gross']:>6.2f}")
    print(f"  • Net Realized PnL:       ${summary['total_net_pnl_usd']:>8,.2f}  |  Exchange Drag:         -${summary['total_exchange_cost_usd']:>7,.2f}")
    print(f"    ├─ Exchange Fees (M/T): ${summary['total_fees_usd']:>8,.2f}  |  Fee Drag Ratio:         {summary['fee_drag_pct']:>6.1f}%")
    print(f"    └─ Slippage Cost:       ${summary['total_slippage_usd']:>8,.2f}  |  Impulse Slip Ticks:          2 ticks")

    print("\n🎯 2. EXCURSION DYNAMICS (MFE / MAE & PROFIT BLEED)")
    print(sub_sep)
    print(f"  • Average MFE (Peak Profit):  +{summary['avg_mfe_pct']:>5.2f}%  |  ${summary['avg_mfe_usd']:>7,.2f}  |  +{summary['avg_mfe_r']:>4.2f}R")
    print(f"  • Average MAE (Adverse Dip):  -{summary['avg_mae_pct']:>5.2f}%  |  ${summary['avg_mae_usd']:>7,.2f}  |  -{summary['avg_mae_r']:>4.2f}R")
    print(f"  • Edge Ratio (MFE / MAE):     {summary['edge_ratio']:>6.2f}x  (Values > 1.0 indicate systematic edge)")
    print(f"  • MFE on Winning Trades:      +{summary['avg_win_mfe_pct']:>5.2f}%  |  MAE on Wins:           -{summary['avg_win_mae_pct']:>5.2f}%")
    print(f"  • MFE on Losing Trades:       +{summary['avg_loss_mfe_pct']:>5.2f}%  |  MAE on Losses:         -{summary['avg_loss_mae_pct']:>5.2f}%")
    print(f"  • MFE Bleed Trades (>= 0.5R): {summary['mfe_bleeds_count']:>6} trades ({summary['mfe_bleed_rate_pct']:>4.1f}% of all trades faded into BE/SL)")

    print("\n⏱️ 3. TIME-IN-TRADE & HOLDING BEHAVIOR")
    print(sub_sep)
    print(f"  • Average Duration (All):     {summary['avg_duration_all_min']:>6.1f} min ({summary['avg_duration_all_min']/60:.2f} hrs)")
    print(f"  • Average Duration (Wins):    {summary['avg_duration_wins_min']:>6.1f} min  |  Duration (Losses):    {summary['avg_duration_losses_min']:>6.1f} min")
    print(f"  • Holding Ratio (Win / Loss): {summary['time_ratio_win_to_loss']:>6.2f}x  (> 1.0 = lets profits run / cuts losses fast)")

    print("\n⚡ 4. CONSECUTIVE STREAKS & RISK ADJUSTMENT")
    print(sub_sep)
    print(f"  • Max Consecutive Wins:       {summary['max_consec_wins']:>6} trades")
    print(f"  • Max Consecutive Losses:     {summary['max_consec_losses']:>6} trades")
    print(f"  • Trade Frequency:            {summary['trades_per_day']:>6.1f} trades/day ({summary['trades_per_year']:.0f} trades/yr)")
    print(f"  • Per-Trade Sharpe Ratio:     {summary['per_trade_sharpe']:>6.2f}   |  Annualized Sharpe:     {summary['annualized_sharpe']:>6.2f}")
    print(f"  • Per-Trade Sortino Ratio:    {summary['per_trade_sortino']:>6.2f}   |  Annualized Sortino:    {summary['annualized_sortino']:>6.2f}")
    print(sep + "\n")


def export_trades_to_csv(trades: List[Dict[str, Any]], output_path: Path) -> None:
    """Exports structured trades data to CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df_trades = pd.DataFrame(trades)
    df_trades.to_csv(output_path, index=False, encoding="utf-8")
    print(f"[EXPORT] Successfully saved {len(trades)} deep trade records to:")
    print(f"         >>> {output_path.resolve()}")


def main():
    parser = argparse.ArgumentParser(description="Deep Backtest Analyzer & Quant Reflexion Suite")
    parser.add_argument("--symbol", type=str, default="BTCUSDT", help="Trading pair (default: BTCUSDT)")
    parser.add_argument("--days", type=int, default=3, help="Backtest window in days (default: 3)")
    parser.add_argument("--timeframe", type=str, default="5m", help="Candle timeframe (default: 5m)")
    parser.add_argument("--strategy", type=str, default="confluence_ema", help="Strategy id (default: confluence_ema)")
    parser.add_argument("--capital", type=float, default=10000.0, help="Initial capital in USDT (default: 10000.0)")
    parser.add_argument("--maker-fee", type=float, default=0.02, help="Maker fee %% (default: 0.02)")
    parser.add_argument("--taker-fee", type=float, default=0.05, help="Taker fee %% (default: 0.05)")
    parser.add_argument("--slippage-ticks", type=int, default=2, help="Impulse slippage ticks (default: 2)")
    parser.add_argument("--sl", type=float, default=0.8, help="Stop loss %% (default: 0.8)")
    parser.add_argument("--tp", type=float, default=1.5, help="Take profit %% (default: 1.5)")
    parser.add_argument("--leverage", type=float, default=1.0, help="Leverage multiplier (default: 1.0)")
    parser.add_argument(
        "--output",
        type=str,
        default="backend/logs/deep_trades_export.csv",
        help="Export CSV path (default: backend/logs/deep_trades_export.csv)",
    )

    args = parser.parse_args()

    # 1. Load Parquet Data
    df_slice, actual_days = load_parquet_history(
        symbol=args.symbol,
        timeframe=args.timeframe,
        days=args.days,
    )

    # 2. Run OrderFlowBacktester with ExecutionSimulator configs
    bt_res = run_quant_backtest(
        df=df_slice,
        strategy=args.strategy,
        initial_capital=args.capital,
        maker_fee_pct=args.maker_fee,
        taker_fee_pct=args.taker_fee,
        slippage_ticks=args.slippage_ticks,
        stop_loss_pct=args.sl,
        take_profit_pct=args.tp,
        leverage=args.leverage,
    )

    if "error" in bt_res:
        print(f"[ERROR] Backtester error: {bt_res['error']}")
        sys.exit(1)

    raw_trades = bt_res.get("trades", [])
    print(f"[RESULT] Backtester finished. Extracted {len(raw_trades)} closed trade lifecycles.")

    # 3. Analyze Deep Quant Metrics
    analyzed_trades, summary = analyze_deep_trades(
        raw_trades=raw_trades,
        df=df_slice,
        initial_capital=args.capital,
        stop_loss_pct=args.sl,
        actual_days=actual_days,
    )

    # 4. Render Formatted Console Table
    render_quant_report(
        summary=summary,
        symbol=args.symbol.upper(),
        timeframe=args.timeframe.lower(),
        days=actual_days,
        strategy=args.strategy,
    )

    # 5. Export to CSV
    output_csv = REPO_ROOT / args.output
    export_trades_to_csv(analyzed_trades, output_csv)


if __name__ == "__main__":
    main()
