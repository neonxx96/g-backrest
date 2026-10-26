# Truth-first BTCUSDT MVP

## Goal

Make the BTCUSDT research flow honest and usable end-to-end: History Backtest,
Walk-Forward/Regime Check, and Paper Trading must show their data provenance,
structured entry reasons, exit reasons, and a deterministic readiness verdict.

## Non-negotiable constraints

- No real orders, exchange secrets, random market data, or changes to
  `backend/app/services/execution_simulator.py`.
- Backend stays on port 8000, frontend stays on port 5173, and SQLite remains
  `data/signals.db`.
- A missing historical L2/footprint dataset is represented as `No data`, never
  as a calculated density or placeholder number.
- `UnifiedTradeSignal` is the input contract for every new Paper entry.

## Data contract

Backtest trades expose `entry_reason: list[str]` and `exit_reason: str`.
`data_feed_context` declares a source, as-of time, and L2 availability.
The front end displays values only when the corresponding source is present;
otherwise it renders `No data` and the Verdict reports `L2 History: No data
(OHLCV only)`.

## Research workflow

1. Run History Backtest for BTCUSDT at 5m or 15m.
2. Read the adaptive regime and Walk-Forward result.
3. Compute a deterministic verdict: block for negative Net PnL or
   `TOXIC_VOLATILITY`; warn for unavailable L2 history or weak quality;
   otherwise allow Live Paper.
4. Send only an explicitly chosen signal into Paper Trading through
   `UnifiedTradeSignal`.

## UI boundaries

Chart controls only toggle layers whose data exists. The trade inspector shows
entry/exit reasons, Gross/Net PnL, fees, Fee Drag, MFE/MAE, and regime.
Clicking a BacktestPanel trade dispatches a symbol/time focus event consumed by
Chart without synthetic candles or marker positions.

## Verification

New unit/API tests cover reason separation, manual-paper contract conversion,
data-availability/Verdict rules, and deterministic signal IDs. Full project
quality gate and localhost UI smoke remain mandatory.
