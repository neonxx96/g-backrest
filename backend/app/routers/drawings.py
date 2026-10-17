"""
Drawings Persistence Router
Endpoints for saving, loading, and clearing user chart drawings in SQLite.
"""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.app.db.database import get_db
from backend.app.db.models import DrawingData

drawings_router = APIRouter(prefix="/api/drawings", tags=["drawings"])

class DrawingSaveSchema(BaseModel):
    user_id: str
    symbol: str
    timeframe: str
    elements_json: str

@drawings_router.get("")
async def get_drawings(
    symbol: str = Query(...), 
    timeframe: str = Query(...), 
    user_id: str = "0", 
    db: AsyncSession = Depends(get_db)
):
    """Fetches saved drawing figures for a given user, coin, and timeframe."""
    res = await db.execute(select(DrawingData).where(
        DrawingData.user_id == user_id,
        DrawingData.symbol == symbol.upper(),
        DrawingData.timeframe == timeframe
    ))
    drawing = res.scalar_one_or_none()
    return {"elements_json": drawing.elements_json if drawing else "[]"}

@drawings_router.post("")
async def save_drawings(
    payload: DrawingSaveSchema, 
    db: AsyncSession = Depends(get_db)
):
    """Saves or updates drawing figures in SQLite."""
    sym = payload.symbol.upper()
    res = await db.execute(select(DrawingData).where(
        DrawingData.user_id == payload.user_id,
        DrawingData.symbol == sym,
        DrawingData.timeframe == payload.timeframe
    ))
    drawing = res.scalar_one_or_none()

    if drawing:
        drawing.elements_json = payload.elements_json
        drawing.updated_at = datetime.utcnow()
    else:
        drawing = DrawingData(
            user_id=payload.user_id,
            symbol=sym,
            timeframe=payload.timeframe,
            elements_json=payload.elements_json,
            updated_at=datetime.utcnow()
        )
        db.add(drawing)

    await db.commit()
    return {"status": "saved", "count": len(payload.elements_json)}

@drawings_router.delete("")
async def delete_drawings(
    symbol: str = Query(...), 
    timeframe: str = Query(...), 
    user_id: str = "0", 
    db: AsyncSession = Depends(get_db)
):
    """Deletes all saved drawing figures for a given user, coin, and timeframe."""
    res = await db.execute(select(DrawingData).where(
        DrawingData.user_id == user_id,
        DrawingData.symbol == symbol.upper(),
        DrawingData.timeframe == timeframe
    ))
    drawing = res.scalar_one_or_none()
    if drawing:
        await db.delete(drawing)
        await db.commit()
        return {"status": "cleared"}
    return {"status": "none"}
