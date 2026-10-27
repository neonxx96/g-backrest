# SignalScript System Architecture & Data Flows

## 1. Directory Tree & Roles

```
.
├── backend/                  # FastAPI asynchronous server, database models, background services
│   ├── main.py               # Application entrypoint, lifespan startup tasks, background loops
│   ├── app/
│   │   ├── config.py         # App configuration & environment variable binding
│   │   ├── logging_setup.py  # Structured and stress logging configuration
│   │   ├── api/              # Core API route handlers (market data, indicators, telemetry)
│   │   ├── db/               # Async database layer (SQLAlchemy 2.0 + aiosqlite, models, init_db)
│   │   ├── engine/           # Background workers for coin monitoring and analysis
│   │   ├── routers/          # Domain-specific routers (backtest, journal, overnight_pilot, copilot)
│   │   ├── services/         # Business logic: risk engine, regime classifier, scanner, recorder
│   │   └── tests/            # Pytest automated test suites (unit, quantum, backtest golden)
├── frontend/                 # React 19 + Vite desktop trading terminal
│   ├── src/
│   │   ├── App.jsx           # Root layout, hotkey manager, modals host, top navigation bar
│   │   ├── components/       # UI components: Chart, OrderBookDOM, tape, backtest, journal
│   │   │   ├── docking/      # Dockview layout panels (TerminalDockview, TradeHistoryWidget, etc.)
│   │   │   └── ui/           # Canonical shadcn/ui design system primitives (Button, Dialog, etc.)
│   │   ├── features/         # Specialized sub-applications (Pilot dashboard & workspace)
│   │   ├── stores/           # Zustand 5 reactive stores (backtestStore, marketDataStore, etc.)
│   │   ├── services/         # Frontend data fetchers, WebSocket clients, failovers
│   │   └── index.css         # Global Tailwind v4 theme, tokens, and Dockview overrides
├── engine/                   # Standalone algorithmic engine used by CLI backtester and scanner
├── recorder/                 # Standalone OrderFlow & Depth recorder service (spool & Parquet lake)
├── strategies/               # Quantitative strategy implementations (MTF Pullback, Cluster Breakout)
├── config/                   # Model routing and default runtime YAML configurations
├── data/                     # Persistent storage (SQLite signals.db, Parquet lake, recordings)
├── docs/                     # Architectural specs, plans, design guidelines, history
├── scripts/                  # Quality gate, smoke tests, automation routers, codemod scripts
│   ├── gen_codemap.py        # Deterministic AST/regex public-symbol and dependency map generator
│   └── check_docs.py         # Gate check for required docs, AGENTS limits, and fresh CODEMAP.md
└── tasks/                    # Isolated agent task specifications following tasks/TEMPLATE.md
```

---

## 2. End-to-End Data Flows

```
[Binance Futures USDT-M]
   │
   ├── WebSocket (!miniTicker@arr, aggTrade, depth20@100ms, liquidationOrders)
   │     │
   │     ├──► [recorder/ & backend recorder service] ──► [data/lake/ Parquet & Spool]
   │     │
   │     └──► [frontend/src/services/marketDataFetcher.js] ──► [Zustand Stores] ──► [KLineCharts & Canvas DOM]
   │
   └── REST API (/fapi/v1/klines, /fapi/v1/depth)
         │
         ├──► [backend/app/services/binance_service.py]
         │        │
         │        ├──► [backend/app/services/scanner.py] ──► [Strategy Signals & SQLite]
         │        │
         │        └──► [backend/app/services/overnight_pilot.py]
         │                 │
         │                 ├──► [regime_classifier.py] (CI-14, Volatility percentiles)
         │                 ├──► [microstructure_gate.py] (L2 depth, CVD absorption)
         │                 └──► [risk_engine.py] (SL-based sizing, Portfolio Heat <= 1.25%)
         │                          │
         │                          └──► [live_paper_runner.py] ──► [data/signals.db: paper_trade_records]
         │
         └──► [frontend/src/services/marketDataFetcher.js (failover)]
```

---

## 3. Module Boundaries & System Invariants

1. **Advisory / Paper Boundary:**
   - The terminal is strictly **advisory and paper-trading**.
   - No module contains or is permitted to import live trading order-execution keys.
2. **Database Boundary:**
   - Single persistent SQLite database located at `data/signals.db`.
   - Asynchronous access through SQLAlchemy + aiosqlite. Migrations occur via non-destructive `init_db()` additions.
3. **Container & Network Boundary:**
   - Backend service is strictly bound to port `8000`.
   - Frontend web service is strictly bound to port `7100`.
   - When running under Docker Compose, traffic is routed through the internal bridge network `signalscript_net` with volume mounts to `./data`.

---

## 4. External Dependencies & Third-Party APIs

- **Binance Futures USDT-M:**
  - REST: `https://fapi.binance.com`
  - WebSocket: `wss://fstream.binance.com`
  - Spot WebSocket Fallback: `wss://stream.binance.com:9443`
- **OpenRouter AI (Copilot & Sentinel):**
  - REST endpoint for NLP strategy generation, second opinions, and dynamic sentinel trade defense.
- **Telegram Bot API:**
  - Real-time notification broadcast for market scanner triggers and risk circuit breakers.

---

## 5. Configuration & Environment Variables

All settings are managed via `backend/app/config.py` loaded from `.env`. Sensitive values are strictly omitted from version control:

- `BINANCE_API_KEY`, `BINANCE_API_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `BACKEND_HOST`, `BACKEND_PORT`, `FRONTEND_URL`, `DATABASE_URL`
- `MAX_STORAGE_GB`, `FOCUS_SYMBOLS`, `WATCHLIST_SYMBOLS`, `LOG_LEVEL`
- `OPENROUTER_API_KEY`, `OPENROUTER_PRIMARY_MODEL`, `OPENROUTER_FALLBACK_MODEL`, `OPENROUTER_MODEL`, `OPENROUTER_FREE_MODELS`, `OPENROUTER_DAILY_BUDGET_USD`, `OPENROUTER_TIMEOUT_SEC`

Configuration names only are documented here. Values and `.env` contents are never committed or copied into documentation.

## 6. Documentation Boundary

`docs/ARCHITECTURE.md` describes directory roles and data flow; `docs/CODEMAP.md` is generated from source and identifies public symbols plus direct dependencies. `docs/ROADMAP.md`, `PROGRESS.md`, and `HANDOFF.md` are the task, journal, and shift-state sources of truth. `scripts/check_docs.py` enforces their presence and generated-map freshness from the quality gate.
