"""
Backtest Router
POST /api/backtest/run — runs a strategy on real Binance Futures history with realistic
Maker/Taker fees, stop slippage ticks, Multi-TP scaling out, and 500-run Monte Carlo stress test.
POST /api/backtest/optimize — runs fast heuristic Genetic Optimization (or Grid Search) in < 3s.
"""

import asyncio
import math
import time
from typing import Any, Dict, List, Optional

import aiohttp
import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.adapters.exchange.binance import BINANCE_FUTURES_REST
from backend.app.services.binance_service import binance_service
from backend.app.services.orderflow_backtester import OrderFlowBacktester, orderflow_backtester

backtest_router = APIRouter(prefix="/api/backtest", tags=["backtest"])

TF_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240}
MAX_CANDLES = 45000  # 30 days of 1m

STRATEGIES_CATALOG = [
    {
        "id": "confluence_ema",
        "name": "Квант-Конфлюенс (EMA + CVD + RSI + ATR)",
        "engine_domain": "historical_flow",
        "is_historical_ready": True,
        "description": "Мультифакторный сетап по тренду с фильтрацией зон перекупленности и поглощения дельты. Основан на 100% реальных исторических данных биржи (OHLCV + Taker Buy Volume).",
        "badge": "Реальная история"
    },
    {
        "id": "cvd_absorption",
        "name": "Поглощение объёма (CVD Absorption)",
        "engine_domain": "historical_flow",
        "is_historical_ready": True,
        "description": "Выявление расхождения между ценовыми экстремумами и кумулятивной дельтой (CVD Divergence) с подтверждением всплеска объема.",
        "badge": "Реальная история"
    },
    {
        "id": "cluster_volume_bounce",
        "aliases": ["density_bounce", "limit_bounce"],
        "name": "Отскок от объёмного кластера (Volume Climax)",
        "engine_domain": "historical_flow",
        "is_historical_ready": True,
        "description": "Пинбар с кульминацией кластерного объема свечи и истощением дельты. Честная математическая замена стаканных плотностей на исторических данных.",
        "badge": "Реальная история"
    },
    {
        "id": "ema_trend",
        "name": "Импульс тренда EMA(20/50)",
        "engine_domain": "historical_flow",
        "is_historical_ready": True,
        "description": "Трендовое пересечение скользящих средних с подтверждением рыночных покупок/продаж по дельте.",
        "badge": "Реальная история"
    },
    {
        "id": "live_density_bounce",
        "name": "Отскок от плотности стакана L2",
        "engine_domain": "live_orderbook",
        "is_historical_ready": False,
        "description": "Работает ТОЛЬКО в реальном времени по живому стакану L2 с детекцией спуфинга и проверкой времени жизни стенки (> 30 сек). Биржа не хранит историческую книгу заявок.",
        "badge": "Только Live L2"
    },
    {
        "id": "live_wall_breakout",
        "name": "Пробой крупной стенки стакана L2",
        "engine_domain": "live_orderbook",
        "is_historical_ready": False,
        "description": "Работает ТОЛЬКО в реальном времени при разъедании крупной лимитной плотности маркет-ордерами.",
        "badge": "Только Live L2"
    }
]

STRATEGIES = {
    "density_bounce",
    "limit_bounce",
    "cluster_volume_bounce",
    "wall_breakout",
    "breakout",
    "delta_absorption",
    "cvd_absorption",
    "ema_trend",
    "confluence_ema",
}


