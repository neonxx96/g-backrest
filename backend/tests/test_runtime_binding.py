from pathlib import Path
import socket

from backend.app.services.runtime_binding import (
    find_available_port,
    persist_runtime_port,
)


def test_find_available_port_skips_occupied_port():
    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.bind(("127.0.0.1", 0))
    blocker.listen(1)
    occupied_port = blocker.getsockname()[1]
    try:
        selected = find_available_port("127.0.0.1", occupied_port, max_attempts=3)
        assert selected == occupied_port + 1
    finally:
        blocker.close()


def test_persist_runtime_port_updates_env_and_runtime_manifest(tmp_path: Path):
    env_path = tmp_path / ".env"
    env_path.write_text("BACKEND_HOST=127.0.0.1\nBACKEND_PORT=8000\nLOG_LEVEL=INFO\n", encoding="utf-8")
    manifest_path = tmp_path / "backend_runtime.json"

    persist_runtime_port(env_path, manifest_path, "127.0.0.1", 8001)

    assert "BACKEND_PORT=8001" in env_path.read_text(encoding="utf-8")
    assert "VITE_BACKEND_PORT=8001" in env_path.read_text(encoding="utf-8")
    assert manifest_path.read_text(encoding="utf-8") == '{"host":"127.0.0.1","port":8001}\n'
