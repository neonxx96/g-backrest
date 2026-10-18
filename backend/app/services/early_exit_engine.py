"""
Early Exit Engine: MFE/MAE Tracker & Tactical Alert Rule Engine
===============================================================
Monitors open paper positions in real time and generates tactical
exit suggestions. Built as a NEW layer — never modifies:

- orderflow_backtester.py, limit_fill_simulator.py, execution_simulator.py,
  paper_trading.py (we only read their public state).

CORE GUARANTEES (Category Invariants):
1. Deterministic: no `random()`. Alerts are pure functions of position
   state + latest price/orderflow data.
2. Zero Look-Ahead: only sees the price/flow data that has already been
   fed to it (timestamped updates).
"""
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# --- Tactical alert thresholds (parameterizable) -----------------------------
MFE_BLEED_R_THRESHOLD = 0.5     # MFE must exceed 0.5R to arm Rule 1
MFE_BLEED_DROP_RATIO = 0.5      # profit must fall to <=50% of MFE
TIME_STOP_SECONDS = 300         # 5 minutes in trade
TIME_STOP_R_THRESHOLD = 0.2     # profit still < 0.2R


@dataclass
class PositionTrackState:
    """Per-position tracking state (MFE/MAE excursion tracker)."""
    symbol: str
    side: str                  # "LONG" | "SHORT"
    entry_price: float
    entry_ts: int
    risk_amount: float = 0.0   # R in absolute USDT
    qty: float = 0.0
    mfe: float = 0.0           # max favorable excursion (abs USDT)
    mae: float = 0.0           # max adverse excursion (abs USDT, positive)
    mfe_ts: int = 0            # timestamp of the MFE peak
    last_price: float = 0.0
    last_update_ts: int = 0
    active_alerts: List[dict] = field(default_factory=list)

    @property
    def current_pnl(self) -> float:
        if self.side == "LONG":
            return (self.last_price - self.entry_price) * self.qty
        return (self.entry_price - self.last_price) * self.qty

    @property
    def time_in_trade_sec(self) -> float:
        if self.last_update_ts <= self.entry_ts:
            return 0.0
        return (self.last_update_ts - self.entry_ts) / 1000.0

    @property
    def current_pnl_r(self) -> float:
        if self.risk_amount <= 0:
            return 0.0
        return self.current_pnl / self.risk_amount

    @property
    def mfe_r(self) -> float:
        if self.risk_amount <= 0:
            return 0.0
        return self.mfe / self.risk_amount


