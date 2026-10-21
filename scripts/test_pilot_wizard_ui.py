"""Browser contract test. Pilot mutations are intercepted; existing runners are untouched."""
import json
import sys
import mimetypes
from pathlib import Path
from playwright.sync_api import sync_playwright, expect


def main():
    config = dict(symbol="BTCUSDT", strategy_type="confluence_ema", timeframe="15m", days=14,
                  initial_capital=1000, risk_per_trade_pct=.5, stop_loss_pct=.8, take_profit_pct=2.2,
                  leverage=2, duration_hours=1, volume_multiplier=1.25, min_density_usd=150000,
                  use_atr_filter=True, use_cvd_filter=True, use_rsi_filter=True, use_multi_tp=True,
                  use_trailing=True, trailing_pct=.5, trailing_activation_pct=.5, tp1_rr_ratio=1.5, tp2_rr_ratio=2.8)
    defaults = [dict(config, symbol=s) for s in ("BTCUSDT", "ETHUSDT", "SOLUSDT")]
    status = {"sessions": {}}
    starts = []
    report = {"schema_version": 1, "status": "descriptive_backtest", "metrics": {"net_pnl_usd": 10, "win_rate_pct": 55, "profit_factor": 1.2, "max_drawdown_pct": 3}, "sample": {"candles": 1000, "closed_trades": 25}}

    def handle(route):
        nonlocal status
        url = route.request.url
        if "/defaults" in url:
            result = {"sessions": defaults}
        elif "/preflight" in url:
            configs = route.request.post_data_json
            status = {"preflight_id": "test-run", "sessions": {c["symbol"]: {"symbol": c["symbol"], "run_id": "test-run", "config": c, "preflight_valid": True, "forecast": {"data_status": "connected", "unified_signal": {"direction": "NO_TRADE", "reason": "Объём 0.8 ниже порога 1.25"}}, "backtest": {"report": report}, "paper": None} for c in configs}}
            result = status
        elif "/start" in url:
            starts.append(route.request.post_data_json)
            for session in status["sessions"].values():
                session["paper"] = {"is_running": True, "data_status": "connected", "initial_capital": session["config"]["initial_capital"], "current_equity": session["config"]["initial_capital"], "last_decision_reason": "NO_TRADE: объём 0.8 < 1.25", "closed_trades": []}
            status["preflight_id"] = None
            result = status
        elif "/events" in url:
            result = {"events": []}
        elif "/optimize" in url:
            result = {"report": {**report, "status": "insufficient_evidence", "metrics": None, "sample": {"candles": 120, "closed_trades": 3}}, "meta": {"best_params": {"stop_loss_pct": .9, "take_profit_pct": 2.4}}, "before_optimization": report["metrics"], "after_optimization": report["metrics"]}
        else:
            result = status
        route.fulfill(status=200, content_type="application/json", body=json.dumps(result))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        if "--build" in sys.argv:
            # Exercise built chunks without starting or replacing any local server.
            from urllib.parse import urlsplit
            dist = (Path(__file__).resolve().parents[1] / "frontend/dist").resolve()

            def serve_build(route):
                path = urlsplit(route.request.url).path
                if path.startswith("/api/"):
                    return route.fallback()
                target = (dist / (path.lstrip("/") or "index.html")).resolve()
                if not target.is_relative_to(dist) or not target.is_file():
                    return route.fulfill(status=404, body="Not found")
                content_type = "text/javascript" if target.suffix == ".js" else mimetypes.guess_type(target.name)[0] or "application/octet-stream"
                route.fulfill(status=200, content_type=content_type, body=target.read_bytes())

            page.route("http://127.0.0.1:5173/**", serve_build)
        errors = []
        page.on("pageerror", lambda err: (errors.append(str(err)), print(str(err), flush=True)))
        page.route("**/api/overnight-pilot/**", handle)
        page.route("**/api/backtest/optimize", handle)
        page.goto("http://127.0.0.1:5173/")
        page.evaluate("localStorage.setItem('signalscript_show_backtest', 'true')")
        page.reload()
        page.get_by_test_id("btn-open-overnight-pilot").click()
        dialog = page.get_by_role("dialog", name="Настройка Night Pilot")
        expect(dialog.get_by_text("$1000.00", exact=True)).to_be_visible(timeout=15000)
        dialog.get_by_role("button", name="Проверить историю и прогноз").click()
        expect(dialog.get_by_text("Объём 0.8 ниже порога 1.25", exact=True).first).to_be_visible(timeout=15000)
        dialog.get_by_role("button", name="Подобрать параметры").first.click()
        expect(dialog.get_by_text("Недостаточно OOS-данных", exact=False).first).to_be_visible()
        dialog.get_by_role("button", name="Перенести параметры в новый черновик").click()
        expect(dialog.get_by_test_id("pilot-start")).to_be_disabled()
        dialog.get_by_role("button", name="Проверить историю и прогноз").click()
        expect(dialog.get_by_test_id("pilot-start")).to_be_enabled()
        dialog.get_by_test_id("pilot-start").click()
        dialog.get_by_test_id("pilot-start").click()
        expect(dialog.get_by_role("button", name="Остановить все paper-сессии")).to_be_visible()
        assert len(starts) == 1
        assert sum(round(c["initial_capital"] * 100) for c in starts[0]) == 100000
        assert starts[0][0]["stop_loss_pct"] == .9
        page.reload()
        page.get_by_test_id("btn-open-overnight-pilot").click()
        expect(dialog.get_by_role("button", name="Остановить все paper-сессии")).to_be_visible()
        page.set_viewport_size({"width": 420, "height": 780})
        dialog.get_by_role("button", name="1. Конфигурация").click()
        overflow = page.get_by_test_id("pilot-workspace").evaluate("el => el.scrollWidth > el.clientWidth + 1")
        assert not overflow, "Wizard overflows its container"
        page.screenshot(path=str(Path(".pytest-temp/pilot-wizard-narrow.png")))
        assert not errors, errors
        browser.close()
    print("PASS: configuration -> preflight -> OOS -> apply -> recheck -> start -> reload; capital conserved; narrow panel; no page errors")


if __name__ == "__main__":
    main()
