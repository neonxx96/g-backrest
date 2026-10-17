"""
Volume Profile & Cluster Delta Engine for Tiger Trade Style Analysis
Calculates:
- Point of Control (POC)
- Value Area High (VAH) & Value Area Low (VAL) - 70% Volume Area
- Candle Delta & Cumulative Volume Delta (CVD)
- Delta Divergences & Absorption detection
"""

import numpy as np
import pandas as pd
from typing import Dict, Tuple, Any

class VolumeProfileEngine:
    @staticmethod
    def calculate_session_profile(df: pd.DataFrame, num_bins: int = 50, value_area_pct: float = 0.70) -> Dict[str, Any]:
        """
        Calculates Horizontal Volume Profile, POC, VAH, and VAL for a given bar range.
        Approximates intra-candle price-volume distribution via typical price or tick approximation.
        """
        if df.empty:
            return {}

        min_price = df['low'].min()
        max_price = df['high'].max()
        
        if min_price == max_price:
            return {'poc': min_price, 'vah': max_price, 'val': min_price, 'bins': []}

        bins = np.linspace(min_price, max_price, num_bins + 1)
        bin_volumes = np.zeros(num_bins)

        for _, row in df.iterrows():
            candle_low = row['low']
            candle_high = row['high']
            candle_vol = row['volume']
            
            # Find overlapping bins
            mask = (bins[1:] >= candle_low) & (bins[:-1] <= candle_high)
            overlap_count = np.sum(mask)
            if overlap_count > 0:
                bin_volumes[mask] += candle_vol / overlap_count

        # Find POC (bin with maximum volume)
        poc_idx = np.argmax(bin_volumes)
        poc_price = (bins[poc_idx] + bins[poc_idx + 1]) / 2.0

        # Calculate Value Area (70% around POC)
        total_vol = np.sum(bin_volumes)
        target_vol = total_vol * value_area_pct
        
        current_vol = bin_volumes[poc_idx]
        left_idx = poc_idx
        right_idx = poc_idx

        while current_vol < target_vol and (left_idx > 0 or right_idx < num_bins - 1):
            left_vol = bin_volumes[left_idx - 1] if left_idx > 0 else 0
            right_vol = bin_volumes[right_idx + 1] if right_idx < num_bins - 1 else 0

            if left_vol >= right_vol and left_idx > 0:
                left_idx -= 1
                current_vol += left_vol
            elif right_idx < num_bins - 1:
                right_idx += 1
                current_vol += right_vol
            else:
                break

        val_price = bins[left_idx]
        vah_price = bins[right_idx + 1]

        return {
            'poc': round(poc_price, 4),
            'vah': round(vah_price, 4),
            'val': round(val_price, 4),
            'total_volume': round(total_vol, 2),
            'price_bins': [round((bins[i] + bins[i+1])/2, 4) for i in range(num_bins)],
            'bin_volumes': [round(v, 2) for v in bin_volumes]
        }

    @staticmethod
    def calculate_candle_delta_and_cvd(df: pd.DataFrame) -> pd.DataFrame:
        """
        Estimates candle delta (Buyer Volume - Seller Volume) and Cumulative Volume Delta (CVD).
        Uses close-location within the bar (Williams %R / Order Flow Proxy) when raw tick data is unavailable.
        """
        df = df.copy()
        
        # Intra-bar location ratio: 1.0 = closed at extreme high, -1.0 = closed at extreme low
        bar_range = (df['high'] - df['low']).replace(0, np.nan)
        location_ratio = (2 * (df['close'] - df['low']) / bar_range) - 1.0
        location_ratio = location_ratio.fillna(0.0)

        # Estimated delta
        df['delta'] = df['volume'] * location_ratio
        df['cvd'] = df['delta'].cumsum()

        # Cumulative Volume Delta (CVD) moving average
        df['cvd_ma'] = df['cvd'].rolling(window=14).mean()

        # Delta divergence detector
        # Bearish divergence: Price makes Higher High while CVD makes Lower High
        price_hh = (df['high'] > df['high'].shift(1)) & (df['high'].shift(1) > df['high'].shift(2))
        cvd_lh = (df['cvd'] < df['cvd'].shift(1))
        df['delta_divergence_bear'] = price_hh & cvd_lh

        # Bullish divergence: Price makes Lower Low while CVD makes Higher Low
        price_ll = (df['low'] < df['low'].shift(1)) & (df['low'].shift(1) < df['low'].shift(2))
        cvd_hl = (df['cvd'] > df['cvd'].shift(1))
        df['delta_divergence_bull'] = price_ll & cvd_hl

        return df
