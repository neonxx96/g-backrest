import json
from pathlib import Path

import backend.app.config as app_config
from backend.app.engine.background_worker import BackgroundWorker, DEFAULT_FOCUS_LIST


def test_worker_persists_active_watchlist_on_init_and_update(tmp_path: Path, monkeypatch):
    """M1.3a: backend publishes the active watchlist for the standalone recorder."""
    monkeypatch.setattr(app_config, "DATA_DIR", tmp_path)

    worker = BackgroundWorker()
    path = tmp_path / "active_watchlist.json"
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["symbols"] == sorted(set(DEFAULT_FOCUS_LIST))
    assert isinstance(payload["updated_at"], int)

    worker.set_monitored_tickers(["BTCUSDT", "SOLUSDT"])
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert payload["symbols"] == ["BTCUSDT", "SOLUSDT"]
    assert not (tmp_path / "active_watchlist.json.tmp").exists()


def test_worker_watchlist_persistence_failure_does_not_break_monitoring(tmp_path: Path, monkeypatch):
    """A read-only data dir must not crash set_monitored_tickers."""
    blocked = tmp_path / "blocked"
    blocked.write_text("not a directory", encoding="utf-8")
    monkeypatch.setattr(app_config, "DATA_DIR", blocked / "subdir")

    worker = BackgroundWorker()
    worker.set_monitored_tickers(["ETHUSDT"])

    assert worker.monitored_tickers == {"ETHUSDT"}