class BacktestParams(BaseModel):
    stop_loss_pct: float = Field(0.8, gt=0, le=50)
    take_profit_pct: float = Field(1.5, gt=0, le=200)
    min_density_usd: float = Field(100000.0, ge=0)
    volume_multiplier: float = Field(1.3, ge=0.5, le=20)
    leverage: float = Field(1.0, ge=1, le=125)
    # Confluence Filter Suite
    use_atr_filter: bool = False
    use_atr_sl: bool = False
    atr_multiplier: float = Field(1.5, ge=0.1, le=10.0)
    use_cvd_filter: bool = False
    use_oi_filter: bool = False
    use_rsi_filter: bool = False
    # ТАКТ 1: Realistic Execution Engine & Multi-TP Scaling Out
    maker_fee_pct: float = Field(0.02, ge=0.0, le=2.0)
    taker_fee_pct: float = Field(0.05, ge=0.0, le=2.0)
    slippage_ticks: int = Field(2, ge=0, le=20)
    use_multi_tp: bool = True
    tp1_pct: float = Field(0.6, gt=0, le=50)
    tp1_atr_mult: float = Field(1.5, gt=0, le=10)
    atr_period: int = Field(14, ge=3, le=100)
    # Ночной спринт ТАКТ 1: Расширенный конфигуратор стратегии
    entry_mode: Optional[str] = None
    sl_mode: str = "fixed_pct"
    wall_sl_offset_ticks: int = Field(3, ge=1, le=30)
    tp1_rr_ratio: float = Field(1.5, ge=0.5, le=10.0)
    tp2_mode: str = "trend_rr"
    tp2_rr_ratio: float = Field(2.8, ge=1.0, le=15.0)
    min_wall_lifetime_sec: int = Field(30, ge=10, le=60)
    # Unified Indicators Configuration { "indicator_id": { "params": {...} } }
    indicators: Optional[Dict[str, Dict[str, Any]]] = None


class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "15m"
    days: int = Field(7, ge=1, le=30)
    strategy_type: str = "ema_trend"
    strategy: Optional[str] = None
    params: BacktestParams = BacktestParams()
    initial_capital: float = Field(10000.0, gt=0)
    # Unified Indicators Configuration
    indicators: Optional[Dict[str, Dict[str, Any]]] = None
    # Legacy / flat override fields
    leverage: Optional[float] = None
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None
    sl_pct: Optional[float] = None
    tp_pct: Optional[float] = None
    use_atr_filter: Optional[bool] = None
    use_atr_sl: Optional[bool] = None
    atr_multiplier: Optional[float] = None
    use_cvd_filter: Optional[bool] = None
    use_oi_filter: Optional[bool] = None
    use_rsi_filter: Optional[bool] = None
    maker_fee_pct: Optional[float] = None
    taker_fee_pct: Optional[float] = None
    slippage_ticks: Optional[int] = None
    use_multi_tp: Optional[bool] = None
    entry_mode: Optional[str] = None
    sl_mode: Optional[str] = None
    wall_sl_offset_ticks: Optional[int] = None
    tp1_rr_ratio: Optional[float] = None
    tp2_mode: Optional[str] = None
    tp2_rr_ratio: Optional[float] = None
    min_wall_lifetime_sec: Optional[int] = None

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


_HISTORY_CACHE: Dict[tuple, tuple] = {}
_HISTORY_CACHE_TTL_SEC = 60.0


