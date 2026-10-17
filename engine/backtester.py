"""
Realistic Bar-by-Bar Backtesting Engine for g-backrest
Simulates trades with fees, slippage, Take Profit, Stop Loss, and Trailing Stops.
"""

from typing import List, Dict, Any
import pandas as pd
import numpy as np

class Backtester:
    def __init__(self, initial_capital: float = 10000.0, fee_pct: float = 0.05, slippage_pct: float = 0.02):
        self.initial_capital = initial_capital
        self.fee_pct = fee_pct / 100.0  # e.g. 0.05% -> 0.0005
        self.slippage_pct = slippage_pct / 100.0

    def run(self, df: pd.DataFrame, strategy) -> Dict[str, Any]:
        """
        Runs the backtest on the prepared dataframe with strategy signals.
        """
        # Ensure signals and TP/SL are calculated
        data = strategy.generate_signals(df.copy())
        
        trades = []
        in_position = False
        pos_dir = 0  # 1 for Long, -1 for Short
        entry_price = 0.0
        entry_time = None
        tp_price = 0.0
        sl_price = 0.0
        trailing_sl = 0.0
        max_favorable_price = 0.0
        
        capital = self.initial_capital
        equity_curve = [capital]
        equity_times = [data.index[0]]

        for i in range(len(data)):
            row = data.iloc[i]
            current_time = data.index[i]
            open_p = row['open']
            high_p = row['high']
            low_p = row['low']
            close_p = row['close']
            signal = row.get('signal', 0)
            
            # --- 1. Manage existing position ---
            if in_position:
                exit_price = None
                exit_reason = None
                
                # Check Trailing Stop logic
                if strategy.use_trailing and trailing_sl > 0:
                    if pos_dir == 1:
                        if high_p > max_favorable_price:
                            max_favorable_price = high_p
                            # Raise trailing stop if profit threshold reached
                            new_sl = max_favorable_price - (row['atr'] * strategy.trailing_step if 'atr' in row else entry_price * (strategy.trailing_step / 100.0))
                            if new_sl > trailing_sl:
                                trailing_sl = new_sl
                        if low_p <= trailing_sl:
                            exit_price = trailing_sl * (1.0 - self.slippage_pct)
                            exit_reason = "Trailing Stop"
                    elif pos_dir == -1:
                        if low_p < max_favorable_price:
                            max_favorable_price = low_p
                            new_sl = max_favorable_price + (row['atr'] * strategy.trailing_step if 'atr' in row else entry_price * (strategy.trailing_step / 100.0))
                            if new_sl < trailing_sl:
                                trailing_sl = new_sl
                        if high_p >= trailing_sl:
                            exit_price = trailing_sl * (1.0 + self.slippage_pct)
                            exit_reason = "Trailing Stop"
                            
                # Check Standard Stop Loss and Take Profit
                if exit_price is None:
                    if pos_dir == 1:
                        # Long Exit Check
                        hit_sl = low_p <= sl_price
                        hit_tp = high_p >= tp_price
                        
                        if hit_sl and hit_tp:
                            # Conservative: assume SL hit first
                            exit_price = sl_price * (1.0 - self.slippage_pct)
                            exit_reason = "Stop Loss (Both hit)"
                        elif hit_sl:
                            exit_price = sl_price * (1.0 - self.slippage_pct)
                            exit_reason = "Stop Loss"
                        elif hit_tp:
                            exit_price = tp_price * (1.0 - self.slippage_pct)
                            exit_reason = "Take Profit"
                            
                    elif pos_dir == -1:
                        # Short Exit Check
                        hit_sl = high_p >= sl_price
                        hit_tp = low_p <= tp_price
                        
                        if hit_sl and hit_tp:
                            exit_price = sl_price * (1.0 + self.slippage_pct)
                            exit_reason = "Stop Loss (Both hit)"
                        elif hit_sl:
                            exit_price = sl_price * (1.0 + self.slippage_pct)
                            exit_reason = "Stop Loss"
                        elif hit_tp:
                            exit_price = tp_price * (1.0 + self.slippage_pct)
                            exit_reason = "Take Profit"
                            
                # Execute position exit
                if exit_price is not None:
                    # Calculate PnL
                    if pos_dir == 1:
                        gross_pnl_pct = (exit_price - entry_price) / entry_price
                    else:
                        gross_pnl_pct = (entry_price - exit_price) / entry_price
                        
                    # Deduct round-trip fees
                    net_pnl_pct = gross_pnl_pct - (2 * self.fee_pct)
                    pnl_amount = capital * net_pnl_pct
                    capital += pnl_amount
                    
                    trades.append({
                        'entry_time': entry_time,
                        'exit_time': current_time,
                        'direction': 'LONG' if pos_dir == 1 else 'SHORT',
                        'entry_price': entry_price,
                        'exit_price': exit_price,
                        'gross_pnl_pct': round(gross_pnl_pct * 100, 2),
                        'net_pnl_pct': round(net_pnl_pct * 100, 2),
                        'pnl_usd': round(pnl_amount, 2),
                        'exit_reason': exit_reason,
                        'capital_after': round(capital, 2)
                    })
                    
                    in_position = False
                    pos_dir = 0
                    
            # --- 2. Check new entry signal ---
            if not in_position and signal in [1, -1]:
                # Enter on bar close (or next bar open)
                pos_dir = int(signal)
                entry_time = current_time
                if pos_dir == 1:
                    entry_price = close_p * (1.0 + self.slippage_pct)
                else:
                    entry_price = close_p * (1.0 - self.slippage_pct)
                    
                tp_price = row.get('tp_price', entry_price * (1.02 if pos_dir == 1 else 0.98))
                sl_price = row.get('sl_price', entry_price * (0.99 if pos_dir == 1 else 1.01))
                trailing_sl = sl_price
                max_favorable_price = entry_price
                in_position = True

            equity_curve.append(capital)
            equity_times.append(current_time)

        # Calculate comprehensive statistics
        stats = self._calculate_stats(trades, capital, equity_curve)
        stats['equity_df'] = pd.DataFrame({'datetime': equity_times, 'equity': equity_curve}).set_index('datetime')
        stats['trades_df'] = pd.DataFrame(trades)
        return stats

    def _calculate_stats(self, trades: List[Dict], final_capital: float, equity: List[float]) -> Dict[str, Any]:
        total_trades = len(trades)
        if total_trades == 0:
            return {
                'total_trades': 0,
                'win_rate_pct': 0.0,
                'profit_factor': 0.0,
                'net_profit_pct': 0.0,
                'net_profit_usd': 0.0,
                'max_drawdown_pct': 0.0,
                'wins': 0,
                'losses': 0,
                'trades': []
            }

        pnls = [t['net_pnl_pct'] for t in trades]
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p <= 0]
        
        win_count = len(wins)
        loss_count = len(losses)
        win_rate = (win_count / total_trades) * 100.0
        
        gross_profit = sum(wins)
        gross_loss = abs(sum(losses))
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 999.0
        
        # Max Drawdown
        eq = np.array(equity)
        peak = np.maximum.accumulate(eq)
        drawdown = (peak - eq) / peak
        max_dd = float(np.max(drawdown) * 100.0)
        
        net_profit_usd = final_capital - self.initial_capital
        net_profit_pct = (net_profit_usd / self.initial_capital) * 100.0
        
        # Win streaks
        max_win_streak = 0
        max_loss_streak = 0
        curr_win = 0
        curr_loss = 0
        for p in pnls:
            if p > 0:
                curr_win += 1
                curr_loss = 0
                max_win_streak = max(max_win_streak, curr_win)
            else:
                curr_loss += 1
                curr_win = 0
                max_loss_streak = max(max_loss_streak, curr_loss)
                
        avg_trade = np.mean(pnls)
        avg_win = np.mean(wins) if wins else 0.0
        avg_loss = np.mean(losses) if losses else 0.0
        risk_reward_realized = round(abs(avg_win / avg_loss), 2) if avg_loss != 0 else 0.0

        return {
            'total_trades': total_trades,
            'win_rate_pct': round(win_rate, 2),
            'profit_factor': profit_factor,
            'net_profit_pct': round(net_profit_pct, 2),
            'net_profit_usd': round(net_profit_usd, 2),
            'max_drawdown_pct': round(max_dd, 2),
            'wins': win_count,
            'losses': loss_count,
            'avg_trade_pct': round(avg_trade, 2),
            'avg_win_pct': round(avg_win, 2),
            'avg_loss_pct': round(avg_loss, 2),
            'risk_reward_ratio': risk_reward_realized,
            'max_win_streak': max_win_streak,
            'max_loss_streak': max_loss_streak,
            'trades': trades
        }
