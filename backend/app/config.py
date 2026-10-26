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
OPENROUTER_PRIMARY_MODEL = os.getenv("OPENROUTER_PRIMARY_MODEL", "deepseek/deepseek-v4.1-flash")
OPENROUTER_FALLBACK_MODEL = os.getenv("OPENROUTER_FALLBACK_MODEL", "openrouter/free")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", OPENROUTER_PRIMARY_MODEL)
OPENROUTER_FREE_MODELS = [
    m.strip() for m in os.getenv(
        "OPENROUTER_FREE_MODELS",
        # Актуальный каталог бесплатных моделей OpenRouter (проверено 2026-10-23
        # прямыми вызовами: flint и nemotron-3.5-lightning отвечают, gemma-4 и
        # inkling отдают 429/403; llama-3.1-8b/gemma-2-9b/qwen-2.5-7b удалены).
        "recursive/flint-v1.0:free,nvidia/nemotron-3.5-lightning:free,openrouter/free,google/gemma-4-31b-it:free"
    ).split(",") if m.strip()
]
OPENROUTER_DAILY_BUDGET_USD = float(os.getenv("OPENROUTER_DAILY_BUDGET_USD", "1.00"))
OPENROUTER_TIMEOUT_SEC = float(os.getenv("OPENROUTER_TIMEOUT_SEC", "20.0"))


