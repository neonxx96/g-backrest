"""
Contract tests for ai_copilot_service (MODULARIZATION_PLAN п.6).

Покрывают чистые функции, извлечённые из роутера ai_copilot.py в сервис:
- NLP-парсер промптов (parse_prompt_to_strategy);
- ATR(14) и синтез дельты (compute_atr14 / get_or_synthesize_delta);
- сводка метрик свечей (compute_market_metrics);
- уровни поддержки/сопротивления из стакана (build_support_resistance);
- фаза рынка и сетап Entry/SL/TP (determine_market_phase / synthesize_trading_idea);
- шкала здоровья (_classify_health_meter / compute_health_score);
- конус волатильности, Liquidity Magnet, EV (build_expected_move_cone /
  build_liquidity_magnet / build_expected_value);
- forecast-конус и цены SL/TP (build_forecast_fan / synthesize_sl_tp_prices);
- обратная совместимость реэкспортов роутера.
"""

import pandas as pd
import numpy as np
import pytest

from backend.app.services import ai_copilot_service as svc
from backend.app.routers import ai_copilot as router_mod


# ==============================================================================
# Helpers
# ==============================================================================

def _candle_df(n=80, start_price=50000.0, uptrend=True, with_delta=False, with_oi=False,
               drift_step=8.0):
    """Детерминированный OHLCV-датафрейм: равномерный тренд, close у верхней/нижней
    границы диапазона (uptrend/downtrend), чтобы синтезированная дельта имела знак."""
    rows = []
    ts = 1700000000000
    for i in range(n):
        drift = i * drift_step
        osc = 12.0 if i % 2 == 0 else -12.0
        close = start_price + drift + osc
        if uptrend:
            high = close + 10.0
            low = close - 50.0
        else:
            high = close + 50.0
            low = close - 10.0
        row = {
            "timestamp": ts + i * 900000,
            "open": close - osc,
            "high": high,
            "low": low,
            "close": close,
            "volume": 1000.0 + i,
        }
        if with_delta:
            row["delta"] = 50.0 if uptrend else -50.0
        if with_oi:
            row["oi"] = 1000.0 + i * 0.5
        rows.append(row)
    return pd.DataFrame(rows)


# ==============================================================================
# parse_prompt_to_strategy
# ==============================================================================

class TestParsePromptToStrategy:
    def test_symbol_timeframe_strategy_detection(self):
        res = svc.parse_prompt_to_strategy("потестируй эфир на 15м, поглощение дельты")
        assert res["symbol"] == "ETHUSDT"
        assert res["timeframe"] == "15m"
        assert res["strategy_type"] == "delta_absorption"

    def test_base_defaults_applied_when_nothing_detected(self):
        res = svc.parse_prompt_to_strategy("что-то непонятное", base_symbol="SOLUSDT", base_tf="1h")
        assert res["symbol"] == "SOLUSDT"
        assert res["timeframe"] == "1h"
        assert res["strategy_type"] == "density_bounce"

    def test_base_tf_invalid_falls_back_to_5m(self):
        res = svc.parse_prompt_to_strategy("тест", base_symbol="BTCUSDT", base_tf="1D")
        assert res["timeframe"] == "5m"

    def test_conservative_profile(self):
        res = svc.parse_prompt_to_strategy("консервативная торговля btc")
        p = res["params"]
        assert p["leverage"] == 2.0
        assert p["use_atr_sl"] is True
        assert p["use_oi_filter"] is True
        assert p["stop_loss_pct"] in (0.4, 0.6)

    def test_aggressive_profile(self):
        res = svc.parse_prompt_to_strategy("агрессивный разгон на sol")
        p = res["params"]
        assert p["leverage"] == 5.0
        assert p["use_atr_filter"] is False
        assert p["use_rsi_filter"] is False

    def test_explicit_numeric_overrides(self):
        res = svc.parse_prompt_to_strategy("btc 5m sl: 0.8 tp: 2.0 плечо 3")
        p = res["params"]
        assert p["stop_loss_pct"] == 0.8
        assert p["take_profit_pct"] == 2.0
        assert p["leverage"] == 3.0

    def test_wall_defaults_by_coin(self):
        btc = svc.parse_prompt_to_strategy("btc")["params"]["min_density_usd"]
        eth = svc.parse_prompt_to_strategy("eth")["params"]["min_density_usd"]
        doge = svc.parse_prompt_to_strategy("doge")["params"]["min_density_usd"]
        assert btc == 1200000.0
        assert eth == 600000.0
        assert doge == 250000.0


