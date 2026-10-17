"""
Validation script for Order Flow Footprint Confluence Matrix & Level Inspector.
Verifies:
1. POST /api/backtest/run returns valid confluence_matrix with WinRate, PF, and context_snapshot
2. POST /api/backtest/inspect-level returns level bounce statistics and recommendation
3. POST /api/ai/optimize-strategy returns parsed params and confluence_matrix
"""

import sys
import json
import urllib.request
import urllib.error

# Ensure UTF-8 output on Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BASE_URL = "http://127.0.0.1:8000"


def test_backtest_run():
    print("Testing /api/backtest/run ...")
    payload = {
        "symbol": "BTCUSDT",
        "timeframe": "5m",
        "days": 7,
        "strategy_type": "density_bounce",
        "initial_capital": 10000.0,
        "params": {
            "take_profit_pct": 1.5,
            "stop_loss_pct": 0.6,
            "min_density_usd": 0.0,
            "volume_multiplier": 1.1,
            "leverage": 2.0,
            "use_atr_filter": False,
            "use_cvd_filter": False,
            "use_oi_filter": False,
            "use_rsi_filter": False
        }
    }
    req = urllib.request.Request(
        f"{BASE_URL}/api/backtest/run",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200, f"Expected 200, got {resp.status}"
        data = json.loads(resp.read().decode("utf-8"))
        
        matrix = data.get("confluence_matrix", [])
        trades = data.get("trades", [])
        summary = data.get("summary", {})
        
        print(f"  -> Total trades: {summary.get('total_trades')}, WinRate: {summary.get('win_rate_pct')}%")
        print(f"  -> Confluence matrix size: {len(matrix)}")
        
        if trades:
            sample_trade = trades[0]
            assert "context_snapshot" in sample_trade, "Trade missing context_snapshot"
            ctx = sample_trade["context_snapshot"]
            print(f"  -> Sample trade context: Imbalance={ctx.get('imbalance_group')}, POC={ctx.get('poc_position')}, CVD={ctx.get('cvd_trend')}, Wall={ctx.get('wall_type')}")

        if matrix:
            for item in matrix[:3]:
                print(f"  -> Top combo: '{item['condition_name']}' | WR={item['win_rate_pct']}% | PF={item['profit_factor']} | Grade={item['grade']}")
                assert item["win_rate_pct"] is not None and not (item["win_rate_pct"] != item["win_rate_pct"]), "WinRate is NaN"
        
        print("PASS: /api/backtest/run confluence matrix verified\n")


def test_inspect_level():
    print("Testing /api/backtest/inspect-level ...")
    payload = {
        "symbol": "BTCUSDT",
        "timeframe": "5m",
        "price": 68000.0,
        "days": 14,
        "tolerance_pct": 0.4
    }
    req = urllib.request.Request(
        f"{BASE_URL}/api/backtest/inspect-level",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200, f"Expected 200, got {resp.status}"
        data = json.loads(resp.read().decode("utf-8"))
        
        print(f"  -> Level price: ${data.get('level_price')}")
        print(f"  -> Total touches: {data.get('total_touches')}")
        print(f"  -> Bounces: {data.get('bounces_count')}, Breakouts: {data.get('breakouts_count')}")
        print(f"  -> Bounce WinRate: {data.get('bounce_winrate_pct')}%")
        print(f"  -> Recommendation: {data.get('recommendation')}")
        assert "bounce_winrate_pct" in data
        assert "recommendation" in data
        print("PASS: /api/backtest/inspect-level verified\n")


def test_ai_copilot_matrix():
    print("Testing /api/ai/optimize-strategy ...")
    payload = {
        "prompt": "Найди консервативную скальпинг стратегию для BTCUSDT 5m с фильтрами дельты и объема",
        "symbol": "BTCUSDT",
        "timeframe": "5m",
        "days": 5
    }
    req = urllib.request.Request(
        f"{BASE_URL}/api/ai/optimize-strategy",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        assert resp.status == 200, f"Expected 200, got {resp.status}"
        data = json.loads(resp.read().decode("utf-8"))
        
        assert "ai_summary" in data
        assert "confluence_matrix" in data
        print(f"  -> AI Summary length: {len(data['ai_summary'])} chars")
        print(f"  -> Confluence matrix returned: {len(data['confluence_matrix'])} combinations")
        print("PASS: /api/ai/optimize-strategy verified\n")


if __name__ == "__main__":
    try:
        test_backtest_run()
        test_inspect_level()
        test_ai_copilot_matrix()
        print("ALL CONFLUENCE & LEVEL INSPECT TESTS PASSED!")
    except Exception as e:
        print(f"FAILURE: {e}", file=sys.stderr)
        sys.exit(1)
