"""
Backtest Router
POST /api/backtest/run — runs a strategy on real Binance Futures history and
returns summary, trades, chart signals and equity curve (JSON-safe: no NaN/Inf).
"""

import asyncio
import math
import time
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.adapters.exchange.binance import BINANCE_FUTURES_REST
from backend.app.services.binance_service import binance_service
from backend.app.services.orderflow_backtester import OrderFlowBacktester

backtest_router = APIRouter(prefix="/api/backtest", tags=["backtest"])

TF_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}
MAX_CANDLES = 45000  # 30 days of 1m
STRATEGIES = {"density_bounce", "delta_absorption", "ema_trend", "confluence_ema"}


class BacktestParams(BaseModel):
    stop_loss_pct: float = Field(0.8, gt=0, le=50)
    take_profit_pct: float = Field(1.5, gt=0, le=200)
    min_density_usd: float = Field(100000.0, ge=0)
    volume_multiplier: float = Field(1.3, ge=0.5, le=20)
    leverage: float = Field(1.0, ge=1, le=125)


class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "15m"
    days: int = Field(7, ge=1, le=30)
    strategy_type: str = "ema_trend"
    params: BacktestParams = BacktestParams()
    initial_capital: float = Field(10000.0, gt=0)
    # Legacy flat fields (older clients / test_e2e.py). Used only if `params` not sent.
    leverage: Optional[float] = None
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None

    model_config = {"extra": "ignore"}


def _clean(v: Any) -> Any:
    """Recursively replace NaN / +-Infinity with 0.0 and numpy types with python types."""
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return f if math.isfinite(f) else 0.0
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.bool_):
        return bool(v)
    return v


async def fetch_history(symbol: str, timeframe: str, days: int) -> pd.DataFrame:
    """Paginated Binance Futures klines (1500 per request) covering `days` days."""
    tf_min = TF_MINUTES[timeframe]
    need = min(int(days * 1440 / tf_min), MAX_CANDLES)
    end_ms = int(time.time() * 1000)
    session = await binance_service.adapter.get_session()
    rows: List[list] = []

    while len(rows) < need:
        limit = min(1500, need - len(rows))
        params = {"symbol": symbol, "interval": timeframe, "limit": limit, "endTime": end_ms}
        async with session.get(f"{BINANCE_FUTURES_REST}/fapi/v1/klines", params=params) as resp:
            if resp.status != 200:
                raise ValueError(f"Binance klines error {resp.status} for {symbol}")
            chunk = await resp.json()
        if not chunk:
            break
        rows = chunk + rows
        end_ms = int(chunk[0][0]) - 1
        if len(chunk) < limit:
            break

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame({
        "timestamp": [int(k[0]) for k in rows],
        "open": [float(k[1]) for k in rows],
        "high": [float(k[2]) for k in rows],
        "low": [float(k[3]) for k in rows],
        "close": [float(k[4]) for k in rows],
        "volume": [float(k[5]) for k in rows],
        "taker_buy_base_volume": [float(k[9]) for k in rows],
    })
    df["delta"] = 2.0 * df["taker_buy_base_volume"] - df["volume"]
    df = df.drop_duplicates(subset="timestamp").sort_values("timestamp").reset_index(drop=True)
    return df


def _sharpe(equity_curve: List[Dict[str, float]]) -> float:
    eq = np.array([p["equity"] for p in equity_curve], dtype=float)
    if len(eq) < 3:
        return 0.0
    rets = np.diff(eq) / np.where(eq[:-1] == 0, 1.0, eq[:-1])
    sd = float(np.std(rets))
    if sd == 0 or not math.isfinite(sd):
        return 0.0
    # per-trade Sharpe, annualisation is not meaningful for event-driven trades
    return float(np.mean(rets) / sd * math.sqrt(len(rets)))