# ==============================================================================
# compute_atr14 / get_or_synthesize_delta
# ==============================================================================

class TestAtrAndDelta:
    def test_atr14_positive_on_realistic_candles(self):
        df = _candle_df(40)
        atr = svc.compute_atr14(df["high"], df["low"], df["close"])
        assert 0 < atr <= 120.0  # диапазон свечей 60, TR ограничен

    def test_atr14_zero_range_without_fallback_stays_zero(self):
        flat = pd.DataFrame({"high": [100.0] * 20, "low": [100.0] * 20, "close": [100.0] * 20})
        atr = svc.compute_atr14(flat["high"], flat["low"], flat["close"])
        assert atr == 0.0

    def test_atr14_zero_range_with_fallback(self):
        flat = pd.DataFrame({"high": [100.0] * 20, "low": [100.0] * 20, "close": [100.0] * 20})
        atr = svc.compute_atr14(flat["high"], flat["low"], flat["close"], fallback_price=40000.0)
        assert atr == pytest.approx(200.0)

    def test_delta_column_preferred(self):
        df = _candle_df(10, with_delta=True)
        delta = svc.get_or_synthesize_delta(df, df["close"], df["high"], df["low"], df["volume"])
        assert list(delta) == [50.0] * 10

    def test_delta_synthesis_bounded_by_volume(self):
        df = _candle_df(10)
        delta = svc.get_or_synthesize_delta(df, df["close"], df["high"], df["low"], df["volume"])
        assert (delta.abs() <= df["volume"]).all()


# ==============================================================================
# compute_market_metrics
# ==============================================================================

class TestComputeMarketMetrics:
    def test_uptrend_metrics(self):
        df = _candle_df(80, uptrend=True)
        m = svc.compute_market_metrics(df, "15m")
        assert m["current_price"] == pytest.approx(df["close"].iloc[-1])
        assert m["price_dec"] == 1  # цена >= 100
        assert m["atr"] > 0
        assert m["ema20"] > m["ema50"]  # восходящий тренд
        assert m["vwap"] > 0
        assert m["cvd_current"] > 0  # бычий синтез дельты
        assert "CVD" in m["cvd_div_status"]
        assert m["cvd_slope"].startswith("ПОЛОЖИТЕЛЬНАЯ")
        assert isinstance(m["oi_1h_pct"], float)  # нет колонки 'oi' -> формула по дельте

    def test_oi_column_path(self):
        df = _candle_df(80, uptrend=True, with_oi=True)
        m = svc.compute_market_metrics(df, "15m")
        assert m["oi_1h_pct"] != 0  # oi растёт линейно

    def test_low_price_uses_4_decimals(self):
        df = _candle_df(40, start_price=0.5, drift_step=0.001)
        m = svc.compute_market_metrics(df, "5m")
        assert m["price_dec"] == 4


# ==============================================================================
# build_support_resistance
# ==============================================================================

