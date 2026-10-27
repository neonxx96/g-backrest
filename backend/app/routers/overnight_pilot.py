from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.overnight_pilot import OvernightPilotConfig, overnight_pilot_manager
from backend.app.services.pair_selector import build_pilot_configs, load_last_selection, run_selection

router = APIRouter(prefix="/api/overnight-pilot", tags=["overnight-pilot"])


@router.get("/defaults")
async def get_overnight_defaults():
    return {"sessions": [config.model_dump() for config in overnight_pilot_manager.default_configs()]}


@router.get("/diversified-paper/defaults")
async def get_diversified_paper_defaults():
    return {"sessions": [config.model_dump() for config in overnight_pilot_manager.diversified_paper_configs()]}


@router.get("/status")
async def get_overnight_status():
    return overnight_pilot_manager.status()


@router.get("/events")
def get_paper_events(
    run_id: Optional[str] = None,
    symbol: Optional[str] = None,
    source: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = 100,
):
    """Read bounded run-scoped decision telemetry; legacy rows have no inferred run."""
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 500")
    intent_logger = getattr(overnight_pilot_manager, "intent_logger", None) or DeepIntentLogger()
    filters = {
        "run_id": run_id,
        "symbol": symbol.upper() if symbol else None,
        "source": source,
        "event_type": event_type,
    }
    events = intent_logger.read_recent(limit=limit, **filters)
    return {"events": events, "count": len(events), "filters": {**filters, "limit": limit}}


@router.post("/start")
async def start_overnight_pilot(
    configs: Optional[List[OvernightPilotConfig]] = None,
    preflight_id: Optional[str] = None,
):
    try:
        result = await overnight_pilot_manager.start(configs, preflight_id=preflight_id)
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/preflight")
async def preflight_overnight_pilot(configs: Optional[List[OvernightPilotConfig]] = None):
    """Run backtest + forecast and leave paper mode stopped for review."""
    try:
        result = await overnight_pilot_manager.preflight(configs)
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/diversified-paper/preflight")
async def preflight_diversified_paper():
    """Prepare the BTC/ETH/SOL three-strategy paper plan without placing orders."""
    try:
        result = await overnight_pilot_manager.preflight(overnight_pilot_manager.diversified_paper_configs())
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/diversified-paper/start")
async def start_diversified_paper(preflight_id: Optional[str] = None):
    """Start the virtual-only three-strategy paper plan; real orders are never sent."""
    try:
        result = await overnight_pilot_manager.start(overnight_pilot_manager.diversified_paper_configs(), preflight_id=preflight_id)
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/diagnostics-lenient/preflight")
async def preflight_diagnostics_lenient():
    """Prepare the explicitly non-production short execution diagnostic preset."""
    try:
        result = await overnight_pilot_manager.preflight(overnight_pilot_manager.diagnostics_lenient_configs())
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/diagnostics-lenient/start")
async def start_diagnostics_lenient(preflight_id: Optional[str] = None):
    """Start the 90-minute paper-only diagnostic preset against live Binance data."""
    try:
        result = await overnight_pilot_manager.start(overnight_pilot_manager.diagnostics_lenient_configs(), preflight_id=preflight_id)
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/naked-test/preflight")
async def preflight_naked_test():
    """Prepare the intentionally unfiltered, paper-only EMA-cross probe."""
    try:
        result = await overnight_pilot_manager.preflight(overnight_pilot_manager.naked_test_configs())
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/naked-test/start")
async def start_naked_test(preflight_id: Optional[str] = None):
    """Run the 15-minute virtual-only EMA-cross probe; no live order path exists."""
    try:
        result = await overnight_pilot_manager.start(overnight_pilot_manager.naked_test_configs(), preflight_id=preflight_id)
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/production-robust/preflight")
async def preflight_production_robust():
    """Prepare the calibrated fee-aware paper preset without placing paper orders."""
    try:
        result = await overnight_pilot_manager.preflight(overnight_pilot_manager.production_robust_configs())
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/production-robust/start")
async def start_production_robust(preflight_id: Optional[str] = None):
    """Start the calibrated production paper preset; real orders are never sent."""
    try:
        result = await overnight_pilot_manager.start(overnight_pilot_manager.production_robust_configs(), preflight_id=preflight_id)
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/optimal-live/preflight")
async def preflight_optimal_live():
    """Prepare the 1,000-USDT-per-symbol optimal paper preset without orders."""
    try:
        result = await overnight_pilot_manager.preflight(overnight_pilot_manager.optimal_live_configs())
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/optimal-live/start")
async def start_optimal_live(preflight_id: Optional[str] = None):
    """Start the virtual-only optimal preset with deep intent logging."""
    try:
        result = await overnight_pilot_manager.start(overnight_pilot_manager.optimal_live_configs(), preflight_id=preflight_id)
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/stop")
async def stop_overnight_pilot():
    result = await overnight_pilot_manager.stop()
    await overnight_pilot_manager.persist()
    return result


