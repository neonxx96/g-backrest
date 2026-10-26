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
        "runner": live_paper_runner.get_status() if live_paper_runner.is_running else (getattr(__import__("backend.app.services.overnight_pilot", fromlist=["overnight_pilot_manager"]).overnight_pilot_manager, "get_unified_live_runner_status", lambda: None)() or live_paper_runner.get_status())
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


@router.get("/analytics/post-mortem")
async def get_post_mortem_analytics(period: str = "all", symbol: Optional[str] = None):
    """Пост-мортем анализ закрытых сделок: причины потерь, MFE/MAE, Fee Burden, рекомендации."""
    from backend.app.services.trade_postmortem_service import analyze_from_db
    periods = {"today": 86_400_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000}
    return await analyze_from_db(periods.get(period), symbol)


@router.get("/closed-trades")
@router.get("/history")
async def get_paper_closed_trades(
    period: str = "all",
    symbol: Optional[str] = None,
    source: Optional[str] = "all",
    sort_by: str = "date",
    sort_order: str = "desc",
    limit: int = 1000,
):
    """
    Returns durable closed paper trades from SQLite (persisted across restarts)
    merged with active runner memory, filtered by time period and symbol,
    with comprehensive summary statistics.
    """
    from datetime import datetime
    from sqlalchemy import select
    from backend.app.db.database import AsyncSessionLocal
    from backend.app.db.models import PaperTradeRecord
    import logging
    import time
    logger = logging.getLogger("SignalScript.PaperTrading")

    now_ms = int(time.time() * 1000)
    period_lower = str(period).lower().strip()
    
    if period_lower == "24h":
        start_ts = now_ms - (24 * 3600 * 1000)
    elif period_lower == "today":
        now_dt = datetime.now()
        midnight_dt = datetime(now_dt.year, now_dt.month, now_dt.day)
        start_ts = int(midnight_dt.timestamp() * 1000)
    elif period_lower == "7d":
        start_ts = now_ms - (7 * 86400 * 1000)
    elif period_lower == "30d":
        start_ts = now_ms - (30 * 86400 * 1000)
    else:
        start_ts = 0

    norm_symbol = symbol.strip().upper() if symbol and symbol.strip().upper() != "ALL" else None

    trades_map = {}

    # 1. Fetch persistent trades from SQLite
    try:
        async with AsyncSessionLocal() as db:
            query = select(PaperTradeRecord)
            if start_ts > 0:
                query = query.where(PaperTradeRecord.exit_ts >= start_ts)
            if norm_symbol:
                query = query.where(PaperTradeRecord.symbol == norm_symbol)
            if source and source != "all":
                query = query.where(PaperTradeRecord.source == source)

            res = await db.execute(query)
            records = res.scalars().all()
            for r in records:
                t_dict = {
                    "id": r.id,
                    "trade_id": r.trade_id,
                    "session_id": r.session_id,
                    "symbol": r.symbol,
                    "side": r.side,
                    "qty": r.qty,
                    "entry_price": r.entry_price,
                    "exit_price": r.exit_price,
                    "target_price": r.target_price,
                    "stop_price": r.stop_price,
                    "gross_pnl": r.gross_pnl,
                    "net_pnl": r.net_pnl,
                    "pnl_percent": r.pnl_percent,
                    "fee": r.fee,
                    "fee_drag": r.fee_drag,
                    "slippage_cost": r.slippage_cost,
                    "mfe": r.mfe,
                    "mae": r.mae,
                    "mfe_r": r.mfe_r,
                    "mae_r": getattr(r, "mae_r", 0.0),
                    "expected_r": getattr(r, "expected_r", 1.5),
                    "realized_r": getattr(r, "realized_r", 0.0),
                    "regime": getattr(r, "regime", "NO_TRADE"),
                    "leverage": getattr(r, "leverage", 1.0),
                    "risk_usd": getattr(r, "risk_usd", 0.0),
                    "profit_bleed": bool(r.profit_bleed),
                    "reason": r.reason,
                    "entry_reason": r.entry_reason,
                    "source": r.source,
                    "_source": r.source,
                    "strategy": r.strategy,
                    "timeframe": r.timeframe,
                    "entry_ts": r.entry_ts,
                    "exit_ts": r.exit_ts,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                key = r.trade_id or f"{r.symbol}:{r.entry_ts}:{r.exit_ts}"
                trades_map[key] = t_dict
    except Exception as e:
        logger.warning("Failed querying paper_trade_records: %s", e)

    # 2. Merge in-memory overnight pilot closed trades directly without full status() serialization
    try:
        from backend.app.services.overnight_pilot import overnight_pilot_manager
        sessions = getattr(overnight_pilot_manager, "sessions", {})
        for sym_key, sess in sessions.items():
            runner = getattr(sess, "runner", None)
            runner_sess = getattr(runner, "session", None)
            if not runner_sess:
                continue
            for t in (getattr(runner_sess, "closed_trades", []) or []):
                t_sym = str(t.get("symbol") or sym_key).upper()
                if norm_symbol and t_sym != norm_symbol:
                    continue
                t_exit = int(t.get("exit_ts") or now_ms)
                if start_ts > 0 and t_exit < start_ts:
                    continue
                cid = t.get("closure_id") or f"pilot:{t_sym}:{t.get('entry_ts')}:{t_exit}"
                if cid not in trades_map:
                    trades_map[cid] = {
                        **t,
                        "trade_id": cid,
                        "source": "marathon",
                        "_source": "marathon",
                        "symbol": t_sym,
                        "exit_ts": t_exit,
                    }
    except Exception as e:
        logger.debug("Failed merging pilot in-memory trades: %s", e)

    # 3. Merge live runner closed trades
    try:
        if live_paper_runner.is_running:
            for t in (live_paper_runner.session.closed_trades or []):
                t_sym = str(t.get("symbol") or live_paper_runner.symbol).upper()
                if norm_symbol and t_sym != norm_symbol:
                    continue
                t_exit = int(t.get("exit_ts") or now_ms)
                if start_ts > 0 and t_exit < start_ts:
                    continue
                cid = t.get("closure_id") or f"live:{t_sym}:{t.get('entry_ts')}:{t_exit}"
                if cid not in trades_map:
                    trades_map[cid] = {
                        **t,
                        "trade_id": cid,
                        "source": "live",
                        "_source": "live",
                        "symbol": t_sym,
                        "exit_ts": t_exit,
                    }
    except Exception as e:
        logger.debug("Failed merging live runner in-memory trades: %s", e)

    trade_list = list(trades_map.values())

    # 4. Sort trades
    is_desc = str(sort_order).lower() != "asc"
    if sort_by == "pnl":
        trade_list.sort(key=lambda x: float(x.get("net_pnl") or 0.0), reverse=is_desc)
    elif sort_by == "symbol":
        trade_list.sort(key=lambda x: str(x.get("symbol") or ""), reverse=is_desc)
    else:  # date / exit_ts
        trade_list.sort(key=lambda x: int(x.get("exit_ts") or 0), reverse=is_desc)

    # 5. Summary metrics
    total_trades = len(trade_list)
    net_pnl = round(sum(float(t.get("net_pnl") or 0.0) for t in trade_list), 2)
    gross_pnl = round(sum(float(t.get("gross_pnl") or 0.0) for t in trade_list), 2)
    total_fees = round(sum(float(t.get("fee_drag") or t.get("fee") or 0.0) for t in trade_list), 2)
    wins = sum(1 for t in trade_list if float(t.get("net_pnl") or 0.0) > 0)
    losses = sum(1 for t in trade_list if float(t.get("net_pnl") or 0.0) <= 0)
    win_rate = round((wins / total_trades * 100.0) if total_trades > 0 else 0.0, 1)
    bleed_count = sum(1 for t in trade_list if t.get("profit_bleed"))
    gross_wins = sum(max(0.0, float(t.get("net_pnl") or 0.0)) for t in trade_list)
    gross_losses = sum(abs(min(0.0, float(t.get("net_pnl") or 0.0))) for t in trade_list)
    profit_factor = round(gross_wins / gross_losses, 2) if gross_losses > 0 else (999.0 if gross_wins > 0 else 0.0)
    realized_r_vals = [float(t["realized_r"]) for t in trade_list if t.get("realized_r") is not None]
    avg_realized_r = round(sum(realized_r_vals) / len(realized_r_vals), 3) if realized_r_vals else 0.0
    valid_mfe_r = [float(t["mfe_r"]) for t in trade_list if t.get("mfe_r") is not None]
    avg_mfe_r = round(sum(valid_mfe_r) / len(valid_mfe_r), 2) if valid_mfe_r else 0.0
    valid_mae_r = [float(t["mae_r"]) for t in trade_list if t.get("mae_r") is not None]
    avg_mae_r = round(sum(valid_mae_r) / len(valid_mae_r), 2) if valid_mae_r else 0.0

    return {
        "status": "ok",
        "period": period,
        "symbol": norm_symbol or "ALL",
        "total_count": total_trades,
        "summary": {
            "total_trades": total_trades,
            "net_pnl": net_pnl,
            "gross_pnl": gross_pnl,
            "total_fees": total_fees,
            "wins": wins,
            "losses": losses,
            "win_rate": win_rate,
            "profit_factor": profit_factor,
            "expectancy_r": avg_realized_r,
            "avg_mfe_r": avg_mfe_r,
            "avg_mae_r": avg_mae_r,
            "profit_bleed_count": bleed_count,
            "avg_trade_pnl": round(net_pnl / total_trades, 2) if total_trades > 0 else 0.0,
        },
        "trades": trade_list[:limit],
    }