class TestSupportResistance:
    def _walls(self):
        top_bids = [(49900.0, 1_500_000.0), (49800.0, 900_000.0), (49700.0, 700_000.0)]
        top_asks = [(50100.0, 1_200_000.0), (50200.0, 800_000.0), (50300.0, 600_000.0)]
        return top_bids, top_asks

    def test_levels_built_and_sorted(self):
        top_bids, top_asks = self._walls()
        sr = svc.build_support_resistance(top_bids, top_asks, 50000.0, 100.0, 50000.0, 1)
        assert [l["price"] for l in sr["support_levels"]] == [49900.0, 49800.0, 49700.0]
        assert [l["price"] for l in sr["resistance_levels"]] == [50100.0, 50200.0, 50300.0]
        assert sr["top_bid_p"] == 49900.0
        assert sr["top_ask_p"] == 50100.0
        assert sr["top_bid_dist_pct"] > 0 and sr["top_ask_dist_pct"] > 0
        assert all("Лимитная" in l["label"] for l in sr["support_levels"] + sr["resistance_levels"])

    def test_walls_on_wrong_side_filtered_out(self):
        # стенки Bid ВЫШЕ цены и Ask НИЖЕ цены должны быть отфильтрованы
        top_bids = [(50100.0, 1_500_000.0)]
        top_asks = [(49900.0, 1_200_000.0)]
        sr = svc.build_support_resistance(top_bids, top_asks, 50000.0, 100.0, 50000.0, 1)
        # fallback: поддержка ниже цены, сопротивление выше
        assert sr["top_bid_p"] < 50000.0
        assert sr["top_ask_p"] > 50000.0
        assert sr["support_levels"][0]["volume_usd"] == 1450000.0
        assert sr["resistance_levels"][0]["volume_usd"] == 1820000.0


# ==============================================================================
# determine_market_phase / synthesize_trading_idea
# ==============================================================================

class TestPhaseAndIdea:
    def test_bullish_impulse(self):
        phase, bias = svc.determine_market_phase(50100.0, 50000.0, 49900.0, 50050.0, 100.0, 10.0, 5.0)
        assert phase == "Импульс (Бычье расширение тренда)"
        assert bias == "BULLISH"

    def test_bearish_impulse(self):
        phase, bias = svc.determine_market_phase(49900.0, 50000.0, 50100.0, 49950.0, -100.0, -10.0, -5.0)
        assert phase == "Импульс (Медвежье расширение тренда)"
        assert bias == "BEARISH"

    def test_consolidation_neutral(self):
        # цена НЕ выше цепочки EMA20>=EMA50 и НЕ ниже её, VWAP далеко
        phase, bias = svc.determine_market_phase(50000.0, 50100.0, 49800.0, 50500.0, 50.0, -10.0, -5.0)
        assert phase == "Консолидация в границах ликвидности"
        assert bias == "NEUTRAL"  # cvd_current < cvd_ema14

    def _levels(self):
        support = [{"price": 49900.0, "volume_usd": 1_500_000.0, "label": "Лимитная плотность Bid $1.50M", "type": "support"}]
        resistance = [{"price": 50100.0, "volume_usd": 1_200_000.0, "label": "Лимитная стенка Ask $1.20M", "type": "resistance"}]
        return support, resistance

    def test_long_idea_geometry(self):
        support, resistance = self._levels()
        idea = svc.synthesize_trading_idea(
            bias="BULLISH", current_price=50000.0, atr=100.0,
            support_levels=support, resistance_levels=resistance,
            tp1_rr_ratio=1.5, tp2_rr_ratio=2.8,
            cvd_div_status="CVD > EMA(14)", oi_status="Приток капитала (+0.10%)",
            recent_delta_sum=200.0, price_dec=1,
            sl_mode="atr_volatility", entry_mode="limit_bounce", min_wall_lifetime_sec=30,
        )
        assert idea["direction"] == "LONG"
        assert idea["order_type"] == "BUY LIMIT"
        assert idea["entry_price"] <= 50000.0
        assert idea["stop_loss"] < idea["entry_price"]
        assert idea["tp1_price"] > idea["entry_price"]
        assert idea["take_profit"] > idea["tp1_price"]
        assert idea["recommended_strategy"] == "delta_absorption"  # recent_delta_sum > 0
        assert idea["position_setup"]["rr_label"] == "1:2.8"
        assert idea["position_setup"]["sl_mode"] == "atr_volatility"
        assert idea["position_setup"]["min_wall_lifetime_sec"] == 30

    def test_short_idea_geometry(self):
        support, resistance = self._levels()
        idea = svc.synthesize_trading_idea(
            bias="BEARISH", current_price=50000.0, atr=100.0,
            support_levels=support, resistance_levels=resistance,
            tp1_rr_ratio=None, tp2_rr_ratio=None,
            cvd_div_status="CVD < EMA(14)", oi_status="Отток капитала (-0.10%)",
            recent_delta_sum=-200.0, price_dec=1,
            sl_mode=None, entry_mode=None, min_wall_lifetime_sec=None,
        )
        assert idea["direction"] == "SHORT"
        assert idea["order_type"] == "SELL LIMIT"
        assert idea["entry_price"] >= 50000.0
        assert idea["stop_loss"] > idea["entry_price"]
        assert idea["tp1_price"] < idea["entry_price"]
        assert idea["take_profit"] < idea["tp1_price"]
        # дефолты RR и режимов
        assert idea["position_setup"]["tp1_rr"] == 1.5
        assert idea["position_setup"]["rr_ratio"] == 2.8
        assert idea["position_setup"]["sl_mode"] == "atr_volatility"
        assert idea["position_setup"]["min_wall_lifetime_sec"] == 30

    def test_explicit_rr_ratios_respected(self):
        support, resistance = self._levels()
        idea = svc.synthesize_trading_idea(
            bias="BULLISH", current_price=50000.0, atr=100.0,
            support_levels=support, resistance_levels=resistance,
            tp1_rr_ratio=2.0, tp2_rr_ratio=3.5,
            cvd_div_status="CVD > EMA(14)", oi_status="x",
            recent_delta_sum=1.0, price_dec=1,
            sl_mode=None, entry_mode=None, min_wall_lifetime_sec=None,
        )
        assert idea["position_setup"]["tp1_rr"] == 2.0
        assert idea["position_setup"]["rr_label"] == "1:3.5"
        risk = idea["entry_price"] - idea["stop_loss"]
        assert idea["tp1_price"] == pytest.approx(round(idea["entry_price"] + 2.0 * risk, 1))