class AutoSelectRequest(BaseModel):
    """Параметры авто-настройки: подбор стратегий под монеты и запуск paper-марафона."""
    symbols: Optional[List[str]] = None
    days: int = Field(14, ge=3, le=30)
    include_explore: bool = True
    duration_hours: float = Field(24.0, gt=0, le=168)
    rerun: bool = True
    start: bool = True


@router.get("/auto-select/last")
async def get_last_auto_selection():
    """Последний результат подбора стратегий (data/pair_selection.json)."""
    return load_last_selection() or {"results": [], "counts": {}}


@router.post("/auto-select")
async def auto_select_and_start(req: AutoSelectRequest = AutoSelectRequest()):
    """Один вызов: подобрать оптимальные стратегии/ТФ по терминальным данным (TRAIN/OOS)
    и запустить paper-марафон только на подтверждённых парах. Реальные ордера не отправляются."""
    selection = None if req.rerun else load_last_selection()
    if selection is None:
        selection = await run_selection(req.symbols, req.days)
    raw = build_pilot_configs(selection, include_explore=req.include_explore, duration_hours=req.duration_hours)
    if not raw:
        return {"started": False, "reason": "ни одна пара не прошла отбор - торговля не запущена (кэш)",
                "counts": selection.get("counts", {}), "results": selection.get("results", [])}
    if not req.start:
        return {"started": False, "preview": raw, "counts": selection.get("counts", {})}
    try:
        configs = [OvernightPilotConfig(**c) for c in raw]
        await overnight_pilot_manager.stop()
        result = await overnight_pilot_manager.start(configs)
        await overnight_pilot_manager.persist()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"started": True, "pairs": [(c["symbol"], c["strategy_type"], c["timeframe"], c["risk_per_trade_pct"]) for c in raw],
            "counts": selection.get("counts", {}), "result": result}


class PausePairRequest(BaseModel):
    close_position: bool = False
    reason: str = "USER_REQUEST"


class ClosePairRequest(BaseModel):
    reason: str = "EMERGENCY_CLOSE_USER"


@router.get("/pairs")
async def get_pairs_status():
    """Get list of active pairs and their operational status (active, paused, closed)."""
    return {"pairs": overnight_pilot_manager.get_pairs()}


@router.post("/pairs/{symbol}/pause")
async def pause_trading_pair(symbol: str, req: PausePairRequest = PausePairRequest()):
    """Pause trading for a single pair: blocks new entries, optionally closes active position."""
    try:
        return await overnight_pilot_manager.pause_pair(
            symbol=symbol,
            close_position=req.close_position,
            reason=req.reason,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/pairs/{symbol}/resume")
async def resume_trading_pair(symbol: str, reason: str = "USER_REQUEST"):
    """Resume trading for a single pair."""
    try:
        return await overnight_pilot_manager.resume_pair(symbol=symbol, reason=reason)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/pairs/{symbol}/close")
async def emergency_close_pair(symbol: str, req: ClosePairRequest = ClosePairRequest()):
    """Emergency close open position for a single pair by market."""
    try:
        return await overnight_pilot_manager.close_pair(symbol=symbol, reason=req.reason)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/pairs/pause-all")
async def pause_all_trading_pairs(close_positions: bool = False):
    """Pause trading across all pairs."""
    try:
        return await overnight_pilot_manager.pause_all_pairs(close_positions=close_positions)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/pairs/resume-all")
async def resume_all_trading_pairs():
    """Resume trading across all pairs."""
    try:
        return await overnight_pilot_manager.resume_all_pairs()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
