import pytest

from backend.app.engine.confluence import (
    DEFAULT_REQUIRED,
    DEFAULT_THRESHOLD,
    DEFAULT_WEIGHTS,
    ConfluenceConfigError,
    ConfluenceConfigStore,
    WeightedConfluenceScorer,
    validate_weights,
)
from backend.app.engine.trade_contract import UnifiedTradeSignal


def test_default_weights_sum_to_one_and_threshold_is_srs_065():
    assert abs(sum(DEFAULT_WEIGHTS.values()) - 1.0) < 1e-9
    assert DEFAULT_THRESHOLD == 0.65
    assert DEFAULT_REQUIRED == ("wall",)


def test_validate_weights_rejects_unknown_negative_and_unnormalized():
    with pytest.raises(ConfluenceConfigError):
        validate_weights({"wall": 0.5, "momentum": 0.5})
    with pytest.raises(ConfluenceConfigError):
        validate_weights({"wall": 1.2, "ema20_cross": -0.2})
    with pytest.raises(ConfluenceConfigError):
        validate_weights({"wall": 0.5, "ema20_cross": 0.4})


def test_scorer_weighted_score_qualifies_at_threshold():
    scorer = WeightedConfluenceScorer()

    verdict = scorer.score({"wall": True, "ema20_cross": True, "volume_multiplier": True, "cvd_filter": True})

    assert verdict.score == pytest.approx(0.25 + 0.20 + 0.15 + 0.15)
    assert verdict.qualified is True
    assert verdict.failed_required == []


def test_scorer_required_factor_vetoes_even_high_score():
    scorer = WeightedConfluenceScorer()
    factors = {name: True for name in DEFAULT_WEIGHTS if name != "wall"}

    verdict = scorer.score(factors)

    assert verdict.score == pytest.approx(0.75)
    assert verdict.qualified is False
    assert verdict.failed_required == ["wall"]


def test_scorer_below_threshold_does_not_qualify():
    scorer = WeightedConfluenceScorer()

    verdict = scorer.score({"wall": True, "ema20_cross": True, "delta_sign": True})

    assert verdict.score == pytest.approx(0.55)
    assert verdict.qualified is False
    assert verdict.failed_required == []


def test_scorer_missing_soft_factors_count_as_failed():
    scorer = WeightedConfluenceScorer()

    verdict = scorer.score({"wall": True})

    assert verdict.score == pytest.approx(0.25)
    assert verdict.qualified is False


def test_scorer_rejects_bad_threshold_and_orphan_required():
    with pytest.raises(ConfluenceConfigError):
        WeightedConfluenceScorer(threshold=0.0)
    with pytest.raises(ConfluenceConfigError):
        WeightedConfluenceScorer({"wall": 1.0}, required=("rsi_filter",))


def test_config_store_roundtrip_and_defaults(tmp_path):
    store = ConfluenceConfigStore(tmp_path / "confluence_weights.json")

    default_profile = store.get("BTCUSDT")
    assert default_profile["custom"] is False
    assert default_profile["threshold"] == 0.65

    custom_weights = {"wall": 0.4, "ema20_cross": 0.3, "volume_multiplier": 0.2, "cvd_filter": 0.1}
    store.update("ETHUSDT", weights=custom_weights, threshold=0.7)

    reloaded = ConfluenceConfigStore(tmp_path / "confluence_weights.json")
    profile = reloaded.get("ETHUSDT")

    assert profile["custom"] is True
    assert profile["weights"] == custom_weights
    assert profile["threshold"] == 0.7
    scorer = reloaded.scorer_for("ETHUSDT")
    assert scorer.score({"wall": True, "ema20_cross": True}).score == pytest.approx(0.7)


def test_config_store_skips_corrupt_entries(tmp_path):
    path = tmp_path / "confluence_weights.json"
    path.write_text(
        '{"profiles": [{"symbol": "BTCUSDT", "weights": {"wall": 0.9}}, {"symbol": "ETHUSDT", "weights": {"wall": 1.0}}]}',
        encoding="utf-8",
    )

    store = ConfluenceConfigStore(path)

    assert store.get("BTCUSDT")["custom"] is False
    assert store.get("ETHUSDT")["custom"] is True


def test_unified_trade_signal_carries_confluence_score():
    signal = UnifiedTradeSignal(
        symbol="BTCUSDT",
        timestamp=1,
        direction="LONG",
        entry_price=100.0,
        sl=99.0,
        tp1=102.0,
        confluence_score=0.75,
    )

    assert signal.confluence_score == 0.75
    assert signal.to_dict()["confluence_score"] == 0.75

    legacy = UnifiedTradeSignal(symbol="BTCUSDT", timestamp=1, direction="LONG", entry_price=100.0, sl=99.0, tp1=102.0)
    assert legacy.confluence_score is None


def test_confluence_router_contract():
    from backend.app.routers.confluence import router

    paths = {(r.path, tuple(sorted(r.methods))) for r in router.routes}
    assert ("/api/confluence/weights", ("GET",)) in paths
    assert ("/api/confluence/weights", ("PUT",)) in paths
    assert ("/api/confluence/score", ("POST",)) in paths
    assert ("/api/confluence/factors", ("GET",)) in paths
