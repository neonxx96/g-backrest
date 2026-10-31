"""Probe: load app, capture console, inspect dockview state after hydrate."""
import asyncio
import json

from playwright.async_api import async_playwright

CONSOLE_KEYWORDS = ("dockview", "hydrate", "salvage", "layout", "sanitize", "rebuild")


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--no-sandbox"])
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})
        logs = []
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
        await page.goto("http://127.0.0.1:7100", wait_until="networkidle")
        await page.wait_for_timeout(4000)

        state = await page.evaluate(
            """() => {
              const api = window.__dockviewApi;
              const groups = Array.from(document.querySelectorAll('.dv-groupview'))
                .map(e => Math.round(e.getBoundingClientRect().width));
              const sashes = {
                total: document.querySelectorAll('.dv-sash').length,
                enabled: document.querySelectorAll('.dv-sash:not(.dv-disabled)').length,
              };
              let layoutInfo = null;
              if (api) {
                try {
                  const json = api.toJSON();
                  const walk = (n, acc) => {
                    if (!n) return acc;
                    if (n.size === null) acc.nullSize += 1;
                    acc.nodes += 1;
                    (n.views || []).forEach(v => acc.views.push(v.id));
                    (n.children || []).forEach(c => walk(c, acc));
                    return acc;
                  };
                  layoutInfo = walk(json.grid.root, {nullSize: 0, nodes: 0, views: []});
                  layoutInfo.gridWH = [json.grid.width, json.grid.height];
                } catch (e) {
                  layoutInfo = {error: String(e)};
                }
              }
              return {groups, sashes, layoutInfo, hasApi: !!api};
            }"""
        )
        print("STATE:", json.dumps(state, ensure_ascii=False))
        print("--- console (filtered) ---")
        for line in logs:
            if any(k.lower() in line.lower() for k in CONSOLE_KEYWORDS):
                print(line[:500])
        print("--- all warns/errors ---")
        for line in logs:
            if line.startswith("[warn") or line.startswith("[error") or line.startswith("[pageerror"):
                print(line[:500])
        await browser.close()


asyncio.run(main())
