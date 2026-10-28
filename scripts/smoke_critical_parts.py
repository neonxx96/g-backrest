import time
"""
Fast smoke test for critical terminal components:
1. Chart klines & indicators
2. OrderBook (DOM depth)
3. OrderFlow Recorder & storage manager
4. Market Scanner & signals
5. Decision Journal & strategy presets
"""

import sys
import json
import urllib.request
import urllib.error

BACKEND_BASE = "http://127.0.0.1:8000/api"


def is_depth_payload(data):
    """Validate the local depth endpoint without treating exchange reachability as app failure.

    The exchange adapter deliberately returns empty sides when every public
    Binance endpoint is unreachable.  That is an honest disconnected state,
    not a malformed response and must not be confused with a synthetic book.
    Live exchange availability is covered separately by the advisory UI check.
    """
    return (
        isinstance(data, dict)
        and isinstance(data.get("bids"), list)
        and isinstance(data.get("asks"), list)
    )


CRITICAL_ENDPOINTS = [
    {
        "name": "OrderFlow Recorder & Storage Status",
        "url": f"{BACKEND_BASE}/recorder/status",
        "validate": lambda data: "used_storage_mb" in data and "max_storage_gb" in data,
    },
    {
        "name": "DOM OrderBook (L2 Depth)",
        "url": f"{BACKEND_BASE}/depth?symbol=BTCUSDT&limit=20",
        "validate": is_depth_payload,
    },
    {
        "name": "Chart Historical K-Lines",
        "url": f"{BACKEND_BASE}/klines?symbol=BTCUSDT&interval=15m&limit=10",
        "validate": lambda data: isinstance(data, list) and len(data) > 0 and "close" in data[-1],
    },
    {
        "name": "Market Scanner Signals",
        "url": f"{BACKEND_BASE}/signals?limit=5",
        "validate": lambda data: isinstance(data, list),
    },
    {
        "name": "Decision Journal Logs",
        "url": f"{BACKEND_BASE}/journal/logs?limit=5",
        "validate": lambda data: data.get("status") == "ok" and "logs" in data,
    },
    {
        "name": "Strategy Parameter Presets",
        "url": f"{BACKEND_BASE}/journal/presets",
        "validate": lambda data: data.get("status") == "ok" and len(data.get("presets", [])) >= 3,
    },
    {
        "name": "User Settings & UI Config",
        "url": f"{BACKEND_BASE}/settings?user_id=0",
        "validate": lambda data: "timeframe" in data and "theme" in data,
    },
    {
        "name": "Quant Quarantine Records",
        "url": f"{BACKEND_BASE}/quant/quarantine/records",
        "validate": lambda data: isinstance(data, list),
    },
]


def run_smoke():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("--- Running Fast Critical Parts Smoke Tests ---", flush=True)
    failed = []

    for item in CRITICAL_ENDPOINTS:
        name = item["name"]
        url = item["url"]
        success = False
        last_err = None
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "SmokeTest/1.0"})
                with urllib.request.urlopen(req, timeout=35) as resp:
                    if resp.status != 200:
                        last_err = f"HTTP {resp.status}"
                        time.sleep(0.5)
                        continue
                    raw = resp.read().decode("utf-8")
                    data = json.loads(raw)
                    if not item["validate"](data):
                        last_err = f"Payload validation failed, got: {str(data)[:120]}"
                        time.sleep(0.5)
                        continue
                    print(f"[PASS] {name}", flush=True)
                    success = True
                    break
            except Exception as e:
                last_err = str(e)
                time.sleep(0.5)
        if not success:
            print(f"[FAIL] {name}: {last_err}", flush=True)
            failed.append(name)

    if failed:
        print(f"\n[ERROR] {len(failed)} smoke tests FAILED: {', '.join(failed)}", flush=True)
        sys.exit(1)

    print("\n[OK] ALL CRITICAL COMPONENT SMOKE TESTS PASSED.", flush=True)
    sys.exit(0)


if __name__ == "__main__":
    run_smoke()
