def test_catalog_exposes_all_paper_historical_strategies_with_metadata():
    from backend.app.services.strategy_catalog import (
        HISTORICAL_STRATEGY_IDS,
        get_strategy_catalog,
    )

    entries = get_strategy_catalog()

    assert {entry["id"] for entry in entries} == set(HISTORICAL_STRATEGY_IDS)
    assert {entry["id"] for entry in entries} >= {
        "ema_trend", "ema_trend_window", "ema_pullback",
        "confluence_ema", "cvd_absorption", "cluster_volume_bounce",
        "diagnostics_lenient", "naked_test",
    }
    for entry in entries:
        assert entry["version"]
        assert entry["family"]
        assert entry["label"]
        assert entry["description"]
        assert entry["supported_timeframes"]
        assert entry["paper_historical"] is True


def test_catalog_derives_legacy_execution_sets_without_changing_membership():
    from backend.app.services.live_paper_runner import (
        MARKET_ENTRY_STRATEGIES,
        PAPER_HISTORICAL_STRATEGIES,
    )
    from backend.app.services.overnight_pilot import (
        HISTORICAL_STRATEGIES,
        OPTIMIZABLE_STRATEGIES,
    )
    from backend.app.services.pair_selector import STRATEGIES
    from backend.app.services.strategy_catalog import (
        HISTORICAL_STRATEGY_IDS,
        MARKET_ENTRY_STRATEGY_IDS,
        OPTIMIZABLE_STRATEGY_IDS,
        SELECTABLE_STRATEGY_IDS,
    )

    assert HISTORICAL_STRATEGIES == HISTORICAL_STRATEGY_IDS
    assert PAPER_HISTORICAL_STRATEGIES == HISTORICAL_STRATEGY_IDS
    assert MARKET_ENTRY_STRATEGIES == MARKET_ENTRY_STRATEGY_IDS
    assert OPTIMIZABLE_STRATEGIES == OPTIMIZABLE_STRATEGY_IDS
    assert tuple(STRATEGIES) == SELECTABLE_STRATEGY_IDS


def test_strategy_catalog_endpoint_is_read_only_metadata():
    from backend.app.routers.overnight_pilot import get_strategy_catalog

    response = get_strategy_catalog()

    assert response["count"] >= 8
    assert response["strategies"][0]["id"]
    assert "strategy_type" not in response
