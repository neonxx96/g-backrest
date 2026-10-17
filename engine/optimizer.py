"""
Strategy Optimizer
Performs grid-search backtesting to find the highest probability and most profitable parameters.
"""

import itertools
from typing import Dict, List, Any
import pandas as pd
from engine.backtester import Backtester

class StrategyOptimizer:
    def __init__(self, backtester: Backtester = None):
        self.backtester = backtester or Backtester()

    def optimize(self, df: pd.DataFrame, strategy_class, param_grid: Dict[str, List[Any]], top_n: int = 5) -> List[Dict[str, Any]]:
        """
        Runs backtests over all parameter combinations and returns sorted rankings.
        """
        keys = list(param_grid.keys())
        values = list(param_grid.values())
        combinations = list(itertools.product(*values))
        
        results = []
        for combo in combinations:
            params = dict(zip(keys, combo))
            strat = strategy_class(params=params)
            stats = self.backtester.run(df, strat)
            
            if stats['total_trades'] >= 3:  # Filter out trivial cases
                results.append({
                    'params': params,
                    'total_trades': stats['total_trades'],
                    'win_rate_pct': stats['win_rate_pct'],
                    'profit_factor': stats['profit_factor'],
                    'net_profit_pct': stats['net_profit_pct'],
                    'max_drawdown_pct': stats['max_drawdown_pct'],
                    'risk_reward': stats['risk_reward_ratio'],
                    'score': stats['profit_factor'] * (stats['win_rate_pct'] / 100.0)
                })

        # Sort by composite score (Profit Factor * Win Rate)
        results.sort(key=lambda x: (x['profit_factor'], x['net_profit_pct']), reverse=True)
        return results[:top_n]
