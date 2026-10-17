"""
Time and Helper Utilities
Provides Europe/Kyiv timezone conversion and formatting across the system.
"""

from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

KYIV_TZ = ZoneInfo("Europe/Kyiv")

def now_kyiv() -> datetime:
    """Returns current localized datetime in Europe/Kyiv."""
    return datetime.now(KYIV_TZ)

def format_kyiv(dt: Optional[datetime] = None) -> str:
    """Formats datetime as 'YYYY-MM-DD HH:MM:SS' in Europe/Kyiv timezone."""
    if dt is None:
        dt = now_kyiv()
    elif dt.tzinfo is None:
        # SQLite stores naive UTC timestamps; localize to UTC then convert to Kyiv
        dt = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(KYIV_TZ)
    else:
        dt = dt.astimezone(KYIV_TZ)
    return dt.strftime("%Y-%m-%d %H:%M:%S")

def format_kyiv_time(dt: Optional[datetime] = None) -> str:
    """Formats datetime as 'HH:MM:SS' in Europe/Kyiv timezone."""
    if dt is None:
        dt = now_kyiv()
    elif dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(KYIV_TZ)
    else:
        dt = dt.astimezone(KYIV_TZ)
    return dt.strftime("%H:%M:%S")
