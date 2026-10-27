# HANDOFF.md — Active State & Next Agent Onboarding Snapshot

> **PROTOCOL:** This file represents the canonical real-time handoff snapshot. The active agent must read this file upon start and update it before completing their shift.

---

## 1. Environment & Repository State Snapshot

- **Active Branch:** `chore/codex-handoff`
- **Base Commit:** `cb2705d` (`docs: update HANDOFF.md with completed Stage D milestones`)
- **Working Tree:** Clean (all temporary screenshots and logs organized into `artifacts/screenshots` and `logs/`).
- **Quality Gate:** `🎉 ALL QUALITY CHECKS PASSED. READY TO COMMIT.`
  - Host Pytest: 616 passed.
  - Docker Linux Pytest: 616 passed (`docker exec signalscript_backend pytest backend/tests`).
  - Frontend Build: Vite build successful, 75 pilot/math unit tests passed.
  - Design Linter: 1031 violations across 73 files (0 regressions against ratchet baseline).
  - Critical Parts Smoke: 8/8 passed (DOM, Chart, Scanner, Recorder, Journal, Presets, Settings, Quarantine).
  - Playwright UI Smoke: 16 visible canvases match `rect * dpr`, 0 console errors, topbar fits 1366px, symbol switch works.
  - Live WebSocket: Binance WebSocket connected and receiving frames.
- **Running Services:**
  - Docker stack: `signalscript_backend` on `http://127.0.0.1:8000`, `signalscript_frontend` on `http://127.0.0.1:7100`.
  - Paper Marathon: Running on 7 coins (`ZECUSDT` SELECT, `BNBUSDT`, `ENAUSDT`, `WLDUSDT`, `UNIUSDT`, `TIAUSDT`, `TRXUSDT` EXPLORE) on $1,000 capital with 0.35% / 0.15% risk.

---

## 2. Invariants & Critical Operating Rules for the Incoming Agent

1. **Strictly Advisory/Paper Trading:** No real order execution logic is present or permitted.
2. **Strictly Sequential Agent Work:** Never run multiple agents simultaneously.
3. **Mandatory Quality Gate:** Always run `powershell -ExecutionPolicy Bypass -File scripts/check.ps1` before any commit.
4. **Design System Token Discipline:** Do not introduce raw Tailwind colors (`bg-gray-800`). Use tokens from `docs/design/DESIGN_GUIDE.md` and keep violations $\le 1031$.
5. **Local `backend.log` File Lock:** While the local Python backend is active, `backend.log` is locked by the Windows OS. Do not attempt to move or rename it.

---

## 3. Recommended First Steps for Codex (Immediate Priorities from ROADMAP)

1. **Step 1: Fill in `docs/AGENT_ROUTING.md`**
   - Populate the model routing table in `docs/AGENT_ROUTING.md` based on your available OpenAI / Codex models (e.g. `o3-mini`, `gpt-4o`, `gpt-4.5`) and reasoning effort levels.
2. **Step 2: Task `NEXT-01` (Design System Violation Elimination)**
   - Continue eliminating the remaining 1031 design system violations in the 73 files and ratchet down `design/lint-baseline.json`. Use `scripts/codemod_design_tokens.mjs` or targeted component updates.
3. **Step 3: Task `NEXT-02` (A/B Performance Verification)**
   - Run a comparative backtest on the historical Parquet lake slice comparing v1.0 (raw win rate) vs v2.0 (quantum risk engine & expectancy).
