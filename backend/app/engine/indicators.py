"""
Unified Technical Indicators Engine for SignalScript Terminal & Quant Backtester.
Synchronized with KLineCharts algorithms on the frontend.
"""

from typing import Dict, Any, Optional
import numpy as np
import pandas as pd


def compute_ema(series: pd.Series, period: int) -> pd.Series:
    """Calculates Exponential Moving Average (EMA)."""
    p = max(1, int(period))
    return series.ewm(span=p, adjust=False).mean()


def compute_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Calculates Wilder's Relative Strength Index (RSI)."""
    p = max(2, int(period))
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / float(p), min_periods=p, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / float(p), min_periods=p, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100.0 - (100.0 / (1.0 + rs))).fillna(50.0)


def compute_macd(
    series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> pd.DataFrame:
    """Calculates Moving Average Convergence Divergence (MACD)."""
    f = max(1, int(fast))
    s = max(f + 1, int(slow))
    sig = max(1, int(signal))

    ema_fast = series.ewm(span=f, adjust=False).mean()
    ema_slow = series.ewm(span=s, adjust=False).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=sig, adjust=False).mean()
    hist = dif - dea

    return pd.DataFrame({"dif": dif, "dea": dea, "hist": hist}, index=series.index)


def compute_bollinger_bands(
    series: pd.Series, period: int = 20, std_dev: float = 2.0
) -> pd.DataFrame:
    """Calculates Bollinger Bands (BOLL)."""
    p = max(2, int(period))
    mult = float(std_dev)

    mid = series.rolling(window=p, min_periods=1).mean()
    std = series.rolling(window=p, min_periods=1).std(ddof=0).fillna(0.0)
    up = mid + mult * std
    dn = mid - mult * std

    return pd.DataFrame({"mid": mid, "up": up, "dn": dn}, index=series.index)


def compute_atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    """Calculates Average True Range (ATR)."""
    p = max(1, int(period))
    h_l = df["high"] - df["low"]
    h_pc = (df["high"] - df["close"].shift(1)).abs()
    l_pc = (df["low"] - df["close"].shift(1)).abs()
    tr = pd.concat([h_l, h_pc, l_pc], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0 / float(p), min_periods=p, adjust=False).mean().bfill().fillna(0.0)


def compute_supertrend(
    df: pd.DataFrame, period: int = 10, multiplier: float = 3.0
) -> pd.DataFrame:
    """Calculates SuperTrend indicator (Trend direction and trailing stop bands)."""
    atr = compute_atr(df, period=period)
    hl2 = (df["high"] + df["low"]) / 2.0
    mult = float(multiplier)

    basic_upper = hl2 + mult * atr
    basic_lower = hl2 - mult * atr

    n = len(df)
    final_upper = np.zeros(n)
    final_lower = np.zeros(n)
    supertrend = np.zeros(n)
    direction = np.ones(n)  # 1 for bull, -1 for bear

    closes = df["close"].values
    bu = basic_upper.values
    bl = basic_lower.values

    for i in range(1, n):
        # Final Upper Band
        if bu[i] < final_upper[i - 1] or closes[i - 1] > final_upper[i - 1]:
            final_upper[i] = bu[i]
        else:
            final_upper[i] = final_upper[i - 1]

        # Final Lower Band
        if bl[i] > final_lower[i - 1] or closes[i - 1] < final_lower[i - 1]:
            final_lower[i] = bl[i]
        else:
            final_lower[i] = final_lower[i - 1]

        # Direction & Supertrend value
        if direction[i - 1] == 1:
            if closes[i] < final_lower[i]:
                direction[i] = -1
                supertrend[i] = final_upper[i]
            else:
                direction[i] = 1
                supertrend[i] = final_lower[i]
        else:
            if closes[i] > final_upper[i]:
                direction[i] = 1
                supertrend[i] = final_lower[i]
            else:
                direction[i] = -1
                supertrend[i] = final_upper[i]

    return pd.DataFrame(
        {
            "supertrend": supertrend,
            "direction": direction,
            "upper": final_upper,
            "lower": final_lower,
        },
        index=df.index,
    )


