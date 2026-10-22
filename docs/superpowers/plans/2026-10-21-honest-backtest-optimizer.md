# Honest backtest and optimizer implementation plan

**Goal:** Keep historical backtest and paper simulation financially comparable, add chronological walk-forward plus an untouched final holdout, and expose one evidence-aware report while preserving legacy API fields.

**Constraints:** No synthetic feed values; historical L2 remains unavailable. Never inspect the outer holdout while selecting parameters. Mark evidence insufficient below 100 evaluated candles or 20 closed trades; do not invent metric values. Preserve legacy routes/keys and unrelated working-tree edits. Run `scripts/check.ps1` before each commit.

## Tasks

1. **Execution-cost and indicator provenance truth** — inspect current stop-fill accounting; add regression tests for the `gross - fees - slippage` invariant and for missing OI never being synthesized or accepted by an OI filter. Make the smallest shared-policy correction across backtest/paper execution without changing unrelated live-runner edits. Run focused tests and the full quality gate, then commit this isolated change.
2. **Walk-forward and final holdout evidence** — add tests for three chronological expanding folds, outer holdout isolation, and `insufficient_evidence` at either threshold. Implement deterministic fold evaluation and candidate selection using development data only; assess the selected candidate on the final holdout once. Run focused tests and the full gate, then commit.
3. **Versioned common report and API contract** — add tests asserting the same normalized metric/evidence report on run and optimize responses while preserving existing response fields. Include data coverage/source and execution-cost details, and ensure unavailable-feed strategies fail explicitly. Run focused tests and full gate, update `AI_HANDOFF.md`, then commit.

**Review focus:** Chronology/leakage, fee and slippage double counting, OI data provenance, null-vs-zero evidence semantics, deterministic tests, and only staging task-owned files/hunks.
