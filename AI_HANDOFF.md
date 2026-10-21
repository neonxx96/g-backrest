# AI Handoff & Project State
Last Updated: 2026-10-21 00:05:26 MSK
Phase: 3 - Production Paper Trading, Fee Drag Optimization & OpenRouter Model Hub

## 1. Current Architecture State

Backend работает на динамических портах (старый 8000, новый 8002).

Учетный инвариант PnL строго подтвержден (145/145 тестов). Комиссии (Maker 0.02% / Taker 0.05%) и Slippage считаются корректно.

Механики выхода (Dynamic Breakeven, Trailing Stop, Limit TP) работают без ошибок.

## 2. Identified Blockers (Solved)

Проблема сплошного NO_ENTRY была вызвана слишком узким окном RSI (40-42) и Fee Drag (съедание профита комиссиями при скальп-целях).

## 3. Next Immediate Actions (For next AI Agent)

Core: Внедрить пресет production_robust в overnight_pilot.py (vol_mult = 1.25, RSI 42-58, R:R >= 2.75:1 с TP >= 2.2% и SL 0.75-0.80%).

Scripts: Обновить scripts/night-pilot.ps1 для запуска пресета production_robust на порту 8002 для BTC, ETH, SOL.

Logging: Добавить вывод WinRate, Net PnL по монетам и алерты (Warning Sentinel) при блокировке входов.

## 4. Slice 1 — Paper Telemetry & Data Truth (verified 2026-10-21)

- `backend/data/deep_intent_log.jsonl` is append-only and records versioned events with `event_id`, UTC timestamp, `source`, `run_id`, config fingerprint, symbol/strategy/timeframe, reason/checks/observations and optional `trade_id`. Legacy entries remain explicitly unscoped; they are never attributed to a new run.
- Paper lifecycle and rejection events share run/config identity. Closed paper events include `gross_pnl`, `total_fees` and `net_pnl`; tests verify `net_pnl == gross_pnl - total_fees` against the closed simulator trade. Slippage is not deducted a second time.
- Runner status distinguishes finalized-candle evaluations, blocked evaluations, per-filter rejection totals, feed/indicator freshness, consecutive/total data errors and telemetry health. Invalid/stale feed observations do not inflate strategy rejection counts; stale data blocks new entries and does not synthesize prices for position management.
- `GET /api/overnight-pilot/status` is read-only. Controlled lifecycle/background paths own snapshots. `GET /api/overnight-pilot/events` supports `run_id`, `symbol`, `source`, `event_type`, and `limit=1..500`; source totals for Backtest, Forecast, Paper, and System remain separate.
- Verification: targeted telemetry/feed/provider tests and the full `scripts/check.ps1` gate passed (see current task report). This verifies software contracts, **not strategy profitability**. Runtime 8002 was not restarted or stopped; manual overnight exchange-feed continuity and UI presentation of event history remain outside this backend slice.

## 5. OpenRouter Model Hub

- Добавлен каталог моделей с шестичасовым дисковым кешем и флагом `is_free`.
- Настройки AI сохраняются в `backend/data/ai_config.json`; UI находится в Settings → AI Engine.
- Runtime 8002 не перезапускается во время ночного пилота: новые API будут доступны после следующего штатного перезапуска backend.
