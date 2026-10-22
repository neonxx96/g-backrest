from pathlib import Path
from contextlib import nullcontext
from types import SimpleNamespace
import pytest

from backend.app.services.runtime_binding import (
    find_available_port,
    persist_runtime_port,
)


def test_find_available_port_skips_occupied_port(monkeypatch):
    # Windows may allocate adjacent ephemeral ports between bind calls. Model
    # only the OS boundary so this tests selection, not machine-wide port luck.
    attempted = []

    def bind(address):
        attempted.append(address)
        if address[1] in (8000, 8001):
            raise OSError("address already in use")

    monkeypatch.setattr("backend.app.services.runtime_binding.socket.socket", lambda *_: nullcontext(SimpleNamespace(setsockopt=lambda *_: None, bind=bind)))
    assert find_available_port("127.0.0.1", 8000, max_attempts=3) == 8002
    assert attempted == [("127.0.0.1", 8000), ("127.0.0.1", 8001), ("127.0.0.1", 8002)]
    with pytest.raises(RuntimeError, match="No free TCP port"):
        find_available_port("127.0.0.1", 8000, max_attempts=2)


def test_persist_runtime_port_updates_env_and_runtime_manifest(tmp_path: Path):
    env_path = tmp_path / ".env"
    env_path.write_text("BACKEND_HOST=127.0.0.1\nBACKEND_PORT=8000\nLOG_LEVEL=INFO\n", encoding="utf-8")
    manifest_path = tmp_path / "backend_runtime.json"

    persist_runtime_port(env_path, manifest_path, "127.0.0.1", 8001)

    assert "BACKEND_PORT=8001" in env_path.read_text(encoding="utf-8")
    assert "VITE_BACKEND_PORT=8001" in env_path.read_text(encoding="utf-8")
    assert manifest_path.read_text(encoding="utf-8") == '{"host":"127.0.0.1","port":8001}\n'
