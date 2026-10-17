"""
Database Engine & Session Management (Async SQLite)
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from backend.app.config import DATABASE_URL
from backend.app.db.models import Base, UserSetting

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True
)

AsyncSessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

async def init_db():
    """Initializes tables and seeds default user_id='0' settings."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
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
