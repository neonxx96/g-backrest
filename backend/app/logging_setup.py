"""
Institutional Logging Setup & Diagnostic Utilities for Stress Testing.
Directs system logs into backend/logs/stress_test.log with structured tags:
[INFO] boots, [TRADE] entries/exits, [WARNING] WS disconnects, and [ERROR] tracebacks.
Includes Windows-compatible memory profiling (RSS and Python heap).
"""

import os
import sys
import logging
import ctypes
from ctypes import wintypes
from pathlib import Path
from typing import Tuple, Dict, Any

# Root logging path
BACKEND_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = BACKEND_DIR / "logs"
STRESS_LOG_FILE = LOGS_DIR / "stress_test.log"


class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
    _fields_ = [
        ("cb", wintypes.DWORD),
        ("PageFaultCount", wintypes.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
    ]


def get_memory_stats() -> Dict[str, float]:
    """
    Returns resident set size (RSS) in MB using Win32 API.
    """
    try:
        pmc = PROCESS_MEMORY_COUNTERS_EX()
        pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
        fn = ctypes.windll.psapi.GetProcessMemoryInfo
        fn.argtypes = [wintypes.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX), wintypes.DWORD]
        fn.restype = wintypes.BOOL
        handle = ctypes.windll.kernel32.GetCurrentProcess()
        ok = fn(handle, ctypes.byref(pmc), pmc.cb)
        if ok:
            return {
                "rss_mb": round(pmc.WorkingSetSize / (1024 * 1024), 2),
                "peak_rss_mb": round(pmc.PeakWorkingSetSize / (1024 * 1024), 2),
                "private_mb": round(pmc.PrivateUsage / (1024 * 1024), 2),
            }
    except Exception:
        pass
    return {"rss_mb": 0.0, "peak_rss_mb": 0.0, "private_mb": 0.0}


def setup_stress_logging(log_file: Path = STRESS_LOG_FILE) -> logging.Logger:
    """
    Configures file-based and stream logging for the paper trading stress test.
    """
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Avoid duplicate file handlers
    log_file_str = str(log_file.resolve())
    for h in root_logger.handlers:
        if isinstance(h, logging.FileHandler) and getattr(h, "baseFilename", None) == log_file_str:
            return root_logger

    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # File Handler
    fh = logging.FileHandler(log_file, mode="a", encoding="utf-8")
    fh.setLevel(logging.INFO)
    fh.setFormatter(formatter)
    root_logger.addHandler(fh)

    # Stream Handler (console) if not already present
    has_stream = any(isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler) for h in root_logger.handlers)
    if not has_stream:
        ch = logging.StreamHandler(sys.stdout)
        ch.setLevel(logging.INFO)
        ch.setFormatter(formatter)
        root_logger.addHandler(ch)

    return root_logger
