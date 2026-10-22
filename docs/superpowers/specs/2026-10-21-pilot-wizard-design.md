# Night Pilot — Slices 3–4

Approved brief: one workflow Configuration → Check → Compare → Launch/report, using the existing backtest, forecast, optimizer and paper runner. Virtual funds only. Runtime processes remain running during development.

## Contract

- Persist editable configurations and presentation choices only. Server snapshots, readiness and running flags are fetched after reload. A failed refresh marks the displayed snapshot as stale.
- Capital is allocated to independent symbol wallets in integer cents. Their sum is the displayed total; risk is calculated per allocated wallet. No shared-margin claim. One strategy per symbol, up to five symbols, 1–12 hours in the new workflow.
- Preflight sends the exact full configuration list. Any edit invalidates its approval. Late responses cannot approve a newer draft. Start sends the same list and server preflight_id; only server status confirms start/stop. No automatic mutation retries.
- Existing report schema_version=1 is authoritative. Historical descriptive metrics, development/walk-forward and holdout results remain separate. Null metrics stay unavailable; insufficient_evidence is explicit (100 holdout candles and 20 closed trades). Forecast is conditional, not a promised price or profit.
- Events are scoped by run_id, symbol and source. Show measured checks, rejection counts, entry/management/exit reasons, fees and net PnL. Closed and floating results remain separate.
- Numerical optimization applies only supported parameters to the next draft and requires a new preflight. AI suggestions do not approve or launch a run.

## Frontend boundaries

`features/pilot/model.js`: validation, allocation, canonical keys, report adapters.
`features/pilot/store.js`: Zustand vanilla store, persistence, race-safe commands.
`features/pilot/api.js`: HTTP contracts, timeout/error handling.
`features/pilot/PilotWorkspace.jsx`: step navigation and lifecycle subscription.
Small configuration, results and telemetry components consume the store/adapters. Integrate through BacktestPanel without overwriting existing Antigravity changes in OvernightPilotPanel. Container queries and min-width:0 replace fixed-width layout assumptions; scrolling stays inside the panel.

## Reliability and delivery

Investigate feed errors from actual code/logs before changing recovery. Cover silent sockets, reconnect delay/cancellation, and stale-entry blocking where implicated. Preserve genuine error counters. Split optional UI with React.lazy/Suspense and measured Vite chunks; do not raise warning thresholds to hide size.

Tests: state transitions, capital conservation, invalid inputs, late responses, failed/partial starts, restored/disconnected status, report nulls and scoped events. Browser acceptance: configure BTC/ETH/SOL, check/compare/apply/recheck, launch via intercepted test API, reload, narrow container, no console errors. Run full scripts/check.ps1 before each commit. A short paper test does not establish future profitability.

References: https://react.dev/reference/react/lazy ; https://zustand.docs.pmnd.rs/reference/middlewares/persist ; https://dockview.dev/docs/overview/quickstart/ ; https://tailwindcss.com/docs/responsive-design ; https://vite.dev/guide/build
