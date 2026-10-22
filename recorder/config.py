from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class RecorderConfig:
    node_id: str = "node-local"
    lake_root: Path = Path("data/lake")
    max_storage_gib: int = 50
    spool_flush_seconds: int = 3
    raw_retention_days: int = 7
    tier1_symbols: tuple[str, ...] = ("BTCUSDT", "ETHUSDT", "SOLUSDT")
    tier2_symbols: tuple[str, ...] = ()
    enabled_streams: tuple[str, ...] = ("trades", "book_ticker", "mark_price", "liquidation", "kline_1m")
    binance_ws_url: str = ""
    watchlist_file: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


def load_config(path: Path) -> RecorderConfig:
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return RecorderConfig(
        node_id=str(raw.get("node_id", "node-local")),
        lake_root=Path(raw.get("lake_root", "data/lake")),
        max_storage_gib=int(raw.get("max_storage_gib", 50)),
        spool_flush_seconds=int(raw.get("spool_flush_seconds", 3)),
        raw_retention_days=int(raw.get("raw_retention_days", 7)),
        tier1_symbols=tuple(str(s).upper() for s in raw.get("tier1_symbols", ["BTCUSDT", "ETHUSDT", "SOLUSDT"])),
        tier2_symbols=tuple(str(s).upper() for s in raw.get("tier2_symbols", [])),
        enabled_streams=tuple(str(s) for s in raw.get("enabled_streams", ["trades", "book_ticker", "mark_price", "liquidation", "kline_1m"])),
        binance_ws_url=str(raw.get("binance_ws_url", "")),
        watchlist_file=str(raw.get("watchlist_file", "")),
        extra=raw,
    )
