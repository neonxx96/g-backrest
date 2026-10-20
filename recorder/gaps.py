from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class GapJournal:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, **fields: Any) -> None:
        row = {
            "exchange": fields["exchange"],
            "market": fields["market"],
            "symbol": fields["symbol"],
            "stream": fields["stream"],
            "gap_start_ts": fields["gap_start_ts"],
            "gap_end_ts": fields["gap_end_ts"],
            "reason": fields["reason"],
            "node_id": fields["node_id"],
            "resolved_by": fields.get("resolved_by", "none"),
        }
        with self.path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(row, separators=(",", ":")) + "\n")
            handle.flush()