class EarlyExitEngine:
    """
    Monitors active paper positions and emits tactical exit alerts.

    Rule 1 (Profit bleed / MFE_Bleed):
      If MFE > 0.5R (position was in a good profit) and the current profit
      has fallen to <= 50% of MFE -> "WARNING: Profit bleed. Consider trailing SL".

    Rule 2 (Time stop):
      If time-in-trade > 300 seconds and the position is still < 0.2R ->
      "WARNING: Time stop. Momentum lost".
    """

    def __init__(
        self,
        mfe_bleed_r_threshold: float = MFE_BLEED_R_THRESHOLD,
        mfe_bleed_drop_ratio: float = MFE_BLEED_DROP_RATIO,
        time_stop_seconds: float = TIME_STOP_SECONDS,
        time_stop_r_threshold: float = TIME_STOP_R_THRESHOLD,
    ):
        self.mfe_bleed_r_threshold = mfe_bleed_r_threshold
        self.mfe_bleed_drop_ratio = mfe_bleed_drop_ratio
        self.time_stop_seconds = time_stop_seconds
        self.time_stop_r_threshold = time_stop_r_threshold
        self.tracks: Dict[str, PositionTrackState] = {}

    def register_position(self, symbol: str, side: str, entry_price: float,
                          entry_ts: int, qty: float, risk_amount: float = 0.0) -> PositionTrackState:
        track = PositionTrackState(
            symbol=symbol, side=side, entry_price=entry_price,
            entry_ts=entry_ts, qty=qty, risk_amount=risk_amount,
        )
        self.tracks[symbol] = track
        logger.info(f"[EarlyExitEngine] position registered: {symbol} {side} entry={entry_price} R={risk_amount:.2f}")
        return track

    def remove_position(self, symbol: str) -> None:
        if symbol in self.tracks:
            del self.tracks[symbol]
            logger.info(f"[EarlyExitEngine] position removed: {symbol}")

    def on_price_update(self, symbol: str, price: float, timestamp_ms: int) -> Optional[PositionTrackState]:
        """Update the tracked excursion state. Deterministic pure arithmetic."""
        track = self.tracks.get(symbol)
        if track is None:
            return None

        track.last_price = float(price)
        track.last_update_ts = int(timestamp_ms)

        if track.qty > 0 and track.entry_price > 0:
            pnl = track.current_pnl
            # MFE: max favorable excursion (absolute USDT, >= 0)
            if pnl > track.mfe:
                track.mfe = pnl
                track.mfe_ts = int(timestamp_ms)
            # MAE: max adverse excursion (absolute USDT, kept positive)
            if pnl < 0 and -pnl > track.mae:
                track.mae = -pnl
        return track

    def evaluate_position(
        self,
        position_state: PositionTrackState,
        latest_orderflow_data: Optional[dict] = None,
    ) -> List[dict]:
        """
        Evaluate tactical exit rules. Returns a list of alert dicts.
        Deterministic: pure function of (position_state, thresholds).
        """
        alerts: List[dict] = []
        if position_state is None:
            return alerts

        now_ts = position_state.last_update_ts
        pnl_r = position_state.current_pnl_r
        mfe_r = position_state.mfe_r

        # Rule 1: Profit bleed (MFE_Bleed)
        if (
            position_state.mfe_r > self.mfe_bleed_r_threshold
            and position_state.mfe > 0
            and position_state.current_pnl <= position_state.mfe * self.mfe_bleed_drop_ratio
        ):
            alerts.append({
                "symbol": position_state.symbol,
                "alert_type": "MFE_Bleed",
                "severity": "WARNING",
                "message": "WARNING: Profit bleed. Consider trailing SL",
                "mfe": round(position_state.mfe, 6),
                "mfe_r": round(mfe_r, 4),
                "current_pnl": round(position_state.current_pnl, 6),
                "timestamp": now_ts,
            })

        # Rule 2: Time stop (momentum decay)
        if (
            position_state.time_in_trade_sec > self.time_stop_seconds
            and pnl_r < self.time_stop_r_threshold
        ):
            alerts.append({
                "symbol": position_state.symbol,
                "alert_type": "Time_Stop",
                "severity": "WARNING",
                "message": "WARNING: Time stop. Momentum lost",
                "time_in_trade_sec": round(position_state.time_in_trade_sec, 1),
                "current_pnl_r": round(pnl_r, 4),
                "timestamp": now_ts,
            })

        # Persist alerts on the track (dedupe by alert_type+message)
        for a in alerts:
            key = (a["alert_type"], a["message"])
            if not any((x["alert_type"], x["message"]) == key for x in position_state.active_alerts):
                position_state.active_alerts.append(a)

        return alerts

    def evaluate_all(self, latest_orderflow_data: Optional[dict] = None) -> List[dict]:
        """Evaluate every tracked position. Returns combined alert list."""
        all_alerts: List[dict] = []
        for track in self.tracks.values():
            all_alerts.extend(self.evaluate_position(track, latest_orderflow_data))
        return all_alerts

    def get_hud_state(self, symbol: str) -> Optional[dict]:
        track = self.tracks.get(symbol)
        if track is None:
            return None
        return {
            "symbol": track.symbol,
            "side": track.side,
            "entry_price": track.entry_price,
            "qty": track.qty,
            "mfe": round(track.mfe, 6),
            "mae": round(track.mae, 6),
            "mfe_pct": round(self._pct(track.mfe, track.entry_price, track.qty), 4),
            "mae_pct": round(self._pct(track.mae, track.entry_price, track.qty), 4),
            "time_in_trade_sec": round(track.time_in_trade_sec, 1),
            "current_pnl": round(track.current_pnl, 6),
            "current_pnl_r": round(track.current_pnl_r, 4),
            "active_alerts": list(track.active_alerts),
        }

    @staticmethod
    def _pct(excursion_abs: float, entry_price: float, qty: float) -> float:
        notional = entry_price * qty
        if notional <= 0:
            return 0.0
        return (excursion_abs / notional) * 100.0


