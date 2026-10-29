import pandas as pd

from backend.app.services.pair_selector import DEFAULT_SYMBOLS, build_pilot_configs, evaluate_symbol_sync
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
    assert all(c["auto_strategy_switch"] is True for c in cfgs)
    for c in cfgs:
        OvernightPilotConfig(**c)  # конфиг валиден для пилота


def test_exclude_explore_and_empty():
    assert [c["symbol"] for c in build_pilot_configs(_sel(), include_explore=False)] == ["ZECUSDT"]
    assert build_pilot_configs({"results": []}) == []


def test_selector_backtests_the_same_atr_filter_that_paper_uses():
    calls = []

    class Backtester:
        def run_backtest(self, **kwargs):
            calls.append(kwargs)
            return {"total_trades": 10, "net_pnl": 1.0, "profit_factor": 1.2}

    frame = pd.DataFrame({"close": range(300)})
    result = evaluate_symbol_sync(Backtester(), {"15m": (frame, frame)}, "BTCUSDT")
    assert result["verdict"] == "SELECT"
    assert calls
    assert all(call["use_atr_filter"] is True for call in calls)


def test_selected_config_retains_selection_history_window():
    selection = _sel()
    selection["days"] = 21
    assert all(config["days"] == 21 for config in build_pilot_configs(selection))


def test_liquid_crypto_candidates_include_additional_distinct_pairs():
    assert len(DEFAULT_SYMBOLS) >= 28
    assert len(DEFAULT_SYMBOLS) == len(set(DEFAULT_SYMBOLS))
    assert {"HYPEUSDT", "BCHUSDT", "AAVEUSDT", "LTCUSDT"} <= set(DEFAULT_SYMBOLS)
