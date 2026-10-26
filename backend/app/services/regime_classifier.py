"""
regime_classifier.py — Market Regime Classifier & Microstructure Gate
======================================================================
Implements deterministic, zero look-ahead market regime classification (5m execution, 15m context)
and microstructure order flow validation for Binance Futures USDT-M.

Regimes:
- TOXIC_DEADZONE: Illiquid chop, wide spread, or extreme spoofing risk -> Strict NO_TRADE.
- VOLATILITY_EXPANSION: News / liquidation bursts -> Halve risk, expand stop x1.25.
- TREND_UP / TREND_DOWN: Momentum expansion -> Trend-following allowed, TP 2.0R-2.5R.
- RANGE_CHOP: Balanced range -> Range scalping / density bounces, partial TP 50% at 1.0R.
- NO_TRADE: Ambiguous / unconfirmed market conditions.
"""
from __future__ import annotations

import enum
import logging
import math
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class MarketRegime(str, enum.Enum):
    TREND_UP = "TREND_UP"
    TREND_DOWN = "TREND_DOWN"
    RANGE_CHOP = "RANGE_CHOP"
    VOLATILITY_EXPANSION = "VOLATILITY_EXPANSION"
    TOXIC_DEADZONE = "TOXIC_DEADZONE"
    NO_TRADE = "NO_TRADE"


def calculate_true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """True Range: max(H-L, |H-C_prev|, |L-C_prev|)."""
    prev_close = close.shift(1)
    hl = high - low
    h_pc = (high - prev_close).abs()
    l_pc = (low - prev_close).abs()
    return pd.concat([hl, h_pc, l_pc], axis=1).max(axis=1)