async def fetch_history(symbol: str, timeframe: str, days: int) -> pd.DataFrame:
    """Paginated Binance klines with multi-endpoint fallback (Futures -> Spot -> Vision) and 60s TTL cache."""
    cache_key = (symbol.upper(), timeframe, int(days))
    now_ts = time.time()
    cached = _HISTORY_CACHE.get(cache_key)
    if cached is not None and (now_ts - cached[0]) < _HISTORY_CACHE_TTL_SEC:
        return cached[1].copy()

    tf_min = TF_MINUTES.get(timeframe, 5)
    need = min(int(days * 1440 / tf_min), MAX_CANDLES)
    session = await binance_service.adapter.get_session()

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    endpoints = [
        {"url": f"{BINANCE_FUTURES_REST}/fapi/v1/klines", "max_limit": 1500},
        {"url": "https://api.binance.com/api/v3/klines", "max_limit": 1000},
        {"url": "https://data-api.binance.vision/api/v3/klines", "max_limit": 1000}
    ]

    rows: List[list] = []

    for ep in endpoints:
        rows = []
        end_ms = int(time.time() * 1000)
        max_chunk = ep["max_limit"]
        endpoint_ok = True

        while len(rows) < need:
            limit = min(max_chunk, need - len(rows))
            params = {"symbol": symbol, "interval": timeframe, "limit": limit, "endTime": end_ms}
            try:
                async with session.get(ep["url"], params=params, headers=headers, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                    if resp.status == 200:
                        chunk = await resp.json()
                        if not chunk or not isinstance(chunk, list):
                            break
                        rows = chunk + rows
                        end_ms = int(chunk[0][0]) - 1
                        if len(chunk) < limit:
                            break
                    else:
                        endpoint_ok = False
                        break
            except Exception:
                endpoint_ok = False
                break

        if endpoint_ok and rows:
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

    # Attempt to enrich with real Open Interest from Binance Futures
    if timeframe in {"5m", "15m", "30m", "1h", "4h"}:
        try:
            oi_limit = min(500, max(50, int(days * 1440 / TF_MINUTES[timeframe])))
            async with session.get(
                f"{BINANCE_FUTURES_REST}/futures/data/openInterestHist",
                params={"symbol": symbol, "period": timeframe, "limit": oi_limit},
                timeout=5
            ) as oi_resp:
                if oi_resp.status == 200:
                    oi_json = await oi_resp.json()
                    if oi_json and isinstance(oi_json, list):
                        oi_df = pd.DataFrame({
                            "timestamp": [int(item["timestamp"]) for item in oi_json],
                            "oi": [float(item["sumOpenInterest"]) for item in oi_json],
                        }).drop_duplicates("timestamp").sort_values("timestamp")
                        df = pd.merge_asof(
                            df,
                            oi_df,
                            on="timestamp",
                            direction="backward"
                        )
                        df["oi"] = df["oi"].ffill().bfill()
        except Exception:
            pass

    _HISTORY_CACHE[cache_key] = (now_ts, df)
    return df.copy()


def _sharpe(equity_curve: List[Dict[str, float]]) -> float:
    eq = np.array([float(p["equity"]) for p in equity_curve], dtype=float)
    if len(eq) < 3:
        return 0.0
    rets = np.diff(eq) / np.where(eq[:-1] == 0, 1.0, eq[:-1])
    sd = float(np.std(rets))
    if sd == 0 or not math.isfinite(sd):
        return 0.0
    return float(np.mean(rets) / sd * math.sqrt(len(rets)))


def build_response(raw: Dict[str, Any], initial_capital: float, meta: Dict[str, Any]) -> Dict[str, Any]:
    raw_trades = raw.get("trades", [])
    trades, signals = [], []
    for idx, t in enumerate(raw_trades, start=1):
        side = "BUY" if t["direction"] == "LONG" else "SELL"
        ctx = t.get("context_snapshot") or {}
        trades.append({
            "id": idx,
            "entry_time": t["entry_time"],
            "exit_time": t["exit_time"],
            "type": side,
            "entry_price": t["entry_price"],
            "exit_price": t["exit_price"],
            "gross_pnl_usd": t.get("gross_pnl_usd", t["pnl_usd"]),
            "gross_pnl_pct": t.get("gross_pnl_pct", t["pnl_pct"]),
            "fee_paid_usd": t.get("fee_paid_usd", 0.0),
            "slippage_cost_usd": t.get("slippage_cost_usd", 0.0),
            "tp1_hit": t.get("tp1_hit", False),
            "pnl_pct": t["pnl_pct"],
            "pnl_usd": t["pnl_usd"],
            "reason": t["exit_reason"],
            "context_snapshot": ctx
        })
        signals.append({
            "time": t["entry_time"],
            "type": side,
            "price": t["entry_price"],
            "label": f"{side} #{idx}",
            "reason": t["exit_reason"],
            "pnl_pct": t["pnl_pct"],
            "pnl_usd": t["pnl_usd"],
            "context_snapshot": ctx
        })

    total = raw.get("total_trades", 0)
    wins = raw.get("wins_count", 0)
    pf = raw.get("profit_factor", 0.0)
    if pf >= 999.0:
        pf = 999.0

    equity_curve = raw.get("equity_curve", [])
    sharpe_val = raw.get("sharpe_ratio")
    if sharpe_val is None:
        sharpe_val = round(_sharpe(equity_curve), 2)

    summary = {
        "total_pnl_pct": raw.get("roi_pct", 0.0),
        "net_pnl_usd": raw.get("net_pnl", 0.0),
        "gross_pnl_usd": raw.get("gross_pnl", raw.get("net_pnl", 0.0)),
        "gross_pnl_pct": raw.get("gross_roi_pct", raw.get("roi_pct", 0.0)),
        "total_fees_usd": raw.get("total_fees_usd", 0.0),
        "total_slippage_usd": raw.get("total_slippage_usd", 0.0),
        "total_exchange_cost_usd": raw.get("total_exchange_cost_usd", raw.get("total_fees_usd", 0.0)),
        "recovery_factor": raw.get("recovery_factor", 0.0),
        "win_rate_pct": raw.get("win_rate_pct", 0.0),
        "total_trades": total,
        "winning_trades": wins,
        "losing_trades": raw.get("losses_count", 0),
        "profit_factor": pf,
        "max_drawdown_pct": raw.get("max_drawdown_pct", 0.0),
        "sharpe_ratio": round(float(sharpe_val), 2),
        "sortino_ratio": round(float(raw.get("sortino_ratio", 0.0)), 2),
    }

    return _clean({
        "summary": summary,
        "trades": trades,
        "signals": signals,
        "equity_curve": equity_curve,
        "confluence_matrix": raw.get("confluence_matrix", []),
        "monte_carlo": raw.get("monte_carlo"),
        "execution_config": raw.get("execution_config"),
        "data_feed_context": raw.get("data_feed_context"),
        "active_position_setup": raw.get("active_position_setup"),
        "meta": meta,
        # legacy keys (test_e2e.py / BacktestModal / AICopilotSidebar)
        "net_pnl": raw.get("net_pnl", 0.0),
        "total_pnl_usd": raw.get("net_pnl", 0.0),
        "data_engine": {
            "class": "Historical Flow & Volume Engine",
            "status": "Verified Real History",
            "historical_sources": ["Binance Futures OHLCV", "Taker Buy Base Volume (Delta)", "Open Interest 1h Delta"],
            "l2_orderbook_available_on_history": False,
            "disclaimer": "Биржа Binance не хранит историческую книгу заявок L2. Симуляция основана на реальном тиковом объёме покупок/продаж (CVD) и свечных кластерах."
        },
        "gross_pnl": raw.get("gross_pnl", 0.0),
        "total_fees_usd": raw.get("total_fees_usd", 0.0),
        "total_slippage_usd": raw.get("total_slippage_usd", 0.0),
        "recovery_factor": raw.get("recovery_factor", 0.0),
        "roi_pct": raw.get("roi_pct", 0.0),
        "win_rate_pct": raw.get("win_rate_pct", 0.0),
        "win_rate": raw.get("win_rate_pct", 0.0),
        "total_trades": total,
        "trades_count": total,
        "profit_factor": pf,
        "max_drawdown_pct": raw.get("max_drawdown_pct", 0.0),
    })


@backtest_router.get("/strategies")
async def get_strategies():
    """Returns catalog of quantitative strategies with strict Historical vs Live L2 separation."""
    return {"strategies": STRATEGIES_CATALOG}


@backtest_router.post("/run")
async def run_backtest(req: BacktestRequest):
    symbol = req.symbol.strip().upper()
    if req.timeframe not in TF_MINUTES:
        raise HTTPException(status_code=422, detail=f"timeframe must be one of {list(TF_MINUTES)}")

    eff_strategy = req.strategy or req.strategy_type
    if eff_strategy == "cluster_volume_bounce":
        eff_strategy = "density_bounce"

    if eff_strategy not in STRATEGIES:
        raise HTTPException(status_code=422, detail=f"strategy_type must be one of {sorted(STRATEGIES)}")

    p = req.params
    leverage = req.leverage if req.leverage is not None else p.leverage
    sl = req.stop_loss_pct if req.stop_loss_pct is not None else (req.sl_pct if req.sl_pct is not None else p.stop_loss_pct)
    tp = req.take_profit_pct if req.take_profit_pct is not None else (req.tp_pct if req.tp_pct is not None else p.take_profit_pct)
    use_atr_filter = req.use_atr_filter if req.use_atr_filter is not None else p.use_atr_filter
    use_atr_sl = req.use_atr_sl if req.use_atr_sl is not None else p.use_atr_sl
    atr_multiplier = req.atr_multiplier if req.atr_multiplier is not None else p.atr_multiplier
    use_cvd_filter = req.use_cvd_filter if req.use_cvd_filter is not None else p.use_cvd_filter
    use_oi_filter = req.use_oi_filter if req.use_oi_filter is not None else p.use_oi_filter
    use_rsi_filter = req.use_rsi_filter if req.use_rsi_filter is not None else p.use_rsi_filter

    maker_fee_pct = req.maker_fee_pct if req.maker_fee_pct is not None else p.maker_fee_pct
    taker_fee_pct = req.taker_fee_pct if req.taker_fee_pct is not None else p.taker_fee_pct
    slippage_ticks = req.slippage_ticks if req.slippage_ticks is not None else p.slippage_ticks
    use_multi_tp = req.use_multi_tp if req.use_multi_tp is not None else p.use_multi_tp

    entry_mode = req.entry_mode if req.entry_mode is not None else p.entry_mode
    sl_mode = req.sl_mode if req.sl_mode is not None else p.sl_mode
    wall_sl_offset_ticks = req.wall_sl_offset_ticks if req.wall_sl_offset_ticks is not None else p.wall_sl_offset_ticks
    tp1_rr_ratio = req.tp1_rr_ratio if req.tp1_rr_ratio is not None else p.tp1_rr_ratio
    tp2_mode = req.tp2_mode if req.tp2_mode is not None else p.tp2_mode
    tp2_rr_ratio = req.tp2_rr_ratio if req.tp2_rr_ratio is not None else p.tp2_rr_ratio
    min_wall_lifetime_sec = req.min_wall_lifetime_sec if req.min_wall_lifetime_sec is not None else p.min_wall_lifetime_sec

    try:
        df = await fetch_history(symbol, req.timeframe, req.days)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"History load failed: {e}")
    if df.empty:
        raise HTTPException(status_code=400, detail=f"No candles for {symbol}")

    custom_indicators = req.indicators or p.indicators
    if custom_indicators:
        from backend.app.engine.indicators import compute_indicators
        df = compute_indicators(df, custom_indicators)
        if "atr" in custom_indicators:
            atr_param = custom_indicators["atr"].get("params", {}).get("period")
            if atr_param:
                p.atr_period = int(atr_param)
        if "rsi" in custom_indicators:
            use_rsi_filter = True
        if "cvd" in custom_indicators:
            use_cvd_filter = True

    engine = OrderFlowBacktester(
        initial_capital=req.initial_capital,
        maker_fee_pct=maker_fee_pct,
        taker_fee_pct=taker_fee_pct,
        slippage_ticks=slippage_ticks,
    )
    raw = await asyncio.to_thread(
        engine.run_backtest,
        df,
        eff_strategy,
        tp,
        sl,
        False,
        0.5,
        float(leverage),
        100000.0,
        p.volume_multiplier,
        p.min_density_usd,
        use_atr_filter,
        use_atr_sl,
        float(atr_multiplier),
        use_cvd_filter,
        use_oi_filter,
        use_rsi_filter,
        maker_fee_pct,
        taker_fee_pct,
        slippage_ticks,
        use_multi_tp,
        p.tp1_pct,
        p.tp1_atr_mult,
        p.atr_period,
        14,
        True,
        False,
        entry_mode,
        sl_mode,
        wall_sl_offset_ticks,
        tp1_rr_ratio,
        tp2_mode,
        tp2_rr_ratio,
        min_wall_lifetime_sec,
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
        "custom_indicators": list(custom_indicators.keys()) if custom_indicators else [],
        "requested_days": req.days,
        "execution": {
            "maker_fee_pct": maker_fee_pct,
            "taker_fee_pct": taker_fee_pct,
            "slippage_ticks": slippage_ticks,
            "use_multi_tp": use_multi_tp,
        },
        "confluence_filters": {
            "atr_filter": use_atr_filter,
            "atr_sl": use_atr_sl,
            "atr_multiplier": float(atr_multiplier),
            "cvd_filter": use_cvd_filter,
            "oi_filter": use_oi_filter,
            "rsi_filter": use_rsi_filter,
        }
    }
    return build_response(raw, req.initial_capital, meta)


class OptimizeRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "5m"
    days: int = Field(7, ge=1, le=30)
    strategy_type: str = "delta_absorption"
    optimizer_mode: str = "genetic"  # "genetic" | "grid"
    sl_min: float = Field(0.2, gt=0, le=20)
    sl_max: float = Field(1.2, gt=0, le=20)
    sl_step: float = Field(0.2, gt=0, le=10)
    tp_min: float = Field(0.5, gt=0, le=100)
    tp_max: float = Field(3.0, gt=0, le=100)
    tp_step: float = Field(0.5, gt=0, le=50)
    tp_pct: Optional[float] = None
    wall_min_usd: float = Field(300000.0, ge=0)
    wall_max_usd: float = Field(3000000.0, ge=0)
    wall_step_usd: float = Field(600000.0, gt=0)
    volume_multiplier: float = Field(1.0, ge=0.5, le=20)
    leverage: float = Field(2.0, ge=1, le=125)
    initial_capital: float = Field(10000.0, gt=0)
    # Execution realism
    maker_fee_pct: float = Field(0.02, ge=0.0, le=2.0)
    taker_fee_pct: float = Field(0.05, ge=0.0, le=2.0)
    slippage_ticks: int = Field(2, ge=0, le=20)
    use_multi_tp: bool = True
    # Current baseline parameters for "Before vs After" comparison
    current_sl_pct: float = 0.8
    current_tp_pct: float = 1.6
    current_wall_usd: float = 300000.0
    # Confluence Filter Suite
    use_atr_filter: bool = False
    use_atr_sl: bool = False
    atr_multiplier: float = 1.5
    use_cvd_filter: bool = False
    use_oi_filter: bool = False
    use_rsi_filter: bool = False
    population_size: int = Field(14, ge=6, le=30)
    generations: int = Field(5, ge=2, le=10)

    model_config = {"extra": "ignore"}


