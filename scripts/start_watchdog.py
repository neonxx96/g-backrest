"""Стартер демо-вотчдога: отсоединённый запуск с логом в data/demo_watchdog.log.

Использование:
    .venv\\Scripts\\python.exe scripts/start_watchdog.py
    (или двойной клик run_demo_watchdog.cmd)

Не плодит дубликатов: если вотчдог уже жив (pid-файл + живой процесс) —
выводит PID и выходит. Остановка: scripts/demo_watchdog.py --stop
"""
from __future__ import annotations

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_PY = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
WATCHDOG = os.path.join(ROOT, "scripts", "demo_watchdog.py")
PID_FILE = os.path.join(ROOT, "data", "demo_watchdog.pid")
LOG_FILE = os.path.join(ROOT, "data", "demo_watchdog.log")


def pid_alive(pid: int) -> bool:
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"],
                         capture_output=True, text=True, timeout=30).stdout
    return str(pid) in out


def main() -> int:
    try:
        old = int(open(PID_FILE, encoding="utf-8").read().strip() or 0)
    except (ValueError, OSError):
        old = 0
    if old and pid_alive(old):
        print(f"вотчдог уже запущен (PID {old}); остановка: python scripts/demo_watchdog.py --stop")
        return 0
    log = open(LOG_FILE, "ab", buffering=0)
    proc = subprocess.Popen(  # noqa: S603 — фиксированная команда venv-питона
        [BACKEND_PY, "-u", WATCHDOG], cwd=ROOT,
        stdout=log, stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
        close_fds=True,
    )
    print(f"вотчдог запущен (PID {proc.pid}), лог: data\\demo_watchdog.log")
    return 0


if __name__ == "__main__":
    sys.exit(main())
