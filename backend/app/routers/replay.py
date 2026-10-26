"""Replay API (задача 2.5): курсорная пагинация детерминированного event-stream
recorder'а (trades + depth) для replay-плеера.

Контракт:
- GET /api/replay/events?symbol=BTCUSDT&start_ts=&end_ts=&cursor=&limit=
- cursor — смещение (offset) в отфильтрованном окне, равен next_cursor предыдущего
  ответа (первый запрос без курсора → с начала окна); seq событий при этом глобальные;
- ответ: {symbol, events: [{seq, timestamp, kind, payload}], next_cursor, total, has_more};
- события отсортированы детерминированно (ReplayEngine: ts, priority, row_index);
- total может быть null, пока поток не доигран до конца (ленивая оценка отсутствует —
  честнее null, чем недостоверное число).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from backend.app.services.replay_engine import ReplayEngine

logger = logging.getLogger(__name__)

replay_router = APIRouter(prefix="/api/replay", tags=["replay"])

MAX_LIMIT = 2000
DEFAULT_LIMIT = 500

# Кэш движков на сессию процесса: build_events кэширует список, повторные
# страницы не перечитывают Parquet. Жизнь кэша — жизнь процесса backend'а
# (lake растёт в течение дня; при необходимости свежих данных — рестарт).
_engines: Dict[str, ReplayEngine] = {}


def paginate_events(
    events: List[Any],
    cursor: Optional[int],
    limit: int,
) -> Dict[str, Any]:
    """Чистая пагинация окна событий (курсор = offset первого элемента страницы).

    Выделено в функцию для прямых юнит-тестов без HTTP (конвенция проекта).
    """
    if limit < 1 or limit > MAX_LIMIT:
        raise ValueError(f"limit must be in [1, {MAX_LIMIT}]")
    start = 0 if cursor is None else cursor
    if start < 0:
        raise ValueError("cursor must be >= 0")
    page = events[start:start + limit]
    next_cursor = start + len(page)
    has_more = next_cursor < len(events)
    return {
        "events": [
            {
                "seq": ev.seq,
                "timestamp": ev.timestamp,
                "kind": ev.kind,
                "payload": ev.payload,
            }
            for ev in page
        ],
        "next_cursor": next_cursor if has_more else None,
        "total": len(events),
        "has_more": has_more,
    }


def _get_engine(symbol: str) -> ReplayEngine:
    key = symbol.upper()
    if key not in _engines:
        _engines[key] = ReplayEngine(symbol=key)
    return _engines[key]


@replay_router.get("/events")
async def replay_events(
    symbol: str = Query(default="BTCUSDT", min_length=1),
    start_ts: Optional[int] = Query(default=None, ge=0),
    end_ts: Optional[int] = Query(default=None, ge=0),
    cursor: Optional[int] = Query(default=None, ge=0),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> Dict[str, Any]:
    sym = symbol.strip().upper()
    if not sym:
        raise HTTPException(status_code=422, detail="symbol is required")
    if start_ts is not None and end_ts is not None and start_ts > end_ts:
        raise HTTPException(status_code=422, detail="start_ts must be <= end_ts")

    try:
        engine = _get_engine(sym)
        events = engine.build_events(start_ts=start_ts, end_ts=end_ts)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:  # pragma: no cover - defensive
        logger.exception("replay engine failure for %s", sym)
        raise HTTPException(status_code=500, detail=f"replay engine failed: {e}")

    if not events:
        return {
            "symbol": sym,
            "events": [],
            "next_cursor": None,
            "total": 0,
            "has_more": False,
        }

    try:
        page = paginate_events(events, cursor=cursor, limit=limit)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return {"symbol": sym, **page}
