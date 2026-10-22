# SignalScript — Software Requirements Specification (SRS) v1.0
**Status:** Approved for Implementation  
**Project Objective:** Build an institutional-grade crypto futures trading terminal (Binance Futures: BTC, ETH, SOL) featuring deterministic backtesting, walk-forward validation, order flow footprint analysis, risk-managed paper trading, and an extensible LEGO-style workspace.

---

## 1. System Architecture Overview & Core Principles

### 1.1 Core Principles & Rules
1. **Truth-First & No-Fake Data:** No synthetic data, no hardcoded fallbacks, and no OHLC-derived proxies for historical order books or liquidity. If historical data is missing, the system must explicitly return `No data`.
2. **Deterministic Engine:** Strategy entry and exit decisions are made strictly by a deterministic core (`UnifiedTradeSignal`). LLM (AI Copilot) and external models are restricted to advisory, parameter tuning, and report synthesis roles.
3. **Multi-Regime Consistency:** A single strategy definition (`UnifiedTradeSignal`) must execute identically across three consecutive environments: **History (Backtest)**, **Validation (Walk-Forward / Out-of-Sample)**, and **Live Paper Trading**.
4. **Isolated Layers:** Backend engine (`backend/`), tests/scripts (`scripts/`), and frontend UI (`frontend/`) adhere to strict separation of concerns. The execution simulator core (`execution_simulator.py`) is immutable.

---

## 2. Detailed Module Specifications (M1 – M6)

### Module M1: Data Ingestion, Storage & Order Flow Engine
**Purpose:** Manage raw market data acquisition, historical archives, and live order flow metric generation.
* **M1.1 Historical Storage:** Storage based on daily Partitioned Parquet files (`backend/data/history/`). Includes a machine-readable `Data Manifest` tracking temporal ranges, missing gaps, and data type availability.
* **M1.2 True Footprint & TPO Generation:** 
  * `cluster_profile`, `poc_price`, `delta`, `cvd`, `stacked_imbalance`, and `absorption` are computed **exclusively** from raw `aggTrades` (`data.binance.vision` or live streams). 
  * If `aggTrades` are absent for a candle, `poc_price = null` and cluster profile remains empty (no OHLC approximations).
  * Volume Profile / TPO metrics (`TVAH`, `TPOC`, `TVAL`) are derived from aggregated price-volume distributions.
* **M1.3 Watchlist-Driven Live Recorder (`recorder.py`):**
  * Automatically subscribes to live `aggTrades` and `depth20` (L2 order book) for all symbols currently present in the active user `WatchlistWidget`.
  * **Order Book Wall & Lifetime Detector:** Identifies large resting limit walls in the L2 book and tracks **Wall TTL (Time-To-Live)** in seconds to filter out spoofing.
  * **Density Threshold Modes:**
    * *Auto Mode (Historical Quantile):* Volume exceeds the 99th percentile (or $K \times \text{median}$) of order book depth over the last $N$ minutes (modeled after TigerTrade, ATAS, Vataga).
    * *Manual Mode:* Fixed USDT threshold (e.g., $\ge \$500,000$) combined with minimum Wall TTL (e.g., $\ge 15\text{s}$).

### Module M2: Strategy Builder & Indicator Registry
**Purpose:** Provide a modular framework to assemble trading strategies from technical indicators and execution filters.
* **M2.1 Indicator Registry (`registry.py`):** Pluggable indicators including `EMA`, `RSI`, `ATR`, `VWAP`, `CVD`, `Volume Spike`, and `Open Interest`.
* **M2.2 Entry Modes:** Supports breakout entry (`Breakout`) and limit bounce off liquidity walls/levels (`Bounce`).
* **M2.3 Signal Combination Logic:**
  * *Strict AND:* Entry triggers only when all active indicator filters and rules align simultaneously.
  * *Weighted Confluence:* Each indicator carries a weight $w_i$ ($\sum w_i = 1.0$). Entry executes when the summed active trigger score exceeds a dynamic threshold (e.g., $0.65$).
* **M2.4 Risk--Management Bounds:** Configurable `SL from/to (%)`, `TP from/to (%)`, and dynamic stop-loss modes (`Fixed %`, `Behind Wall`, `ATR-based`).
* **M2.5 Unified Contract (`trade_contract.py`):** Every signal outputs a structured `UnifiedTradeSignal` containing a detailed `entry_reason` list (conditions + actual indicator values) and an explicit `exit_reason`.

### Module M3: Backtest, Walk-Forward & Verdict Engine
**Purpose:** Rigorously evaluate historical edge, prevent overfitting, and enforce institutional safety checks before live simulation.
* **M3.1 Execution & Fee Modeling:** Simulates historical fills with configurable `maker`/`taker` fee schedules and slippage (`Fee Drag %`).
* **M3.2 Walk-Forward & Market Regimes:**
  * Uses `RegimeClassifier` (`FLAT_DENSE`, `TREND_IMPULSE`, `TOXIC_VOLATILITY`).
  * Splits history into `Train / Validation / Holdout` sets to prevent look-ahead bias and curve-fitting.
