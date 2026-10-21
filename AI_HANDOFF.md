# AI Handoff & Project State
## Latest continuation — Pilot Wizard (2026-10-21)

- Entry point: Backtest panel → «Мастер Night Pilot». Four steps: configuration, checks, comparison, launch/report. Draft settings persist; server runtime is always re-read after reload, never restored as running from local storage.
- Per-symbol strategy/timeframe, risk, SL/TP, leverage and duration (1–12 hours); total virtual budget is divided between independent wallets with cent-exact conservation, not multiplied by coin count. No shared cross-margin portfolio is implied.
- Preflight is invalidated by edits or optimizer application. Late requests cannot approve changed configurations or overwrite newer start results. Direct optimizer reports separate holdout evidence from development results; insufficient evidence is not profitability. Only supported parameters transfer, followed by mandatory recheck.
- Dashboard separates realized/floating PnL, balance/equity, margin, fees, positions, closed trades and run-scoped decisions. Missing fields from older runtimes remain unavailable, not zero. Stopping a runner does not liquidate open paper positions.
- Actual accumulated feed failures traced to Binance REST DNS errors. Runner retries now back off to 60s and validate snapshot timestamps against receipt time. MiniTicker detects silent sockets, reconnects with bounded delay and starts without fabricated seeded quotes.
- Production bundle splits React, chart, Dockview and research UI; Wizard is lazy loaded. Largest JS chunk is approximately 484 kB (previous main approximately 1.42 MB), without raising warning limits.
- Verification: browser contract test `scripts/test_pilot_wizard_ui.py --build` passes configuration → preflight → optimize → apply → recheck → start → reload at narrow width with no page errors. Paper mutation responses in this test are intercepted: it does not prove live profitability or start real sessions.
- Runtime 8002 was NOT stopped/restarted. New Python fixes require a planned restart after the existing pilot; old runtime lacks run IDs. Foreign dirty changes remain outside these commits. Do not claim the active pilot has loaded new code.

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

## 6. Slice 2 — Honest Backtest & Optimizer

- Backtest and paper now use the same configurable maker/taker percentage convention; paper config percentages are converted to fractional rates once. Default taker fee is aligned at 0.05%.
- Missing historical OI remains unavailable (`NaN` with provenance) instead of being synthesized from volume/delta. An enabled OI filter rejects missing data, and the backtest API fails early when the selected history has no OI.
- The optimizer selects parameters using three chronological expanding development validation windows and reserves the final chronological holdout from candidate scoring. Holdout metrics are only published as validated when the holdout has at least 100 candles and 20 closed trades; otherwise `evidence_status=insufficient_evidence` and holdout metrics are null.
- Optimizer passes common risk, fee/slippage, ATR/CVD/OI/RSI, trailing, breakeven and partial-TP settings into each fold and holdout evaluation. Run and optimize endpoints expose a versioned `report` envelope while retaining legacy fields.
- `scripts/check.ps1` passed after the fee/OI/walk-forward changes: backend tests, frontend unit/build, critical component smoke, blocking Playwright UI smoke and live Binance WS check. Focused backtest/optimizer/report tests also pass. These checks establish contract/math consistency, not profitability; the outer holdout and paper results are not evidence of future returns.