# ==============================================================================
# Health meter
# ==============================================================================

class TestHealthMeter:
    def test_zones_thresholds(self):
        base = dict(sym="BTCUSDT", entry_price=50000.0, tp1_price=50500.0, sl_price=49500.0,
                    top_bid_price=49900.0, top_bid_usd=1_500_000.0,
                    top_ask_price=50100.0, top_ask_usd=1_000_000.0,
                    oi_1h_pct=0.5, cvd_div_status="CVD > EMA(14)")
        assert svc._classify_health_meter(score=85, **base)["zone"] == "GREEN"
        assert svc._classify_health_meter(score=60, **base)["zone"] == "BLUE"
        assert svc._classify_health_meter(score=30, **base)["zone"] == "YELLOW"
        assert svc._classify_health_meter(score=10, **base)["zone"] == "RED"

    def test_score_clamped(self):
        base = dict(sym="BTCUSDT", entry_price=50000.0, tp1_price=50500.0, sl_price=49500.0,
                    top_bid_price=49900.0, top_bid_usd=1_500_000.0,
                    top_ask_price=50100.0, top_ask_usd=1_000_000.0,
                    oi_1h_pct=0.5, cvd_div_status="CVD > EMA(14)")
        assert svc._classify_health_meter(score=150, **base)["score"] == 100
        assert svc._classify_health_meter(score=-5, **base)["score"] == 0

    def test_health_score_all_bullish(self):
        s = svc.compute_health_score(cvd_current=10, cvd_ema14=5, recent_delta_sum=100,
                                     oi_1h_pct=0.5, top_bid_usd=2_000_000.0, top_ask_usd=1_000_000.0)
        assert s == 95  # 62+12+8+7+6

    def test_health_score_all_bearish(self):
        s = svc.compute_health_score(cvd_current=-10, cvd_ema14=5, recent_delta_sum=-100,
                                     oi_1h_pct=-0.5, top_bid_usd=500_000.0, top_ask_usd=1_000_000.0)
        assert s == 32  # 62-10-6-9-5

    def test_health_score_override_wins(self):
        s = svc.compute_health_score(cvd_current=10, cvd_ema14=5, recent_delta_sum=100,
                                     oi_1h_pct=0.5, top_bid_usd=2_000_000.0, top_ask_usd=1_000_000.0,
                                     override=41)
        assert s == 41


