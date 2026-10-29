# Paper Trading Lab — implementation plan

> Execute sequentially on `dev`. Each increment is independently testable and
> merged into `main` only after its full quality gate is green.

## Phase 0 — foundation (complete)

- [x] Establish `main` as stable and `dev` as the development line.
- [x] Add `docs/SYSTEM_WORKING_MAP.md` and enforce it in documentation checks.
- [x] Remove tracked diagnostic dumps and keep runtime artifacts ignored.

## Phase 1 — strategy catalogue (current)

**Goal:** Replace scattered strategy name lists with one validated source of
truth, without changing active paper-run behavior.

1. Write failing backend tests for catalogue IDs, metadata, compatibility and
   legacy-list parity.
2. Add `strategy_catalog.py` with immutable descriptors for the existing
   strategy implementations; do not add a speculative strategy.
3. Make `overnight_pilot.py` and `pair_selector.py` read the catalogue while
   retaining current defaults/behaviour.
4. Expose read-only catalogue metadata through the pilot API, then render it in
   the strategy-selection UI.
5. Update `SYSTEM_WORKING_MAP.md`, `ARCHITECTURE.md`, `CODEMAP.md` and focused
   tests; run the full gate before committing.

**Done when:** existing strategy selection remains compatible, the UI can name
and explain every selectable strategy, and no active runner is restarted.

## Phase 2 — challengers during active paper trading

**Goal:** evaluate alternate profiles while an incumbent runs, with no state
interference.

1. Add experiment entities/ledger and schema migration preserving old data.
2. Add deduplicated challenger submit/status/result endpoints.
3. Run only read-only closed-candle backtests/OOS evaluation from challenger
   jobs; reject invalid/stale data with an explicit reason.
4. Add tests proving an active `LivePaperRunner` and shared session are unchanged.
5. Add UI queue/results and `KEEP/WATCH/CANDIDATE/REJECT` recommendations.

## Phase 3 — operator-controlled shared paper runs and curated universe

**Goal:** manual start/stop replaces mandatory duration for a curated 10–20-pair
universe of liquid, volatile, actively trading USDT-M contracts.

1. Make duration optional in config/API with an explicit stop policy.
2. Preserve shared-wallet risk accounting and reconcile existing persisted
   sessions before any start.
3. Add a universe selector that ranks exchange-valid pairs by current liquidity,
   activity and volatility, then caps the selected set at 10–20; include
   preflight capacity/error/exclusion reports.
4. Add a structured run report and correlation IDs for every pair.
5. Operationally validate the 10–20 pair set; no automatic expansion beyond
   that approved cap.

## Phase 4 — user-facing paper trade policy

**Goal:** safe, understandable risk, scaling and AI-management configuration.

1. Versioned `PaperTradePolicy` schema and compatibility migration.
2. Map existing risk engine controls into policy; validate cross-field limits.
3. Enable scale-in only behind explicit limits and regression tests.
4. Add AI `off/advisory/bounded` contract with deterministic vetoes authoritative.
5. Build a compact settings UI showing effective risk, not raw implementation
   flags.

## Phase 5 — configurable historical admission

**Goal:** replace bypasses with transparent strict/observation/disabled policy.

1. Separate technical hard vetoes from research-quality thresholds.
2. Add policy schema, audited reason codes and migration for legacy requests.
3. Replace `start-without-verdict` with policy-controlled start after tests prove
   hard risk/data/exchange gates cannot be bypassed.
4. Add UI warnings, confirmation and per-pair inclusion/exclusion table.

## Phase 6 — soak, evidence and iteration

**Goal:** collect trustworthy paper data, triage issues and promote only evidence
backed improvements.

1. Run a bounded 10–20-pair diagnostic profile; inspect reports/errors.
2. Fix observed defects as small, tested commits.
3. Refresh the curated 10–20-pair universe only when data-quality and error
   reports justify replacing an existing pair.
4. Periodically review challenger evidence; operator approves any promotion.

## Guardrails for every phase

- No real exchange order path, secrets or paid AI calls.
- Never overlap agents or modify active runtime state accidentally.
- Test first for behavioral changes; use focused checks while implementing.
- Run `powershell -ExecutionPolicy Bypass -File scripts/check.ps1` to a green
  exit before every commit.
