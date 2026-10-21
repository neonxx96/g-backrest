"""Durable, append-only decision context for later AI post-mortem analysis."""

import json
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

from backend.app.config import BASE_DIR


class DeepIntentLogWriteError(OSError):
    """Raised when a telemetry event cannot be durably appended."""


class DeepIntentLogger:
    """Store machine-readable events as append-only JSON Lines."""

    _write_lock = threading.Lock()

    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = path or BASE_DIR / "backend" / "data" / "deep_intent_log.jsonl"

    def record_event(
        self,
        *,
        event_type: str,
        source: str,
        symbol: str,
        reason_code: str,
        reason: str,
        run_id: Optional[str],
        session_id: Optional[str],
        config_fingerprint: Optional[str],
        strategy: Optional[str],
        timeframe: Optional[str],
        checks: Optional[list],
        observed: Optional[dict],
        trade_id: Optional[str],
        payload: Optional[dict],
    ) -> Dict[str, Any]:
        """Append one versioned event and return its serialized representation."""
        event = {
            "schema_version": 1,
            "event_id": uuid.uuid4().hex,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "run_id": run_id,
            "session_id": session_id,
            "config_fingerprint": config_fingerprint,
            "symbol": symbol.upper(),
            "strategy": strategy,
            "timeframe": timeframe,
            "event_type": event_type,
            "reason_code": reason_code,
            "reason": reason,
            "checks": checks or [],
            "observed": observed or {},
            "trade_id": trade_id,
            "payload": payload or {},
        }
        self._append(event)
        return event

    def record(
        self,
        *,
        intent: str,
        symbol: str,
        session_id: str,
        reason: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Compatibility adapter for old callers that do not know a run ID."""
        event_type = {
            "SKIPPED": "DECISION_SKIPPED",
            "ENTERED": "POSITION_OPENED",
            "MANAGED": "POSITION_UPDATED",
            "CLOSED": "POSITION_CLOSED",
        }.get(intent.upper(), "LEGACY_EVENT")
        event = {
            "schema_version": 1,
            "event_id": uuid.uuid4().hex,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "legacy",
            "run_id": None,
            "session_id": session_id,
            "config_fingerprint": None,
            "symbol": symbol.upper(),
            "strategy": None,
            "timeframe": None,
            "event_type": event_type,
            "reason_code": intent.upper() or "LEGACY_EVENT",
            "reason": reason,
            "checks": [],
            "observed": {},
            "trade_id": None,
            "payload": {},
            # Preserve the original consumer-facing fields during migration.
            "intent": intent,
            "context": context or {},
        }
        self._append(event)
        return event

    def _append(self, event: Dict[str, Any]) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self._write_lock:
                with self.path.open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        except OSError as exc:
            raise DeepIntentLogWriteError(f"Unable to append telemetry event to {self.path}: {exc}") from exc

    def read_recent(
        self,
        limit: int = 20,
        *,
        run_id: Optional[str] = None,
        symbol: Optional[str] = None,
        source: Optional[str] = None,
        event_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Read the newest matching rows while keeping memory bounded by limit."""
        if not self.path.exists() or limit <= 0:
            return []

        events: Deque[Dict[str, Any]] = deque(maxlen=limit)
        normalized_symbol = symbol.upper() if symbol else None
        with self.path.open("r", encoding="utf-8") as stream:
            for line in stream:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(event, dict):
                    continue
                if "schema_version" not in event:
                    event = {
                        **event,
                        "schema_version": "legacy",
                        "event_id": None,
                        "source": "legacy",
                        "run_id": None,
                        "config_fingerprint": None,
                        "event_type": "LEGACY_EVENT",
                        "reason_code": "LEGACY_EVENT",
                        "reason": event.get("reason", ""),
                    }
                if run_id is not None and event.get("run_id") != run_id:
                    continue
                if normalized_symbol is not None and str(event.get("symbol", "")).upper() != normalized_symbol:
                    continue
                if source is not None and event.get("source") != source:
                    continue
                if event_type is not None and event.get("event_type") != event_type:
                    continue
                events.append(event)
        return list(events)
