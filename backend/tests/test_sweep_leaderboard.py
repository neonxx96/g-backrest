"""Tests for Quant Sweep Leaderboard (SRS M5.1, roadmap phase 6.1):
ranked Top-10 artifact from optimizer runs + persistence store."""

import json

import pytest

from backend.app.engine.sweep_leaderboard import (
    SweepLeaderboardStore,
    build_leaderboard_entries,
)


def _opt_result(entries=12):
    return {
        "strategy_type": "ema_cross",
        "combinations_tested": 9,
        "train_bars": 700,
        "oos_bars": 300,
        "leaderboard": [
            {
                "params": {"fast_period": 8 + i, "slow_period": 26},
                "train_score": round(1.0 - i * 0.05, 3),
                "oos_score": round(0.9 - i * 0.1, 3),
                "sharpe_degradation": 0.8,
                "verdict": "ROBUST",
                "train_metrics": {"sharpe": 1.5},
                "oos_metrics": {"sharpe": 1.2, "max_drawdown_pct": 8.0, "trade_count": 30, "win_rate": 0.55},
            }
            for i in range(entries)
        ],
    }


def test_entries_ranked_by_oos_score_and_trimmed_to_top_10():
    entries = build_leaderboard_entries(_opt_result(), "BTCUSDT", "15m")

    assert len(entries) == 10                       # Top-10 из 12
    assert [e["rank"] for e in entries] == list(range(1, 11))
    scores = [e["oos_score"] for e in entries]
    assert scores == sorted(scores, reverse=True)   # ранг по oos_score
    first = entries[0]
    assert first["oos_sharpe"] == 1.2 and first["oos_trade_count"] == 30
    assert first["verdict"] == "ROBUST"


def test_entries_empty_input_no_synthesis():
    assert build_leaderboard_entries({"leaderboard": []}, "BTCUSDT", "15m") == []
    assert build_leaderboard_entries({}, "BTCUSDT", "15m") == []
    with pytest.raises(ValueError):
        build_leaderboard_entries(_opt_result(), "BTCUSDT", "15m", top_n=0)


def test_store_records_and_returns_latest(tmp_path):
    store = SweepLeaderboardStore(tmp_path / "sweep.json")
    artifact = store.record_run(_opt_result(), "btcusdt", "15m", top_n=10)

    assert artifact["symbol"] == "BTCUSDT"
    assert len(artifact["entries"]) == 10
    assert (tmp_path / "sweep.json").exists()

    latest = store.latest(symbol="BTCUSDT", timeframe="15m", strategy_type="ema_cross")
    assert latest is not None and latest["recorded_at"] == artifact["recorded_at"]
    assert store.latest(symbol="ETHUSDT") is None

    # Персист действительно JSON с runs
    raw = json.loads((tmp_path / "sweep.json").read_text(encoding="utf-8"))
    assert "BTCUSDT|15m|ema_cross" in raw["runs"]


def test_store_latest_returns_most_recent_run(tmp_path):
    store = SweepLeaderboardStore(tmp_path / "sweep.json")
    first = store.record_run(_opt_result(), "BTCUSDT", "15m")
    second = store.record_run(_opt_result(), "BTCUSDT", "15m")
    second["recorded_at"] = first["recorded_at"] + 1  # гарантируем порядок
    store._save({"runs": {"BTCUSDT|15m|ema_cross": second}})

    latest = store.latest(symbol="BTCUSDT")
    assert latest["recorded_at"] == second["recorded_at"]

    runs = store.list_runs()
    assert len(runs) == 1 and "entries" not in runs[0]


def test_store_handles_missing_and_corrupt_file(tmp_path):
    store = SweepLeaderboardStore(tmp_path / "sweep.json")
    assert store.latest() is None

    (tmp_path / "sweep.json").write_text("{not json", encoding="utf-8")
    assert store.latest() is None  # битый файл — честный None, не падение


def test_sweep_router_registered():
    from backend.app.routers.sweep import router

    paths = {r.path for r in router.routes}
    assert paths == {"/api/sweep/run", "/api/sweep/leaderboard", "/api/sweep/runs"}
