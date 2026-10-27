"""
scripts/launch_overnight_8pairs.py — Institutional 8-Pair Marathon Launch Script
================================================================================
Launches the refined 8-pair quant portfolio on Binance Futures USDT-M:
- Pairs: BTC, ETH, SOL, BNB, XRP, DOGE, SUI, NEAR
- Timeframes: 5m and 15m (eliminating 1m/3m fee drag)
- Risk per trade: 0.35% ($3.50 on $1,000 shared balance)
- Portfolio Heat limit: 1.25% ($12.50 max simultaneous risk across all pairs)
- Maximum simultaneous positions: 4
- Maximum effective leverage: 5.0x (derived strictly from stop loss distance)
- Market Regime Gate: Mandatory classification before signal acceptance
- Microstructure Gate: Imbalance & CVD absorption veto
- Tiered Trailing: BE at +1.0R / +1.5R with partial profit lock
"""
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BACKEND_BASE = "http://127.0.0.1:8000/api/overnight-pilot"

TOP_8_PAIRS_CONFIG = [
    {
        "symbol": "BTCUSDT",
        "strategy_type": "diagnostics_lenient",
        "timeframe": "5m",
        "days": 7,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.25,
        "stop_loss_pct": 0.5,
        "take_profit_pct": 0.75,
        "leverage": 1.0,
        "duration_hours": 2.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.5,
        "use_atr_filter": False,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": False,
        "use_trailing": False,
        "trailing_pct": 0.0,
        "trailing_activation_pct": 0.0,
        "tp1_rr_ratio": 1.0,
        "tp2_rr_ratio": 1.0,
        "sl_tp_mode": "fixed",
        "ai_control": False,
    },
    {
        "symbol": "ETHUSDT",
        "strategy_type": "ema_trend_window",
        "timeframe": "5m",
        "days": 2,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.35,
        "stop_loss_pct": 0.8,
        "take_profit_pct": 1.8,
        "leverage": 3.0,
        "duration_hours": 24.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.95,
        "use_atr_filter": True,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.5,
        "trailing_activation_pct": 0.5,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.5,
        "ai_control": True,
    },
    {
        "symbol": "SOLUSDT",
        "strategy_type": "confluence_ema",
        "timeframe": "5m",
        "days": 2,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.35,
        "stop_loss_pct": 1.0,
        "take_profit_pct": 2.0,
        "leverage": 3.0,
        "duration_hours": 24.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.95,
        "use_atr_filter": True,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.6,
        "trailing_activation_pct": 0.6,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.6,
        "ai_control": True,
    },
    {
        "symbol": "BNBUSDT",
        "strategy_type": "confluence_ema",
        "timeframe": "15m",
        "days": 2,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.35,
        "stop_loss_pct": 0.8,
        "take_profit_pct": 1.8,
        "leverage": 3.0,
        "duration_hours": 24.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.95,
        "use_atr_filter": True,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.5,
        "trailing_activation_pct": 0.5,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.5,
        "ai_control": True,
    },
    {
        "symbol": "XRPUSDT",
        "strategy_type": "confluence_ema",
        "timeframe": "5m",
        "days": 2,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.35,
        "stop_loss_pct": 0.9,
        "take_profit_pct": 2.0,
        "leverage": 3.0,
        "duration_hours": 24.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.95,
        "use_atr_filter": True,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.6,
        "trailing_activation_pct": 0.6,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.6,
        "ai_control": True,
    },
    {
        "symbol": "DOGEUSDT",
        "strategy_type": "ema_trend",
        "timeframe": "15m",
        "days": 2,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.35,
        "stop_loss_pct": 1.1,
        "take_profit_pct": 2.2,
        "leverage": 3.0,
        "duration_hours": 24.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.95,
        "use_atr_filter": True,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.6,
        "trailing_activation_pct": 0.6,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.6,
        "ai_control": True,
    },
    {
        "symbol": "SUIUSDT",
        "strategy_type": "confluence_ema",
        "timeframe": "5m",
        "days": 2,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.35,
        "stop_loss_pct": 1.2,
        "take_profit_pct": 2.4,
        "leverage": 3.0,
        "duration_hours": 24.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.95,
        "use_atr_filter": True,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.7,
        "trailing_activation_pct": 0.7,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.7,
        "ai_control": True,
    },
    {
        "symbol": "NEARUSDT",
        "strategy_type": "confluence_ema",
        "timeframe": "15m",
        "days": 2,
        "initial_capital": 1000.0,
        "risk_per_trade_pct": 0.35,
        "stop_loss_pct": 1.0,
        "take_profit_pct": 2.2,
        "leverage": 3.0,
        "duration_hours": 24.0,
        "min_density_usd": 0.0,
        "volume_multiplier": 0.95,
        "use_atr_filter": True,
        "use_cvd_filter": False,
        "use_oi_filter": False,
        "use_rsi_filter": False,
        "use_multi_tp": True,
        "use_trailing": True,
        "trailing_pct": 0.6,
        "trailing_activation_pct": 0.6,
        "tp1_rr_ratio": 1.5,
        "tp2_rr_ratio": 2.5,
        "sl_tp_mode": "atr",
        "atr_multiplier": 1.6,
        "ai_control": True,
    },
]

