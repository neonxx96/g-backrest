"""
Unified Trade Contract (Paper Trading Readiness v0.1)
=====================================================
Defines the authoritative UnifiedTradeSignal dataclass/schema and adapters
to bridge Historical Backtest, Scanner Signals, and Paper Trading Execution.

All components (Backtest, AI Forecasts, Scanner, Paper Trading) consume
and produce this verified contract.
"""

from __future__ import annotations

import hashlib
import time
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator


class UnifiedTradeSignal(BaseModel):
    """
    Unified Institutional Trade Contract.
    Mandatory standard across all SignalScript subsystems.
    """
    symbol: str = Field(..., description="Trading pair symbol (e.g. BTCUSDT)")
    timeframe: str = Field(default="5m", description="Operational timeframe (e.g. 1m, 5m, 15m, 1h)")
    timestamp: int = Field(..., description="Timestamp in milliseconds (UTC)")
    direction: str = Field(..., description="Trade direction: 'LONG' or 'SHORT'")
    entry_type: str = Field(default="LIMIT", description="Entry order type: 'LIMIT', 'MARKET', 'STOP_LIMIT', etc.")
    entry_price: float = Field(..., gt=0, description="Target entry price")
    sl: float = Field(..., gt=0, description="Stop-Loss price level")
    tp1: float = Field(..., gt=0, description="Take-Profit 1 price level")
    tp2: Optional[float] = Field(default=None, description="Take-Profit 2 price level (optional scaling out)")
    leverage: float = Field(default=1.0, ge=1.0, le=125.0, description="Isolated leverage")
    risk_pct: float = Field(default=2.0, gt=0, le=100.0, description="Max portfolio equity risked (%)")
    expected_rr: float = Field(default=1.5, gt=0, description="Expected Risk/Reward ratio")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Signal confidence score (0.0 - 1.0)")
    reason: List[str] = Field(
        default_factory=lambda: ["Quant Algorithmic Signal"],
        description="Ordered, human-readable conditions that produced the signal"
    )
    strategy_type: str = Field(default="confluence_ema", description="Generating strategy identifier")
    data_source: str = Field(default="binance_futures_rest", description="Data provenance (e.g. rest, ws, parquet)")
    invalidation_condition: str = Field(
        default="Price breaches SL or regime shifts to TOXIC_VOLATILITY",
        description="Conditions under which the signal is canceled"
    )
    unique_id: str = Field(default="", description="Deterministic SHA256 / UUID fingerprint")
    context_snapshot: Optional[Dict[str, Any]] = Field(default=None, description="Structured market context captured at signal time")

    model_config = {
        "extra": "ignore",
        "populate_by_name": True
    }

    @field_validator("symbol")
    @classmethod
    def clean_symbol(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("direction")
    @classmethod
    def clean_direction(cls, v: str) -> str:
        d = v.strip().upper()
        if d in ("BUY", "LONG"):
            return "LONG"
        if d in ("SELL", "SHORT"):
            return "SHORT"
        raise ValueError(f"Direction must be 'LONG' or 'SHORT', got '{v}'")

    @field_validator("entry_type")
    @classmethod
    def clean_entry_type(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("reason", mode="before")
    @classmethod
    def normalize_reason(cls, v: Any) -> List[str]:
        """Accept legacy text at the boundary, but store every signal as explicit conditions."""
        values = [v] if isinstance(v, str) else v
        if not isinstance(values, list):
            raise ValueError("reason must be a string or a list of condition strings")
        normalized = [str(item).strip() for item in values if str(item).strip()]
        if not normalized:
            raise ValueError("reason must contain at least one non-empty condition")
        return normalized

    def model_post_init(self, __context: Any) -> None:
        """Generates deterministic unique_id if not explicitly provided."""
        if not self.unique_id:
            raw_fingerprint = (
                f"{self.symbol}_{self.timeframe}_{self.direction}_"
                f"{self.entry_price:.4f}_{self.sl:.4f}_{self.tp1:.4f}_"
                f"{self.timestamp}_{self.strategy_type}_{'|'.join(self.reason)}"
            )
            self.unique_id = hashlib.sha256(raw_fingerprint.encode("utf-8")).hexdigest()[:16]

    def to_dict(self) -> Dict[str, Any]:
        """Serializes signal to dictionary."""
        return self.model_dump()


# ==============================================================================
# ADAPTER FUNCTIONS (Legacy & Component Bridges)
# ==============================================================================

def from_backtest_trade(
    trade: Dict[str, Any],
    symbol: str,
    timeframe: str = "5m",
    strategy_type: str = "confluence_ema",
    leverage: float = 1.0,
    risk_pct: float = 2.0,
    data_source: str = "historical_backtest"
) -> UnifiedTradeSignal:
    """
    Adapts an OrderFlowBacktester trade dictionary into a verified UnifiedTradeSignal.
    """
    direction = str(trade.get("direction", "LONG")).upper()
    entry_price = float(trade.get("entry_price", 0.0))
    entry_time = int(trade.get("entry_time", int(time.time() * 1000)))

    # Compute SL/TP from trade or defaults
    pnl_pct = float(trade.get("pnl_pct", 0.0))
    exit_price = float(trade.get("exit_price", entry_price))

    # Derive approximate SL and TP if not explicitly stored
    if direction == "LONG":
        sl = entry_price * 0.992
        tp1 = entry_price * 1.015
    else:
        sl = entry_price * 1.008
        tp1 = entry_price * 0.985

    expected_rr = 1.5
    if entry_price > 0 and abs(entry_price - sl) > 0:
        expected_rr = round(abs(tp1 - entry_price) / abs(entry_price - sl), 2)

    # Entry conditions and exit outcome are distinct facts. Legacy payloads may
    # only have a generic reason, but an exit reason must never become the
    # explanation for why a position was opened.
    reason = trade.get("entry_reason") or trade.get("reason") or "Backtest Signal Execution"

    return UnifiedTradeSignal(
        symbol=symbol,
        timeframe=timeframe,
        timestamp=entry_time,
        direction=direction,
        entry_type="LIMIT",
        entry_price=entry_price,
        sl=round(sl, 4),
        tp1=round(tp1, 4),
        tp2=None,
        leverage=float(leverage),
        risk_pct=float(risk_pct),
        expected_rr=max(0.1, expected_rr),
        confidence=1.0 if pnl_pct > 0 else 0.5,
        reason=reason,
        strategy_type=strategy_type,
        data_source=data_source,
        invalidation_condition="Price breaches SL level"
    )


def from_backtest_setup(
    setup: Dict[str, Any],
    symbol: str,
    timeframe: str = "5m",
    timestamp: Optional[int] = None,
    strategy_type: str = "confluence_ema",
    leverage: float = 1.0,
    risk_pct: float = 2.0,
    data_source: str = "historical_orderflow_setup"
) -> UnifiedTradeSignal:
    """
    Adapts an active_position_setup dict (from OrderFlowBacktester) into UnifiedTradeSignal.
    """
    direction = str(setup.get("direction", "LONG")).upper()
    entry_price = float(setup.get("entry_price", 0.0))
    sl_price = float(setup.get("sl_price", 0.0))
    tp1_price = float(setup.get("tp1_price", 0.0))
    tp2_price = float(setup.get("tp2_price")) if setup.get("tp2_price") else None
    rr = float(setup.get("rr_ratio", 1.5))
    order_type_str = str(setup.get("order_type", "LIMIT")).split()[-1] if setup.get("order_type") else "LIMIT"

    ts = timestamp or int(time.time() * 1000)

    return UnifiedTradeSignal(
        symbol=symbol,
        timeframe=timeframe,
        timestamp=ts,
        direction=direction,
        entry_type=order_type_str,
        entry_price=entry_price,
        sl=sl_price,
        tp1=tp1_price,
        tp2=tp2_price,
        leverage=float(leverage),
        risk_pct=float(risk_pct),
        expected_rr=max(0.1, rr),
        confidence=1.0,
        reason=[f"{setup.get('entry_mode', strategy_type)} (RR 1:{rr})"],
        strategy_type=strategy_type,
        data_source=data_source,
        invalidation_condition=f"Price breaches SL {sl_price} or wall expired"
    )


def from_scanner_signal(
    sig: Dict[str, Any],
    default_sl_pct: float = 0.8,
    default_tp_pct: float = 1.6,
    leverage: float = 1.0,
    risk_pct: float = 2.0,
    data_source: str = "market_scanner"
) -> UnifiedTradeSignal:
    """
    Adapts a MarketScanner signal into a verified UnifiedTradeSignal.
    """
    symbol = str(sig.get("symbol", "BTCUSDT")).upper()
    timeframe = str(sig.get("timeframe", "15m"))
    price = float(sig.get("price", 0.0))
    cond_type = str(sig.get("condition_type", "TECHNICAL"))
    raw_dir = str(sig.get("direction", "BULLISH")).upper()

    is_long = raw_dir in ("BULLISH", "BUY", "LONG", "OVERSOLD")
    direction = "LONG" if is_long else "SHORT"

    if is_long:
        sl = round(price * (1.0 - default_sl_pct / 100.0), 4)
        tp1 = round(price * (1.0 + default_tp_pct / 100.0), 4)
    else:
        sl = round(price * (1.0 + default_sl_pct / 100.0), 4)
        tp1 = round(price * (1.0 - default_tp_pct / 100.0), 4)

    rr = round(default_tp_pct / max(0.01, default_sl_pct), 2)
    reason = str(sig.get("description") or f"{cond_type}: {raw_dir}")

    ts = int(time.time() * 1000)

    return UnifiedTradeSignal(
        symbol=symbol,
        timeframe=timeframe,
        timestamp=ts,
        direction=direction,
        entry_type="LIMIT",
        entry_price=price,
        sl=sl,
        tp1=tp1,
        tp2=None,
        leverage=float(leverage),
        risk_pct=float(risk_pct),
        expected_rr=rr,
        confidence=0.85,
        reason=[reason],
        strategy_type=f"scanner_{cond_type.lower()}",
        data_source=data_source,
        invalidation_condition="Opposite scanner trigger or SL breach"
    )


def from_paper_order(
    order_data: Dict[str, Any],
    timeframe: str = "5m",
    strategy_type: str = "paper_trading",
    data_source: str = "paper_trading_engine"
) -> UnifiedTradeSignal:
    """
    Adapts an active Paper Trading order into UnifiedTradeSignal.
    """
    symbol = str(order_data.get("symbol", "BTCUSDT")).upper()
    side = str(order_data.get("side", "BUY")).upper()
    direction = "LONG" if side in ("BUY", "LONG") else "SHORT"
    price = float(order_data.get("price", 0.0))
    stop_price = float(order_data.get("stop_price", 0.0))
    target_price = float(order_data.get("target_price", 0.0))

    if stop_price <= 0:
        stop_price = round(price * 0.992 if direction == "LONG" else price * 1.008, 4)
    if target_price <= 0:
        target_price = round(price * 1.016 if direction == "LONG" else price * 0.984, 4)

    expected_rr = 2.0
    if price > 0 and abs(price - stop_price) > 0:
        expected_rr = round(abs(target_price - price) / abs(price - stop_price), 2)

    return UnifiedTradeSignal(
        symbol=symbol,
        timeframe=timeframe,
        timestamp=int(order_data.get("created_ts") or (time.time() * 1000)),
        direction=direction,
        entry_type=str(order_data.get("order_type", "LIMIT")).upper(),
        entry_price=price,
        sl=stop_price,
        tp1=target_price,
        tp2=None,
        leverage=float(order_data.get("leverage", 1.0)),
        risk_pct=float(order_data.get("risk_pct", 2.0)),
        expected_rr=max(0.1, expected_rr),
        confidence=1.0,
        reason=order_data.get("reason", "Paper Trading Order"),
        strategy_type=strategy_type,
        data_source=data_source,
        invalidation_condition="Stop loss or manual cancellation"
    )


def to_paper_order_request(signal: UnifiedTradeSignal, quantity: Optional[float] = None) -> Dict[str, Any]:
    """
    Converts a UnifiedTradeSignal into payload for PaperTradingSession.execute_trade_signal.
    """
    return {
        "symbol": signal.symbol,
        "side": "BUY" if signal.direction == "LONG" else "SELL",
        "price": signal.entry_price,
        "stop_price": signal.sl,
        "target_price": signal.tp1,
        "quantity": quantity,
        "order_type": signal.entry_type,
        "reason": f"[{signal.strategy_type}] {' | '.join(signal.reason)}",
        "regime": None
    }
