from backend.app.services.live_paper_runner import live_paper_runner
from backend.app.services.openrouter_client import openrouter_client
"""
Paper Trading REST API Router
Provides endpoints to inspect virtual wallet status, open/closed positions,
and manual administrative wallet reset.
"""

import time
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.paper_trading import paper_trading_session
from backend.app.engine.trade_contract import UnifiedTradeSignal

router = APIRouter(prefix="/api/paper-trading", tags=["Paper Trading"])


class ResetWalletRequest(BaseModel):
    initial_balance: float = Field(default=100.0, description="Virtual balance to reset to")


class DepositRequest(BaseModel):
    amount: float = Field(gt=0, description="Сумма пополнения виртуального кошелька, USDT")
    reason: str = Field(default="Manual top-up", max_length=120)


class OrderSignalRequest(BaseModel):
    symbol: str
    side: str
    price: float
    stop_price: float = 0.0
    target_price: float = 0.0
    quantity: Optional[float] = None
    order_type: str = "LIMIT"
    reason: List[str] = Field(default_factory=lambda: ["Manual UI Signal"])
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


@router.post("/deposit")
async def deposit_paper_wallet(req: DepositRequest):
    """
    Пополнение виртуального кошелька paper-сессии (paper money, без реальных денег).
    Не трогает позиции/ордера/историю — только увеличивает базу баланса и маржу.
    """
    try:
        result = paper_trading_session.deposit(req.amount, reason=req.reason)
        return {"status": "ok", **result, "state": paper_trading_session.get_state().to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/order")
async def place_paper_order(req: OrderSignalRequest):
    """
    Places a paper trading order with risk sizing, stop-loss, target, and mandatory reason.
    Rejects immediately if regime is TOXIC_VOLATILITY or if system is HALTED.
    """
    try:
        direction = "LONG" if req.side.strip().upper() in {"BUY", "LONG"} else "SHORT"
        risk_distance = abs(req.price - req.stop_price)
        reward_distance = abs(req.target_price - req.price)
        signal = UnifiedTradeSignal(
            symbol=req.symbol.upper(),
            timestamp=int(time.time() * 1000),
            direction=direction,
            entry_type=req.order_type.upper(),
            entry_price=req.price,
            sl=req.stop_price,
            tp1=req.target_price,
            expected_rr=max(0.1, reward_distance / risk_distance) if risk_distance > 0 else 0.1,
            reason=req.reason,
        )
        order_res = paper_trading_session.execute_unified_signal(signal, regime=req.regime)
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



class LiveStartRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    strategy_type: str = Field(default="live_density_bounce")
    initial_capital: float = Field(default=10000.0)
    risk_per_trade_pct: float = Field(default=1.0)
    min_density_usd: float = Field(default=500000.0)
    ai_control: bool = Field(default=False)
    stop_loss_pct: float = Field(default=0.8)
    take_profit_pct: float = Field(default=1.6)
    leverage: float = Field(default=2.0)
    maker_fee_pct: float = Field(default=0.02)
    taker_fee_pct: float = Field(default=0.05)
    slippage_ticks: int = Field(default=2)


@router.post("/live/start")
async def start_live_paper_trading(req: LiveStartRequest):
    """Starts the real-time paper trading engine on live FreeBinanceCollector feeds."""
    try:
        status = live_paper_runner.start(req.model_dump())
        return {"status": "ok", "runner": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/live/deposit")
async def deposit_live_paper_wallet(req: DepositRequest):
    """Пополнение виртуального кошелька запущенного live paper-раннера."""
    try:
        result = live_paper_runner.session.deposit(req.amount, reason=req.reason)
        return {"status": "ok", **result, "runner": live_paper_runner.get_status()}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/live/stop")
async def stop_live_paper_trading():
    """Stops the real-time paper trading engine."""
    try:
        status = live_paper_runner.stop()
        return {"status": "ok", "runner": status}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/live/status")
async def get_live_paper_status():
    """Returns live execution state, equity curve, open positions and AI decision logs."""
    return {
        "status": "ok",
        "runner": live_paper_runner.get_status()
    }


class AIRiskEvalRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    setup: Dict[str, Any]
    market_snapshot: Dict[str, Any]
    model: Optional[str] = None


@router.post("/evaluate-ai-risk")
async def evaluate_ai_trade_risk(req: AIRiskEvalRequest):
    """Evaluates prospective trade setup against OpenRouter Risk Sentinel or quant fallback."""
    try:
        res = await openrouter_client.evaluate_trade_risk(
            symbol=req.symbol,
            setup=req.setup,
            market_snapshot=req.market_snapshot,
            model=req.model
        )
        return {"status": "ok", "evaluation": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ai-model-chain-status")
async def get_ai_model_chain_status():
    """Returns telemetry of OpenRouter cascade: spending, daily budget, model availability cache."""
    return {
        "status": "ok",
        "spending": openrouter_client.get_spending_status(),
        "recent_calls": openrouter_client.call_history[-15:],
    }