# ==============================================================================
# build_expected_move_cone
# ==============================================================================

class TestExpectedMoveCone:
    def test_cone_shape_and_ordering(self):
        cone = svc.build_expected_move_cone(
            current_price=50000.0, atr=100.0, bias="BULLISH",
            recent_delta_sum=50.0, last_candle_ts=1700000000000,
            tf="15m", price_dec=1,
        )
        assert cone["bars_forward"] == 16
        assert len(cone["fan_points"]) == 16
        assert cone["base_price"] == 50000.0
        assert cone["base_timestamp"] == 1700000000000
        assert cone["sigma_1s_pct"] > 0 and cone["sigma_2s_pct"] > cone["sigma_1s_pct"]
        first = cone["fan_points"][0]
        assert first["lower_2s"] < first["lower_1s"] <= first["price_mid"] <= first["upper_1s"] < first["upper_2s"]
        # шаг времени = 15 минут
        assert cone["fan_points"][1]["timestamp"] - first["timestamp"] == 15 * 60 * 1000

    def test_bearish_drift_lowers_mid(self):
        cone = svc.build_expected_move_cone(
            current_price=50000.0, atr=100.0, bias="BEARISH",
            recent_delta_sum=-50.0, last_candle_ts=1700000000000,
            tf="5m", price_dec=1,
        )
        mid_k16 = cone["fan_points"][-1]["price_mid"]
        assert mid_k16 < 50000.0


# ==============================================================================
# build_liquidity_magnet
# ==============================================================================

class TestLiquidityMagnet:
    def _walls(self):
        bid_items = [(49900.0, 2_000_000.0), (49700.0, 1_000_000.0)]
        ask_items = [(50100.0, 1_000_000.0), (50300.0, 500_000.0)]
        return bid_items, ask_items

    def test_bullish_support(self):
        bid_items, ask_items = self._walls()
        mag = svc.build_liquidity_magnet(
            bid_items=bid_items, ask_items=ask_items, current_price=50000.0,
            top_bid_p=49900.0, top_bid_usd=2_000_000.0, top_bid_dist_pct=0.2,
            top_ask_p=50100.0, top_ask_usd=1_000_000.0, top_ask_dist_pct=0.2,
            price_dec=1,
        )
        assert mag["magnet_vector"] == "BULLISH_SUPPORT"
        assert mag["target_liquidity_price"] == 50100.0
        assert mag["bids_volume_usd"] == 3000000.0  # обе стенки Bid в коридоре
        assert mag["corridor_pct"] == 1.5

    def test_bearish_pressure(self):
        bid_items, ask_items = self._walls()
        mag = svc.build_liquidity_magnet(
            bid_items=ask_items, ask_items=bid_items, current_price=50000.0,
            top_bid_p=49900.0, top_bid_usd=1_000_000.0, top_bid_dist_pct=0.2,
            top_ask_p=50100.0, top_ask_usd=2_000_000.0, top_ask_dist_pct=0.2,
            price_dec=1,
        )
        assert mag["magnet_vector"] == "BEARISH_PRESSURE"
        assert mag["target_liquidity_price"] == 49900.0

    def test_balanced_and_corridor_filter(self):
        # стенки вне ±1.5% не должны входить в суммы
        far_bid = [(48000.0, 9_000_000.0)]
        near_ask = [(50100.0, 1_000_000.0)]
        mag = svc.build_liquidity_magnet(
            bid_items=far_bid, ask_items=near_ask, current_price=50000.0,
            top_bid_p=49900.0, top_bid_usd=1_000_000.0, top_bid_dist_pct=0.2,
            top_ask_p=50100.0, top_ask_usd=1_000_000.0, top_ask_dist_pct=0.2,
            price_dec=1,
        )
        assert mag["bids_volume_usd"] == 0.0  # дальняя стенка отфильтрована
        assert mag["magnet_vector"] == "BEARISH_PRESSURE"
        # balanced: одинаковые объёмы в коридоре
        mag2 = svc.build_liquidity_magnet(
            bid_items=[(49900.0, 1_000_000.0)], ask_items=[(50100.0, 1_000_000.0)],
            current_price=50000.0,
            top_bid_p=49900.0, top_bid_usd=1_000_000.0, top_bid_dist_pct=0.2,
            top_ask_p=50100.0, top_ask_usd=1_000_000.0, top_ask_dist_pct=0.2,
            price_dec=1,
        )
        assert mag2["magnet_vector"] == "BALANCED"
        assert mag2["target_liquidity_price"] == 50000.0


