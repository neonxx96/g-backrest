"""Browser evidence for the Truth-first BTCUSDT MVP."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:5173"
OUT = ROOT / "artifacts" / "truth-first-btc-mvp.png"


def main() -> None:
    OUT.parent.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_selector('[data-testid="chart-container"]', timeout=45000)
        page.keyboard.press("b")
        page.wait_for_selector('[data-testid="btn-run-single"]', timeout=10000)
        page.locator('[data-testid="btn-run-single"]').click()
        page.wait_for_selector('[data-testid="research-verdict"]', timeout=60000)
        page.locator('[data-testid="btn-toggle-signals"]').click()
        for title in ("Тепловая карта плотностей стакана во времени", "Маркеры ликвидаций Binance Futures"):
            page.get_by_title(title).click()
        rows = page.locator('[data-testid="backtest-trade-row"]')
        if rows.count():
            rows.first.click()
        page.screenshot(path=str(OUT), full_page=True)
        print(f"UI evidence captured: {OUT}")
        print("Verdict:", page.locator('[data-testid="research-verdict"]').inner_text())
        browser.close()


if __name__ == "__main__":
    main()