def build_response(raw: Dict[str, Any], initial_capital: float, meta: Dict[str, Any]) -> Dict[str, Any]:
    raw_trades = raw.get("trades", [])
    trades, signals = [], []
    for idx, t in enumerate(raw_trades, start=1):
        side = "BUY" if t["direction"] == "LONG" else "SELL"
        trades.append({
            "id": idx,
            "entry_time": t["entry_time"],
            "exit_time": t["exit_time"],
            "type": side,
            "entry_price": t["entry_price"],
            "exit_price": t["exit_price"],
            "pnl_pct": t["pnl_pct"],
            "pnl_usd": t["pnl_usd"],
            "reason": t["exit_reason"],
        })
        signals.append({
            "time": t["entry_time"],
            "type": side,
            "price": t["entry_price"],
            "label": f"{side} #{idx}",
            "reason": t["exit_reason"],
            "pnl_pct": t["pnl_pct"],
            "pnl_usd": t["pnl_usd"],
        })

    total = raw.get("total_trades", 0)
    wins = raw.get("wins_count", 0)
    pf = raw.get("profit_factor", 0.0)
    if pf >= 999.0:  # engine sentinel for "no losing trades"
        pf = 999.0

    equity_curve = raw.get("equity_curve", [])
    summary = {
        "total_pnl_pct": raw.get("roi_pct", 0.0),
        "win_rate_pct": raw.get("win_rate_pct", 0.0),
        "total_trades": total,
        "winning_trades": wins,
        "losing_trades": raw.get("losses_count", 0),
        "profit_factor": pf,
        "max_drawdown_pct": raw.get("max_drawdown_pct", 0.0),
        "sharpe_ratio": round(_sharpe(equity_curve), 2),
    }

    return _clean({
        "summary": summary,
        "trades": trades,
        "signals": signals,
        "equity_curve": equity_curve,
        "meta": meta,
        # legacy keys (test_e2e.py / BacktestModal)
        "net_pnl": raw.get("net_pnl", 0.0),
        "roi_pct": raw.get("roi_pct", 0.0),
        "win_rate_pct": raw.get("win_rate_pct", 0.0),
        "total_trades": total,
        "profit_factor": pf,
        "max_drawdown_pct": raw.get("max_drawdown_pct", 0.0),
    })


@backtest_router.post("/run")
async def run_backtest(req: BacktestRequest):
    symbol = req.symbol.strip().upper()
    if req.timeframe not in TF_MINUTES:
        raise HTTPException(status_code=422, detail=f"timeframe must be one of {list(TF_MINUTES)}")
    if req.strategy_type not in STRATEGIES:
        raise HTTPException(status_code=422, detail=f"strategy_type must be one of {sorted(STRATEGIES)}")

    p = req.params
    # Legacy flat fields override only when provided
    leverage = req.leverage if req.leverage is not None else p.leverage
    sl = req.stop_loss_pct if req.stop_loss_pct is not None else p.stop_loss_pct
    tp = req.take_profit_pct if req.take_profit_pct is not None else p.take_profit_pct

    try:
        df = await fetch_history(symbol, req.timeframe, req.days)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"History load failed: {e}")
    if df.empty:
        raise HTTPException(status_code=400, detail=f"No candles for {symbol}")

    engine = OrderFlowBacktester(initial_capital=req.initial_capital)
    raw = await asyncio.to_thread(
        engine.run_backtest,
        df,
        req.strategy_type,
        tp,
        sl,
        False,           # use_trailing: plain SL/TP so results match the UI parameters
        0.5,
        float(leverage),
        100000.0,
        p.volume_multiplier,
        p.min_density_usd,
    )
    if "error" in raw:
        raise HTTPException(status_code=400, detail=raw["error"])

    meta = {
        "symbol": symbol,
        "timeframe": req.timeframe,
        "strategy_type": req.strategy_type,
        "candles": int(len(df)),
        "from_time": int(df["timestamp"].iloc[0]),
        "to_time": int(df["timestamp"].iloc[-1]),
        "requested_days": req.days,
        "note": "min_density_usd is a turnover proxy (close*volume) for density_bounce; historical L2 not used",
    }
    return build_response(raw, req.initial_capital, meta)


class GridSearchRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "5m"
    days: int = Field(7, ge=1, le=30)
    strategy_type: str = "delta_absorption"
    sl_min: float = Field(0.3, gt=0, le=20)
    sl_max: float = Field(1.0, gt=0, le=20)
    sl_step: float = Field(0.2, gt=0, le=10)
    tp_pct: float = Field(1.6, gt=0, le=100)
    wall_min_usd: float = Field(500000.0, ge=0)
    wall_max_usd: float = Field(2000000.0, ge=0)
    wall_step_usd: float = Field(500000.0, gt=0)
    volume_multiplier: float = Field(1.0, ge=0.5, le=20)
    leverage: float = Field(2.0, ge=1, le=125)
    initial_capital: float = Field(10000.0, gt=0)

    model_config = {"extra": "ignore"}


