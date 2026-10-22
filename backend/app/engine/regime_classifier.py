"""
Market Regime Classifier (Adaptive Brain)
=========================================
Vectorized classification of market micro-structure into 3 strict regimes:
1. FLAT_DENSE: Low volatility, dense order flow/liquidity, neutral CVD slope.
   Strategy: Range scalping, tight TP, conservative SL.
2. TREND_IMPULSE: High volatility, strong directional CVD slope, moderate/sparse book.
   Strategy: Breakout/momentum, wide TP, trailing stop.
3. TOXIC_VOLATILITY: Abnormally high ATR combined with severe liquidity vacuum.
   Strategy: NO_TRADE (strict execution block).
"""

from enum import Enum
from typing import Dict, Any, Optional, Tuple, Union
import numpy as np
import pandas as pd


class MarketRegime(str, Enum):
    FLAT_DENSE = "FLAT_DENSE"
    TREND_IMPULSE = "TREND_IMPULSE"
    TOXIC_VOLATILITY = "TOXIC_VOLATILITY"


class RegimeClassifier:
    """
    Vectorized market regime detector using Order Flow (CVD) and volatility micro-structure.
    """

    def __init__(
        self,
        window: int = 30,
        vol_medium_threshold: float = 0.0025,   # 0.25% ATR/Price
        vol_toxic_threshold: float = 0.0075,    # 0.75% ATR/Price (extreme spike)
        density_toxic_threshold: float = 0.65,  # liquidity vacuum (< 65% of normal)
        density_dense_threshold: float = 1.15,  # dense walls (> 115% of normal)
        slope_threshold: float = 0.35,          # normalized CVD slope significance
        spread_toxic_threshold: float = 0.003,  # 0.3% wide spread threshold
    ):
        self.window = max(5, int(window))
        self.vol_medium_threshold = float(vol_medium_threshold)
        self.vol_toxic_threshold = float(vol_toxic_threshold)
        self.density_toxic_threshold = float(density_toxic_threshold)
        self.density_dense_threshold = float(density_dense_threshold)
        self.slope_threshold = float(slope_threshold)
        self.spread_toxic_threshold = float(spread_toxic_threshold)

    def compute_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Vectorized computation of window metrics without per-bar loops:
        - Normalized ATR: ATR_W / Price
        - Relative Density: Normalized order book / trade volume density
        - CVD Slope: Linear regression slope over rolling window W
        """
        if df is None or len(df) < 5:
            return pd.DataFrame()

        data = df.copy()
        w = min(self.window, len(data))

        # 1. Price series
        close = data["close"].astype(float)
        high = data["high"].astype(float)
        low = data["low"].astype(float)
        prev_close = close.shift(1).fillna(close)

        # 2. Vectorized True Range and ATR
        tr1 = high - low
        tr2 = (high - prev_close).abs()
        tr3 = (low - prev_close).abs()
        tr = np.maximum(tr1, np.maximum(tr2, tr3))
        atr = tr.rolling(window=w, min_periods=1).mean()
        safe_close = close.replace(0, np.nan)
        data["norm_atr"] = (atr / safe_close).fillna(0.0)

        # 3. Order Book / Trade Density
        if "density" in data.columns:
            raw_density = data["density"].astype(float)
        elif "density_bid" in data.columns and "density_ask" in data.columns:
            raw_density = data["density_bid"].astype(float) + data["density_ask"].astype(float)
        else:
            vol = data["volume"].astype(float)
            range_safe = tr.replace(0, np.nan)
            raw_density = (vol / range_safe).fillna(vol.mean() if len(vol) > 0 else 1.0)

        avg_density = raw_density.rolling(window=w * 2, min_periods=1).mean().replace(0, np.nan)
        data["rel_density"] = (raw_density / avg_density).fillna(1.0)

        # 3b. Bid-Ask Spread if present
        if "spread" in data.columns:
            raw_spread = data["spread"].astype(float)
            data["norm_spread"] = (raw_spread / safe_close).fillna(0.0)
        elif "ask" in data.columns and "bid" in data.columns:
            raw_spread = (data["ask"].astype(float) - data["bid"].astype(float)).abs()
            data["norm_spread"] = (raw_spread / safe_close).fillna(0.0)
        elif "spread_pct" in data.columns:
            data["norm_spread"] = (data["spread_pct"].astype(float) / 100.0).fillna(0.0)
        else:
            data["norm_spread"] = pd.Series(0.0, index=data.index)

        # 4. Delta & CVD
        if "cvd" not in data.columns:
            if "delta" in data.columns:
                delta = data["delta"].astype(float)
            elif "taker_buy_volume" in data.columns and "volume" in data.columns:
                delta = (2.0 * data["taker_buy_volume"].astype(float)) - data["volume"].astype(float)
            else:
                body = close - data["open"].astype(float)
                rng = (high - low).replace(0, np.nan)
                delta = (body / rng).fillna(0.0) * data["volume"].astype(float)
            data["cvd"] = delta.cumsum()

        # 5. Vectorized Rolling Linear Regression Slope for CVD
        # slope = sum((x - x_bar) * (y - y_bar)) / sum((x - x_bar)^2)
        cvd = data["cvd"].astype(float)
        x = np.arange(w)
        x_mean = x.mean()
        x_dev = x - x_mean
        ss_xx = np.sum(x_dev ** 2)

        if ss_xx > 0:
            def calc_slope(chunk):
                if len(chunk) < w:
                    return 0.0
                y = chunk
                y_mean = np.mean(y)
                return np.sum(x_dev * (y - y_mean)) / ss_xx

            # Rolling slope via numpy convolution / rolling apply
            rolling_slope = cvd.rolling(window=w, min_periods=w).apply(calc_slope, raw=True).fillna(0.0)
        else:
            rolling_slope = pd.Series(0.0, index=data.index)

        # Normalize slope by rolling volume scale
        vol_scale = data["volume"].rolling(window=w, min_periods=1).mean().replace(0, np.nan)
        data["cvd_slope"] = rolling_slope
        data["cvd_slope_norm"] = (rolling_slope / vol_scale).fillna(0.0)

        return data

    def classify_series(self, df: pd.DataFrame) -> pd.Series:
        """
        Classifies an entire DataFrame into MarketRegime series using vectorized boolean masks.
        """
        features = self.compute_features(df)
        if features.empty:
            return pd.Series(dtype=object)

        norm_atr = features["norm_atr"]
        rel_density = features["rel_density"]
        norm_spread = features.get("norm_spread", pd.Series(0.0, index=features.index))
        abs_slope = features["cvd_slope_norm"].abs()

        # Initialize with FLAT_DENSE
        regimes = pd.Series(MarketRegime.FLAT_DENSE.value, index=features.index)

        # Mask 1: TOXIC_VOLATILITY (extreme volatility + liquidity vacuum OR abnormally wide spread + liquidity vacuum)
        toxic_mask = (
            ((norm_atr >= self.vol_toxic_threshold) & (rel_density <= self.density_toxic_threshold)) |
            ((norm_spread >= self.spread_toxic_threshold) & (rel_density <= self.density_toxic_threshold))
        )

        # Mask 2: TREND_IMPULSE (healthy or high ATR + decisive directional CVD flow)
        trend_mask = (norm_atr >= self.vol_medium_threshold) & (abs_slope >= self.slope_threshold) & (~toxic_mask)

        # Mask 3: FLAT_DENSE (everything else, specifically low volatility or dense resting walls)
        regimes[trend_mask] = MarketRegime.TREND_IMPULSE.value
        regimes[toxic_mask] = MarketRegime.TOXIC_VOLATILITY.value

        return regimes

    def classify_current(self, df: pd.DataFrame) -> Tuple[MarketRegime, Dict[str, Any]]:
        """
        Classifies the latest market bar/snapshot.
        Returns:
            (regime: MarketRegime, metrics: Dict[str, Any])
        """
        if df is None or len(df) < 5:
            return MarketRegime.FLAT_DENSE, {
                "norm_atr": 0.0,
                "rel_density": 1.0,
                "norm_spread": 0.0,
                "cvd_slope_norm": 0.0,
                "is_trade_allowed": True
            }

        features = self.compute_features(df)
        last_row = features.iloc[-1]

        norm_atr = float(last_row.get("norm_atr", 0.0))
        rel_density = float(last_row.get("rel_density", 1.0))
        norm_spread = float(last_row.get("norm_spread", 0.0))
        slope_norm = float(last_row.get("cvd_slope_norm", 0.0))
        abs_slope = abs(slope_norm)

        is_toxic = (
            (norm_atr >= self.vol_toxic_threshold and rel_density <= self.density_toxic_threshold) or
            (norm_spread >= self.spread_toxic_threshold and rel_density <= self.density_toxic_threshold)
        )

        if is_toxic:
            regime = MarketRegime.TOXIC_VOLATILITY
        elif norm_atr >= self.vol_medium_threshold and abs_slope >= self.slope_threshold:
            regime = MarketRegime.TREND_IMPULSE
        else:
            regime = MarketRegime.FLAT_DENSE

        metrics = {
            "regime": regime.value,
            "norm_atr": round(norm_atr, 6),
            "rel_density": round(rel_density, 3),
            "norm_spread": round(norm_spread, 6),
            "cvd_slope_norm": round(slope_norm, 4),
            "is_trade_allowed": regime != MarketRegime.TOXIC_VOLATILITY,
            "vol_medium_threshold": self.vol_medium_threshold,
            "vol_toxic_threshold": self.vol_toxic_threshold,
            "spread_toxic_threshold": self.spread_toxic_threshold,
        }

        return regime, metrics


# Singleton instance
regime_classifier = RegimeClassifier()
