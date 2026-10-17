"""
Headless verification of POST /api/backtest/run.
Usage: python scripts/verify_backtest.py   (backend must run on :8000)
Exit code 0 = all checks passed.
"""

import json
import math
import sys
import urllib.request

URL = "http://127.0.0.1:8000/api/backtest/run"
SUMMARY_KEYS = {
    "total_pnl_pct", "win_rate_pct", "total_trades", "winning_trades",
    "losing_trades", "profit_factor", "max_drawdown_pct", "sharpe_ratio",
}
TRADE_KEYS = {"id", "entry_time", "exit_time", "type", "entry_price", "exit_price", "pnl_pct", "pnl_usd", "reason"}
SIGNAL_KEYS = {"time", "type", "price", "label"}

failures = []


def check(cond, msg):
    print(("  [OK]   " if cond else "  [FAIL] ") + msg)
    if not cond:
        failures.append(msg)


def post(payload):
    req = urllib.request.Request(
        URL, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode()
    # strict parse: reject NaN / Infinity tokens
    def bad(tok):
        raise ValueError(f"non-finite JSON token: {tok}")
    return json.loads(raw, parse_constant=bad)


def walk_finite(o):
    if isinstance(o, dict):
        return all(walk_finite(v) for v in o.values())
    if isinstance(o, list):
        return all(walk_finite(v) for v in o)
    if isinstance(o, float):
        return math.isfinite(o)
    return True


def run_case(strategy, params, timeframe="15m", days=14):
    print(f"\n== {strategy} / {timeframe} / {days}d ==")
    res = post({
        "symbol": "BTCUSDT", "timeframe": timeframe, "days": days,
        "strategy_type": strategy, "params": params,
    })
    s = res["summary"]
    check(SUMMARY_KEYS <= set(s), "summary has all required keys")
    check(walk_finite(res), "no NaN/Infinity anywhere in response")
    check(set(res) >= {"summary", "trades", "signals", "equity_curve"}, "top-level keys present")
    trades, signals = res["trades"], res["signals"]
    check(s["total_trades"] == len(trades), f"total_trades == len(trades) ({len(trades)})")
    check(s["winning_trades"] + s["losing_trades"] == s["total_trades"], "wins + losses == total")
    check(len(signals) == len(trades), "one entry signal per trade")
    if trades:
        check(TRADE_KEYS <= set(trades[0]), "trade has required keys")
        check(SIGNAL_KEYS <= set(signals[0]), "signal has required keys")
        check(all(t["type"] in ("BUY", "SELL") for t in trades), "trade types are BUY/SELL")
        check(all(t["exit_time"] >= t["entry_time"] for t in trades), "exit_time >= entry_time")
        # PnL sanity: sign must match price move for the side
        ok = True
        for t in trades:
            move = (t["exit_price"] - t["entry_price"]) * (1 if t["type"] == "BUY" else -1)
            if (move > 0) != (t["pnl_pct"] > 0) and abs(move) > 1e-9 and abs(t["pnl_pct"]) > 0.05:
                ok = False
        check(ok, "pnl_pct sign matches price move")
        wins = sum(1 for t in trades if t["pnl_usd"] > 0)
        check(wins == s["winning_trades"], f"winning_trades matches trades ({wins})")
        wr = round(wins / len(trades) * 100, 2)
        check(abs(wr - s["win_rate_pct"]) < 0.02, f"win_rate recomputed = {wr}")
        eq_last = res["equity_curve"][-1]["equity"]
        check(abs((eq_last / 10000.0 - 1) * 100 - s["total_pnl_pct"]) < 0.05, "equity curve end matches total_pnl_pct")
    check(0 <= s["max_drawdown_pct"] <= 100, "max drawdown within 0..100%")
    print("  summary:", json.dumps(s))
    print("  meta:   ", json.dumps(res.get("meta")))
    return res


def main():
    base = {"stop_loss_pct": 0.8, "take_profit_pct": 1.6, "min_density_usd": 0, "volume_multiplier": 1.3, "leverage": 2}
    run_case("ema_trend", base, "15m", 14)
    run_case("delta_absorption", {**base, "volume_multiplier": 1.0}, "5m", 14)
    run_case("density_bounce", {**base, "volume_multiplier": 1.0, "min_density_usd": 100000}, "5m", 14)

    print("\n== validation ==")
    try:
        post({"symbol": "BTCUSDT", "timeframe": "7m", "days": 3, "strategy_type": "ema_trend"})
        check(False, "invalid timeframe must be rejected")
    except urllib.error.HTTPError as e:
        check(e.code == 422, f"invalid timeframe -> HTTP {e.code}")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        sys.exit(1)
    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