def _build_axis(lo: float, hi: float, step: float, max_pts: int = 8) -> List[float]:
    if hi < lo:
        lo, hi = hi, lo
    if step <= 0 or abs(hi - lo) < 1e-9:
        return [round(lo, 4)]
    vals = []
    cur = lo
    while cur <= hi + 1e-7 and len(vals) < max_pts:
        vals.append(round(cur, 4))
        cur += step
    return vals or [round(lo, 4)]


def _run_grid_sync(df: pd.DataFrame, req: GridSearchRequest) -> Dict[str, Any]:
    sl_vals = _build_axis(req.sl_min, req.sl_max, req.sl_step, max_pts=8)
    wall_vals = _build_axis(req.wall_min_usd, req.wall_max_usd, req.wall_step_usd, max_pts=6)

    engine = OrderFlowBacktester(initial_capital=req.initial_capital)
    enriched_df = engine.calculate_indicators(df) if len(df) >= 60 else df
    rows: List[Dict[str, Any]] = []
    best_raw: Optional[Dict[str, Any]] = None
    best_key = (-1e18, -1e18)
    best_params: Dict[str, Any] = {}

    for sl in sl_vals:
        for wall_usd in wall_vals:
            raw = engine.run_backtest(
                enriched_df,
                req.strategy_type,
                req.tp_pct,
                sl,
                False,
                0.5,
                float(req.leverage),
                100000.0,
                req.volume_multiplier,
                wall_usd,
            )
            if "error" in raw:
                continue
            eq = raw.get("equity_curve", [])
            sharpe = round(_sharpe(eq), 2)
            pnl_pct = float(raw.get("roi_pct", 0.0))
            pf = float(raw.get("profit_factor", 0.0))
            if pf >= 999.0:
                pf = 999.0
            total_trades = int(raw.get("total_trades", 0))
            row = {
                "stop_loss_pct": sl,
                "take_profit_pct": req.tp_pct,
                "min_density_usd": wall_usd,
                "volume_multiplier": req.volume_multiplier,
                "leverage": req.leverage,
                "total_pnl_pct": round(pnl_pct, 2),
                "win_rate_pct": round(float(raw.get("win_rate_pct", 0.0)), 2),
                "profit_factor": round(pf, 2),
                "max_drawdown_pct": round(float(raw.get("max_drawdown_pct", 0.0)), 2),
                "total_trades": total_trades,
                "winning_trades": int(raw.get("wins_count", 0)),
                "losing_trades": int(raw.get("losses_count", 0)),
                "sharpe_ratio": sharpe,
            }
            rows.append(row)
            # Rank combinations with >=1 trade above 0-trade combinations
            has_trades = 1 if total_trades > 0 else 0
            cand_key = (has_trades, sharpe, pnl_pct)
            if best_raw is None or cand_key > (1 if best_params.get("total_trades", 0) > 0 else 0, best_key[0], best_key[1]):
                best_raw = raw
                best_key = (sharpe, pnl_pct)
                best_params = row

    rows.sort(key=lambda r: (1 if r["total_trades"] > 0 else 0, r["sharpe_ratio"], r["total_pnl_pct"]), reverse=True)
    for idx, r in enumerate(rows, start=1):
        r["rank"] = idx

    return {"rows": rows, "best_raw": best_raw, "best_params": best_params}


@backtest_router.post("/optimize")
async def optimize_backtest(req: GridSearchRequest):
    symbol = req.symbol.strip().upper()
    if req.timeframe not in TF_MINUTES:
        raise HTTPException(status_code=422, detail=f"timeframe must be one of {list(TF_MINUTES)}")
    if req.strategy_type not in STRATEGIES:
        raise HTTPException(status_code=422, detail=f"strategy_type must be one of {sorted(STRATEGIES)}")

    try:
        df = await fetch_history(symbol, req.timeframe, req.days)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"History load failed: {e}")
    if df.empty:
        raise HTTPException(status_code=400, detail=f"No candles for {symbol}")

    out = await asyncio.to_thread(_run_grid_sync, df, req)
    rows = out["rows"]
    best_raw = out["best_raw"] or {"trades": [], "equity_curve": []}

    meta = {
        "symbol": symbol,
        "timeframe": req.timeframe,
        "strategy_type": req.strategy_type,
        "candles": int(len(df)),
        "from_time": int(df["timestamp"].iloc[0]),
        "to_time": int(df["timestamp"].iloc[-1]),
        "requested_days": req.days,
        "mode": "grid",
        "combinations_tested": len(rows),
        "best_params": out["best_params"],
    }
    resp = build_response(best_raw, req.initial_capital, meta)
    resp["grid_results"] = _clean(rows)
    return resp

