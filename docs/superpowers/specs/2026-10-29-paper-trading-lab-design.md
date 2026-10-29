# Paper Trading Lab — design

## Purpose

Turn the existing terminal into a **paper-only research and execution lab**. A
single virtual account can run a selected universe of futures pairs, evaluate
fixed strategy profiles in parallel, and keep testing challenger profiles while
the incumbent profile is running. The outcome is observable evidence for later
improvement, not a promise of profit and never a real exchange order.

## Non-negotiable constraints

- The exchange integration remains public-data-only; no real order submission
  may be added.
- A shared paper account is the source of truth for equity, exposure and risk.
  Pair count must not multiply starting capital.
- Closed candles and a reproducible data window are required for every
  backtest, selection and promotion decision.
- Technical market-data validity and runtime risk limits remain hard vetoes.
  The requested relaxation applies only to the *historical research admission*
  policy and is always visible in the UI and persisted run metadata.
- A challenger never mutates or restarts an active runner. Promotion changes a
  future configuration only after the current position is flat or an operator
  explicitly approves a safe transition.

## Target operating model

```text
strategy catalogue -> candidate builder -> closed-candle backtest / OOS
                                        -> admission policy
                           incumbent -> paper runner -> shared account / journal
pair already running -> challenger job -----------------> experiment ledger
experiment ledger -> recommendation -> operator-approved future promotion
```

### 1. Versioned strategy catalogue

Create one backend-owned registry rather than scattered string lists. Every
strategy entry has a stable ID, version, supported timeframes, parameter schema,
data requirements, risk compatibility, defaults, and a human description. The
initial catalogue absorbs the existing proven implementations:

| Family | Existing strategy IDs |
| --- | --- |
| trend | `ema_trend`, `ema_trend_window`, `ema_pullback`, `confluence_ema` |
| order flow | `cvd_absorption`, `cluster_volume_bounce` |
| diagnostic | `diagnostics_lenient`, `naked_test` |

Only catalogue entries can be selected, backtested, or started. New strategies
are registered explicitly with tests; they are not invented by an AI response.

### 2. Incumbent and challenger separation

For each pair, the runner owns one incumbent `StrategyProfile`. A challenger is
a bounded, persisted evaluation job containing the strategy/profile version,
data window, data fingerprint, backtest/OOS metrics, verdict and recommendation.
It can be submitted while that pair is running because it does not write runner
state or the paper wallet. Duplicate jobs with the same pair/profile/window
fingerprint coalesce; materially different candidates may run independently.

Recommendations are `KEEP`, `WATCH`, `CANDIDATE`, or `REJECT`. They never
auto-replace a live strategy in the first release. This deliberately separates
research quality from execution safety.

### 3. Paper-run controls

Replace the mandatory fixed-duration workflow with a manual `Start` / `Stop`
control. A duration may be supplied as an optional safety timer, but absence
means *run until the operator presses Stop*; it is not an invisible 24-hour
timer. Start returns the exact applied profile, account ID, admission mode and
risk policy. Stop blocks new entries, continues deterministic management for
existing paper positions until the selected stop policy is resolved, and records
the reason.

Scale is a configuration profile, not a code fork: smoke (1–5 pairs), then a
curated production-like universe of **10–20** liquid, volatile and currently
active USDT-M pairs. The UI must surface activity/liquidity evidence,
rate/data-feed health, excluded pairs and error counts before start. The product
does not target a 50–200-pair universe unless a future, separately approved
requirement changes that limit.

### 4. User-facing trade policy

One versioned `PaperTradePolicy` groups controls users currently have to infer
from low-level fields:

- shared initial balance and per-trade/portfolio/directional risk limits;
- max positions, leverage ceiling, stop and take-profit style;
- optional scale-in (max layers, trigger distance, risk allocated to each layer,
  break-even rule); disabled by default;
- trailing and partial-exit controls;
- an **AI management mode** (`off`, `advisory`, `bounded`) where AI may only
  propose actions in advisory mode, and bounded mode must still pass the
  deterministic risk engine. AI never bypasses a stop, heat cap or kill switch.

The server validates and stores the applied policy with each session. UI labels
explain the effective limit rather than exposing unexplained flags.

### 5. Configurable historical admission

Replace the one-dimensional `BLOCK` shortcut with an explicit policy:

- `strict`: historical `BLOCK` prevents automatic paper start (current safe
  behavior);
- `observation`: a failed historical quality threshold can be included in a
  labelled diagnostic run after technical readiness and risk validation;
- `disabled`: skips only selected historical quality cut-offs, never exchange
  eligibility, data freshness, sizing, portfolio heat, circuit breaker, or
  emergency stop.

Each threshold (minimum trades, profit factor, net PnL, volatility warning) is
visible and configurable within conservative bounds. Server responses provide
machine-readable exclusions/reasons; the UI shows an inclusion/exclusion
summary before confirmation. The legacy `start-without-verdict` path is replaced
only when this policy is covered by migration and regression tests.

### 6. Observability and evidence

The terminal needs a durable experiment/run ledger, structured event reasons and
a post-run summary: pair/profile/version, lifecycle, admission mode, metrics,
fills, blocks, data errors, risk rejects, AI proposals/decisions and exceptions.
This is the data needed to fix real faults during 10–20-pair soak runs without
reading the whole project or guessing from UI counters.

## Delivery order

1. Catalogue contract and read-only UI/API exposure.
2. Challenger jobs and experiment ledger, without auto-promotion.
3. Manual start/stop and scale profiles on the existing shared-account runner.
4. Trade policy model plus risk-engine integration (scale-in and bounded AI
   management remain off by default until tested).
5. Admission-policy modes and migration away from bypass endpoints.
6. Controlled 10–20 pair soak operations and bug-fix increments.

## Success criteria

- A running pair can receive and complete a challenger backtest without altering
  its runner, position, wallet or incumbent profile.
- Strategy choices shown in the terminal come from a versioned catalogue and are
  more diverse than the current EMA-only shortlist when evidence supports it.
- A user can start and stop a shared-account paper scheme manually and see exact
  applied policy and exclusions.
- Historical thresholds can be adjusted or disabled only through explicit,
  recorded policy; runtime safety remains enforced.
- At every scale level, logs and reports identify data, strategy, risk and UI
  failures by pair and correlation ID.