def compute_cvd(df: pd.DataFrame, smooth_period: int = 14) -> pd.DataFrame:
    """Calculates Cumulative Volume Delta (CVD) and smoothed line."""
    if "delta" in df.columns:
        delta = df["delta"]
    elif "taker_buy_volume" in df.columns:
        delta = (2.0 * df["taker_buy_volume"]) - df["volume"]
    elif "taker_buy_base_volume" in df.columns:
        delta = (2.0 * df["taker_buy_base_volume"]) - df["volume"]
    else:
        rng = (df["high"] - df["low"]).replace(0, np.nan)
        delta = ((df["close"] - df["open"]) / rng).fillna(0.0) * df["volume"]

    cvd = delta.cumsum()
    p = max(1, int(smooth_period))
    cvd_ema = cvd.ewm(span=p, adjust=False).mean()

    return pd.DataFrame({"delta": delta, "cvd": cvd, "cvd_ema": cvd_ema}, index=df.index)


def compute_indicators(
    df: pd.DataFrame,
    indicators_config: Optional[Dict[str, Dict[str, Any]]] = None,
) -> pd.DataFrame:
    """
    Unified entry point for computing indicators on market history dataframe.
    Accepts standardized config:
    {
        "ema": { "params": { "period1": 9, "period2": 21, "period3": 50 } },
        "rsi": { "params": { "period": 14 } },
        "macd": { "params": { "fast": 12, "slow": 26, "signal": 9 } },
        "boll": { "params": { "period": 20, "stdDev": 2.0 } },
        "atr": { "params": { "period": 14 } },
        "supertrend": { "params": { "atrPeriod": 10, "multiplier": 3.0 } },
        "cvd": { "params": { "smoothPeriod": 14 } },
        "vol": { "params": { "maPeriod": 20 } }
    }
    """
    if df.empty:
        return df

    data = df.copy()
    config = indicators_config or {}

    for ind_id, ind_data in config.items():
        params = ind_data.get("params", {}) if isinstance(ind_data, dict) else {}

        if ind_id == "ema":
            p1 = params.get("period1", 9)
            p2 = params.get("period2", 21)
            p3 = params.get("period3", 50)
            data[f"ema_{p1}"] = compute_ema(data["close"], p1)
            data[f"ema_{p2}"] = compute_ema(data["close"], p2)
            data[f"ema_{p3}"] = compute_ema(data["close"], p3)

        elif ind_id == "rsi":
            period = params.get("period", 14)
            data[f"rsi_{period}"] = compute_rsi(data["close"], period)
            data["rsi"] = data[f"rsi_{period}"]

        elif ind_id == "macd":
            fast = params.get("fast", 12)
            slow = params.get("slow", 26)
            signal = params.get("signal", 9)
            macd_df = compute_macd(data["close"], fast, slow, signal)
            data["macd_dif"] = macd_df["dif"]
            data["macd_dea"] = macd_df["dea"]
            data["macd_hist"] = macd_df["hist"]

        elif ind_id == "boll":
            period = params.get("period", 20)
            std_dev = params.get("stdDev", 2.0)
            boll_df = compute_bollinger_bands(data["close"], period, std_dev)
            data["boll_mid"] = boll_df["mid"]
            data["boll_up"] = boll_df["up"]
            data["boll_dn"] = boll_df["dn"]

        elif ind_id == "atr":
            period = params.get("period", 14)
            data[f"atr_{period}"] = compute_atr(data, period)
            data["atr"] = data[f"atr_{period}"]

        elif ind_id == "supertrend":
            atr_period = params.get("atrPeriod", 10)
            multiplier = params.get("multiplier", 3.0)
            st_df = compute_supertrend(data, atr_period, multiplier)
            data["supertrend"] = st_df["supertrend"]
            data["supertrend_dir"] = st_df["direction"]
            data["supertrend_upper"] = st_df["upper"]
            data["supertrend_lower"] = st_df["lower"]

        elif ind_id == "cvd":
            smooth = params.get("smoothPeriod", 14)
            cvd_df = compute_cvd(data, smooth)
            data["delta"] = cvd_df["delta"]
            data["cvd"] = cvd_df["cvd"]
            data["cvd_ema"] = cvd_df["cvd_ema"]

        elif ind_id == "vol":
            ma_p = params.get("maPeriod", 20)
            data[f"vol_ma_{ma_p}"] = data["volume"].rolling(window=ma_p, min_periods=1).mean()
            data["vol_ma"] = data[f"vol_ma_{ma_p}"]

    return data
