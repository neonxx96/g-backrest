"""
Application Configuration
Loads settings from .env file with robust defaults.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)

BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_API_SECRET = os.getenv("BINANCE_API_SECRET", "")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# SQLite Database
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_FILE = DATA_DIR / "signals.db"
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite+aiosqlite:///{DATABASE_FILE}")

# Storage Quota & Order Flow Recording (Max 100GB by default, FIFO cleanup)
MAX_STORAGE_GB = float(os.getenv("MAX_STORAGE_GB", "100.0"))
RECORDED_DATA_DIR = DATA_DIR / "recorded"
RECORDED_DATA_DIR.mkdir(parents=True, exist_ok=True)

# Focus symbols (3-5 primary coins for deep orderflow/DOM/tape recording)
FOCUS_SYMBOLS_RAW = os.getenv("FOCUS_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT,DOGEUSDT,XRPUSDT")
FOCUS_SYMBOLS = [s.strip().upper() for s in FOCUS_SYMBOLS_RAW.split(",") if s.strip()]

# Watchlist symbols (secondary/deferred observation)
WATCHLIST_SYMBOLS_RAW = os.getenv("WATCHLIST_SYMBOLS", "BNBUSDT,SUIUSDT,NEARUSDT")
WATCHLIST_SYMBOLS = [s.strip().upper() for s in WATCHLIST_SYMBOLS_RAW.split(",") if s.strip()]

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# OpenRouter LLM Configuration
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "google/gemini-2.0-flash-001")


