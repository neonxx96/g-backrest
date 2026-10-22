"""Контрактные тесты пагинации replay-events (задача 2.5, слайс эндпоинта).

Чистые функции, без HTTP (конвенция проекта): paginate_events + дефолт каталога
ReplayEngine (регрессия merge: был data/recorder вместо реального data/recorded).
"""

from __future__ import annotations

import pytest

from backend.app.config import RECORDED_DATA_DIR
from backend.app.routers.replay import MAX_LIMIT, paginate_events
from backend.app.services.replay_engine import DEFAULT_RECORDER_DIR, ReplayEvent


def _ev(seq: int, ts: int, kind: str = "trade") -> ReplayEvent:
    return ReplayEvent(timestamp=ts, priority=0, seq=seq, kind=kind, payload={"i": seq})


def _window(n: int) -> list:
    return [_ev(i, 1_000 + i) for i in range(n)]


def test_first_page_without_cursor():
    page = paginate_events(_window(10), cursor=None, limit=4)
    assert [e["seq"] for e in page["events"]] == [0, 1, 2, 3]
    assert page["next_cursor"] == 4
    assert page["has_more"] is True
    assert page["total"] == 10


def test_walk_full_window_via_cursor():
    events = _window(10)
    seen: list = []
    cursor = None
    for _ in range(10):
        page = paginate_events(events, cursor=cursor, limit=4)
        seen += [e["seq"] for e in page["events"]]
        cursor = page["next_cursor"]
        if not page["has_more"]:
            break
    assert seen == list(range(10))
    assert cursor is None  # финальная страница закрывает окно


def test_last_page_partial_and_no_more():
    page = paginate_events(_window(10), cursor=8, limit=4)
    assert [e["seq"] for e in page["events"]] == [8, 9]
    assert page["next_cursor"] is None
    assert page["has_more"] is False


def test_cursor_beyond_window_is_empty_not_error():
    page = paginate_events(_window(5), cursor=99, limit=4)
    assert page["events"] == []
    assert page["has_more"] is False
    assert page["next_cursor"] is None


def test_limit_bounds_enforced():
    with pytest.raises(ValueError):
        paginate_events(_window(3), cursor=None, limit=0)
    with pytest.raises(ValueError):
        paginate_events(_window(3), cursor=None, limit=MAX_LIMIT + 1)


def test_negative_cursor_rejected():
    with pytest.raises(ValueError):
        paginate_events(_window(3), cursor=-1, limit=1)


def test_event_shape_has_global_seq_and_kind():
    events = [_ev(42, 7_000, kind="depth")]
    page = paginate_events(events, cursor=None, limit=1)
    ev = page["events"][0]
    assert ev["seq"] == 42 and ev["timestamp"] == 7_000 and ev["kind"] == "depth"
    assert ev["payload"] == {"i": 42}


def test_default_engine_dir_points_to_recorded_lake():
    # Регрессия: ветка указывала на несуществующий data/recorder.
    assert DEFAULT_RECORDER_DIR == RECORDED_DATA_DIR
    assert (DEFAULT_RECORDER_DIR / "BTCUSDT").exists()


def test_book_to_lists_parses_json_string_from_lake():
    # Регрессия: bids/asks в Parquet — JSON-строки; старая версия итерировала
    # посимвольно ([['['], ['8'], ...]). Проверка на реальном формате lake.
    from backend.app.services.replay_engine import book_to_lists

    raw = '[[81576.1, 25.741], [81576.0, 2.192]]'
    assert book_to_lists(raw) == [[81576.1, 25.741], [81576.0, 2.192]]
    assert book_to_lists(None) == []
    assert book_to_lists([[1.0, 2.0]]) == [[1.0, 2.0]]
    assert book_to_lists("not-json") == []
