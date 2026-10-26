from backend.app.services.pair_selector import build_pilot_configs
from backend.app.services.overnight_pilot import OvernightPilotConfig


def _sel():
    best = lambda s, tf: {"strategy": s, "timeframe": tf, "sl": 0.5, "tp": 1.0}
    return {"results": [
        {"symbol": "ZECUSDT", "verdict": "SELECT", "best": best("ema_trend_window", "15m")},
        {"symbol": "BNBUSDT", "verdict": "EXPLORE", "best": best("ema_trend", "5m")},
        {"symbol": "BTCUSDT", "verdict": "SKIP"},
        {"symbol": "XXXUSDT", "verdict": "NO_DATA"},
    ]}


def test_build_configs_tiers_and_validity():
    cfgs = build_pilot_configs(_sel())
    assert [c["symbol"] for c in cfgs] == ["ZECUSDT", "BNBUSDT"]
    assert cfgs[0]["risk_per_trade_pct"] > cfgs[1]["risk_per_trade_pct"]  # EXPLORE = меньший риск
    for c in cfgs:
        OvernightPilotConfig(**c)  # конфиг валиден для пилота


def test_exclude_explore_and_empty():
    assert [c["symbol"] for c in build_pilot_configs(_sel(), include_explore=False)] == ["ZECUSDT"]
    assert build_pilot_configs({"results": []}) == []
