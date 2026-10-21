# Pilot Wizard implementation plan

Spec: ../specs/2026-10-21-pilot-wizard-design.md. Execute inline; user explicitly authorized implementation and routine decisions.

1. Add tested pure model, API client and persisted Zustand draft store. Prove capital conservation, invalid configuration rejection, preflight invalidation/races, status restoration and evidence-aware report mapping. Commit after full gate.
2. Add responsive Wizard/configuration/results/decision components. Integrate through clean BacktestPanel entry points, preserving legacy components and foreign diffs. Add browser contract exercise for check → optimize → apply → recheck → start, reload and narrow panels. Gate and commit.
3. Trace actual stale feed behavior. Add regression for confirmed cause, implement bounded recovery and preserve stale-data protection. Gate and commit.
4. Lazy-load optional UI, split measured vendor chunks with Vite's installed Rolldown API. Build, browser smoke, gate and commit.
5. Review scoped diffs, document current implementation and deployment limitations in AI_HANDOFF.md. Do not restart active pilot.

Review focus: old responses approving new drafts; duplicate capital per symbol; absent metrics becoming zero; failed network mutation displaying success; partial sessions and backend outage masquerading as all-running.

Progress: implementation started from b6d09f1. Existing dirty files recorded by git status; commits include only new feature files and scoped changes in initially clean files. Baseline full check.ps1 passed in the preceding audit with localhost permission.
