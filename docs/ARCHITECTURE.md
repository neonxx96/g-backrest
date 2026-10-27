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

- `TELEGRAM_BOT_TOKEN`: Token for alert broadcasting.
- `TELEGRAM_CHAT_ID`: Destination chat identifier for notifications.
- `OPENROUTER_API_KEY`: API key for AI Copilot and Sentinel services.
- `OPENROUTER_MODEL`: Model name for copilot evaluation (default: `anthropic/claude-3.5-sonnet`).
- `BACKEND_HOST`: Host interface binding (default: `127.0.0.1` or `0.0.0.0` in Docker).
- `BACKEND_PORT`: Port binding for FastAPI (default: `8000`).
- `MAX_STORAGE_GB`: Disk storage quota for Parquet lake before FIFO purge (default: `100`).
- `LOG_LEVEL`: Logging verbosity (`INFO`, `DEBUG`, `WARNING`, `ERROR`).
- `DATA_DIR`: Directory path for persistent data (default: `./data`).
- `RECORDED_DATA_DIR`: Directory path for Parquet Lake (default: `./data/recorded`).
