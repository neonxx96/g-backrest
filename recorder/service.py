from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Any

import websockets

from .events import normalize_message
from .gaps import GapJournal
from .storage import LakeWriter, SpoolJournal

LOGGER = logging.getLogger(__name__)


class DiskPolicy:
    def __init__(self, *, max_storage_gib: int = 50):
        self.max_bytes = int(max_storage_gib * 1024**3)

    def allows(self, tier: str, *, used_bytes: int) -> bool:
        ratio = used_bytes / self.max_bytes if self.max_bytes else 1.0
        if tier == "tier1":
            return ratio < 1.0
        return ratio < (0.90 if tier == "tier3" else 0.95)


class RecorderService:
    def __init__(self, *, lake_root: Path, spool_root: Path, node_id: str, session_id: str | None = None, max_storage_gib: int = 50):
        self.node_id = node_id
        self.session_id = session_id or uuid.uuid4().hex
        self.spool = SpoolJournal(Path(spool_root) / f"{node_id}-{self.session_id}.jsonl")
        self.writer = LakeWriter(Path(lake_root), node_id=node_id, session_id=self.session_id)
        self.gaps = GapJournal(Path(lake_root).parent / "gaps" / f"{node_id}.jsonl")
        self.buffers: dict[str, list[dict[str, Any]]] = {}
        self.counters: dict[str, int] = {}
        self.started_ns = time.time_ns()
        self.disk_policy = DiskPolicy(max_storage_gib=max_storage_gib)
        self.data_root = Path(lake_root).parent
        self.alerts: set[str] = set()
        self.disk_full = False
        self._data_size_cache_bytes = 0
        self._data_size_cache_mono = 0.0
        self._data_size_check_interval_s = 30.0

    def process_message(self, frame: dict[str, Any]) -> dict[str, Any]:
        stream_name = str(frame.get("stream", ""))
        payload = frame.get("data", frame)
        stream = self._stream_name(stream_name, payload)
        if stream == "kline_1m" and not bool(payload.get("k", {}).get("x", False)):
            return {"ignored": True, "reason": "kline_not_closed"}
        if not self.disk_policy.allows("tier1", used_bytes=self._data_size_bytes()):
            self.disk_full = True
            self.alerts.add("disk_full")
            self.gaps.record(
                exchange="binance",
                market="usd-m",
                symbol=str(payload.get("s", "*")),
                stream=stream,
                gap_start_ts=int(payload.get("E", 0)),
                gap_end_ts=int(payload.get("E", 0)),
                reason="disk_full",
                node_id=self.node_id,
            )
            return {"ignored": True, "reason": "disk_full"}
        if stream == "liquidation" and "s" not in payload:
            payload = {**payload, "s": payload.get("o", {}).get("s", "")}
        event = normalize_message(payload, stream=stream, node_id=self.node_id, session_id=self.session_id)
        self.spool.append(event)
        self.buffers.setdefault(stream, []).append(event)
        self.counters[stream] = self.counters.get(stream, 0) + 1
        return event

    def flush(self) -> None:
        self.spool.flush()
        for stream, events in list(self.buffers.items()):
            if events:
                self.writer.close_segment(stream, events)
                self.buffers[stream] = []

    def status(self) -> dict[str, Any]:
        return {"node_id": self.node_id, "session_id": self.session_id, "uptime_s": round((time.time_ns() - self.started_ns) / 1e9, 3), "counters": dict(self.counters), "spool": str(self.spool.path), "disk_full": self.disk_full, "alerts": sorted(self.alerts)}

    def close(self) -> None:
        self.flush()
        self.spool.close()

    def _data_size_bytes(self) -> int:
        now = time.monotonic()
        if now - self._data_size_cache_mono < self._data_size_check_interval_s:
            return self._data_size_cache_bytes
        self._data_size_cache_bytes = self._scan_data_size_bytes()
        self._data_size_cache_mono = now
        return self._data_size_cache_bytes

    def _scan_data_size_bytes(self) -> int:
        if not self.data_root.exists():
            return 0
        return sum(item.stat().st_size for item in self.data_root.rglob("*") if item.is_file())

    @staticmethod
    def _stream_name(name: str, payload: dict[str, Any]) -> str:
        lower = name.lower()
        event_type = str(payload.get("e", "")).lower()
        if "aggtrade" in lower or "@trade" in lower or event_type in {"aggtrade", "trade"}:
            return "trades"
        if "bookticker" in lower or event_type == "bookticker":
            return "book_ticker"
        if "markprice" in lower or event_type == "markpriceupdate":
            return "mark_price"
        if "forceorder" in lower or event_type == "forceorder":
            return "liquidation"
        if "kline_1m" in lower or event_type == "kline":
            return "kline_1m"
        raise ValueError(f"unsupported Binance stream: {name or event_type}")

    async def run_forever(self, url: str, *, reconnect_delay: float = 2.0) -> None:
        LOGGER.info("connecting to Binance stream (%s)", url.split("?", 1)[0])
        while True:
            try:
                async with websockets.connect(url, ping_interval=20, ping_timeout=15, max_size=10 * 1024 * 1024) as socket:
                    LOGGER.info("Binance stream connected")
                    async for raw in socket:
                        try:
                            self.process_message(json.loads(raw))
                        except Exception as exc:
                            LOGGER.exception("message processing failed; continuing stream")
                            self.alerts.add("message_processing_error")
                            self.gaps.record(exchange="binance", market="usd-m", symbol="*", stream="message", gap_start_ts=0, gap_end_ts=int(time.time() * 1000), reason=f"message_processing_error:{type(exc).__name__}", node_id=self.node_id)
                        if sum(len(items) for items in self.buffers.values()) >= 1000:
                            await asyncio.to_thread(self.flush)
                    LOGGER.warning("Binance stream closed normally: code=%s reason=%s", socket.close_code, socket.close_reason)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                LOGGER.exception("Binance connection loop failed; reconnecting")
                self.gaps.record(exchange="binance", market="usd-m", symbol="*", stream="connection", gap_start_ts=0, gap_end_ts=int(time.time() * 1000), reason="disconnect", node_id=self.node_id)
                await asyncio.to_thread(self.flush)
                await asyncio.sleep(reconnect_delay)

    @staticmethod
    def build_binance_url(symbols: tuple[str, ...]) -> str:
        # Binance's USD-M endpoint currently delivers the raw trade stream
        # reliably from this host; normalize_trade supports both raw trade
        # and historical aggTrade payloads.
        streams = [f"{symbol.lower()}@trade" for symbol in symbols]
        streams += [f"{symbol.lower()}@bookTicker" for symbol in symbols]
        streams += [f"{symbol.lower()}@markPrice@1s" for symbol in symbols]
        streams += [f"{symbol.lower()}@kline_1m" for symbol in symbols]
        streams.append("!forceOrder@arr")
        return "wss://fstream.binance.com/stream?streams=" + "/".join(streams)
