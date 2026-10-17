"""
CDP Screenshot Utility
Captures high-fidelity real browser screenshot of the web app at http://localhost:5173.
"""

import sys
import json
import base64
import asyncio
import urllib.request
import subprocess
import time
import os

TARGET_URL = "http://127.0.0.1:5173"
OUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "d:/AI_agent_space/gemini/current_screen.png"

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
        raise RuntimeError("Neither Chrome nor Edge was found")
    
    cmd = [
        browser,
        "--headless=new",
        "--remote-debugging-port=9222",
        "--window-size=1920,1080",
        "--disable-gpu",
        "--no-sandbox",
        TARGET_URL
    ]
    proc = subprocess.Popen(cmd)
    return proc

async def capture_cdp():
    import websockets
    # Wait for debug port
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
        raise RuntimeError("Could not connect to Chrome debugging port 9222")

    async with websockets.connect(ws_url) as ws:
        msg_counter = 100

        async def send_cmd(method, params=None):
            nonlocal msg_counter
            msg_counter += 1
            cid = msg_counter
            req = {'id': cid, 'method': method}
            if params:
                req['params'] = params
            await ws.send(json.dumps(req))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get('id') == cid:
                    return msg

        size_env = os.environ.get("CDP_SIZE")
        if size_env:
            w, h = [int(v) for v in size_env.split(",")]
            await send_cmd('Emulation.setDeviceMetricsOverride', {
                'width': w, 'height': h, 'deviceScaleFactor': 1, 'mobile': False
            })

        # Wait 3.5 seconds for React, Klinecharts, and Binance WS to render fully
        await asyncio.sleep(3.5)
        
        eval_script = os.environ.get("CDP_EVAL")
        if eval_script:
            ev_resp = await send_cmd('Runtime.evaluate', {
                'expression': eval_script, 'returnByValue': True, 'awaitPromise': True
            })
            val = ev_resp.get('result', {}).get('result', {}).get('value')
            if val is not None:
                print("CDP_EVAL_RESULT:", json.dumps(val, ensure_ascii=False))
            await asyncio.sleep(float(os.environ.get("CDP_WAIT", "1.0")))

        mouse = os.environ.get("CDP_MOUSE")
        if mouse:
            mx, my = [float(v) for v in mouse.split(",")]
            for step in range(3):
                await send_cmd('Input.dispatchMouseEvent', {
                    'type': 'mouseMoved', 'x': mx + step, 'y': my + step
                })
                await asyncio.sleep(0.3)

        resp = await send_cmd('Page.captureScreenshot', {'format': 'png'})
        img_b64 = resp['result']['data']
        with open(OUT_FILE, 'wb') as f:
            f.write(base64.b64decode(img_b64))
        print(f"CAPTURED: {OUT_FILE} ({os.path.getsize(OUT_FILE)} bytes)")

def main():
    proc = launch_chrome()
    try:
        asyncio.run(capture_cdp())
    finally:
        try:
            proc.terminate()
            proc.kill()
        except Exception:
            pass

if __name__ == "__main__":
    main()
