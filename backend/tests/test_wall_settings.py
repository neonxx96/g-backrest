import pytest

from backend.app.services.wall_settings import (
    AutoDensityCalibrator,
    WallSettings,
    WallSettingsStore,
    WallTracker,
    _percentile,
)


def test_wall_settings_defaults_match_srs_manual_mode():
    settings = WallSettings(symbol="btcusdt")

    assert settings.symbol == "BTCUSDT"
    assert settings.mode == "manual"
    assert settings.min_density_usd == 500_000.0
    assert settings.wall_ttl_seconds == 15.0


def test_wall_settings_rejects_invalid_mode_and_percentile():
    with pytest.raises(ValueError):
        WallSettings(symbol="BTCUSDT", mode="turbo")
    with pytest.raises(ValueError):
        WallSettings(symbol="BTCUSDT", auto_percentile=120.0)
    with pytest.raises(ValueError):
        WallSettings(symbol="BTCUSDT", auto_k_median=0)


def test_percentile_nearest_rank():
    sample = sorted(float(i) for i in range(1, 101))

    assert _percentile(sample, 99.0) == 99.0
    assert _percentile(sample, 50.0) == 50.0
    assert _percentile([10.0], 99.0) == 10.0


def test_auto_calibrator_percentile_and_k_median():
    calibrator = AutoDensityCalibrator()
    observations = [100_000.0] * 60 + [1_000_000.0] * 40

    percentile_settings = WallSettings(symbol="BTCUSDT", mode="auto", auto_method="percentile", auto_percentile=99.0)
    k_median_settings = WallSettings(symbol="BTCUSDT", mode="auto", auto_method="k_median", auto_k_median=3.0)

    assert calibrator.compute(percentile_settings, observations) == 1_000_000.0
    assert calibrator.compute(k_median_settings, [100_000.0] * 50) == 300_000.0


def test_auto_calibrator_falls_back_to_manual_on_small_sample():
    calibrator = AutoDensityCalibrator()
    settings = WallSettings(symbol="BTCUSDT", mode="auto", min_density_usd=500_000.0)

    assert calibrator.compute(settings, [1_000.0] * 5) is None
    assert calibrator.effective_threshold(settings, [1_000.0] * 5) == 500_000.0


def test_wall_tracker_ttl_qualification():
    tracker = WallTracker()
    tracker.update(price=100.0, side="bid", usd=600_000.0, ts=1000.0)
    tracker.update(price=101.0, side="ask", usd=600_000.0, ts=1010.0)
    tracker.update(price=102.0, side="bid", usd=100_000.0, ts=1000.0)

    qualified_early = tracker.qualified_walls(threshold_usd=500_000.0, ttl_seconds=15.0, now=1012.0)
    assert [w.price for w in qualified_early] == []

    qualified_late = tracker.qualified_walls(threshold_usd=500_000.0, ttl_seconds=15.0, now=1016.0)
    assert sorted(w.price for w in qualified_late) == [100.0]
    # Below-threshold wall never qualifies even after TTL
    assert all(w.price != 102.0 for w in qualified_late)


def test_wall_tracker_clears_level_on_zero_size():
    tracker = WallTracker()
    tracker.update(price=100.0, side="bid", usd=600_000.0, ts=1000.0)
    tracker.update(price=100.0, side="bid", usd=0.0, ts=1001.0)

    assert tracker.qualified_walls(threshold_usd=1.0, ttl_seconds=0.0, now=1010.0) == []


def test_settings_store_roundtrip(tmp_path):
    store = WallSettingsStore(tmp_path / "wall_settings.json")
    store.update(WallSettings(symbol="ETHUSDT", mode="auto", wall_ttl_seconds=30.0, auto_k_median=2.5))

    reloaded = WallSettingsStore(tmp_path / "wall_settings.json")
    settings = reloaded.get("ETHUSDT")

    assert settings.mode == "auto"
    assert settings.wall_ttl_seconds == 30.0
    assert settings.auto_k_median == 2.5
    # Unknown symbol gets SRS defaults
    assert reloaded.get("SOLUSDT").min_density_usd == 500_000.0


def test_settings_store_survives_corrupt_file(tmp_path):
    path = tmp_path / "wall_settings.json"
    path.write_text("{broken", encoding="utf-8")

    store = WallSettingsStore(path)

    assert store.get("BTCUSDT").mode == "manual"