@backtest_router.post("/optimize")
async def optimize_backtest(req: OptimizeRequest):
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

    engine = OrderFlowBacktester(
        initial_capital=req.initial_capital,
        maker_fee_pct=req.maker_fee_pct,
        taker_fee_pct=req.taker_fee_pct,
        slippage_ticks=req.slippage_ticks,
    )

    out = await asyncio.to_thread(
        engine.run_genetic_optimization,
        df,
        req.strategy_type,
        (req.sl_min, req.sl_max),
        (req.tp_min, req.tp_max),
        (req.wall_min_usd, req.wall_max_usd),
        float(req.leverage),
        float(req.volume_multiplier),
        float(req.maker_fee_pct),
        float(req.taker_fee_pct),
        int(req.slippage_ticks),
        bool(req.use_multi_tp),
        {
            "stop_loss_pct": req.current_sl_pct,
            "take_profit_pct": req.current_tp_pct,
            "min_density_usd": req.current_wall_usd,
            "use_cvd_filter": req.use_cvd_filter,
            "atr_period": 14,
        },
        int(req.population_size),
        int(req.generations),
    )

    rows = out["rows"]
    top_setups = out.get("top_setups", rows[:5])
    best_raw = out["best_raw"] or {"trades": [], "equity_curve": []}

    meta = {
        "symbol": symbol,
        "timeframe": req.timeframe,
        "strategy_type": req.strategy_type,
        "candles": int(len(df)),
        "from_time": int(df["timestamp"].iloc[0]),
        "to_time": int(df["timestamp"].iloc[-1]),
        "requested_days": req.days,
        "mode": "genetic",
        "combinations_tested": out["iterations_count"],
        "generations": out["generations"],
        "elapsed_ms": out["elapsed_ms"],
        "best_params": out["best_params"],
    }
    resp = build_response(best_raw, req.initial_capital, meta)
    resp["top_setups"] = _clean(top_setups)
    resp["grid_results"] = _clean(rows)
    resp["before_optimization"] = _clean(out["before_optimization"])
    resp["after_optimization"] = _clean(out["after_optimization"])
    return resp


class InspectLevelRequest(BaseModel):
    symbol: str = Field(default="BTCUSDT")
    timeframe: str = Field(default="5m")
    price: float = Field(..., description="Ценовой уровень для анализа")
    days: Optional[int] = Field(default=14, ge=1, le=30)
    tolerance_pct: Optional[float] = Field(default=0.35, ge=0.05, le=5.0)


@backtest_router.post("/inspect-level")
async def inspect_level(req: InspectLevelRequest):
    sym = req.symbol.strip().upper()
    tf = req.timeframe.strip()
    if tf not in TF_MINUTES:
        tf = "5m"
    days = req.days or 14

    try:
        df = await fetch_history(sym, tf, days)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка загрузки истории Binance: {e}")

    if df.empty or len(df) < 10:
        raise HTTPException(status_code=400, detail=f"Недостаточно свечей для {sym}")

    res = orderflow_backtester.inspect_level_bounces(
        df=df,
        level_price=req.price,
        tolerance_pct=req.tolerance_pct or 0.35,
        lookforward_bars=6
    )
    res["symbol"] = sym
    res["timeframe"] = tf
    res["days"] = days
    return _clean(res)
