"""
Database Models (SQLAlchemy Async)
Stores User Settings, Signals, Liquidation Events, and Chart Drawings.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, Index
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class UserSetting(Base):
    """
    User-configurable filters and alert preferences.
    user_id=0 is used as global / web default.
    """
    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, unique=True, index=True, default="0")
    
    # 24h market filters
    price_change_min = Column(Float, default=2.5)          # Price change % >= 2.5%
    price_change_enabled = Column(Boolean, default=True)
    
    oi_change_min = Column(Float, default=3.0)             # OI change % >= 3.0%
    oi_change_enabled = Column(Boolean, default=True)
    
    liquidation_min_usd = Column(Float, default=50000.0)   # 24h liquidations >= $50,000
    liquidation_enabled = Column(Boolean, default=False)
    
    mcap_min_usd = Column(Float, default=50000000.0)       # Min market cap $50M
    mcap_max_usd = Column(Float, default=50000000000.0)    # Max market cap $50B
    mcap_enabled = Column(Boolean, default=False)

    # Indicator triggers on Timeframe
    timeframe = Column(String, default="15m")              # 1m, 5m, 15m, 30m, 45m, 1h, 4h, 6h
    
    ema_cross_enabled = Column(Boolean, default=True)      # Signal on EMA 20 cross
    vol_spike_mult = Column(Float, default=2.0)            # Volume >= 2.0x MA20
    vol_spike_enabled = Column(Boolean, default=True)
    
    rsi_min = Column(Float, default=30.0)
    rsi_max = Column(Float, default=70.0)
    rsi_filter_enabled = Column(Boolean, default=True)
    
    cvd_divergence_enabled = Column(Boolean, default=False)
    atr_volatility_min_pct = Column(Float, default=0.5)    # ATR as % of price >= 0.5%
    atr_filter_enabled = Column(Boolean, default=False)

    cooldown_minutes = Column(Integer, default=30)         # Cooldown per symbol+condition
    notifications_enabled = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class LiquidationEvent(Base):
    """
    Live liquidation events caught from Binance WebSocket !forceOrder@arr
    """
    __tablename__ = "liquidation_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String, index=True)
    side = Column(String)  # BUY (Short liquidated) or SELL (Long liquidated)
    price = Column(Float)
    quantity = Column(Float)
    usd_amount = Column(Float)
    timestamp = Column(DateTime, index=True, default=datetime.utcnow)

    __table_args__ = (
        Index('idx_symbol_timestamp', 'symbol', 'timestamp'),
    )

class SignalHistory(Base):
    """
    Generated signals log
    """
    __tablename__ = "signal_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String, index=True)
    timeframe = Column(String)
    price = Column(Float)
    condition_type = Column(String)  # 'EMA_CROSS', 'VOL_SPIKE', 'RSI_EXTREME', 'CVD_DIV'
    direction = Column(String)       # 'BULLISH', 'BEARISH'
    description = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

class DrawingData(Base):
    """
    Chart drawing objects saved per symbol and timeframe
    """
    __tablename__ = "drawing_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, default="0", index=True)
    symbol = Column(String, index=True)
    timeframe = Column(String)
    elements_json = Column(Text, default="[]")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
