"""
scripts/run_diagnostics_single.py — Diagnostic Paper Run for Single Pair
===============================================================================
Runs a short diagnostic paper session for one pair using diagnostics_lenient strategy.
"""

import json
import sys
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BACKEND_BASE = "http://127.0.0.1:8000/api/overnight-pilot"

DIAGNOSTICS_SINGLE_CONFIG = [
    {
        "symbol": "BTCUSDT",
        "strategy_type": "naked_test",
        "timeframe": "5m",
        "days": 7,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.25,
        "stop_loss_pct": 0.5,
        "take_profit_pct": 0.75,
        "leverage": 1.0,
        "duration_hours": 2.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.0,
        "use_atr_filter": True,
        "use_cvd_filter": True,
        "use_oi_filter": False,
        "use_rsi_filter": True,
        "use_stacked_imbalance_filter": False,
        "use_absorption_filter": False,
        "use_poc_migration_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.5,
        "trailing_activation_pct": 0.5,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.5,
        "ai_control": False,
        "max_portfolio_heat_pct": 1.25,
        "max_directional_heat_pct": 0.75,
        "max_positions": 4,
        "circuit_daily_loss_limit_pct": -1.25,
        "circuit_weekly_loss_limit_pct": -3.50,
        "max_consecutive_losses": 3,
    },
]


def get_json(url, timeout=30):
    """HTTP GET request returning JSON."""
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def post_json(url, payload, timeout=60):
    """HTTP POST request with JSON body."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    print("=" * 70)
    print("🚀 ДИАГНОСТИЧЕСКИЙ ЗАПУСК (SINGLE PAIR)")
    print("=" * 70)

    # 1. Check no running sessions
    print("[1/3] Проверка отсутствия активных сессий...")
    try:
        status = get_json(f"{BACKEND_BASE}/status")
        sessions = status.get("sessions", {})
        if isinstance(sessions, dict):
            running_symbols = [sym for sym, s in sessions.items() if s.get("running") or (s.get("paper") or {}).get("is_running")]
        else:
            running_symbols = [s.get("symbol") for s in sessions if s.get("running") or (s.get("paper") or {}).get("is_running")]
        if running_symbols:
            print(f"  -> Запуск отменён: активны paper-сессии {', '.join(running_symbols)}.")
            return
        print("  -> Активных paper-сессий нет.")
    except Exception as e:
        print(f"  -> Не удалось проверить статус: {e}")
        return

    # 2. Preflight - отправляем СПИСОК напрямую, не вложенный в объект
    print("[2/3] Запуск Preflight для BTCUSDT...")
    start_t = time.time()
    try:
        # FastAPI endpoint expects List[OvernightPilotConfig] directly in body
        data = json.dumps(DIAGNOSTICS_SINGLE_CONFIG).encode("utf-8")
        req = urllib.request.Request(f"{BACKEND_BASE}/preflight", data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=120) as resp:
            preflight_res = json.loads(resp.read().decode("utf-8"))
        preflight_id = preflight_res.get("preflight_id")
        valid = preflight_res.get("valid_sessions", 0)
        total = preflight_res.get("total_sessions", 0)
        print(f"  -> Preflight завершен за {time.time() - start_t:.1f}с: {valid}/{total} валидно (preflight_id: {preflight_id})")
        if not preflight_id:
            print("  -> Preflight не выдал идентификатор.")
            return
        print(f"  -> Preflight response: {json.dumps(preflight_res, indent=2)}")
    except Exception as e:
        print(f"  -> Ошибка preflight: {e}")
        if isinstance(e, urllib.error.HTTPError):
            print(f"  -> HTTP {e.code}: {e.read().decode('utf-8')}")
        return

    # 3. Start without verdict check - отправляем СПИСОК напрямую, не вложенный в объект
    print("[3/3] Старт diagnostic paper session (without verdict check)...")
    try:
        start_url = f"{BACKEND_BASE}/start-without-verdict?preflight_id={urllib.parse.quote(str(preflight_id), safe='')}"
        # FastAPI endpoint expects List[OvernightPilotConfig] directly in body
        data = json.dumps(DIAGNOSTICS_SINGLE_CONFIG).encode("utf-8")
        req = urllib.request.Request(start_url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            start_res = json.loads(resp.read().decode("utf-8"))
        print(f"  -> Старт успешен: {start_res.get('message', 'Started')}")
    except Exception as e:
        print(f"  -> Ошибка запуска: {e}")
        if isinstance(e, urllib.error.HTTPError):
            print(f"  -> HTTP {e.code}: {e.read().decode('utf-8')}")
        return

    # 4. Check status
    time.sleep(3.0)
    try:
        st = get_json(f"{BACKEND_BASE}/status")
        sessions = st.get("sessions", {})
        if isinstance(sessions, dict):
            sessions = list(sessions.values())
        running_cnt = sum(1 for s in sessions if s.get("running") or (s.get("paper") or {}).get("is_running"))
        print("-" * 70)
        print(f"🎉 DIAGONSTIC SESSION АКТИВНА! Работает: {running_cnt}/1")
        print(f"Баланс пула: ${st.get('aggregate', {}).get('paper', {}).get('balance', 1000.0):,.2f}")
        for s in sessions:
            sym = s.get("symbol")
            sess_config = s.get("config", {})
            tf = sess_config.get("timeframe")
            strat = sess_config.get("strategy_type")
            status = "RUNNING" if s.get("running") or (s.get("paper") or {}).get("is_running") else "STOPPED"
            print(f"  • {sym:10s} [{status}] TF: {tf:3s} | Стратегия: {strat}")
        print("=" * 70)
    except Exception as e:
        print(f"  -> Ошибка статуса: {e}")


if __name__ == "__main__":
    main()
