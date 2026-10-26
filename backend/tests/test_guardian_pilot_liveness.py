# -*- coding: utf-8 -*-
"""Юнит-тест критерия живости марафона в scripts/backend_guardian.py.

Регрессия: старый pilot_sessions_alive считал сессии живыми по len(sessions) > 0,
из-за чего после рестарта backend (снапшот сессий восстанавливается, движок
paper is_running=False) guardian пропускал resume и марафон оставался мёртвым.
"""
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from backend_guardian import any_session_running  # noqa: E402


def _payload(*running_flags: bool) -> dict:
    return {
        "status": "ok",
        "sessions": {
            f"SYM{i}USDT": {"symbol": f"SYM{i}USDT", "paper": {"is_running": flag}}
            for i, flag in enumerate(running_flags)
        },
    }


def test_no_sessions_is_dead():
    assert any_session_running({"status": "ok", "sessions": {}}) is False


def test_snapshot_restored_but_engine_down_is_dead():
    # Восстановленный снапшот: записи сессий есть, движок не запущен — мертво.
    assert any_session_running(_payload(False, False, False)) is False


def test_missing_paper_block_is_dead():
    payload = {"status": "ok", "sessions": {"BTCUSDT": {"symbol": "BTCUSDT"}}}
    assert any_session_running(payload) is False


def test_one_running_session_is_alive():
    assert any_session_running(_payload(False, True, False)) is True


def test_none_payload_is_dead():
    assert any_session_running({}) is False
    assert any_session_running(None) is False


if __name__ == "__main__":
    pytest.main([__file__, "-q"])
