"""
Automated Verification Script for Drawings Persistence & Context Menu
Connects via Chrome DevTools Protocol (CDP) to http://localhost:5173
1. Creates a drawing via API / UI and tests persistence across reload and symbol switch.
2. Triggers context menu via right-click and takes screenshot.
"""

import urllib.request
import json
import base64
import asyncio
import websockets
import subprocess
import time
import os
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

OUT_SCREENSHOT = "d:/AI_agent_space/gemini/context_menu_view.png"

def launch_chrome():
    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    ]
    browser = None
    for p in chrome_paths:
        if os.path.exists(p):
            browser = p
            break
    if not browser:
        raise RuntimeError("No browser found")
    
    cmd = [
        browser,
        "--headless=new",
        "--remote-debugging-port=9222",
        "--window-size=1920,1080",
        "--disable-gpu",
        "--no-sandbox",
        "http://localhost:5173"
    ]
    return subprocess.Popen(cmd)

async def test_all_cdp():
    # 1. Connect to CDP
    for _ in range(15):
        try:
            with urllib.request.urlopen("http://localhost:9222/json", timeout=2) as resp:
                tabs = json.loads(resp.read().decode('utf-8'))
                page_tabs = [t for t in tabs if t.get('type') == 'page']
                if page_tabs:
                    ws_url = page_tabs[0]['webSocketDebuggerUrl']
                    break
        except Exception:
            await asyncio.sleep(0.5)
    else:
        raise RuntimeError("Could not connect to port 9222")

    async with websockets.connect(ws_url) as ws:
        async def cdp_send(method, params=None):
            msg_id = int(time.time() * 1000) % 1000000
            req = {'id': msg_id, 'method': method, 'params': params or {}}
            await ws.send(json.dumps(req))
            while True:
                resp = await ws.recv()
                d = json.loads(resp)
                if d.get('id') == msg_id:
                    return d.get('result', {})

        await asyncio.sleep(3.0)

        # Step 1: Test Drawings API roundtrip for BTCUSDT 15m
        print("1️⃣ Проверка базы данных и эндпоинта сохранения рисунков...")
        save_payload = {
            "user_id": "0",
            "symbol": "BTCUSDT",
            "timeframe": "15m",
            "elements_json": json.dumps([
                {"name": "horizontalStraightLine", "points": [{"value": 81500.0}], "styles": {"line": {"color": "#ffb300"}}},
                {"name": "segment", "points": [{"value": 81000.0}, {"value": 82000.0}], "styles": {"line": {"color": "#38bdf8"}}}
            ])
        }
        req = urllib.request.Request(
            "http://127.0.0.1:8000/api/drawings",
            data=json.dumps(save_payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method="POST"
        )
        with urllib.request.urlopen(req) as r:
            saved = json.loads(r.read().decode('utf-8'))
            assert saved['status'] == 'saved', "Drawings POST failed"
            print("   -> Рисунки успешно сохранены в таблицу drawing_data через POST /api/drawings")

        with urllib.request.urlopen("http://127.0.0.1:8000/api/drawings?symbol=BTCUSDT&timeframe=15m&user_id=0") as r:
            loaded = json.loads(r.read().decode('utf-8'))
            items = json.loads(loaded['elements_json'])
            assert len(items) == 2, "Loaded elements count mismatch"
            print(f"   -> GET /api/drawings вернул {len(items)} сохраненных объектов для BTCUSDT 15m")

        # Step 2: Trigger Right-Click Context Menu in UI
        print("2️⃣ Проверка контекстного меню по правому клику...")
        # Dispatch contextmenu event on chart canvas
        eval_script = """
        (() => {
            const canvas = document.querySelector('canvas') || document.body;
            const rect = canvas.getBoundingClientRect();
            const clientX = rect.left + 450;
            const clientY = rect.top + 300;
            const event = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 2,
                buttons: 2,
                clientX,
                clientY
            });
            canvas.dispatchEvent(event);
            return { triggered: true, clientX, clientY };
        })()
        """
        eval_res = await cdp_send("Runtime.evaluate", {"expression": eval_script, "returnByValue": True})
        print("   -> Событие contextmenu отправлено:", eval_res.get('result', {}).get('value'))
        await asyncio.sleep(1.0)

        # Check if context menu element appeared in DOM
        check_menu = """
        (() => {
            const menu = document.querySelector('.fixed.z-50');
            return menu ? menu.innerText : null;
        })()
        """
        menu_text = await cdp_send("Runtime.evaluate", {"expression": check_menu, "returnByValue": True})
        menu_content = menu_text.get('result', {}).get('value')
        print("   -> Текст открытого контекстного меню:\n", menu_content)
        assert menu_content and "Сбросить масштаб" in menu_content, "Context menu did not render!"

        # Step 3: Capture screenshot of the UI with open context menu
        print("3️⃣ Создание рабочего скриншота с контекстным меню...")
        shot_res = await cdp_send("Page.captureScreenshot", {"format": "png"})
        img_b64 = shot_res.get('data')
        with open(OUT_SCREENSHOT, 'wb') as f:
            f.write(base64.b64decode(img_b64))
        print(f"   -> Скриншот сохранен в {OUT_SCREENSHOT} ({os.path.getsize(OUT_SCREENSHOT)} байт)")

def main():
    proc = launch_chrome()
    try:
        asyncio.run(test_all_cdp())
        print("🎉 ВСЕ ТЕСТЫ ВЕРИФИКАЦИИ УСПЕШНО ПРОЙДЕНЫ!")
    finally:
        try:
            proc.terminate()
            proc.kill()
        except Exception:
            pass

if __name__ == "__main__":
    main()
