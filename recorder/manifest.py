"""Machine-readable Data Manifest over the recorder lake (SRS M1.1).

Aggregates per-segment SHA-256 manifests and the gap journal into a single
JSON document: for every (exchange, market, symbol, stream) it reports the
covered exchange-time range, row counts, segment list and recorded gaps, so
downstream consumers (backtester, replay, UI) can answer "what data do we
actually have" without scanning Parquet files.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _parse_partition(segment_rel_path: str) -> dict[str, str]:
    parts = Path(segment_rel_path).parts
    parsed: dict[str, str] = {}
    for part in parts:
        if "=" in part:
            key, _, value = part.partition("=")
            parsed[key] = value
    return parsed


def build_data_manifest(lake_root: Path, *, generated_at_ms: int | None = None) -> dict[str, Any]:
    """Builds the aggregate manifest for a lake root directory."""
    lake_root = Path(lake_root)
    data_root = lake_root.parent
    manifests_dir = data_root / "manifests"
    gaps_dir = data_root / "gaps"

    datasets: dict[tuple, dict[str, Any]] = {}
    for manifest_path in sorted(manifests_dir.glob("*.json")):
        try:
            segment = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        partition = _parse_partition(str(segment.get("path", "")))
        key = (
            partition.get("exchange", "unknown"),
            partition.get("market", "unknown"),
            partition.get("symbol", "unknown"),
            partition.get("stream", "unknown"),
        )
        entry = datasets.setdefault(
            key,
            {
                "exchange": key[0],
                "market": key[1],
                "symbol": key[2],
                "stream": key[3],
                "row_count": 0,
                "segment_count": 0,
                "min_exch_ts_ms": None,
                "max_exch_ts_ms": None,
                "dates": set(),
                "segments": [],
            },
        )
        entry["row_count"] += int(segment.get("row_count", 0))
        entry["segment_count"] += 1
        seg_min = int(segment.get("min_exch_ts_ms", 0))
        seg_max = int(segment.get("max_exch_ts_ms", 0))
        entry["min_exch_ts_ms"] = seg_min if entry["min_exch_ts_ms"] is None else min(entry["min_exch_ts_ms"], seg_min)
        entry["max_exch_ts_ms"] = seg_max if entry["max_exch_ts_ms"] is None else max(entry["max_exch_ts_ms"], seg_max)
        if partition.get("date"):
            entry["dates"].add(partition["date"])
        entry["segments"].append(
            {
                "path": segment.get("path"),
                "sha256": segment.get("sha256"),
                "row_count": int(segment.get("row_count", 0)),
                "min_exch_ts_ms": seg_min,
                "max_exch_ts_ms": seg_max,
            }
        )

    gaps: list[dict[str, Any]] = []
    for gap_path in sorted(gaps_dir.glob("*.jsonl")):
        try:
            with gap_path.open("r", encoding="utf-8") as handle:
                for line in handle:
                    if line.strip():
                        gaps.append(json.loads(line))
        except (OSError, ValueError):
            continue

    dataset_list = []
    for entry in sorted(datasets.values(), key=lambda e: (e["symbol"], e["stream"])):
        symbol_gaps = [g for g in gaps if g.get("symbol") in (entry["symbol"], "*")]
        dataset_list.append(
            {
                **{k: v for k, v in entry.items() if k not in ("dates", "segments")},
                "dates": sorted(entry["dates"]),
                "gap_count": len(symbol_gaps),
                "gaps": symbol_gaps,
                "segments": entry["segments"],
            }
        )

    return {
        "manifest_version": 1,
        "lake_root": str(lake_root),
        "generated_at_ms": generated_at_ms if generated_at_ms is not None else int(datetime.now(tz=timezone.utc).timestamp() * 1000),
        "dataset_count": len(dataset_list),
        "datasets": dataset_list,
    }


def write_data_manifest(lake_root: Path, output_path: Path | None = None) -> Path:
    """Builds the manifest and writes it next to the lake as data_manifest.json."""
    lake_root = Path(lake_root)
    manifest = build_data_manifest(lake_root)
    output = Path(output_path) if output_path else lake_root.parent / "data_manifest.json"
    tmp = output.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    tmp.replace(output)
    return output
