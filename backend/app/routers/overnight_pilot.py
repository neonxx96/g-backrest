from typing import List, Optional

from fastapi import APIRouter, HTTPException

from backend.app.services.deep_intent_logger import DeepIntentLogger
from backend.app.services.overnight_pilot import OvernightPilotConfig, overnight_pilot_manager

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
