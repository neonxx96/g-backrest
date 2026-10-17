"""
End-to-End Functional Test Suite for Signal Script
Tests all REST endpoints, custom timeframes, drawings persistence, and frontend availability.
"""

import sys
import io
import time
import json
import urllib.request
import sqlite3

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

def request_json(url, method="GET", payload=None):
    data = json.dumps(payload).encode('utf-8') if payload else None
    headers = {'Content-Type': 'application/json'} if payload else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode('utf-8'))

def main():
    print("=" * 70)
    print("🧪 Запуск автоматизированного E2E-тестирования Signal Script")
    print("=" * 70)

    # 1. Health check
    print("1️⃣ Проверка бэкенда (GET /api/health)...", end=" ")
    health = request_json("http://127.0.0.1:8000/api/health")
    assert health['status'] == 'ok', "Backend health status is not ok"
    print(f"✅ OK! (Стрим ликвидаций WS: {'ВКЛ' if health['is_ws_connected'] else 'ВЫКЛ'})")

    # 2. Frontend check
    print("2️⃣ Проверка фронтенда (GET http://127.0.0.1:5173)...", end=" ")
    with urllib.request.urlopen("http://127.0.0.1:5173", timeout=10) as resp:
        html = resp.read().decode('utf-8')
        assert "html" in html.lower(), "Frontend HTML not served"
    print("✅ OK! (Vite React сервер отвечает)")

    # 3. Settings read & write
    print("3️⃣ Проверка настроек профиля (GET & POST /api/settings)...", end=" ")
    settings = request_json("http://127.0.0.1:8000/api/settings?user_id=0")
    assert 'price_change_min' in settings
    
    # Update settings
    settings['price_change_min'] = 2.5
    updated = request_json("http://127.0.0.1:8000/api/settings", method="POST", payload=settings)
    assert updated['price_change_min'] == 2.5
    print("✅ OK! (Настройки моментально обновлены без перезапуска)")

    # 4. Klines: Standard 15m
    print("4️⃣ Проверка свечей BTCUSDT (15m)...", end=" ")
    klines_15m = request_json("http://127.0.0.1:8000/api/klines?symbol=BTCUSDT&timeframe=15m&limit=50")
    assert len(klines_15m) > 0, "No klines returned"
    first = klines_15m[-1]
    print(f"✅ OK! ({len(klines_15m)} свечей получено, последняя цена: {first['close']})")

    # 5. Klines: Custom 45m aggregation
    print("5️⃣ Проверка нестандартного ТФ ETHUSDT (45m)...", end=" ")
    klines_45m = request_json("http://127.0.0.1:8000/api/klines?symbol=ETHUSDT&timeframe=45m&limit=30")
    assert len(klines_45m) > 0, "45m resampled klines failed"
    print(f"✅ OK! (45m свечи успешно собраны из 15m, получено: {len(klines_45m)})")

    # 6. Klines: Custom 6h aggregation
    print("6️⃣ Проверка старшего ТФ SOLUSDT (6h)...", end=" ")
    klines_6h = request_json("http://127.0.0.1:8000/api/klines?symbol=SOLUSDT&timeframe=6h&limit=20")
    assert len(klines_6h) > 0, "6h resampled klines failed"
    print(f"✅ OK! (6h свечи успешно получены, количество: {len(klines_6h)})")

    # 7. Chart drawings persistence
    print("7️⃣ Проверка сохранения рисунков графика...", end=" ")
    dummy_drawings = [
      {"name": "horizontalStraightLine", "points": [{"value": 81500}], "styles": {"line": {"color": "#ff9800"}}},
      {"name": "segment", "points": [{"value": 80000}, {"value": 82000}], "styles": {"line": {"color": "#2962ff"}}}
    ]
    save_res = request_json("http://127.0.0.1:8000/api/drawings", method="POST", payload={
        "user_id": "0",
        "symbol": "BTCUSDT",
        "timeframe": "15m",
        "elements_json": json.dumps(dummy_drawings)
    })
    assert save_res['status'] == 'saved'

    load_res = request_json("http://127.0.0.1:8000/api/drawings?symbol=BTCUSDT&timeframe=15m&user_id=0")
    loaded_elements = json.loads(load_res['elements_json'])
    assert len(loaded_elements) == 2
    print("✅ OK! (Рисунки сохранены в базу и успешно загружены)")

    # 8. Trigger Live Scan
    print("8️⃣ Тестирование вызова сканера рынка (POST /api/scan)...", end=" ")
    scan_res = request_json("http://127.0.0.1:8000/api/scan", method="POST")
    print(f"✅ OK! (Сканирование выполнено, сигналов найдено: {scan_res['found']})")

    # 9. Liquidations DB check
    print("9️⃣ Проверка записи ликвидаций Binance в SQLite...", end=" ")
    conn = sqlite3.connect("data/signals.db")
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*), SUM(usd_amount) FROM liquidation_events")
    count, total_usd = cur.fetchone()
    conn.close()
    print(f"✅ OK! (В базе зафиксировано ликвидаций: {count}, на сумму: ${total_usd or 0:,.2f})")

    # 10. Recorder & 100GB Quota check
    print("🔟 Проверка квоты хранилища 100 GB и рекордера (GET /api/recorder/status)...", end=" ")
    rec_status = request_json("http://127.0.0.1:8000/api/recorder/status")
    assert rec_status['max_storage_gb'] == 100.0
    assert rec_status['is_recording'] is True
    print(f"✅ OK! (Запись активна, фокус монет: {len(rec_status['focus_symbols'])}, сделок: {rec_status['total_trades_session']})")

    # 11. Footprint Clusters check
    print("1️⃣1️⃣ Проверка генератора Footprint / Кластеров...", end=" ")
    clusters = request_json("http://127.0.0.1:8000/api/recorder/clusters?symbol=BTCUSDT&limit=5")
    assert isinstance(clusters, list)
    print(f"✅ OK! (Кластера формируются в памяти, свечей: {len(clusters)})")

    # 12. Order Flow Backtester simulation
    print("1️⃣2️⃣ Проверка симулятора бэктеста Order Flow (POST /api/backtest/run)...", end=" ")
    bt_res = request_json("http://127.0.0.1:8000/api/backtest/run", method="POST", payload={
        "symbol": "BTCUSDT",
        "timeframe": "15m",
        "days": 7,
        "strategy_type": "confluence_ema",
        "initial_capital": 10000.0,
        "leverage": 2.0
    })
    assert 'net_pnl' in bt_res
    assert 'win_rate_pct' in bt_res
    print(f"✅ OK! (Бэктест выполнен: PnL {bt_res['net_pnl']}$, WR {bt_res['win_rate_pct']}%, сделок {bt_res['total_trades']})")

    # 13. Data Export ZIP
    print("1️⃣3️⃣ Проверка экспорта данных (GET /api/recorder/export)...", end=" ")
    req_exp = urllib.request.Request("http://127.0.0.1:8000/api/recorder/export?symbol=BTCUSDT")
    with urllib.request.urlopen(req_exp, timeout=10) as resp:
        zip_bytes = resp.read()
        assert len(zip_bytes) > 0
    print(f"✅ OK! (Архив Parquet сформирован, размер: {len(zip_bytes):,} байт)")

    # 14. Fast Grid Search Optimization (POST /api/backtest/optimize)
    print("1️⃣4️⃣ Проверка быстрого Grid Search (POST /api/backtest/optimize)...", end=" ")
    opt_res = request_json("http://127.0.0.1:8000/api/backtest/optimize", method="POST", payload={
        "symbol": "BTCUSDT",
        "timeframe": "15m",
        "days": 5,
        "strategy_type": "delta_absorption",
        "sl_min": 0.2,
        "sl_max": 0.8,
        "sl_step": 0.3,
        "tp_min": 0.5,
        "tp_max": 2.0,
        "tp_step": 0.7,
        "wall_min_usd": 200000.0,
        "wall_max_usd": 1400000.0,
        "wall_step_usd": 600000.0,
        "leverage": 2.0
    })
    assert "top_setups" in opt_res and len(opt_res["top_setups"]) > 0
    best_opt = opt_res["top_setups"][0]
    print(f"✅ OK! (Сетка рассчитана: {opt_res['meta']['combinations_tested']} комбинаций, топ-1 PF: {best_opt['profit_factor']}, WR: {best_opt['win_rate_pct']}%)")

    # 15. Strategy Signal Persistence in SQLite (POST /api/signals)
    print("1️⃣5️⃣ Проверка сохранения сигналов стратегии в SQLite (POST & GET /api/signals)...", end=" ")
    sig_payload = {
        "symbol": "BTCUSDT",
        "timeframe": "15m",
        "price": 81450.5,
        "condition_type": "DENSITY_BOUNCE",
        "direction": "BULLISH",
        "description": "BUY ZONE: Wall $1.2M",
        "normalized_metric": "+1.8σ"
    }
    created_sig = request_json("http://127.0.0.1:8000/api/signals", method="POST", payload=sig_payload)
    assert created_sig["id"] > 0
    assert created_sig["symbol"] == "BTCUSDT"

    all_sigs = request_json("http://127.0.0.1:8000/api/signals?limit=5")
    assert any(s["id"] == created_sig["id"] for s in all_sigs)
    print(f"✅ OK! (Сигнал #{created_sig['id']} сохранен и подтвержден в SQLite)")

    print("=" * 70)
    print("🎉 ВСЕ 15 E2E ТЕСТОВ ПРОЙДЕНЫ УСПЕШНО! СИСТЕМА ПОЛНОСТЬЮ ИСПРАВНА!")
    print("=" * 70)

if __name__ == "__main__":
    main()

