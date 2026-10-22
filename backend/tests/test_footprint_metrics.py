"""Tests for footprint cluster metrics (SRS M1.2b, roadmap phase 4.2):
per-level imbalance, stacked imbalance runs and absorption detection."""

from backend.app.services.recorder import (
    ABSORPTION_DELTA_SHARE,
    ABSORPTION_VOL_MULT,
    IMBALANCE_RATIO,
    annotate_cluster_metrics,
)


def _candle(ts, levels, vol=None, delta=None):
    lvls = [{"price": p, "buy_vol": b, "sell_vol": s, "delta": round(b - s, 4), "trades": 1}
            for p, b, s in levels]
    return {
        "timestamp": ts,
        "total_volume": vol if vol is not None else round(sum(b + s for _, b, s in levels), 4),
        "total_delta": delta if delta is not None else round(sum(b - s for _, b, s in levels), 4),
        "levels": lvls,
    }


def test_imbalance_flags_levels_with_ratio_3_and_significant_volume():
    candles = [_candle(0, [
        (100.0, 90.0, 30.0),   # ровно 3.0 -> buy imbalance
        (101.0, 10.0, 40.0),   # 4.0 -> sell imbalance
        (102.0, 50.0, 40.0),   # 1.25 -> None
        (103.0, 0.001, 0.0),   # ниже 5% макс. уровня -> None
    ])]

    annotate_cluster_metrics(candles)
    sides = [l["imbalance"] for l in candles[0]["levels"]]

    assert sides == ["buy", "sell", None, None]
    assert IMBALANCE_RATIO == 3.0


def test_imbalance_handles_zero_on_one_side():
    candles = [_candle(0, [(100.0, 25.0, 0.0), (101.0, 0.0, 0.0)])]

    annotate_cluster_metrics(candles)
    sides = [l["imbalance"] for l in candles[0]["levels"]]

    assert sides[0] == "buy"     # односторонний уровень с объёмом — imbalance
    assert sides[1] is None      # пустой уровень — нет


def test_stacked_imbalance_requires_run_of_3_adjacent_levels():
    # buy на 100, 101, 102 (серия 3), sell только на 104 (одиночный)
    candles = [_candle(0, [
        (105.0, 10.0, 10.0),
        (104.0, 5.0, 30.0),
        (103.0, 10.0, 10.0),
        (102.0, 30.0, 5.0),
        (101.0, 30.0, 5.0),
        (100.0, 30.0, 5.0),
    ])]

    annotate_cluster_metrics(candles)

    assert candles[0]["stacked_imbalance"] == {"buy": 3, "sell": 0}


def test_stacked_imbalance_reports_longest_run():
    candles = [_candle(0, [(float(100 - i), 40.0, 5.0) for i in range(5)])]

    annotate_cluster_metrics(candles)

    assert candles[0]["stacked_imbalance"]["buy"] == 5


def test_absorption_high_volume_small_delta():
    quiet_a = _candle(0, [(100.0, 50.0, 50.0)])                          # vol 100
    quiet_b = _candle(1, [(100.0, 50.0, 50.0)])                          # vol 100
    absorbing = _candle(2, [(100.0, 80.0, 75.0)], vol=160.0, delta=5.0)  # vol 1.6x медианы, delta мал
    candles = [quiet_a, quiet_b, absorbing]

    annotate_cluster_metrics(candles)

    assert candles[0]["absorption"] is False
    assert candles[1]["absorption"] is False
    assert candles[2]["absorption"] is True
    assert 160.0 >= ABSORPTION_VOL_MULT * 100.0
    assert 5.0 <= ABSORPTION_DELTA_SHARE * 160.0


def test_absorption_rejects_high_volume_with_strong_delta():
    absorbing = _candle(1, [(100.0, 80.0, 75.0)], vol=160.0, delta=100.0)

    annotate_cluster_metrics([absorbing])

    assert absorbing["absorption"] is False


def test_empty_and_zero_volume_candles_do_not_crash():
    candles = [{"timestamp": 0, "total_volume": 0.0, "total_delta": 0.0, "levels": []}]

    result = annotate_cluster_metrics(candles)

    assert result[0]["stacked_imbalance"] == {"buy": 0, "sell": 0}
    assert result[0]["absorption"] is False