# ==============================================================================
# build_expected_value
# ==============================================================================

class TestExpectedValue:
    def test_positive_ev_verdict(self):
        ev = svc.build_expected_value(0.6, 300.0, 100.0, 5.0, 175.0, 1.75, 50)
        assert ev["is_positive_expectancy"] is True
        assert ev["verdict"].startswith("Математическое")
        assert ev["ev_r_multiple"] == "+1.75R"
        assert ev["sample_warning"] is None
        assert ev["is_statistically_significant"] is True

    def test_negative_ev_and_small_sample(self):
        ev = svc.build_expected_value(0.4, 100.0, 300.0, 5.0, -185.0, -1.85, 12)
        assert ev["is_positive_expectancy"] is False
        assert "Мало данных" in ev["sample_warning"]
        assert ev["ev_r_multiple"] == "-1.85R"


# ==============================================================================
# build_forecast_fan / synthesize_sl_tp_prices
# ==============================================================================

class TestForecastHelpers:
    def test_fan_shape(self):
        fan = svc.build_forecast_fan(
            current_price=50000.0, atr=100.0, drift_direction=1.0,
            anchor_timestamp=1700000000000, horizon_bars=8,
            time_step_ms=15 * 60 * 1000, price_dec=1,
        )
        assert len(fan["fan_points"]) == 8
        pt = fan["fan_points"][0]
        for key in ("bar_offset", "step", "timestamp", "price_mid",
                    "upper_1s", "lower_1s", "upper_2s", "lower_2s",
                    "upper_1sigma", "lower_1sigma", "upper_2sigma", "lower_2sigma"):
            assert key in pt
        assert fan["expected_drift_pct"] > 0
        assert fan["fan_points"][-1]["price_mid"] > 50000.0

    def test_sl_tp_long_with_explicit_pcts(self):
        levels = svc.synthesize_sl_tp_prices(
            direction="LONG", current_price=50000.0, atr=100.0,
            sl_pct=0.6, tp_pct=1.8, tp1_rr=1.5, price_dec=1,
        )
        assert levels["sl_price"] == pytest.approx(49700.0)
        assert levels["tp2_price"] == pytest.approx(50900.0)
        # tp1 = min(tp2_dist, sl_dist * 1.5) = min(900, 450) = 450
        assert levels["tp1_price"] == pytest.approx(50450.0)
        assert levels["breakeven_price"] == pytest.approx(50050.0)

    def test_sl_tp_short_atr_defaults(self):
        levels = svc.synthesize_sl_tp_prices(
            direction="SHORT", current_price=50000.0, atr=100.0,
            sl_pct=0.0, tp_pct=0.0, tp1_rr=1.5, price_dec=1,
        )
        assert levels["sl_price"] == pytest.approx(50120.0)   # 1.2 * ATR
        assert levels["tp2_price"] == pytest.approx(49720.0)  # 2.8 * ATR
        assert levels["tp1_price"] < 50000.0
        assert levels["breakeven_price"] == pytest.approx(49950.0)


# ==============================================================================
# Обратная совместимость реэкспортов роутера
# ==============================================================================

class TestRouterReexports:
    def test_forecast_symbols_reexported(self):
        assert router_mod.compute_probabilistic_forecast is svc.compute_probabilistic_forecast
        assert router_mod.build_forecast_signal is svc.build_forecast_signal
        assert router_mod.classify_forecast_regime is svc.classify_forecast_regime
