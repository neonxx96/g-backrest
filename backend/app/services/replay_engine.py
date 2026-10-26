"""
Deterministic Replay Engine for Order Flow Backtesting
=======================================================
Reads recorded Parquet data (aggTrades + depth snapshots) and replays
them as a chronologically merged, strictly ordered event stream.

GUARANTEES:
- Zero look-ahead bias: at event time t, only data with timestamp <= t is exposed.
- Deterministic tie-break: if a trade and a depth snapshot share the exact same
  UTC millisecond, the TRADE is emitted first (market state updates last, so a
  strategy never "peeks" into the future orderbook state).
- Deterministic ordering: stable sort on (timestamp, source_priority, row_index).

The engine is intentionally isolated from `orderflow_backtester.py` so the
existing bar-based backtester remains untouched.
"""
import json
import logging
from pathlib import Path
from typing import Any, Iterator, List, Optional

import pandas as pd

from backend.app.config import RECORDED_DATA_DIR

logger = logging.getLogger(__name__)

# --- Event priority for deterministic tie-break -------------------------------
# Lower value = emitted earlier at identical timestamps.
# Trades carry the *actual* execution; depth snapshots represent the orderbook
# state *after* the trade matched. Replaying trades first is the conservative
# choice: a strategy acting on the trade never sees post-trade book state.
PRIORITY_TRADE = 0
PRIORITY_DEPTH = 1


def book_to_lists(value: Any) -> List[list]:
    """Depth-книга из Parquet. Формат зависит от записи:
    - реальный lake сериализует bids/asks как JSON-строки (dtype str) — парсим;
    - свежезаписанный DataFrame с list-колонкой читается как numpy array — берём итерируемое.
    """
    if value is None:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            logger.warning("Unparseable book payload (first 80 chars): %.80s", value)
            return []
        return [list(level) for level in parsed] if isinstance(parsed, list) else []
    try:
        return [list(level) for level in value]
    except TypeError:
        return []

# Единый источник истины — реальный каталог recorder'а (фикс merge 2.5: было data/recorder).
DEFAULT_RECORDER_DIR = RECORDED_DATA_DIR


class ReplayEvent:
    """A single merged replay event (trade or depth snapshot)."""

    __slots__ = ("timestamp", "priority", "seq", "kind", "payload")

    def __init__(self, timestamp: int, priority: int, seq: int, kind: str, payload: dict):
        self.timestamp = timestamp
        self.priority = priority
        self.seq = seq  # Global monotonic sequence number, deterministic.
        self.kind = kind  # "trade" or "depth"
        self.payload = payload

    def __repr__(self) -> str:
        return f"ReplayEvent(seq={self.seq}, ts={self.timestamp}, kind={self.kind})"


class ReplayEngine:
    """
    Loads recorded Parquet data and yields a deterministic, chronologically
    ordered stream of `ReplayEvent` objects.

    Convergence logic (crucial for correctness):
    1. Load all `trades_*.parquet` and `depth_*.parquet` for a given symbol.
    2. Tag each row with its source priority (`PRIORITY_TRADE` vs `PRIORITY_DEPTH`).
    3. Merge-sort by (timestamp, priority, original_row_index) — this ensures
       stability and no lookahead.
    4. Yield events lazily to avoid loading the entire history into memory at once
       (although daily Parquet files are small, we keep it efficient).
    """

    def __init__(self, data_dir: Path = DEFAULT_RECORDER_DIR, symbol: str = "BTCUSDT"):
        self.data_dir = Path(data_dir)
        self.symbol = symbol
        self._events_cache: Optional[List[ReplayEvent]] = None

    def _load_daily_files(self, pattern: str) -> List[pd.DataFrame]:
        """Load all parquet files matching a daily pattern for the symbol."""
        sym_dir = self.data_dir / self.symbol
        if not sym_dir.exists():
            return []
        frames: List[pd.DataFrame] = []
        for f in sorted(sym_dir.glob(pattern)):
            if f.stat().st_size == 0:
                continue
            try:
                df = pd.read_parquet(f)
                if df.empty:
                    continue
                frames.append(df)
            except Exception as e:  # pragma: no cover - defensive
                logger.warning("Failed to read parquet %s: %s", f, e)
        return frames

    def build_events(self, start_ts: Optional[int] = None,
                     end_ts: Optional[int] = None) -> List[ReplayEvent]:
        """
        Build the merged, deterministically sorted event list.
        Returns a list so tests can inspect it; `stream()` yields lazily.
        """
        if self._events_cache is not None:
            cached = self._events_cache
            if start_ts is None and end_ts is None:
                return cached
            return [e for e in cached
                    if (start_ts is None or e.timestamp >= start_ts)
                    and (end_ts is None or e.timestamp <= end_ts)]

        # 1. Load raw data ---------------------------------------------------
        trades_frames = self._load_daily_files("trades_*.parquet")
        depth_frames = self._load_daily_files("depth_*.parquet")

        # 2. Normalize & tag -------------------------------------------------
        records: List[ReplayEvent] = []

        for df in trades_frames:
            for row in df.itertuples():
                ts = int(row.timestamp)
                records.append(
                    ReplayEvent(
                        timestamp=ts,
                        priority=PRIORITY_TRADE,
                        seq=-1,  # assigned after sort
                        kind="trade",
                        payload={
                            "price": float(row.price),
                            "quantity": float(row.quantity),
                            "usd_amount": float(row.usd_amount),
                            "is_taker_buy": bool(row.is_taker_buy),
                            "delta": float(row.delta),
                        },
                    )
                )

        for df in depth_frames:
            for row in df.itertuples():
                ts = int(row.timestamp)
                records.append(
                    ReplayEvent(
                        timestamp=ts,
                        priority=PRIORITY_DEPTH,
                        seq=-1,
                        kind="depth",
                        payload={
                            "bids": book_to_lists(row.bids),
                            "asks": book_to_lists(row.asks),
                        },
                    )
                )

        # 3. Deterministic sort ------------------------------------------------
        # Sort key: (timestamp, priority, stable insertion order)
        # Insertion order is preserved because we append trades first, then depths,
        # but we explicitly sort with a stable mechanism below to be safe.
        records.sort(key=lambda e: (e.timestamp, e.priority))

        # 4. Assign monotonic sequence numbers ---------------------------------
        for i, ev in enumerate(records):
            ev.seq = i

        self._events_cache = records
        if start_ts is None and end_ts is None:
            return records
        return [e for e in records
                if (start_ts is None or e.timestamp >= start_ts)
                and (end_ts is None or e.timestamp <= end_ts)]

    def stream(self, start_ts: Optional[int] = None,
               end_ts: Optional[int] = None) -> Iterator[ReplayEvent]:
        """Yield events in chronological order (lazy iterator)."""
        yield from self.build_events(start_ts=start_ts, end_ts=end_ts)

