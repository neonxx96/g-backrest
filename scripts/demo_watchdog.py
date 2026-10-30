"""Демо-вотчдог SignalScript: держит демо-трейдинг живым без участия человека.

Что делает каждый цикл (по умолчанию раз в 60 секунд):
1. Проверяет API бэкенда (http://127.0.0.1:8000). Если порт мёртв или HTTP не
   отвечает (например, слушатель умер с WinError 64) — аккуратно перезапускает
   backend/main.py, снимая зависший процесс с порта 8000 и снимая бэкап БД.
2. Если API жив, а пилот демо не запущен — возобновляет сохранённый набор пар
   из data/screen_and_trade_result.json (prepare + start-demo), подставляя
   сохранённый equity общего счёта, чтобы перезапуски не обнуляли кошелёк.
3. Пока пилот работает — запоминает текущий equity в data/demo_wallet.json.

Пары, отвергнутые live-проверкой (например TOXIC_VOLATILITY), пропускаются и
будут повторены в следующих циклах автоматически.

Запуск (отсоединённо):
    .venv\\Scripts\\python.exe -u scripts/demo_watchdog.py
Остановка:
    .venv\\Scripts\\python.exe scripts/demo_watchdog.py --stop
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import screen_and_trade as st  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
MAIN_PY = os.path.join(ROOT, "backend", "main.py")
STATUS_URL = "http://127.0.0.1:8000/api/overnight-pilot/status"
# Лёгкий эндпоинт для проверки живости: тяжёлый /overnight-pilot/status во время
# возобновления пар может отвечать дольше таймаута и давать ложное «бэкенд мёртв».
HEALTH_URL = "http://127.0.0.1:8000/api/health"
PID_FILE = os.path.join(ROOT, "data", "demo_watchdog.pid")
STOP_FILE = os.path.join(ROOT, "data", "demo_watchdog.stop")
BACKEND_PID_FILE = os.path.join(ROOT, "data", "backend.pid")  # PID дерева backend, порождённого вотчдогом


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def http_json(url: str, timeout: float = 8.0) -> Optional[Dict[str, Any]]:
    try:
        with urlopen(url, timeout=timeout) as resp:  # noqa: S310 — локальный доверенный backend
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, HTTPError, OSError, ValueError):
        return None


def http_json_exc(url: str, timeout: float = 8.0):
    """Как http_json, но возвращает (data, error) — для диагностики причины."""
    try:
        with urlopen(url, timeout=timeout) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8")), None
    except Exception as exc:  # noqa: BLE001 — фиксируем причину для лога
        return None, exc


def port_owner_pid() -> Optional[int]:
    out = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, timeout=30
    ).stdout
    for line in out.splitlines():
        if ":8000" in line and "LISTENING" in line:
            parts = line.split()
            try:
                return int(parts[-1])
            except (ValueError, IndexError):
                return None
    return None


def backup_db() -> None:
    src = os.path.join(ROOT, "data", "signals.db")
    if not os.path.exists(src):
        return
    dst = os.path.join(ROOT, "data", "backups", f"signals-{time.strftime('%Y%m%dT%H%M%S')}-watchdog.db")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        with sqlite3.connect(src) as s, sqlite3.connect(dst) as d:
            s.backup(d)
        log(f"бэкап БД → {os.path.relpath(dst, ROOT)}")
    except sqlite3.Error as exc:
        log(f"бэкап БД пропущен: {exc}")


def kill_pid_tree(pid: int, reason: str) -> None:
    log(f"{reason}: остановка дерева PID {pid}")
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                   capture_output=True, timeout=60)
    for _ in range(10):
        if not pid_alive(pid):
            return
        time.sleep(1)


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"],
                         capture_output=True, text=True, timeout=30).stdout
    return str(pid) in out


def tracked_backend_pid() -> Optional[int]:
    try:
        pid = int(open(BACKEND_PID_FILE, encoding="utf-8").read().strip() or 0)
    except (ValueError, OSError):
        return None
    return pid or None


def kill_backend(owner: Optional[int]) -> None:
    if owner:
        kill_pid_tree(owner, "остановка зависшего бэкенда")


def start_backend() -> None:
    log("запуск backend/main.py …")
    log_out = open(os.path.join(ROOT, "backend.log"), "ab", buffering=0)
    err_out = open(os.path.join(ROOT, "backend.err.log"), "ab", buffering=0)
    proc = subprocess.Popen(  # noqa: S603 — фиксированная команда venv-питона
        [BACKEND, MAIN_PY], cwd=ROOT, stdout=log_out, stderr=err_out,
        creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS,
        close_fds=True,
    )
    # Помним PID дерева: если слушатель умрёт, а процесс останется зомби
    # (классический WinError 64), следующий цикл убьёт именно его — иначе
    # получим два живых бэкенда с конфликтом Telegram-бота и гонкой за БД.
    with open(BACKEND_PID_FILE, "w", encoding="utf-8") as fh:
        fh.write(str(proc.pid))


def wait_api_ready(timeout: float = 180.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if http_json(HEALTH_URL, timeout=8.0) is not None:
            return True
        time.sleep(3)
    return False


def ensure_backend() -> bool:
    """True, если API отвечает (после возможного перезапуска).

    Требует ДВЕ подряд неудачные лёгкие проверки здоровья, прежде чем считать
    бэкенд мёртвым: единичный таймаут во время пиковой нагрузки не должен
    убивать здоровый сервер.
    """
    _, exc = http_json_exc(HEALTH_URL, timeout=15.0)
    if exc is None:
        return True
    time.sleep(5)
    if http_json(HEALTH_URL, timeout=15.0) is not None:
        log(f"health-check мигнул один раз ({type(exc).__name__}: {str(exc)[:60]}) — бэкенд жив, продолжаем")
        return True
    # Зомби-дерево своего прошлого бэкенда (слушатель мёртв, процесс жив) — убить.
    tracked = tracked_backend_pid()
    if tracked and pid_alive(tracked):
        backup_db()
        kill_pid_tree(tracked, "своё дерево бэкенда не отвечает")
    owner = port_owner_pid()
    if owner is not None and owner != tracked:
        backup_db()
        kill_backend(owner)
    elif owner is None:
        log("порт 8000 мёртв")
    start_backend()
    if wait_api_ready():
        log("бэкенд поднялся")
        return True
    log("бэкенд не поднялся за таймаут — повторим в следующем цикле")
    return False


def ensure_demo(status: Dict[str, Any]) -> None:
    """Добирает недостающие пары сохранённого набора; следит за equity счёта."""
    agg = (status.get("aggregate") or {}).get("paper") or {}
    equity = agg.get("equity")
    if equity is not None:
        st.save_equity(float(equity))
    started = st.load_started()
    if not started:
        if not status.get("pilot_running"):
            log("пилот остановлен и сохранённого набора пар нет — нечего возобновлять")
        return
    running = {s.get("symbol") for s in (status.get("summary") or [])}
    missing = [i for i in started if i["symbol"] not in running]
    if not missing:
        return
    if status.get("pilot_running"):
        log(f"добираю {len(missing)} недостающих пар к работающему пилоту")
    else:
        log(f"пилот не запущен; возобновляю {len(missing)} пар (equity старта ${st.saved_equity():.2f})")
    for item in missing:
        symbol = item["symbol"]
        config = st.build_config(symbol, item["strategy_type"], item["timeframe"],
                                 initial_capital=st.saved_equity())
        try:
            prepared = st._post("/pairs/prepare", config)
            result = st.start_pair_preflight(config, prepared["preflight_id"])
            log(f"OK {symbol} {item['strategy_type']} {item['timeframe']} → {result.get('session_id') or 'started'}")
        except Exception as exc:  # noqa: BLE001 — TOXIC_VOLATILITY и прочее: повторим в следующем цикле
            log(f"SKIP {symbol}: {exc}")
        time.sleep(2)


def write_pid() -> None:
    with open(PID_FILE, "w", encoding="utf-8") as fh:
        fh.write(str(os.getpid()))


def stop_requested() -> bool:
    return os.path.exists(STOP_FILE)


def cmd_stop() -> int:
    if not os.path.exists(PID_FILE):
        print("вотчдог не запущен (pid-файла нет)")
        return 0
    open(STOP_FILE, "w", encoding="utf-8").close()
    try:
        pid = int(open(PID_FILE, encoding="utf-8").read().strip() or 0)
    except ValueError:
        pid = 0
    if pid:
        for attempt in range(3):
            if not pid_alive(pid):
                break
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                           capture_output=True, timeout=60)
            for _ in range(10):
                if not pid_alive(pid):
                    break
                time.sleep(1)
        log(f"вотчдог PID {pid} {'остановлен' if not pid_alive(pid) else 'НЕ УДАЛОСЬ остановить'}")
    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)
    if os.path.exists(STOP_FILE):
        os.remove(STOP_FILE)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interval", type=int, default=60, help="секунды между проверками")
    parser.add_argument("--stop", action="store_true", help="остановить вотчдог")
    args = parser.parse_args()
    if args.stop:
        return cmd_stop()
    if stop_requested():
        os.remove(STOP_FILE)
    if os.path.exists(PID_FILE):
        try:
            old = int(open(PID_FILE, encoding="utf-8").read().strip() or 0)
        except ValueError:
            old = 0
        if old and pid_alive(old):
            print(f"вотчдог уже запущен (PID {old}); для остановки: --stop")
            return 1
    write_pid()
    log(f"вотчдог стартовал (PID {os.getpid()}, интервал {args.interval}с)")
    try:
        while not stop_requested():
            try:
                if ensure_backend():
                    status = http_json(STATUS_URL, timeout=30.0)
                    if status is not None:
                        ensure_demo(status)
                    else:
                        log("status не получен в этом цикле — возобновление отложено")
            except Exception as exc:  # noqa: BLE001 — вотчдог не должен умирать сам
                log(f"цикл завершился ошибкой: {exc}")
            time.sleep(args.interval)
    finally:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
        if os.path.exists(STOP_FILE):
            os.remove(STOP_FILE)
        log("вотчдог остановлен")
    return 0


if __name__ == "__main__":
    sys.exit(main())
