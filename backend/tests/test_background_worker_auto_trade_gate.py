"""P0 (night test 23-24.10): quant-цикл background worker не должен спамить
общий paper-кошелёк ордерами по всему фокус-листу.

Баг: при старте раннера worker выставил 685 ENTRY-ордеров (50 попыток × 13
символов). Гейт: auto-trade ВЫКЛ по умолчанию; при явном флаге — только
символ live-раннера.
"""
import os

from backend.app.engine import background_worker
from backend.app.services.live_paper_runner import live_paper_runner


def test_gate_disabled_by_default(monkeypatch):
    monkeypatch.delenv("BACKGROUND_WORKER_AUTO_TRADE", raising=False)
    assert background_worker.background_auto_trade_allowed("BTCUSDT") is False
    assert background_worker.background_auto_trade_allowed("ETHUSDT") is False


def test_gate_disabled_with_false_value(monkeypatch):
    monkeypatch.setenv("BACKGROUND_WORKER_AUTO_TRADE", "false")
    assert background_worker.background_auto_trade_allowed("BTCUSDT") is False


def test_gate_restricted_to_runner_symbol(monkeypatch):
    monkeypatch.setenv("BACKGROUND_WORKER_AUTO_TRADE", "true")
    saved = live_paper_runner.symbol
    live_paper_runner.symbol = "ETHUSDT"
    try:
        assert background_worker.background_auto_trade_allowed("ETHUSDT") is True
        assert background_worker.background_auto_trade_allowed("ethusdt") is True
        assert background_worker.background_auto_trade_allowed("BTCUSDT") is False
        assert background_worker.background_auto_trade_allowed("SOLUSDT") is False
    finally:
        live_paper_runner.symbol = saved


def test_gate_off_when_runner_symbol_missing(monkeypatch):
    monkeypatch.setenv("BACKGROUND_WORKER_AUTO_TRADE", "true")
    saved = live_paper_runner.symbol
    live_paper_runner.symbol = None
    try:
        assert background_worker.background_auto_trade_allowed("BTCUSDT") is False
    finally:
        live_paper_runner.symbol = saved