def choppiness_index(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """
    Choppiness Index (CI):
    CI = 100 * [log10(sum(TR, n)) - log10(max(H, n) - min(L, n))] / log10(n)
    Values > 61.8 indicate consolidation/chop; values < 38.2 indicate strong trend.
    """
    tr = calculate_true_range(high, low, close)
    sum_tr = tr.rolling(window=period, min_periods=period).sum()
    max_h = high.rolling(window=period, min_periods=period).max()
    min_l = low.rolling(window=period, min_periods=period).min()
    rng = (max_h - min_l).replace(0, np.nan)

    log_n = math.log10(period)
    ci = 100.0 * (np.log10(sum_tr) - np.log10(rng)) / log_n
    return ci.bfill().fillna(50.0)


def bollinger_width(close: pd.Series, period: int = 20, num_std: float = 2.0) -> pd.Series:
    """Bollinger Band Width (BBW) = (Upper - Lower) / Middle."""
    mid = close.rolling(window=period, min_periods=period).mean()
    std = close.rolling(window=period, min_periods=period).std()
    upper = mid + (num_std * std)
    lower = mid - (num_std * std)
    safe_mid = mid.replace(0, np.nan)
    return ((upper - lower) / safe_mid).bfill().fillna(0.0)


def rolling_percentile_rank(series: pd.Series, window: int = 288) -> pd.Series:
    """
    Computes rolling percentile rank (0.0 to 100.0) over a sliding window.
    Window 288 bars on 5m = exactly 24 hours of rolling history.
    """
    def _pct_rank(chunk: np.ndarray) -> float:
        val = chunk[-1]
        if not np.isfinite(val):
            return 50.0
        finite = chunk[np.isfinite(chunk)]
        if len(finite) <= 1:
            return 50.0
        return float(np.sum(finite <= val) / len(finite) * 100.0)

    # Use rolling apply for deterministic percentile evaluation
    pct = series.rolling(window=window, min_periods=min(10, window)).apply(_pct_rank, raw=True)
    return pct.bfill().fillna(50.0)


def calculate_adx(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Calculates Wilder's Average Directional Index (ADX)."""
    up_move = high.diff()
    down_move = -low.diff()

    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    tr = calculate_true_range(high, low, close)
    alpha = 1.0 / period

    tr_smooth = pd.Series(tr).ewm(alpha=alpha, min_periods=period, adjust=False).mean()
    plus_di = 100.0 * (pd.Series(plus_dm).ewm(alpha=alpha, min_periods=period, adjust=False).mean() / tr_smooth.replace(0, np.nan))
    minus_di = 100.0 * (pd.Series(minus_dm).ewm(alpha=alpha, min_periods=period, adjust=False).mean() / tr_smooth.replace(0, np.nan))

    di_sum = (plus_di + minus_di).replace(0, np.nan)
    dx = 100.0 * (plus_di - minus_di).abs() / di_sum
    adx = dx.ewm(alpha=alpha, min_periods=period, adjust=False).mean()
    return adx.bfill().fillna(20.0)


def compute_order_book_imbalance(
    book_bids: List[Tuple[float, float]],
    book_asks: List[Tuple[float, float]],
    mid_price: float,
    band_pct: float = 0.005,
) -> float:
    """
    Computes depth imbalance in the price corridor [mid*(1-band), mid*(1+band)]:
    IB = (BidDepth - AskDepth) / (BidDepth + AskDepth)
    Returns value in [-1.0, 1.0].
    """
    if mid_price <= 0 or not book_bids or not book_asks:
        return 0.0

    lower_bound = mid_price * (1.0 - band_pct)
    upper_bound = mid_price * (1.0 + band_pct)

    bid_depth = sum(qty for price, qty in book_bids if price >= lower_bound)
    ask_depth = sum(qty for price, qty in book_asks if price <= upper_bound)

    total = bid_depth + ask_depth
    if total <= 0:
        return 0.0

    return float((bid_depth - ask_depth) / total)


def classify_market_regime(
    df_5m: pd.DataFrame,
    df_15m: Optional[pd.DataFrame] = None,
    orderbook: Optional[Dict[str, Any]] = None,
    symbol_meta: Optional[Dict[str, Any]] = None,
    lookback_window: int = 288,
) -> MarketRegime:
    """
    Classifies market regime strictly using closed candles up to candle t.
    Priority order:
    1. TOXIC_DEADZONE (highest priority: protect capital)
    2. VOLATILITY_EXPANSION
    3. TREND_UP / TREND_DOWN
    4. RANGE_CHOP
    5. NO_TRADE (uncertain/low-edge state)
    """
    if df_5m is None or len(df_5m) < 20:
        return MarketRegime.NO_TRADE

    c = df_5m["close"]
    h = df_5m["high"]
    l = df_5m["low"]
    v = df_5m["volume"]

    # Trend direction via EMA
    ema20 = c.ewm(span=20, adjust=False).mean()
    ema50 = c.ewm(span=50, adjust=False).mean()
    last_close = float(c.iloc[-1])
    last_ema20 = float(ema20.iloc[-1])
    last_ema50 = float(ema50.iloc[-1])

    trend_dir = 1 if (last_ema20 > last_ema50 and last_close > last_ema20) else (
        -1 if (last_ema20 < last_ema50 and last_close < last_ema20) else 0
    )

    # Indicator series
    adx_series = calculate_adx(h, l, c, 14)
    adx_val = float(adx_series.iloc[-1])

    ci_series = choppiness_index(h, l, c, 14)
    ci_val = float(ci_series.iloc[-1])

    tr_series = calculate_true_range(h, l, c)
    atr_series = tr_series.ewm(span=14, adjust=False).mean()
    atr_pct_series = rolling_percentile_rank(atr_series, lookback_window)
    atr_pct = float(atr_pct_series.iloc[-1])

    bbw_series = bollinger_width(c, 20, 2.0)
    bbw_pct_series = rolling_percentile_rank(bbw_series, lookback_window)
    bbw_pct = float(bbw_pct_series.iloc[-1])

    vol_ma20 = v.rolling(20, min_periods=1).mean().iloc[-1]
    last_vol = float(v.iloc[-1])
    rvol = (last_vol / max(vol_ma20, 1e-9)) if vol_ma20 > 0 else 1.0

    # Orderbook metrics if available
    spread_bps = 2.0
    ib = 0.0
    min_depth_usd = float((symbol_meta or {}).get("min_depth_usd", 10_000.0))
    total_depth_usd = 100_000.0

    if orderbook:
        bids = orderbook.get("bids", [])
        asks = orderbook.get("asks", [])
        best_bid = float(bids[0][0]) if bids else 0.0
        best_ask = float(asks[0][0]) if asks else 0.0
        if best_bid > 0 and best_ask >= best_bid:
            mid = (best_bid + best_ask) / 2.0
            spread_bps = ((best_ask - best_bid) / mid) * 10_000.0
            ib = compute_order_book_imbalance(bids, asks, mid, 0.005)
            total_depth_usd = float(orderbook.get("total_depth_usd", 100_000.0))

    # --- 1. TOXIC_DEADZONE Check ---------------------------------------------
    if (
        spread_bps > 5.0
        or abs(ib) >= 0.55
        or total_depth_usd < min_depth_usd
        or (ci_val >= 65.0 and atr_pct >= 85.0)
    ):
        return MarketRegime.TOXIC_DEADZONE

    # --- 2. VOLATILITY_EXPANSION Check ----------------------------------------
    if atr_pct >= 90.0 or bbw_pct >= 90.0 or rvol >= 2.0:
        return MarketRegime.VOLATILITY_EXPANSION

    # --- 3. TREND Check -------------------------------------------------------
    if adx_val >= 25.0 and ci_val <= 45.0 and trend_dir != 0:
        return MarketRegime.TREND_UP if trend_dir == 1 else MarketRegime.TREND_DOWN

    # --- 4. RANGE_CHOP Check --------------------------------------------------
    if 15.0 <= adx_val < 25.0 and ci_val >= 58.0:
        return MarketRegime.RANGE_CHOP

    # --- 5. Ambiguous / Low edge -> NO_TRADE ----------------------------------
    return MarketRegime.NO_TRADE


def microstructure_gate(
    signal_side: str,
    orderbook: Optional[Dict[str, Any]],
    cvd_series: Optional[Union[List[float], np.ndarray, pd.Series]],
    candles_df: pd.DataFrame,
    symbol_meta: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, str]:
    """
    Microstructure Order Flow Gate:
    1. Spreads and Depth sanity
    2. Depth Imbalance thresholding (-0.25 / +0.25)
    3. CVD Bearish / Bullish Absorption detection
    """
    meta = symbol_meta or {}
    max_spread_bps = float(meta.get("max_spread_bps", 5.0))
    min_depth_usd = float(meta.get("min_depth_usd", 5_000.0))

    side = signal_side.upper()
    ib = 0.0
    spread_bps = 2.0

    if orderbook:
        bids = orderbook.get("bids", [])
        asks = orderbook.get("asks", [])
        total_depth_usd = float(orderbook.get("total_depth_usd", 50_000.0))

        if total_depth_usd < min_depth_usd:
            return False, f"LOW_LIQUIDITY (Depth: ${total_depth_usd:.0f} < ${min_depth_usd:.0f})"

        best_bid = float(bids[0][0]) if bids else 0.0
        best_ask = float(asks[0][0]) if asks else 0.0
        if best_bid > 0 and best_ask >= best_bid:
            mid = (best_bid + best_ask) / 2.0
            spread_bps = ((best_ask - best_bid) / mid) * 10_000.0
            ib = compute_order_book_imbalance(bids, asks, mid, 0.005)

        if spread_bps > max_spread_bps:
            return False, f"SPREAD_TOO_WIDE ({spread_bps:.1f} bps > {max_spread_bps:.1f} bps)"

        if abs(ib) >= 0.55:
            return False, f"SUSPECT_ORDERBOOK_SPOOFING (|IB|: {abs(ib):.2f} >= 0.55)"

    # Imbalance direction checks
    if side == "LONG" and ib <= -0.25:
        return False, f"BEARISH_BOOK_IMBALANCE (IB: {ib:.2f} <= -0.25)"
    if side == "SHORT" and ib >= 0.25:
        return False, f"BULLISH_BOOK_IMBALANCE (IB: {ib:.2f} >= +0.25)"

    # CVD Absorption detection over last 5 bars
    if cvd_series is not None and len(cvd_series) >= 6 and len(candles_df) >= 6:
        cvd_vals = list(cvd_series)
        cvd_slope_5 = cvd_vals[-1] - cvd_vals[-6]
        c_last = float(candles_df["close"].iloc[-1])
        o_last = float(candles_df["open"].iloc[-1])
        h_prev6 = float(candles_df["high"].iloc[-6:-1].max())
        l_prev6 = float(candles_df["low"].iloc[-6:-1].min())

        # Bearish Absorption: Buyers aggressive (CVD slope > 0) but price fails to make new highs
        if side == "LONG" and cvd_slope_5 > 0 and c_last < o_last and c_last <= h_prev6:
            return False, "BEARISH_ABSORPTION (Aggressive buying absorbed by limit sellers)"

        # Bullish Absorption: Sellers aggressive (CVD slope < 0) but price fails to make new lows
        if side == "SHORT" and cvd_slope_5 < 0 and c_last > o_last and c_last >= l_prev6:
            return False, "BULLISH_ABSORPTION (Aggressive selling absorbed by limit buyers)"

    return True, "OK"
