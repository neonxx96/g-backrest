"""Create auditable local evidence before a paper-only overnight run."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BINANCE_EXCHANGE_INFO_URL = "https://fapi.binance.com/fapi/v1/exchangeInfo"


def _fetch_exchange_info() -> dict[str, Any]:
    request = urllib.request.Request(BINANCE_EXCHANGE_INFO_URL, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def validate_symbols(symbols: list[str]) -> dict[str, Any]:
    """Return eligible USDT-M perpetuals and explicit exclusions from Binance metadata."""
    exchange_info = _fetch_exchange_info()
    metadata = {str(item.get("symbol", "")).upper(): item for item in exchange_info.get("symbols", [])}
    eligible: list[str] = []
    excluded: dict[str, str] = {}
    for symbol in [item.upper() for item in symbols]:
        item = metadata.get(symbol)
        if item is None:
            excluded[symbol] = "SYMBOL_NOT_FOUND"
        elif item.get("status") != "TRADING":
            excluded[symbol] = f"STATUS_{item.get('status', 'UNKNOWN')}"
        elif item.get("contractType") != "PERPETUAL":
            excluded[symbol] = f"CONTRACT_{item.get('contractType', 'UNKNOWN')}"
        elif item.get("quoteAsset") != "USDT":
            excluded[symbol] = f"QUOTE_{item.get('quoteAsset', 'UNKNOWN')}"
        else:
            eligible.append(symbol)
    return {"eligible": eligible, "excluded": excluded}


def _integrity_check(path: Path) -> str:
    with sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True) as connection:
        return str(connection.execute("PRAGMA integrity_check").fetchone()[0])


def _paper_record_count(path: Path) -> int:
    with sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True) as connection:
        row = connection.execute("SELECT COUNT(*) FROM paper_trade_records").fetchone()
        return int(row[0])


def _create_backup(source: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = backup_dir / f"{source.stem}-{timestamp}.db"
    with sqlite3.connect(f"file:{source.resolve()}?mode=ro", uri=True) as source_connection:
        with sqlite3.connect(destination) as backup_connection:
            source_connection.backup(backup_connection)
    return destination


def run_preflight(source: Path, backup_dir: Path) -> dict[str, Any]:
    """Back up one SQLite database and return factual local preflight evidence."""
    source = Path(source)
    if not source.is_file():
        raise FileNotFoundError(f"SQLite database not found: {source}")

    source_integrity = _integrity_check(source)
    if source_integrity.lower() != "ok":
        raise RuntimeError(f"Source SQLite integrity check failed: {source_integrity}")

    backup = _create_backup(source, Path(backup_dir))
    backup_integrity = _integrity_check(backup)
    if backup_integrity.lower() != "ok":
        raise RuntimeError(f"Backup SQLite integrity check failed: {backup_integrity}")

    disk = shutil.disk_usage(source.parent)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "database": {
            "path": str(source.resolve()),
            "bytes": source.stat().st_size,
            "integrity_check": source_integrity,
            "paper_trade_records": _paper_record_count(source),
        },
        "backup": {"path": str(backup.resolve()), "bytes": backup.stat().st_size, "integrity_check": backup_integrity},
        "disk": {"free_bytes": disk.free, "total_bytes": disk.total},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path("data/signals.db"))
    parser.add_argument("--backup-dir", type=Path, default=Path("data/backups"))
    parser.add_argument("--report", type=Path, default=Path("data/paper_run_preflight.json"))
    parser.add_argument("--validate-symbols", action="store_true", help="Check the eight target symbols against Binance Futures public metadata")
    args = parser.parse_args()
    report = run_preflight(args.db, args.backup_dir)
    if args.validate_symbols:
        report["symbols"] = validate_symbols([
            "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
            "XRPUSDT", "DOGEUSDT", "SUIUSDT", "NEARUSDT",
        ])
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
