"""Durable, append-only decision context for later AI post-mortem analysis."""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.app.config import BASE_DIR


class DeepIntentLogger:
    """Store concise runner intentions as JSONL without touching trading state."""

    _write_lock = threading.Lock()

    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = path or BASE_DIR / "backend" / "data" / "deep_intent_log.jsonl"

    def record(
        self,
        *,
        intent: str,
        symbol: str,
        session_id: str,
        reason: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "intent": intent,
            "symbol": symbol.upper(),
            "session_id": session_id,
            "reason": reason,
            "context": context or {},
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._write_lock:
            with self.path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        return event

    def read_recent(self, limit: int = 20) -> List[Dict[str, Any]]:
        if not self.path.exists() or limit <= 0:
            return []
        events: List[Dict[str, Any]] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return events[-limit:]