* **M3.3 Verdict v2 (Safety Gateway):**
  * Automated traffic-light gate (`PASS` 🟢, `WARNING` 🟡, `BLOCK` 🔴).
  * Hard blocks Live Paper activation if `Net PnL` is negative after fees, sample size is insufficient, or `TOXIC_VOLATILITY` is active.
  * Explicitly flags when a strategy requires L2 order book data that is missing on historical datasets (`L2 History: No data`).

### Module M4: Live Paper Trading, Position Sizer & Risk Manager
**Purpose:** Execute 24/7 automated forward simulation on virtual balances utilizing live order flow data streams.
* **M4.1 Position Modes:** Supports `One-Way` (unidirectional with averaging/DCA or reversal) and `Hedge Mode` (simultaneous Long and Short across distinct sub-strategies).
* **M4.2 Position Sizer (Pre-Simulator Risk Layer):**
  * Operates on top of `execution_simulator.py` without modifying its core.
  * *Fixed Fractional Risk:* Base risk per trade equals $1\%$ (configurable) of current equity, scaled inversely by distance to Stop Loss and expected fees.
  * *Budgeted DCA (Averaging):* Splits the base risk across a pre-defined grid of DCA orders so that the total maximum drawdown of the entire ladder never exceeds the single-trade risk limit ($1\%$).
  * *Signal Quality Multiplier:* Adjusts position sizing based on Confluence Score ($0.5\times \dots 1.2\times$) and enforces a global `Max Portfolio Heat` limit.
  * *Compounding / Deposit Growth Mode:* Optional higher-risk compounding profile capped by strict daily drawdown limits.
* **M4.3 Safety & Kill Switch:** Automatically pauses execution and locks new entries if daily account drawdown reaches `-3%`, `-5%`, `-10%`, or a custom dollar threshold.

### Module M5: AI Copilot & Quant Sweep Optimizer
**Purpose:** Automate strategy discovery and provide plain-language analytical insights.
* **M5.1 Quant Sweep Optimizer:** Automatically executes parameter grid searches and multi-indicator permutations across validation sets, generating a ranked `Top 1–10 Strategies` leaderboard based on net expectancy, profit factor, and drawdown.
* **M5.2 AI Copilot Integration (`ai_copilot.py`):**
  * Translates raw optimization output into human-readable recommendations.
  * Provides a **"Apply Strategy #X"** button to inject selected parameters into the strategy form in one click.
  * Restricts AI to suggestions and explanations; execution decisions remain strictly deterministic.

### Module M6: PWA Terminal & LEGO Visual Workspace
**Purpose:** Deliver a fully customizable, institutional multi-window terminal layout with minimal friction and maximum ergonomics.
* **M6.1 Layout Engine (`TerminalDockview.jsx` + `layoutStore.js`):**
  * Powered by `dockview-react` (MIT license).
  * Supports detachable floating windows, tab grouping, secondary monitor support, and persistence across sessions via SQLite (`/api/workspaces`) and `localStorage`.
* **M6.2 Charting Interface (`Chart.jsx` + `chartAnnotations.js`):**
  * Strict dark mode styling (Edgedepth/Tealstreet aesthetic) with thin gridlines and muted candles.
  * Toggleable layers: `Heatmap / Densities`, `Liquidations`, `TPO Profile`, `Forecast Bands`, `Signals & Markers`, and `Market Regime`.
  * Synchronized sub-panes for `CVD`, `Open Interest (OI)`, and `RSI`.
  * Interactive trade inspection tooltips displaying full entry reasons, exit triggers, fees, Fee Drag %, MFE, MAE, and market regime.
* **M6.3 Order Book DOM & Tape (`OrderBookDOM.jsx`):** High-performance rendering of live L2 liquidity walls, order book depth, and time-and-sales tape.
* **M6.4 Ergonomics & Localization:** Minimalist header with asset/TF selectors, workspace presets, color-linking (`colorLinksStore.js`), and plain-language help tooltips (`?`) on every input parameter.

---

## 3. Data Integrity & Compliance Matrix

| Data Stream | History (Backtest) | Live Paper / Real-Time | Fallback Policy |
| :--- | :--- | :--- | :--- |
| **Candles (1m–4h)** | Binance Vision / REST Archive | WebSocket Real-Time Stream | `No data` if archive missing |
| **aggTrades / Footprint** | Decoded from Vision `.zip` | Live WebSocket `aggTrade` | `No data` if trades absent |
| **L2 Order Book / Walls** | **No data** (Recorder forward only) | Live WebSocket `depth20` | Explicit `No data` label |
| **Funding Rate** | Historical Archive | REST Polling / WS Feed | Neutral ($0$) if unavailable |

---

## 4. Verification & Quality Gates (QA)
* **Automated Test Suite:** Minimum requirement of 80+ passing `pytest` unit/integration tests and clean Playwright UI smoke tests.
* **Command Execution Rule:** All builds must pass `npm run build` and `scripts/check.ps1` with zero blocking errors prior to release or branch merging.