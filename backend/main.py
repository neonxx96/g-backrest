"""
Main FastAPI Server & Background Worker Daemon
Runs REST API, Telegram Bot, WebSocket Liquidations listener, and Periodic Scanner.
"""

import asyncio
import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend.app.config import BACKEND_HOST, BACKEND_PORT, DATA_DIR, ENV_PATH, LOG_LEVEL
from backend.app.services.runtime_binding import find_available_port, persist_runtime_port_guarded
from backend.app.db.database import init_db
from backend.app.api.routes import router as api_router
from backend.app.api.data_routes import data_router
from backend.app.routers.backtest import backtest_router
from backend.app.routers.ai_copilot import ai_router
from backend.app.services.binance_service import binance_service
from backend.app.services.scanner import scanner
from backend.app.services.recorder import recorder
from backend.app.services.bot import start_bot_polling, broadcast_signal


# Configure logging
from backend.app.logging_setup import setup_stress_logging
setup_stress_logging()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
# basicConfig — no-op, если root-logger уже настроен (например setup_stress_logging
# импортирован выше), поэтому file-handler подключаем явно: backend.log — единственная
# диагностика при зависании startup (процесс жив, HTTP не поднялся; инцидент 2026-10-22).
try:
    _file_handler = logging.FileHandler("backend.log", encoding="utf-8")
    _file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    if not any(isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", "") == _file_handler.baseFilename
               for h in logging.getLogger().handlers):
        logging.getLogger().addHandler(_file_handler)
except OSError:
    pass  # read-only cwd: остаёмся на stdout
logger = logging.getLogger("SignalScript")

background_tasks = []

async def periodic_scanner_worker():
    """Background worker running market scans every 60 seconds."""
    logger.info("Periodic scanner worker started (interval=60s).")
    await asyncio.sleep(5)  # Initial grace period
    while True:
        try:
            signals = await scanner.scan_market()
            for sig in signals:
                logger.info(f"Signal detected: {sig['symbol']} {sig['condition_type']}")
        except Exception as e:
            logger.error(f"Error in periodic scanner: {e}")
        await asyncio.sleep(60)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup. Каждый шаг логируется явно: при зависании startup до bind HTTP
    # (инцидент 2026-10-22: процесс жив, порт не слушает) последняя запись
    # показывает проблемный шаг.
    logger.info("Initializing Signal Script Backend...")
    await init_db()
    logger.info("[startup 1/6] init_db done")
    from backend.app.services.overnight_pilot import overnight_pilot_manager
    await overnight_pilot_manager.restore()
    logger.info("[startup 2/6] overnight pilot restore done")

    # 3. Start Binance Liquidations WebSocket
    liq_task = asyncio.create_task(binance_service.start_liquidation_listener())
    background_tasks.append(liq_task)
    logger.info("[startup 3/6] liquidation listener task created")

    # 4. Start Periodic Scanner
    scan_task = asyncio.create_task(periodic_scanner_worker())
    background_tasks.append(scan_task)
    logger.info("[startup 4/6] periodic scanner task created")

    # 5. Start Telegram Bot Polling
    bot_task = asyncio.create_task(start_bot_polling())
    background_tasks.append(bot_task)
    logger.info("[startup 5/6] telegram bot polling task created")

    # 6. Start OrderFlow Recorder (100GB storage manager)
    await recorder.start()
    logger.info("[startup 6/6] recorder started")

    # 7. Start Parallel Background Processing Worker for Monitored Coins
    from backend.app.engine.background_worker import background_worker
    worker_task = background_worker.start()
    background_tasks.append(worker_task)
    logger.info("[startup 7/7] background worker started")

    # 8. Warning Sentinel: системные алерты наружу (задача 7.2)
    warning_sentinel.start()
    logger.info("[startup 8/8] warning sentinel started")

    logger.info("Backend startup complete; HTTP server is now serving requests.")
    yield

    # Shutdown
    logger.info("Shutting down Signal Script Backend...")
    binance_service.is_ws_running = False
    warning_sentinel.stop()
    await recorder.stop()
    await background_worker.stop()
    for task in background_tasks:
        task.cancel()
    await binance_service.close()

app = FastAPI(title="Signal Script API", lifespan=lifespan)

@app.get("/api/health")
@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "signalscript-backend"}

# Allow CORS for React/Vite development & localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.app.routers.workspaces import router as workspaces_router
from backend.app.routers.journal import journal_router
from backend.app.routers.monitoring import router as monitoring_router, system_monitoring_router
from backend.app.routers.paper_trading_router import router as paper_trading_router
from backend.app.routers.adaptive_router import adaptive_router
from backend.app.routers.overnight_pilot import router as overnight_pilot_router
from backend.app.routers.ai_settings import router as ai_settings_router
from backend.app.routers.walls import router as walls_router
from backend.app.routers.confluence import router as confluence_router
from backend.app.routers.verdict import router as verdict_router
from backend.app.routers.risk import router as risk_router
from backend.app.routers.sweep import router as sweep_router
from backend.app.routers.replay import replay_router
from backend.app.services.warning_sentinel import warning_sentinel

app.include_router(api_router)
app.include_router(data_router)
app.include_router(backtest_router)
app.include_router(ai_router)
app.include_router(workspaces_router)
app.include_router(journal_router)
app.include_router(monitoring_router)
app.include_router(system_monitoring_router)
app.include_router(paper_trading_router)
app.include_router(adaptive_router)
app.include_router(overnight_pilot_router)
app.include_router(ai_settings_router)
app.include_router(walls_router)
app.include_router(confluence_router)
app.include_router(verdict_router)
app.include_router(risk_router)
app.include_router(sweep_router)
app.include_router(replay_router)

from backend.app.routers.quant_router import router as quant_router
app.include_router(quant_router)

if __name__ == "__main__":
    import time
    preferred_port = 8000
    active_port = find_available_port(BACKEND_HOST, preferred_port)
    if active_port != preferred_port:
        raise RuntimeError(f"Configured backend port {preferred_port} is busy; refusing fallback port {active_port}.")
    persist_runtime_port_guarded(
        ENV_PATH,
        DATA_DIR / "backend_runtime.json",
        BACKEND_HOST,
        active_port,
        preferred_port,
    )
    logger.info("SignalScript backend listening on http://%s:%s", BACKEND_HOST, active_port)
    uvicorn.run("backend.main:app", host=BACKEND_HOST, port=active_port, reload=False)
