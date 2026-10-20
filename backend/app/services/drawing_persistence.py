"""Small, deterministic helpers for resilient chart-drawing persistence."""

from datetime import datetime, timezone
from typing import Any, Iterable, Optional


def choose_latest_drawing(rows: Iterable[Any]) -> Optional[Any]:
    """Return the newest drawing row, tolerating legacy duplicate records."""
    candidates = list(rows)
    if not candidates:
        return None

    def sort_key(row: Any) -> datetime:
        value = getattr(row, "updated_at", None)
        if value is None:
            return datetime.min.replace(tzinfo=timezone.utc)
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    return max(candidates, key=sort_key)
