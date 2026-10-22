import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.historical_data_loader import HistoricalDataLoader
from backend.app.services.orderflow_backtester import OrderFlowBacktester

loader = HistoricalDataLoader()
bt = OrderFlowBacktester()

for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
    df = loader.load_dataset_sync(sym, "15m", days=30)
    print(f"\n--- {sym} 15m ---")
    for vol in [1.15, 1.25]:
        for rsi_filt in [True, False]:
            for sl in [0.8, 1.2]:
                for tp in [2.0, 3.0]:
                    res = bt.run_backtest(
                        df,
                        strategy_type="confluence_ema",
                        volume_multiplier=vol,
                        use_rsi_filter=rsi_filt,
                        stop_loss_pct=sl,
                        take_profit_pct=tp,
                        use_dynamic_breakeven=True,
                        dynamic_be_trigger_r=0.5,
                        fast_eval=True,
                    )
                    pf = res.get("profit_factor", 0.0)
                    trades = res.get("total_trades", 0)
                    net = res.get("net_pnl", 0.0)
                    wr = res.get("win_rate_pct", 0.0)
                    if trades >= 4:
                        print(f"vol={vol} rsi={rsi_filt} sl={sl} tp={tp} -> trades={trades:2d} WR={wr:4.1f}% PF={pf:4.2f} Net=${net:+7.2f}")
