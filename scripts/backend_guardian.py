"""Backend Guardian — внешний watchdog для SignalScript backend.

Рекомендация из HANDOFF (инцидент тихой гибели backend 22.10): раз в N секунд
проверять /api/health; при K подряд неудачах — перезапускать backend по
процедуре 6.1 (Start-Process .venv python backend/main.py, логи в
backend-runtime.*.log). Опционально после рестарта восстанавливает марафон
(--resume-pilot data/pilot_configs_ab_20261022.json): preflight + start с тем
же телом конфига (API-нюанс: start требует тело, иначе "No current preflight
matches this configuration").

Защита от restart-loop: не более --max-restarts-per-hour рестартов в час.

Запуск (отдельное окно, НЕ из backend-процесса):
    .venv\\Scripts\\python.exe scripts\\backend_guardian.py
    .venv\\Scripts\\python.exe scripts\\backend_guardian.py --resume-pilot data/pilot_configs_ab_20261022.json
    .venv\\Scripts\\python.exe scripts\\backend_guardian.py --once   # диагностика
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_PY = ROOT_DIR / ".venv" / "Scripts" / "python.exe"
MAIN_PY = ROOT_DIR / "backend" / "main.py"
RUNTIME_JSON = ROOT_DIR / "data" / "backend_runtime.json"
LOGS_DIR = ROOT_DIR / "backend" / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOGS_DIR / "backend_guardian.log"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def log(msg: str):
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def read_endpoint() -> tuple[str, int]:
    """Активный endpoint из data/backend_runtime.json (fallback: 127.0.0.1:8000)."""
    try:
        payload = json.loads(RUNTIME_JSON.read_text(encoding="utf-8"))
        host = str(payload.get("host") or DEFAULT_HOST)
        port = int(payload.get("port") or DEFAULT_PORT)
        if 1 <= port <= 65535:
            return host, port
    except Exception:
        pass
    return DEFAULT_HOST, DEFAULT_PORT


def is_healthy(host: str, port: int, timeout: float = 5.0) -> bool:
    try:
        res = requests.get(f"http://{host}:{port}/api/health", timeout=timeout)
        return res.status_code == 200 and res.json().get("status") == "ok"
    except Exception:
        return False


def wait_healthy(host: str, port: int, timeout_sec: float = 180.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if is_healthy(host, port, timeout=5.0):
            return True
        time.sleep(3)
    return False


def restart_backend() -> bool:
    """Процедура 6.1: Start-Process backend с логами, ожидание health."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_log = LOGS_DIR / f"backend-runtime.{ts}.out.log"
    err_log = LOGS_DIR / f"backend-runtime.{ts}.err.log"
    log(f"[RESTART] Запуск backend: {BACKEND_PY} {MAIN_PY} (out={out_log.name})")
    try:
        with open(out_log, "ab") as out_f, open(err_log, "ab") as err_f:
            subprocess.Popen(
                [str(BACKEND_PY), str(MAIN_PY)],
                cwd=str(ROOT_DIR),
                stdout=out_f,
                stderr=err_f,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
    except Exception as e:
        log(f"[RESTART][FAIL] Не удалось запустить процесс: {e}")
        return False
    # backend сам выберет порт и запишет data/backend_runtime.json — перечитываем
    time.sleep(5)
    host, port = read_endpoint()
    if wait_healthy(host, port):
        log(f"[RESTART][OK] backend поднялся на {host}:{port}")
        return True
    log(f"[RESTART][FAIL] backend не ответил /api/health за таймаут ({host}:{port})")
    return False


def any_session_running(payload: dict) -> bool:
    """True, если хотя бы одна paper-сессия реально работает (is_running).

    Старый критерий len(sessions) > 0 ловил восстановленный из снапшота
    статус после рестарта backend: записи сессий есть, а движок не запущен —
    guardian пропускал resume, и марафон оставался мёртвым.
    """
    sessions = (payload or {}).get("sessions") or {}
    for s in sessions.values():
        paper = s.get("paper") or {}
        if paper.get("is_running"):
            return True
    return False


def pilot_sessions_alive(host: str, port: int) -> bool:
    try:
        res = requests.get(f"http://{host}:{port}/api/overnight-pilot/status", timeout=10)
        if res.status_code != 200:
            return False
        return any_session_running(res.json())
    except Exception:
        return False


def resume_pilot(host: str, port: int, config_path: Path) -> bool:
    """Перезапуск марафона A/B: preflight + start с одинаковым телом конфига."""
    try:
        body = config_path.read_bytes()
    except OSError as e:
        log(f"[PILOT][FAIL] Не читается конфиг {config_path}: {e}")
        return False
    base = f"http://{host}:{port}"
    headers = {"Content-Type": "application/json"}
    try:
        pre = requests.post(f"{base}/api/overnight-pilot/preflight", data=body, headers=headers, timeout=120)
        if pre.status_code != 200:
            log(f"[PILOT][FAIL] preflight HTTP {pre.status_code}: {pre.text[:200]}")
            return False
        # start требует preflight_id из ответа preflight (сессии хранят его как
        # run_id; без него _preflight_matches отклоняет старт с 400).
        try:
            preflight_id = (pre.json() or {}).get("preflight_id")
        except ValueError:
            preflight_id = None
        if not preflight_id:
            log("[PILOT][FAIL] preflight прошёл, но preflight_id не выдан "
                "(сессии невалидны — смотри /api/overnight-pilot/status)")
            return False
        start = requests.post(
            f"{base}/api/overnight-pilot/start",
            params={"preflight_id": preflight_id},
            data=body, headers=headers, timeout=60,
        )
        if start.status_code != 200:
            log(f"[PILOT][FAIL] start HTTP {start.status_code}: {start.text[:200]}")
            return False
        log("[PILOT][OK] Марафон перезапущен после рестарта backend")
        return True
    except Exception as e:
        log(f"[PILOT][FAIL] {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Backend Guardian — watchdog с авторестартом")
    parser.add_argument("--interval", type=int, default=120, help="Интервал проверок, сек (default: 120)")
    parser.add_argument("--fail-threshold", type=int, default=2, help="Подряд неудач до рестарта (default: 2)")
    parser.add_argument("--max-restarts-per-hour", type=int, default=3, help="Лимит рестартов в час (default: 3)")
    parser.add_argument("--resume-pilot", type=str, default=None,
                        help="Путь к JSON конфигурации марафона для авто-восстановления после рестарта")
    parser.add_argument("--once", action="store_true", help="Одна проверка и выход")
    args = parser.parse_args()

    log(f"Backend Guardian started (interval={args.interval}s, threshold={args.fail_threshold}, "
        f"max_restarts/h={args.max_restarts_per_hour}, resume_pilot={args.resume_pilot or 'off'})")

    fails = 0
    restart_times: list[float] = []
    last_resume_attempt = 0.0
    RESUME_MIN_INTERVAL = 300.0  # не чаще одной попытки resume за 5 минут

    def check_once() -> str:
        nonlocal fails, restart_times, last_resume_attempt
        host, port = read_endpoint()
        if is_healthy(host, port):
            if fails:
                log(f"[OK] backend снова healthy на {host}:{port} (было {fails} подряд неудач)")
            fails = 0
            # Resume марафона и на healthy-бэкенде: снапшот сессий может быть
            # восстановлен при рестарте backend вне guardian (is_running=False),
            # а старая логика резюмила только после собственного рестарта.
            if args.resume_pilot and time.time() - last_resume_attempt >= RESUME_MIN_INTERVAL:
                last_resume_attempt = time.time()
                if not pilot_sessions_alive(host, port):
                    log("[PILOT] Сессии не живы — пробую resume марафона")
                    resume_pilot(host, port, ROOT_DIR / args.resume_pilot)
            return "ok"

        fails += 1
        log(f"[WARN] /api/health недоступен ({host}:{port}), подряд неудач: {fails}/{args.fail_threshold}")
        if fails < args.fail_threshold:
            return "warn"

        now = time.time()
        restart_times = [t for t in restart_times if now - t < 3600]
        if len(restart_times) >= args.max_restarts_per_hour:
            log("[HALT] Лимит рестартов в час исчерпан — требуется ручное вмешательство!")
            fails = 0
            return "halt"

        restart_times.append(now)
        fails = 0
        if not restart_backend():
            return "restart_failed"

        host, port = read_endpoint()
        if args.resume_pilot and not pilot_sessions_alive(host, port):
            resume_pilot(host, port, ROOT_DIR / args.resume_pilot)
        return "restarted"

    if args.once:
        status = check_once()
        log(f"[ONCE] status={status}")
        return

    while True:
        try:
            check_once()
        except Exception as e:
            log(f"[ERROR] Ошибка цикла guardian: {e}")
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
