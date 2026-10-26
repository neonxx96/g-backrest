"""Runtime port selection and discovery metadata for parallel local instances."""

from __future__ import annotations

import json
import logging
import socket
import urllib.request
from pathlib import Path

logger = logging.getLogger("SignalScript.RuntimeBinding")


def find_available_port(host: str, preferred_port: int, max_attempts: int = 100) -> int:
    """Return the first bindable TCP port at or above ``preferred_port``."""
    if preferred_port < 1 or preferred_port > 65535:
        raise ValueError("preferred_port must be between 1 and 65535")
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")

    for port in range(preferred_port, min(65535, preferred_port + max_attempts - 1) + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((host, port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"No free TCP port found from {preferred_port} after {max_attempts} attempts")


def is_healthy_backend_running(host: str, port: int, timeout_sec: float = 2.0) -> bool:
    """Return True if a live SignalScript backend answers /api/health on host:port."""
    url = f"http://{host}:{port}/api/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout_sec) as resp:
            if resp.status != 200:
                return False
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
            return isinstance(payload, dict) and payload.get("status") == "ok"
    except Exception:
        return False


def persist_runtime_port_guarded(
    env_path: Path,
    manifest_path: Path,
    host: str,
    port: int,
    preferred_port: int,
) -> bool:
    """Persist the active endpoint unless a healthy primary backend owns it.

    A secondary instance that roamed to a non-preferred port must NOT rewrite
    ``.env`` / ``backend_runtime.json`` while the primary backend on
    ``preferred_port`` is alive — otherwise the frontend dev proxy (and every
    launcher reading ``.env``) gets hijacked to the secondary port and all
    ``/api/*`` calls start failing with 502. Returns True when metadata was
    persisted.
    """
    if port != preferred_port and is_healthy_backend_running(host, preferred_port):
        logger.warning(
            "Roamed to port %s, but a healthy backend already answers on %s:%s; "
            "leaving .env and %s untouched.",
            port, host, preferred_port, manifest_path,
        )
        return False
    persist_runtime_port(env_path, manifest_path, host, port)
    return True


def persist_runtime_port(
    env_path: Path,
    manifest_path: Path,
    host: str,
    port: int,
) -> None:
    """Persist the active endpoint for launchers and the frontend dev proxy."""
    env_path.parent.mkdir(parents=True, exist_ok=True)
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    replaced = False
    output: list[str] = []
    for line in lines:
        if line.startswith("BACKEND_PORT="):
            output.append(f"BACKEND_PORT={port}")
            replaced = True
        else:
            output.append(line)
    if not replaced:
        output.append(f"BACKEND_PORT={port}")
    vite_replaced = False
    for index, line in enumerate(output):
        if line.startswith("VITE_BACKEND_PORT="):
            output[index] = f"VITE_BACKEND_PORT={port}"
            vite_replaced = True
            break
    if not vite_replaced:
        output.append(f"VITE_BACKEND_PORT={port}")
    env_path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"host": host, "port": port}, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
