"""
Paper Trading REST API Router
Provides endpoints to inspect virtual wallet status, open/closed positions,
and manual administrative wallet reset.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.paper_trading import paper_trading_session

router = APIRouter(prefix="/api/paper-trading", tags=["Paper Trading"])


class ResetWalletRequest(BaseModel):
    initial_balance: float = Field(default=100.0, description="Virtual balance to reset to")


class OrderSignalRequest(BaseModel):
    symbol: str
    side: str
    price: float
    stop_price: float = 0.0
    target_price: float = 0.0
    quantity: Optional[float] = None
    order_type: str = "LIMIT"
    reason: str = "Manual UI Signal"
    regime: Optional[str] = None


@router.get("/status")
async def get_paper_trading_status():
    """
    Returns current snapshot of the paper trading session:
    - Balance ($100.00 base)
    - Available & Locked Margin
    - Realized & Unrealized PnL
    - Active Positions
    - Active Orders
    - Closed Trades (with reasons, fees, timestamps)
    - Session Uptime
    """
    state = paper_trading_session.get_state()
    return {
        "status": "ok",
        **state.to_dict()
    }


@router.post("/reset")
async def reset_paper_wallet(req: ResetWalletRequest = ResetWalletRequest()):
    """
    Strictly resets paper trading wallet back to initial balance ($100.00 USD).
    Clears all active orders, positions, and closed trades history.
    """
    try:
        paper_trading_session.reset_wallet(req.initial_balance)
        state = paper_trading_session.get_state()
        return {
            "status": "ok",
            "message": f"Paper trading wallet successfully reset to ${req.initial_balance:.2f} USD",
            "state": state.to_dict()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/order")
async def place_paper_order(req: OrderSignalRequest):
    """
    Places a paper trading order with risk sizing, stop-loss, target, and mandatory reason.
    Rejects immediately if regime is TOXIC_VOLATILITY or if system is HALTED.
    """
    try:
        order_res = paper_trading_session.execute_trade_signal(
            symbol=req.symbol.upper(),
            side=req.side.upper(),
            price=req.price,
            stop_price=req.stop_price,
            target_price=req.target_price,
            quantity=req.quantity,
            order_type=req.order_type.upper(),
            reason=req.reason,
            regime=req.regime
        )
        return {"status": "ok", "order": order_res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class KillSwitchRequest(BaseModel):
    reason: str = Field(default="EMERGENCY STOP triggered by user")


@router.post("/kill-switch")
async def trigger_kill_switch(req: KillSwitchRequest = KillSwitchRequest()):
    """
    Emergency Kill Switch:
    - Stops accepting any new orders (sets HALTED status).
    - Immediately cancels all pending/active orders.
    - Closes all active open positions at current market price (Market order with taker fee).
    - Records halt reason and timestamp.
    """
    try:
        res = paper_trading_session.kill_switch(reason=req.reason)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/resume")
async def resume_paper_trading():
    """
    Resumes paper trading after emergency stop (unhalts system).
    """
    try:
        res = paper_trading_session.resume(reason="Admin/UI Resume")
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

