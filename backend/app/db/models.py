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

    # Stage 3: Heatmap & Storage settings
    heatmap_enabled = Column(Boolean, default=True)
    heatmap_min_usd = Column(Float, default=100000.0)
    storage_max_gb = Column(Float, default=100.0)
    storage_retention_days = Column(Integer, default=14)
    storage_path = Column(String, default="data/recorded")

    # Stage 3: Indicator Normalization & Per-coin overrides
    normalization_mode = Column(String, default="raw")      # 'raw', 'atr_pct', 'z_score', 'percentile'
    coin_overrides = Column(Text, default="{}")             # JSON string for per-coin indicator settings

    # Stage 3: TigerTrade Orderbook & Theme settings
    orderbook_levels = Column(Integer, default=20)
    orderbook_volume_mode = Column(String, default="both")  # 'numbers', 'bars', 'heatmap', 'both'
    orderbook_tick_scale = Column(Float, default=1.0)
    theme = Column(String, default="tealstreet")            # 'tealstreet', 'tiger', 'bloomberg'
    ui_config = Column(Text, default="{}")                  # JSON string for font, opacity, EMA, subpanes, orderflow

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
    condition_type = Column(String)  # 'EMA_CROSS', 'VOL_SPIKE', 'RSI_EXTREME', 'CVD_DIV', 'VWAP_CROSS'
    direction = Column(String)       # 'BULLISH', 'BEARISH', etc.
    description = Column(Text)
    normalized_metric = Column(String, nullable=True, default=None)
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

class Workspace(Base):
    """
    User Workspaces & Dockview Layouts.
    Stores layout JSON (dockview geometry & tab placement) and color links.
    Strictly NO market data (ticks, candles, depth) is stored here.
    """
    __tablename__ = "workspaces"

    id = Column(String, primary_key=True)
    user_id = Column(String, default="0", index=True)
    name = Column(String, nullable=False)
    layout_data = Column(Text, nullable=False)
    color_links = Column(Text, default="{}")
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DecisionLog(Base):
    """
    Stage 1 & 2: Trader Decision Journal & AI Second Opinion Log.
    Records triggered signals, manual user entries/exits/skips, and consultative AI recommendations.
    Strictly consultative — never executes trades automatically.
    """
    __tablename__ = "decision_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    event_type = Column(String, index=True, default="SIGNAL")  # 'SIGNAL', 'AI_OPINION', 'MANUAL_ENTRY', 'MANUAL_EXIT', 'MANUAL_SKIP'
    symbol = Column(String, index=True)
    timeframe = Column(String, default="5m")
    direction = Column(String, default="LONG")                 # 'LONG', 'SHORT', 'NEUTRAL'
    price = Column(Float, default=0.0)
    entry_price = Column(Float, nullable=True)
    sl_price = Column(Float, nullable=True)
    tp_price = Column(Float, nullable=True)
    strategy_or_condition = Column(String, default="")
    ai_verdict = Column(String, nullable=True)                 # 'ЗА', 'ПРОТИВ', 'НЕЙТРАЛЬНО', 'AI НЕДОСТУПЕН'
    ai_reason = Column(Text, nullable=True)
    context_json = Column(Text, default="{}")                  # Market context snapshot (CVD, OI, EV, walls, ATR)
    user_decision = Column(String, default="PENDING")          # 'ENTERED', 'SKIPPED', 'EXITED', 'PENDING'
    notes = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StrategyPreset(Base):
    """
    Stage 3: Fast 1-click Strategy Parameter Presets (SL/TP, indicator filters, entry/SL modes).
    """
    __tablename__ = "strategy_presets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, index=True)
    symbol = Column(String, default="ANY")
    timeframe = Column(String, default="5m")
    strategy_type = Column(String, default="density_bounce")
    params_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class OvernightPilotRun(Base):
    """Durable metadata and last snapshot for a three-strategy paper run."""
    __tablename__ = "overnight_pilot_runs"

    session_id = Column(String, primary_key=True)
    symbol = Column(String, index=True, nullable=False)
    strategy_type = Column(String, nullable=False)
    config_json = Column(Text, nullable=False, default="{}")
    backtest_json = Column(Text, nullable=True)
    forecast_json = Column(Text, nullable=True)
    paper_json = Column(Text, nullable=True)
    is_running = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

