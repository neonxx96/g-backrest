"""
Main FastAPI Server & Background Worker Daemon
Runs REST API, Telegram Bot, WebSocket Liquidations listener, and Periodic Scanner.
"""

import asyncio
import logging
import sys
from pathlib import Path
from contextlib import asynccontextmanager

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend.app.config import BACKEND_HOST, BACKEND_PORT, LOG_LEVEL
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
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("backend.log", encoding="utf-8")
    ]
)
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
    # Startup
    logger.info("Initializing Signal Script Backend...")
    await init_db()
    
    # 1. Start Binance Liquidations WebSocket
    liq_task = asyncio.create_task(binance_service.start_liquidation_listener())
    background_tasks.append(liq_task)

    # 2. Start Periodic Scanner
    scan_task = asyncio.create_task(periodic_scanner_worker())
    background_tasks.append(scan_task)

    # 3. Start Telegram Bot Polling
    bot_task = asyncio.create_task(start_bot_polling())
    background_tasks.append(bot_task)

    # 4. Start OrderFlow Recorder (100GB storage manager)
    await recorder.start()

    yield

    # Shutdown
    logger.info("Shutting down Signal Script Backend...")
    binance_service.is_ws_running = False
    await recorder.stop()
    for task in background_tasks:
        task.cancel()
    await binance_service.close()

app = FastAPI(title="Signal Script API", lifespan=lifespan)

# Allow CORS for React/Vite development & localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.app.routers.workspaces import router as workspaces_router

app.include_router(api_router)
app.include_router(data_router)
app.include_router(backtest_router)
app.include_router(ai_router)
app.include_router(workspaces_router)

if __name__ == "__main__":

    uvicorn.run("backend.main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=False)
