"""Regression coverage for local paper-run backup and preflight evidence."""

import importlib.util
import sqlite3
from pathlib import Path


def _load_preflight_module():
    path = Path(__file__).resolve().parents[2] / "scripts" / "paper_run_preflight.py"
    spec = importlib.util.spec_from_file_location("paper_run_preflight", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_preflight_creates_verified_sqlite_backup_and_report(tmp_path):
    module = _load_preflight_module()
    source = tmp_path / "signals.db"
    with sqlite3.connect(source) as connection:
        connection.execute("create table paper_trade_records (id integer primary key, symbol text)")
        connection.execute("insert into paper_trade_records (symbol) values ('BTCUSDT')")

    report = module.run_preflight(source, tmp_path / "backups")

    backup = Path(report["backup"]["path"])
    assert backup.exists()
    assert report["database"]["integrity_check"] == "ok"
    assert report["database"]["paper_trade_records"] == 1
    assert report["backup"]["integrity_check"] == "ok"
    with sqlite3.connect(backup) as connection:
        assert connection.execute("select symbol from paper_trade_records").fetchone()[0] == "BTCUSDT"


def test_symbol_validation_marks_only_trading_usdt_m_contracts_as_eligible(monkeypatch):
    module = _load_preflight_module()

    monkeypatch.setattr(module, "_fetch_exchange_info", lambda: {"symbols": [
        {"symbol": "BTCUSDT", "status": "TRADING", "contractType": "PERPETUAL", "quoteAsset": "USDT"},
        {"symbol": "ETHUSDT", "status": "BREAK", "contractType": "PERPETUAL", "quoteAsset": "USDT"},
        {"symbol": "SOLUSDT", "status": "TRADING", "contractType": "CURRENT_QUARTER", "quoteAsset": "USDT"},
    ]})

    result = module.validate_symbols(["BTCUSDT", "ETHUSDT", "SOLUSDT", "MISSINGUSDT"])

    assert result["eligible"] == ["BTCUSDT"]
    assert result["excluded"] == {
        "ETHUSDT": "STATUS_BREAK",
        "SOLUSDT": "CONTRACT_CURRENT_QUARTER",
        "MISSINGUSDT": "SYMBOL_NOT_FOUND",
    }
