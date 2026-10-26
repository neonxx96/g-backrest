from playwright.sync_api import sync_playwright
import time
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1600, 'height': 950})
        page = context.new_page()

        print("[*] Navigating to http://localhost:7100 ...")
        page.goto('http://localhost:7100', wait_until='domcontentloaded', timeout=30000)

        # Wait until "По парам (20)" button appears
        print("[*] Waiting for 'По парам (20)' tab...")
        page.wait_for_selector('button:has-text("По парам (20)")', timeout=20000)
        print("[+] 'По парам (20)' tab is ready!")

        # Click the tab
        page.locator('button:has-text("По парам (20)")').click()
        time.sleep(2)

        out_path = r"C:\Users\danil\.gemini\antigravity\brain\72a830ab-8fb5-4fb2-8267-c1a8a4795da5\terminal_unified_marathon_running.png"
        page.screenshot(path=out_path, full_page=False)
        print(f"[+] Screenshot captured to: {out_path}")
        browser.close()

if __name__ == '__main__':
    main()
