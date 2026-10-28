# Paper Autopilot Recovery Design

## Intent

The terminal must make its paper-trading state truthful and usable: AI/selection produces a reviewed configuration, a valid preflight starts only paper runners, and the UI distinguishes an active run from persisted historical candidates. Active and closed paper positions must remain visible in the existing chart and trade-history views through their existing API contracts.

## Goals

- Keep real exchange order submission impossible.
- Replace ambiguous `STOPPED` candidate rows with an actionable, accurate recovery state.
- Provide one existing-architecture action that runs AI selection, preflight, and starts only non-blocked paper pairs.
- Keep risk gates authoritative; a BLOCK verdict is never auto-started.
- Preserve shared-account accounting, durable trade history, and chart position overlays.

## Non-goals

- No forced entries, fabricated fills, or bypassed TP/SL/risk checks.
- No automatic resumption of a paper run after backend restart without an explicit user action.
- No live order route, wallet/history reset, or large UI redesign.

## Chosen approach

Use the existing `overnight_pilot` manager and `auto-select` strategy selection. Add a recovery-aware run-state contract and an explicit paper-only autopilot start path that: selects strategies, preflights the resulting configs, excludes only BLOCK verdicts, then starts the exact allowed configuration. The UI consumes that contract to explain stopped persisted candidates and to expose the existing chart overlay state rather than inventing a second runner.

## Constraints

- Backend `8000`, frontend `7100`, SQLite `data/signals.db`.
- One logical paper runner per selected pair sharing one virtual account.
- All trading remains demo/paper only; no real orders.
- Existing risk limits and historical results are preserved.

## Acceptance evidence

1. A stopped persisted pilot is labelled as recoverable, not a live active run.
2. The autopilot start operation only starts pairs that passed exact preflight and reports excluded BLOCK pairs.
3. A running status exposes `paper.is_running`, shared-account identity, and open positions for the existing chart overlay.
4. Tests demonstrate the stopped/recoverable contract and blocked-pair exclusion; existing TP/SL and durable-history tests stay green.
