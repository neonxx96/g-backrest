"""
Workspaces REST API (SQLite persistence for Dockview layouts & Color Links)
Stores layout geometry and tab configurations with schemaVersion: 1.
Strictly NO market data (ticks, candles, orderbook) is saved here.
"""

import json
from datetime import datetime
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.database import AsyncSessionLocal
from backend.app.db.models import Workspace

router = APIRouter(prefix="/api/workspaces", tags=["Workspaces"])

DEFAULT_COLOR_LINKS = {
    "c1": "BTCUSDT",
    "c2": "ETHUSDT",
    "c3": "SOLUSDT",
    "c4": "BNBUSDT",
    "c5": "DOGEUSDT",
    "c6": "XRPUSDT",
    "c7": "SUIUSDT",
    "c8": "NEARUSDT",
    "c9": "PEPEUSDT",
    "c10": "AVAXUSDT"
}

# Preset 1: «Классический трейдер»
# Layout: Chart (center), Watchlist (left), OrderBook + Signals (right)
DEFAULT_CLASSIC_LAYOUT = {
    "schemaVersion": 1,
    "name": "Классический трейдер",
    "activePanel": "chart_main",
    "panels": {
        "chart_main": {"id": "chart_main", "component": "chart", "title": "График (HTF)", "channel": "c1"},
        "orderbook_main": {"id": "orderbook_main", "component": "orderbook", "title": "Стакан DOM", "channel": "c1"},
        "watchlist_main": {"id": "watchlist_main", "component": "watchlist", "title": "Watchlist", "channel": "c1"},
        "signals_main": {"id": "signals_main", "component": "signals", "title": "Лента сигналов", "channel": "c1"}
    },
    "dockview": None  # Managed by dockview.toJSON()
}

# Preset 2: «Скальпер Order Flow»
# Layout: Chart LTF + Chart HTF + OrderBook + CVD Placeholder + Footprint Placeholder + Signals
DEFAULT_ORDERFLOW_LAYOUT = {
    "schemaVersion": 1,
    "name": "Скальпер Order Flow",
    "activePanel": "chart_ltf",
    "panels": {
        "chart_ltf": {"id": "chart_ltf", "component": "chart", "title": "График LTF (1m)", "channel": "c1"},
        "orderbook_main": {"id": "orderbook_main", "component": "orderbook", "title": "Стакан DOM", "channel": "c1"},
        "signals_main": {"id": "signals_main", "component": "signals", "title": "Лента сигналов", "channel": "c1"},
        "footprint_placeholder": {
            "id": "footprint_placeholder",
            "component": "footprint_placeholder",
            "title": "Футпринт / Кластеры",
            "channel": "c1",
            "info": "Модуль кластерного анализа Order Flow (Footprint). Показывает распределение объема покупок и продаж на каждом ценовом уровне свечи."
        },
        "cvd_placeholder": {
            "id": "cvd_placeholder",
            "component": "cvd_placeholder",
            "title": "CVD Дельта",
            "channel": "c1",
            "info": "Кумулятивная дельта объема (CVD) в реальном времени. Детектирует дивергенции между ценой и рыночными ордерами."
        }
    },
    "dockview": None
}


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


class WorkspaceItem(BaseModel):
    id: str
    name: str
    is_default: bool
    updated_at: Optional[datetime] = None


class WorkspaceDetail(BaseModel):
    id: str
    name: str
    is_default: bool
    layout_data: Dict[str, Any]
    color_links: Dict[str, str]
    updated_at: Optional[datetime] = None


class SaveWorkspacePayload(BaseModel):
    id: Optional[str] = None
    name: str
    layout_data: Dict[str, Any]
    color_links: Optional[Dict[str, str]] = None
    is_default: Optional[bool] = False


async def ensure_default_workspaces(db: AsyncSession):
    """Seed the 2 default presets if table is empty"""
    res = await db.execute(select(Workspace).where(Workspace.user_id == "0"))
    existing = res.scalars().all()
    if not existing:
        w1 = Workspace(
            id="default_classic",
            user_id="0",
            name="Классический трейдер",
            layout_data=json.dumps(DEFAULT_CLASSIC_LAYOUT, ensure_ascii=False),
            color_links=json.dumps(DEFAULT_COLOR_LINKS),
            is_default=True
        )
        w2 = Workspace(
            id="default_orderflow",
            user_id="0",
            name="Скальпер Order Flow",
            layout_data=json.dumps(DEFAULT_ORDERFLOW_LAYOUT, ensure_ascii=False),
            color_links=json.dumps(DEFAULT_COLOR_LINKS),
            is_default=False
        )
        db.add(w1)
        db.add(w2)
        await db.commit()


