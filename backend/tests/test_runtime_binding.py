from pathlib import Path
from contextlib import nullcontext
from types import SimpleNamespace
import pytest

from backend.app.services.runtime_binding import (
    find_available_port,
    is_healthy_backend_running,
    persist_runtime_port,
    persist_runtime_port_guarded,
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


def test_guarded_persist_blocks_hijack_when_primary_healthy(tmp_path: Path, monkeypatch):
    """A roamed secondary instance must not rewrite .env while the primary lives."""
    env_path = tmp_path / ".env"
    env_path.write_text("BACKEND_PORT=8000\nVITE_BACKEND_PORT=8000\n", encoding="utf-8")
    manifest_path = tmp_path / "backend_runtime.json"
    manifest_path.write_text('{"host":"127.0.0.1","port":8000}\n', encoding="utf-8")

    monkeypatch.setattr(
        "backend.app.services.runtime_binding.is_healthy_backend_running",
        lambda host, port, **_: True,
    )
    persisted = persist_runtime_port_guarded(env_path, manifest_path, "127.0.0.1", 8001, 8000)

    assert persisted is False
    # .env and manifest still describe the primary backend
    assert "BACKEND_PORT=8000" in env_path.read_text(encoding="utf-8")
    assert "8001" not in env_path.read_text(encoding="utf-8")
    assert manifest_path.read_text(encoding="utf-8") == '{"host":"127.0.0.1","port":8000}\n'


def test_guarded_persist_allows_roam_when_primary_dead(tmp_path: Path, monkeypatch):
    """If the preferred port is busy by something dead/foreign, roaming persists."""
    env_path = tmp_path / ".env"
    env_path.write_text("BACKEND_PORT=8000\n", encoding="utf-8")
    manifest_path = tmp_path / "backend_runtime.json"

    monkeypatch.setattr(
        "backend.app.services.runtime_binding.is_healthy_backend_running",
        lambda host, port, **_: False,
    )
    persisted = persist_runtime_port_guarded(env_path, manifest_path, "127.0.0.1", 8001, 8000)

    assert persisted is True
    assert "BACKEND_PORT=8001" in env_path.read_text(encoding="utf-8")


def test_guarded_persist_on_preferred_port_skips_health_probe(tmp_path: Path, monkeypatch):
    """Binding the preferred port itself always persists (no self-probe)."""
    env_path = tmp_path / ".env"
    env_path.write_text("BACKEND_PORT=7999\n", encoding="utf-8")
    manifest_path = tmp_path / "backend_runtime.json"

    def fail_probe(*_, **__):
        raise AssertionError("health probe must not run for the preferred port")

    monkeypatch.setattr(
        "backend.app.services.runtime_binding.is_healthy_backend_running", fail_probe
    )
    persisted = persist_runtime_port_guarded(env_path, manifest_path, "127.0.0.1", 8000, 8000)

    assert persisted is True
    assert "BACKEND_PORT=8000" in env_path.read_text(encoding="utf-8")


def test_is_healthy_backend_running_contract(monkeypatch):
    class FakeResp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return b'{"status":"ok"}'

    monkeypatch.setattr(
        "backend.app.services.runtime_binding.urllib.request.urlopen",
        lambda url, timeout=0: FakeResp(),
    )
    assert is_healthy_backend_running("127.0.0.1", 8000) is True

    monkeypatch.setattr(
        "backend.app.services.runtime_binding.urllib.request.urlopen",
        lambda url, timeout=0: (_ for _ in ()).throw(OSError("refused")),
    )
    assert is_healthy_backend_running("127.0.0.1", 8000) is False
