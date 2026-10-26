# -*- coding: utf-8 -*-
"""Юнит-тест resume_pilot в scripts/backend_guardian.py.

Регрессия: guardian вызывал start без preflight_id, backend отвечал 400
«No current preflight matches this configuration», и марафон не возобновлялся.
Проверяем, что preflight_id из ответа preflight пробрасывается в start.
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import backend_guardian as bg  # noqa: E402


class _Resp:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def test_resume_pilot_passes_preflight_id(tmp_path: Path, monkeypatch):
    cfg = tmp_path / "pilot.json"
    cfg.write_bytes(b'[{"symbol": "BTCUSDT"}]')
    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        if url.endswith("/preflight"):
            return _Resp(200, {"status": "ok", "preflight_id": "abc123hex"})
        if url.endswith("/start"):
            assert kwargs.get("params", {}).get("preflight_id") == "abc123hex"
            return _Resp(200, {"status": "ok"})
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(bg.requests, "post", fake_post)
    assert bg.resume_pilot("127.0.0.1", 8000, cfg) is True
    assert len(calls) == 2


def test_resume_pilot_aborts_when_no_preflight_id(tmp_path: Path, monkeypatch):
    cfg = tmp_path / "pilot.json"
    cfg.write_bytes(b"[]")
    calls = []

    def fake_post(url, **kwargs):
        calls.append(url)
        if url.endswith("/preflight"):
            # сессии невалидны -> preflight_id не выдан
            return _Resp(200, {"status": "ok", "preflight_id": None})
        return _Resp(200, {})

    monkeypatch.setattr(bg.requests, "post", fake_post)
    assert bg.resume_pilot("127.0.0.1", 8000, cfg) is False
    # start вообще не должен дёргаться без preflight_id
    assert all("/start" not in u for u in calls)


def test_resume_pilot_propagates_start_failure(tmp_path: Path, monkeypatch):
    cfg = tmp_path / "pilot.json"
    cfg.write_bytes(b"[]")

    def fake_post(url, **kwargs):
        if url.endswith("/preflight"):
            return _Resp(200, {"preflight_id": "x" * 32})
        return _Resp(400, text="boom")

    monkeypatch.setattr(bg.requests, "post", fake_post)
    assert bg.resume_pilot("127.0.0.1", 8000, cfg) is False


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
