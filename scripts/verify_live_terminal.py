"""
Autonomous Live Terminal & AI Strategy Copilot Verification Script
Tests:
1. Live Binance Kline WebSocket stream ticks within 5 seconds.
2. OrderBook depth walls (> $1M densities).
3. POST /api/ai/optimize-strategy endpoint (Russian prompt NLP parsing & backtest validation).
4. Terminal HTTP and Backend API health.
"""

import sys
import time
import json
import asyncio
import urllib.request
import aiohttp

API_BASE = "http://127.0.0.1:8000/api"
FRONTEND_URL = "http://127.0.0.1:5173"

def print_utf8(text: str):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    print(text)


async def test_live_ws_ticks(symbol: str = "BTCUSDT", timeout_sec: float = 5.0):
    """Verifies that live Binance kline ticks are received within timeout."""
    stream_url = f"wss://stream.binance.com:9443/ws/{symbol.lower()}@kline_1m"
    print_utf8(f"📡 1. Проверка живого WebSocket стрима свечей ({stream_url})...")
    start = time.time()
    
    async with aiohttp.ClientSession() as session:
        try:
            async with session.ws_connect(stream_url, timeout=timeout_sec) as ws:
                msg = await ws.receive_json(timeout=timeout_sec)
                elapsed = time.time() - start
                k = msg.get("k", {})
                close_price = k.get("c")
                high_price = k.get("h")
                low_price = k.get("l")
                vol = k.get("v")
                print_utf8(
                    f"   ✅ Тик получен за {elapsed:.2f} сек! "
                    f"Цена: {close_price} (High: {high_price}, Low: {low_price}, Vol: {vol})"
                )
                return True
        except Exception as e:
            print_utf8(f"   ❌ Ошибка WS тиков: {e}")
            return False


def test_orderbook_walls(symbol: str = "BTCUSDT"):
    """Verifies Level 2 orderbook depth endpoint and detects large density walls."""
    print_utf8(f"🧱 2. Проверка плотностей стакана OrderBook /api/depth ({symbol})...")
    url = f"{API_BASE}/depth?symbol={symbol}&limit=100"
    try:
        req = urllib.request.urlopen(url, timeout=5)
        data = json.loads(req.read().decode("utf-8"))
        bids = data.get("bids", [])
        asks = data.get("asks", [])
        
        big_bids = [(float(p), float(p) * float(q)) for p, q in bids if float(p) * float(q) >= 1000000]
        big_asks = [(float(p), float(p) * float(q)) for p, q in asks if float(p) * float(q) >= 1000000]
        
        print_utf8(f"   ✅ Стакан L2 получен: {len(bids)} bids, {len(asks)} asks.")
        if big_asks:
            print_utf8(f"   📌 Топ Ask стенка: ${big_asks[0][0]:.1f} объём ${big_asks[0][1]/1000000:.2f}M")
        if big_bids:
            print_utf8(f"   📌 Топ Bid стенка: ${big_bids[0][0]:.1f} объём ${big_bids[0][1]/1000000:.2f}M")
        return True
    except Exception as e:
        print_utf8(f"   ❌ Ошибка /api/depth: {e}")
        return False


def test_ai_optimize_copilot():
    """Tests POST /api/ai/optimize-strategy with a natural language Russian prompt."""
    print_utf8("🤖 3. Проверка AI-Ассистента стратегий (POST /api/ai/optimize-strategy)...")
    url = f"{API_BASE}/ai/optimize-strategy"
    prompt = "Сделай консервативный сетап для скальпинга BTC на 5m с низким риском"
    
    payload = json.dumps({
        "prompt": prompt,
        "symbol": "BTCUSDT",
        "timeframe": "5m",
        "days": 7
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=20)
        data = json.loads(resp.read().decode("utf-8"))
        
        status = data.get("status")
        parsed = data.get("parsed_strategy", {})
        summary = data.get("summary", {})
        ai_verdict = data.get("ai_summary", "")
        signals = data.get("signals", [])
        
        assert status == "success", "Expected status=success"
        assert parsed.get("symbol") == "BTCUSDT", "Expected BTCUSDT"
        assert parsed.get("timeframe") == "5m", "Expected 5m"
        assert "params" in parsed, "Expected parsed params"
        
        print_utf8(f"   ✅ AI распознал запрос:")
        print_utf8(f"      Монета: {parsed.get('symbol')} | ТФ: {parsed.get('timeframe')} | Стратегия: {parsed.get('strategy_type')}")
        print_utf8(f"      Параметры: SL {parsed['params'].get('stop_loss_pct')}%, TP {parsed['params'].get('take_profit_pct')}%, Плечо {parsed['params'].get('leverage')}x")
        print_utf8(f"      Фильтры: ATR={parsed['params'].get('use_atr_filter')}, CVD={parsed['params'].get('use_cvd_filter')}, OI={parsed['params'].get('use_oi_filter')}")
        print_utf8(f"   ✅ Бэктест рассчитан: PnL {summary.get('total_pnl_pct')}%, WinRate {summary.get('win_rate_pct')}%, Сигналов: {len(signals)}")
        print_utf8(f"   📋 AI Вердикт: {ai_verdict.strip()[:160]}...")
        return True
    except Exception as e:
        print_utf8(f"   ❌ Ошибка AI Copilot: {e}")
        return False


def test_frontend_health():
    """Checks frontend dev server accessibility."""
    print_utf8("🖥️  4. Проверка доступности фронтенда...")
    try:
        urllib.request.urlopen(FRONTEND_URL, timeout=3)
        print_utf8(f"   ✅ Фронтенд работает: {FRONTEND_URL}")
        return True
    except Exception as e:
        print_utf8(f"   ❌ Фронтенд недоступен: {e}")
        return False


async def main():
    print_utf8("=" * 70)
    print_utf8("🔍 ВАЛИДАЦИЯ СИСТЕМЫ: ЖИВЫЕ СВЕЧИ, СТЕНКИ СТАКАНА И AI-КОПИЛОТ")
    print_utf8("=" * 70)
    
    t1 = await test_live_ws_ticks("BTCUSDT", 5.0)
    t2 = test_orderbook_walls("BTCUSDT")
    t3 = test_ai_optimize_copilot()
    t4 = test_frontend_health()
    
    print_utf8("=" * 70)
    if all([t1, t2, t3, t4]):
        print_utf8("🎉 ВСЕ ТЕСТЫ УСПЕШНО ПРОЙДЕНЫ! ТЕРМИНАЛ ПОЛНОСТЬЮ ЖИВОЙ И ГОТОВ К РАБОТЕ!")
        print_utf8("=" * 70)
        sys.exit(0)
    else:
        print_utf8("⚠️  Один или несколько тестов завершились с ошибкой.")
        print_utf8("=" * 70)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