# One shared paper account is created by OvernightPilotManager. These are
# deliberately conservative operational defaults for the first reproducible
# diagnostic run; pair-specific signal parameters above remain unchanged.
FIRST_RUN_DEFAULTS = {
    "initial_capital": 1000.0,
    "risk_per_trade_pct": 0.5,
    "risk_contract_version": 1,
    "risk_units": "percent",
    "max_portfolio_heat_pct": 1.25,
    "max_directional_heat_pct": 0.75,
    "max_positions": 4,
    "daily_dd_limit_pct": 3.0,
    "circuit_daily_loss_limit_pct": -1.25,
    "circuit_weekly_loss_limit_pct": -3.5,
    "max_consecutive_losses": 3,
    "duration_hours": 8.0,
    "ai_control": False,
}

for _pair_config in TOP_8_PAIRS_CONFIG:
    _pair_config.update(FIRST_RUN_DEFAULTS)


def post_json(url: str, data: dict, timeout: int = 120):
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_json(url: str, timeout: int = 30):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    print("=" * 70)
    print("🚀 ИНСТИТУЦИОНАЛЬНЫЙ ЗАПУСК КВАНТ-МАРАФОНА (ТОП-8 ПАР BINANCE FUTURES)")
    print("=" * 70)
    print(f"Пул активов: {[p['symbol'] for p in TOP_8_PAIRS_CONFIG]}")
    print("Базовый риск: 0.50% | Portfolio Heat: 1.25% | Max Leverage: 5.0x")
    print("Market Regime Gate: ВКЛЮЧЕН | Microstructure Gate: ВКЛЮЧЕН")
    print("AI Sentinel: disabled for the diagnostic run (deterministic fallback)")
    print("-" * 70)

    # 1. Refuse to disturb an existing paper run. A diagnostic launch must be
    # explicit about operational ownership instead of terminating sessions.
    try:
        print("[1/3] Проверка отсутствия активных сессий...")
        current_status = get_json(f"{BACKEND_BASE}/status")
        running_symbols = [
            str(session.get("symbol", "unknown"))
            for session in current_status.get("sessions", [])
            if session.get("running") or (session.get("paper") or {}).get("is_running")
        ]
        if running_symbols:
            print(f"  -> Запуск отменён: активны paper-сессии {', '.join(running_symbols)}. Остановите их явно и повторите.")
            return
        print("  -> Активных paper-сессий нет.")
    except Exception as e:
        print(f"  -> Не удалось безопасно проверить статус: {e}. Запуск отменён.")
        return

    # 2. Preflight for the 8 pairs
    print("[2/3] Запуск Preflight для 8 пар...")
    start_t = time.time()
    try:
        preflight_res = post_json(f"{BACKEND_BASE}/preflight", {"configs": TOP_8_PAIRS_CONFIG}, timeout=120)
        preflight_id = preflight_res.get("preflight_id")
        valid = preflight_res.get("valid_sessions", 0)
        total = preflight_res.get("total_sessions", 0)
        print(f"  -> Preflight завершен за {time.time() - start_t:.1f}с: {valid}/{total} валидно (preflight_id: {preflight_id})")
        if not preflight_id:
            print("  -> Preflight не выдал идентификатор; запуск отменён, чтобы не пересчитать конфигурацию неявно.")
            return
    except Exception as e:
        print(f"  -> Ошибка preflight: {e}")
        return

    # 3. Start live paper trading
    print("[3/3] Старт непрерывного марафона...")
    try:
        start_url = f"{BACKEND_BASE}/start?preflight_id={urllib.parse.quote(str(preflight_id), safe='')}"
        start_res = post_json(start_url, {"configs": TOP_8_PAIRS_CONFIG}, timeout=60)
        print(f"  -> Старт успешен: {start_res.get('message', 'Started')}")
    except Exception as e:
        print(f"  -> Ошибка запуска: {e}")
        return

    # 4. Check initial status
    time.sleep(2.0)
    try:
        st = get_json(f"{BACKEND_BASE}/status")
        running_cnt = sum(1 for s in st.get("sessions", []) if s.get("running"))
        print("-" * 70)
        print(f"🎉 МАРАФОН АКТИВЕН! Работает сессий: {running_cnt}/8")
        print(f"Баланс пула: ${st.get('aggregate', {}).get('paper', {}).get('balance', 1000.0):,.2f}")
        for s in st.get("sessions", []):
            sym = s.get("symbol")
            tf = s.get("config", {}).get("timeframe")
            strat = s.get("config", {}).get("strategy_type")
            status = "RUNNING" if s.get("running") else "STOPPED"
            print(f"  • {sym:10s} [{status}] TF: {tf:3s} | Стратегия: {strat}")
        print("=" * 70)
    except Exception as e:
        print(f"  -> Ошибка статуса: {e}")


if __name__ == "__main__":
    main()