@router.get("", response_model=List[WorkspaceItem])
async def list_workspaces(db: AsyncSession = Depends(get_db)):
    """Return all workspaces (up to 10 presets)"""
    await ensure_default_workspaces(db)
    res = await db.execute(
        select(Workspace).where(Workspace.user_id == "0").order_by(Workspace.created_at.asc())
    )
    workspaces = res.scalars().all()
    return [
        WorkspaceItem(
            id=w.id,
            name=w.name,
            is_default=w.is_default,
            updated_at=w.updated_at
        )
        for w in workspaces
    ]


@router.get("/{workspace_id}", response_model=WorkspaceDetail)
async def get_workspace(workspace_id: str, db: AsyncSession = Depends(get_db)):
    """Fetch single workspace with full layout_data and color_links"""
    await ensure_default_workspaces(db)
    res = await db.execute(
        select(Workspace).where(Workspace.user_id == "0", Workspace.id == workspace_id)
    )
    w = res.scalar_one_or_none()
    if not w:
        # Fallback to default classic if not found
        res_default = await db.execute(
            select(Workspace).where(Workspace.user_id == "0", Workspace.id == "default_classic")
        )
        w = res_default.scalar_one_or_none()
        if not w:
            raise HTTPException(status_code=404, detail="Воркспейс не найден")

    try:
        layout_dict = json.loads(w.layout_data)
    except Exception:
        layout_dict = DEFAULT_CLASSIC_LAYOUT

    try:
        colors_dict = json.loads(w.color_links)
    except Exception:
        colors_dict = DEFAULT_COLOR_LINKS

    # Ensure schemaVersion exists
    if "schemaVersion" not in layout_dict:
        layout_dict["schemaVersion"] = 1

    return WorkspaceDetail(
        id=w.id,
        name=w.name,
        is_default=w.is_default,
        layout_data=layout_dict,
        color_links=colors_dict,
        updated_at=w.updated_at
    )


@router.post("", response_model=WorkspaceDetail)
async def save_workspace(payload: SaveWorkspacePayload, db: AsyncSession = Depends(get_db)):
    """Save or update workspace. Max 10 presets limit enforced."""
    res = await db.execute(select(Workspace).where(Workspace.user_id == "0"))
    all_ws = res.scalars().all()

    target_id = payload.id
    if not target_id:
        if len(all_ws) >= 10:
            raise HTTPException(
                status_code=400,
                detail="Достигнут лимит пресетов (максимум 10). Удалите один из существующих."
            )
        target_id = f"preset_{int(datetime.utcnow().timestamp())}"

    # Verify schemaVersion in layout_data
    layout_data = dict(payload.layout_data)
    if "schemaVersion" not in layout_data:
        layout_data["schemaVersion"] = 1

    layout_str = json.dumps(layout_data, ensure_ascii=False)
    color_links_str = json.dumps(payload.color_links or DEFAULT_COLOR_LINKS, ensure_ascii=False)

    existing_ws = next((w for w in all_ws if w.id == target_id), None)
    if existing_ws:
        existing_ws.name = payload.name
        existing_ws.layout_data = layout_str
        existing_ws.color_links = color_links_str
        existing_ws.updated_at = datetime.utcnow()
        await db.commit()
        await db.refresh(existing_ws)
        saved = existing_ws
    else:
        new_ws = Workspace(
            id=target_id,
            user_id="0",
            name=payload.name,
            layout_data=layout_str,
            color_links=color_links_str,
            is_default=bool(payload.is_default),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(new_ws)
        await db.commit()
        await db.refresh(new_ws)
        saved = new_ws

    return WorkspaceDetail(
        id=saved.id,
        name=saved.name,
        is_default=saved.is_default,
        layout_data=layout_data,
        color_links=payload.color_links or DEFAULT_COLOR_LINKS,
        updated_at=saved.updated_at
    )


@router.delete("/{workspace_id}")
async def delete_workspace(workspace_id: str, db: AsyncSession = Depends(get_db)):
    """Delete custom workspace (default presets are protected)"""
    if workspace_id in ("default_classic", "default_orderflow"):
        raise HTTPException(status_code=400, detail="Нельзя удалить пресет по умолчанию")

    res = await db.execute(
        select(Workspace).where(Workspace.user_id == "0", Workspace.id == workspace_id)
    )
    w = res.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Воркспейс не найден")

    await db.delete(w)
    await db.commit()
    return {"status": "ok", "deleted_id": workspace_id}
