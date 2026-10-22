"""
Calibration runner: Compares Strict Baseline vs Calibrated thresholds on 30-day historical Binance Futures data.
Symbols: BTCUSDT, ETHUSDT, SOLUSDT (15m timeframe).
"""
import sys
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import pandas as pd
from backend.app.services.historical_data_loader import HistoricalDataLoader
from backend.app.services.orderflow_backtester import OrderFlowBacktester

def run_variant(df: pd.DataFrame, symbol: str, variant_name: str, config: dict) -> dict:
    backtester = OrderFlowBacktester(
        initial_capital=10000.0,
        fee_pct=0.05,
        maker_fee_pct=0.02,
        taker_fee_pct=0.05,
        slippage_ticks=2,
    )

    res = backtester.run_backtest(
        df=df,
        strategy_type=config.get("strategy_type", "confluence_ema"),
        volume_multiplier=config.get("volume_multiplier", 1.3),
        use_rsi_filter=config.get("use_rsi_filter", False),
        stop_loss_pct=config.get("stop_loss_pct", 0.8),
        take_profit_pct=config.get("take_profit_pct", 1.6),
        use_trailing=config.get("use_trailing", True),
        trailing_pct=config.get("trailing_pct", 0.5),
        leverage=config.get("leverage", 1.0),
        use_multi_tp=config.get("use_multi_tp", True),
        use_dynamic_breakeven=config.get("use_dynamic_breakeven", True),
    )

    total_trades = res.get("total_trades", 0)
    win_rate = res.get("win_rate_pct", 0.0)
    profit_factor = res.get("profit_factor", 0.0)
    net_pnl_usd = res.get("net_pnl", 0.0)
    gross_pnl_usd = res.get("gross_pnl", 0.0)
    roi_pct = res.get("roi_pct", 0.0)
    max_drawdown_pct = res.get("max_drawdown_pct", 0.0)
    total_fees = res.get("total_fees_usd", 0.0)
    total_slippage = res.get("total_slippage_usd", 0.0)

    return {
        "symbol": symbol,
        "variant": variant_name,
        "trades": total_trades,
        "win_rate_%": round(win_rate, 2),
        "profit_factor": round(profit_factor, 2),
        "gross_pnl_$": round(gross_pnl_usd, 2),
        "net_pnl_$": round(net_pnl_usd, 2),
        "roi_%": round(roi_pct, 2),
        "max_dd_%": round(max_drawdown_pct, 2),
        "fees_$": round(total_fees, 2),
        "slippage_$": round(total_slippage, 2),
    }

def main():
    loader = HistoricalDataLoader()
    symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    results = []

    for sym in symbols:
        print(f"Loading 30d 15m data for {sym}...")
        df = loader.load_dataset_sync(sym, "15m", days=30)
        print(f"  Loaded {len(df)} candles.")

        # Variant 1: Strict Baseline (vol >= 1.3, use_rsi_filter=True)
        v1_conf = {
            "strategy_type": "confluence_ema",
            "volume_multiplier": 1.3,
            "use_rsi_filter": True,
            "stop_loss_pct": 0.8,
            "take_profit_pct": 1.6,
            "use_trailing": True,
            "trailing_pct": 0.5,
            "leverage": 1.0,
            "use_multi_tp": True,
            "use_dynamic_breakeven": True,
        }
        res1 = run_variant(df, sym, "1. Strict Baseline (vol>=1.3, rsi_filter=True)", v1_conf)
        results.append(res1)

        # Variant 2: Calibrated (vol >= 1.15, use_rsi_filter=False)
        v2_conf = {
            "strategy_type": "confluence_ema",
            "volume_multiplier": 1.15,
            "use_rsi_filter": False,
            "stop_loss_pct": 0.8,
            "take_profit_pct": 1.6,
            "use_trailing": True,
            "trailing_pct": 0.5,
            "leverage": 1.0,
            "use_multi_tp": True,
            "use_dynamic_breakeven": True,
        }
        res2 = run_variant(df, sym, "2. Calibrated (vol>=1.15, rsi_filter=False)", v2_conf)
        results.append(res2)

    print("\n" + "="*80)
    print("RESULTS COMPARISON TABLE (30 Days, 15m Timeframe):")
    print("="*80)
    res_df = pd.DataFrame(results)
    print(res_df.to_string(index=False))

    out_path = PROJECT_ROOT / "calibration_results.json"
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nSaved results to {out_path}")

if __name__ == "__main__":
    main()
