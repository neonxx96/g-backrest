import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
from backend.app.services.historical_data_loader import HistoricalDataLoader
from backend.app.services.orderflow_backtester import OrderFlowBacktester

loader = HistoricalDataLoader()
bt = OrderFlowBacktester()

symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]

for sym in symbols:
    df = loader.load_dataset_sync(sym, "15m", days=30)
    best_pf = 0.0
    best_cfg = None
    best_res = None
    
    # Try different combinations
    for vol in [1.2, 1.25, 1.3]:
        for sl in [0.4, 0.6, 0.8]:
            for tp in [0.8, 1.2, 1.6, 2.0]:
                for be in [True, False]:
                    res = bt.run_backtest(
                        df,
                        strategy_type="confluence_ema",
                        volume_multiplier=vol,
                        use_rsi_filter=False,
                        stop_loss_pct=sl,
                        take_profit_pct=tp,
                        use_dynamic_breakeven=be,
                        use_trailing=True,
                        trailing_pct=0.4,
                        fast_eval=True,
                    )
                    pf = res.get("profit_factor", 0.0)
                    trades = res.get("total_trades", 0)
                    net = res.get("net_pnl", 0.0)
                    if trades >= 8 and pf > best_pf:
                        best_pf = pf
                        best_cfg = (vol, sl, tp, be)
                        best_res = res
    if best_cfg:
        print(f"=== {sym} BEST CONFIG ===")
        print(f"  Trades: {best_res['total_trades']}, WinRate: {best_res['win_rate_pct']:.1f}%, PF: {best_pf:.2f}")
        print(f"  Net PnL: ${best_res['net_pnl']:+.2f}, Gross: ${best_res['gross_pnl']:+.2f}, Fees: ${best_res['total_fees_usd']:.2f}")
        print(f"  Max DD: {best_res['max_drawdown_pct']:.2f}%")
        print(f"  Params: vol_mult={best_cfg[0]}, SL={best_cfg[1]}%, TP={best_cfg[2]}%, dynamic_be={best_cfg[3]}")
    else:
        print(f"=== {sym} ===: No configuration found with >= 8 trades and positive PF.")
