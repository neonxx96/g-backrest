from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import pyarrow as pa
import pyarrow.parquet as pq


class SpoolJournal:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = self.path.open("a", encoding="utf-8", newline="\n")

    def append(self, event: dict[str, Any]) -> None:
        self._handle.write(json.dumps(event, separators=(",", ":")) + "\n")

    def flush(self) -> None:
        self._handle.flush()
        os.fsync(self._handle.fileno())

    def close(self) -> None:
        self.flush()
        self._handle.close()

    @staticmethod
    def replay(path: Path) -> Iterable[dict[str, Any]]:
        with Path(path).open("r", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield json.loads(line)


class LakeWriter:
    def __init__(self, root: Path, *, node_id: str, session_id: str, schema_version: int = 1):
        self.root = Path(root)
        self.node_id = node_id
        self.session_id = session_id
        self.schema_version = schema_version
        self.manifest_root = self.root.parent / "manifests"

    def close_segment(self, stream: str, events: list[dict[str, Any]], *, sequence: int | None = None) -> tuple[Path, Path]:
        if not events:
            raise ValueError("cannot close an empty segment")
        first = events[0]
        event_dt = datetime.fromtimestamp(int(first["exch_ts_ms"]) / 1000, tz=timezone.utc)
        seq = int(time.time_ns() if sequence is None else sequence)
        partition = (
            self.root
            / f"schema_version={self.schema_version}"
            / f"exchange={first['exchange']}"
            / f"market={first['market']}"
            / f"symbol={first['symbol']}"
            / f"stream={stream}"
            / f"date={event_dt:%Y-%m-%d}"
            / f"hour={event_dt:%H}"
        )
        partition.mkdir(parents=True, exist_ok=True)
        segment = partition / f"part-{self.node_id}-{self.session_id}-{seq}.parquet"
        if segment.exists():
            raise FileExistsError(segment)
        temporary = segment.with_suffix(".parquet.tmp")
        pq.write_table(pa.Table.from_pylist(events), temporary, compression="zstd")
        os.replace(temporary, segment)

        digest = hashlib.sha256(segment.read_bytes()).hexdigest()
        manifest = self.manifest_root / f"{segment.stem}.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(
            json.dumps(
                {
                    "path": str(segment.relative_to(self.root.parent)),
                    "sha256": digest,
                    "row_count": len(events),
                    "min_exch_ts_ms": min(int(e["exch_ts_ms"]) for e in events),
                    "max_exch_ts_ms": max(int(e["exch_ts_ms"]) for e in events),
                    "node_id": self.node_id,
                    "session_id": self.session_id,
                    "schema_version": self.schema_version,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        return segment, manifest
