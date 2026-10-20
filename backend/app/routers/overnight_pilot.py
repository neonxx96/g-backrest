from typing import List, Optional

from fastapi import APIRouter, HTTPException

from backend.app.services.overnight_pilot import OvernightPilotConfig, overnight_pilot_manager

router = APIRouter(prefix="/api/overnight-pilot", tags=["overnight-pilot"])


@router.get("/defaults")
async def get_overnight_defaults():
    return {"sessions": [config.model_dump() for config in overnight_pilot_manager.default_configs()]}


@router.get("/status")
async def get_overnight_status():
    await overnight_pilot_manager.persist()
    return overnight_pilot_manager.status()


@router.post("/start")
async def start_overnight_pilot(configs: Optional[List[OvernightPilotConfig]] = None):
    try:
        result = await overnight_pilot_manager.start(configs)
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
async def start_diagnostics_lenient():
    """Start the 90-minute paper-only diagnostic preset against live Binance data."""
    try:
        result = await overnight_pilot_manager.start(overnight_pilot_manager.diagnostics_lenient_configs())
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
async def start_production_robust():
    """Start the calibrated production paper preset; real orders are never sent."""
    try:
        result = await overnight_pilot_manager.start(overnight_pilot_manager.production_robust_configs())
        await overnight_pilot_manager.persist()
        return result
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/stop")
async def stop_overnight_pilot():
    result = await overnight_pilot_manager.stop()
    await overnight_pilot_manager.persist()
    return result
