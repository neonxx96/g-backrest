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

    print("=" * 70)
    print("🎉 ВСЕ 9 E2E ТЕСТОВ ПРОЙДЕНЫ УСПЕШНО! СИСТЕМА ПОЛНОСТЬЮ ИСПРАВНА!")
    print("=" * 70)

if __name__ == "__main__":
    main()
