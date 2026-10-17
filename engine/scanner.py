"""
Real-time Signal & Probability Scanner
Monitors watchlist pairs, detects setup triggers, and assesses confluence probability.
"""

import sys
import io
import time
from datetime import datetime
from typing import List, Dict, Any
import pandas as pd

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

from engine.data_loader import DataLoader
from engine.indicators import add_all_indicators
from engine.volume_profile import VolumeProfileEngine
from strategies.mtf_pullback import MTFPullbackStrategy
from strategies.cluster_breakout_strategy import ClusterAbsorptionStrategy

class RealtimeScanner:
    def __init__(self, exchange_id: str = "bybit", market_type: str = "swap"):
        self.data_loader = DataLoader(exchange_id=exchange_id, market_type=market_type)
        self.strategy = MTFPullbackStrategy()

    def scan_symbol(self, symbol: str, ltf: str = "15m", htf: str = "1h") -> Dict[str, Any]:
        """
        Scans a single symbol across LTF and HTF for real-time setup triggers.
        """
        # 1. Fetch LTF candles
        ltf_df = self.data_loader.fetch_historical_ohlcv(symbol, timeframe=ltf, days=7, force_refresh=True)
        ltf_df = add_all_indicators(ltf_df)
        
        # 2. Fetch HTF candles if specified
        if htf:
            htf_df = self.data_loader.fetch_historical_ohlcv(symbol, timeframe=htf, days=30, force_refresh=True)
            htf_df = add_all_indicators(htf_df)
            combined_df = DataLoader.align_multi_timeframe(ltf_df, htf_df, prefix="htf_")
        else:
            combined_df = ltf_df

        # 3. Generate Signals
        signaled_df = self.strategy.generate_signals(combined_df)
        
        # Inspect the last 2 bars (last completed bar and current candle)
        last_bar = signaled_df.iloc[-1]
        prev_bar = signaled_df.iloc[-2]
        
        active_signal = None
        target_bar = None
        
        if last_bar['signal'] != 0:
            active_signal = last_bar['signal']
            target_bar = last_bar
            bar_status = "Текущая (формирующаяся)"
        elif prev_bar['signal'] != 0:
            active_signal = prev_bar['signal']
            target_bar = prev_bar
            bar_status = "Закрытая свеча"
            
        result = {
            'symbol': symbol,
            'ltf': ltf,
            'htf': htf,
            'current_price': last_bar['close'],
            'has_signal': active_signal is not None,
            'signal_dir': 'LONG' if active_signal == 1 else ('SHORT' if active_signal == -1 else 'NEUTRAL'),
            'confidence_pct': round(target_bar['confidence'] * 100, 1) if target_bar is not None else 0.0,
            'tp_price': round(target_bar['tp_price'], 4) if target_bar is not None and not pd.isna(target_bar['tp_price']) else None,
            'sl_price': round(target_bar['sl_price'], 4) if target_bar is not None and not pd.isna(target_bar['sl_price']) else None,
            'bar_status': bar_status if target_bar is not None else None,
            'rsi': round(last_bar['rsi'], 1) if 'rsi' in last_bar else None,
            'vol_ratio': round(last_bar['vol_ratio'], 2) if 'vol_ratio' in last_bar else 1.0,
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        
        return result

    def scan_watchlist(self, symbols: List[str], ltf: str = "15m", htf: str = "1h") -> List[Dict[str, Any]]:
        results = []
        for sym in symbols:
            try:
                res = self.scan_symbol(sym, ltf=ltf, htf=htf)
                results.append(res)
            except Exception as e:
                results.append({
                    'symbol': sym,
                    'has_signal': False,
                    'error': str(e)
                })
        return results
