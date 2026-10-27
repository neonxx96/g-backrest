# SignalScript Engineering History & Architectural Decisions (ADR-Lite)

This document records the architectural decisions, conventions, discovered pitfalls, and reverted experiments developed by Kimi and Gemini/Antigravity. Its purpose is to prevent incoming agents (Codex, Cline) from repeating known mistakes.

---

## 1. Architectural Decisions (ADR-Lite)

- **ADR-01: KLineCharts Strictly v9 API (`9.8.12`)**
  - *Context:* KLineCharts v10 has breaking API changes and unstable overlay mechanics; v8 is deprecated.
  - *Decision:* Strictly lock KLineCharts to v9 (`chart.createOverlay`, `chart.overrideOverlay`, `chart.applyNewData`). Never upgrade to v10 without a dedicated migration specification.
- **ADR-02: Dockview Styling via CSS Variables (`--dv-*`)**
  - *Context:* Directly patching Dockview internals in JavaScript causes breakage upon library updates.
  - *Decision:* All tab heights (fixed at 28px), sashes (1px), active tab accents, and drag overlays are styled purely through CSS variables on `.dockview-theme-dark` in `frontend/src/index.css`.
- **ADR-03: Net Expectancy ($E_R$) Over Raw Win Rate**
  - *Context:* Strategies targeting a 70%+ Win Rate bled capital due to asymmetric losses and high taker fees ($2 \times 0.05\%$).
  - *Decision:* Adopt Net Expectancy ($E_R > 0$) as the primary fitness function. Optimize for $R$-multiples with fee deduction, minimum risk-reward ($R:R \ge 2.0$), and Out-Of-Sample validation.
- **ADR-04: SL-Based Position Sizing & Portfolio Heat Quota**
  - *Context:* Fixed percentage sizing led to account blow-ups on high-volatility altcoins.
  - *Decision:* Position sizing is strictly derived from Stop Loss distance: $\text{Size} = \frac{\text{Capital} \times \text{RiskPct}}{\text{SL Distance} + 2 \times \text{Fee} + \text{Slippage}}$. Portfolio Heat is capped at 1.25%, with Directional Heat capped at 0.75%.
- **ADR-05: Zero Look-Ahead Bias Invariant**
  - *Context:* Backtests using closing prices or future candle data yielded unrealistically high returns that failed in production.
  - *Decision:* Strict invariant: calculations on candle $t$ only access data $\le t$. Intra-candle order fills are verified via tick-level simulation or high/low sequence checks.
- **ADR-06: Canvas 2D Bitmaps and Resize Guard**
  - *Context:* Rapid browser resizing triggered dozens of canvas memory reallocations per second, causing layout thrashing.
  - *Decision:* All canvas elements scale via $\text{bitmap} = \text{rect} \times \text{dpr} \times \text{uiScale}$, guarded by `if (canvas.width !== targetW || canvas.height !== targetH)`. Resizing operations use `requestAnimationFrame` and a trailing debounce of 120ms.
- **ADR-07: Design System Ratchet Linter (`design_lint.mjs`)**
  - *Context:* Raw Tailwind color classes (`bg-gray-800`, `text-zinc-400`) repeatedly slipped into PRs.
  - *Decision:* Codified strict shadcn token usage and added a ratchet linter to the pre-commit gate. The violation count can only decrease from baseline.
- **ADR-08: Dual-Source Market Data Failover**
  - *Context:* Binance Futures WebSocket occasionally experiences connection drops, leaving widgets blank.
  - *Decision:* Frontend implements automated failover: Binance Futures WS -> Binance Spot WS (`wss://stream.binance.com:9443`) -> immediate REST snapshot fallback (`/fapi/v1/ticker/24hr`).
- **ADR-09: Generated CodeMap Is the Navigation Contract**
  - *Context:* Manual function maps age immediately in a mixed Python/React codebase.
  - *Decision:* `scripts/gen_codemap.py` derives public symbols and dependency/caller hints deterministically; `--check` is part of the documentation gate.

---

## 2. Pitfalls, Failed Experiments & Reverted Approaches

1. **Premature Breakeven at +0.4R:**
   - *Attempt:* Moving Stop Loss to Breakeven when price reached +0.4R.
   - *Result:* High rate of premature stop-outs during normal market noise, leading to negative expectancy due to fees.
   - *Remedy:* Reverted. Replaced with Dynamic Breakeven at +1.0R with an explicit offset covering double taker fees plus one tick.
2. **Synthetic/Random Fallback Quotes (`Math.random()`):**
   - *Attempt:* Generating synthetic ticks or mock book depth during WebSocket disconnects.
   - *Result:* Polluted data telemetry and generated false scanner signals.
   - *Remedy:* Strictly prohibited in `AGENTS.md`. Disconnections must show a clean `disconnected` badge and trigger an automatic REST retry.
3. **Simultaneous Refactoring of Monolithic Files:**
   - *Attempt:* Breaking down `Chart.jsx` and `orderflow_backtester.py` alongside feature edits.
   - *Result:* Introduced race conditions and regression in event handlers.
   - *Remedy:* Giant files may only be refactored under dedicated tasks adhering to [`docs/MODULARIZATION_PLAN.md`](docs/MODULARIZATION_PLAN.md).
4. **Pyramiding (Adding to Winning Positions):**
   - *Attempt:* Adding contracts on continuation signals.
   - *Result:* Pyramiding magnified drawdown during sudden liquidity sweeps.
   - *Remedy:* Set `ENABLE_PYRAMIDING = False` in `risk_engine.py` until verified via comparative A/B backtesting on historical lake data.
5. **Starting a second backend for a smoke check:**
   - *Attempt:* Treating the development launch commands as harmless when Docker is already running.
   - *Result:* The project invariant allows only one `backend/main.py` process and port `8000` may already be owned.
   - *Remedy:* Inspect listeners first; do not launch the local stack while Docker/local services occupy the mandated ports.
