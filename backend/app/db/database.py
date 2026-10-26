"""
Database Engine & Session Management (Async SQLite)
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy import event
from backend.app.config import DATABASE_URL
from backend.app.db.models import Base, UserSetting

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    poolclass=NullPool,
    connect_args={"timeout": 30},
)

@event.listens_for(engine.sync_engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    try:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()
    except Exception:
        pass

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async def init_db():
    """Initializes tables, migrates missing columns, and seeds default user_id='0' settings."""
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.run_sync(Base.metadata.create_all)
        
        # Check and migrate columns in user_settings table
        def migrate_columns(sync_conn):
            from sqlalchemy import inspect, text
            inspector = inspect(sync_conn)
            cols = [c["name"] for c in inspector.get_columns("user_settings")]
            new_cols = {
                "heatmap_enabled": "BOOLEAN DEFAULT 1",
                "heatmap_min_usd": "FLOAT DEFAULT 100000.0",
                "storage_max_gb": "FLOAT DEFAULT 100.0",
                "storage_retention_days": "INTEGER DEFAULT 14",
                "storage_path": "VARCHAR DEFAULT 'data/recorded'",
                "normalization_mode": "VARCHAR DEFAULT 'raw'",
                "coin_overrides": "TEXT DEFAULT '{}'",
                "orderbook_levels": "INTEGER DEFAULT 20",
                "orderbook_volume_mode": "VARCHAR DEFAULT 'both'",
                "orderbook_tick_scale": "FLOAT DEFAULT 1.0",
                "theme": "VARCHAR DEFAULT 'tealstreet'",
                "ui_config": "TEXT DEFAULT '{}'",
            }
            for col_name, col_type in new_cols.items():
                if col_name not in cols:
                    sync_conn.execute(text(f"ALTER TABLE user_settings ADD COLUMN {col_name} {col_type}"))

            # Check signal_history table
            sh_cols = [c["name"] for c in inspector.get_columns("signal_history")]
            if "normalized_metric" not in sh_cols:
                sync_conn.execute(text("ALTER TABLE signal_history ADD COLUMN normalized_metric VARCHAR DEFAULT NULL"))

            # Check paper_trade_records table
            if "paper_trade_records" in inspector.get_table_names():
                ptr_cols = [c["name"] for c in inspector.get_columns("paper_trade_records")]
                new_ptr_cols = {
                    "mae_r": "FLOAT DEFAULT 0.0",
                    "expected_r": "FLOAT DEFAULT 0.0",
                    "realized_r": "FLOAT DEFAULT 0.0",
                    "regime": "VARCHAR DEFAULT 'NO_TRADE'",
                    "leverage": "FLOAT DEFAULT 1.0",
                    "risk_usd": "FLOAT DEFAULT 0.0",
                }
                for col_name, col_type in new_ptr_cols.items():
                    if col_name not in ptr_cols:
                        sync_conn.execute(text(f"ALTER TABLE paper_trade_records ADD COLUMN {col_name} {col_type}"))

        await conn.run_sync(migrate_columns)
        
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        res = await session.execute(select(UserSetting).where(UserSetting.user_id == "0"))
        default_setting = res.scalar_one_or_none()
        if not default_setting:
            default_setting = UserSetting(user_id="0")
            session.add(default_setting)
            await session.commit()

async def get_db():
    """Dependency for FastAPI routes."""
    async with AsyncSessionLocal() as session:
        yield session
