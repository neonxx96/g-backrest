"""
Early Exit Engine: MFE/MAE Tracker, Tactical Alert Rule Engine & Tier-1 Profit-Lock Sentinel
============================================================================================
Monitors open paper positions in real time and generates tactical
exit suggestions and deterministic profit-lock actions (Block 3). Built as a modular layer —
never modifies:

- orderflow_backtester.py, limit_fill_simulator.py, execution_simulator.py,
  paper_trading.py (we only read their public state).

CORE GUARANTEES (Category Invariants):
1. Deterministic: no `random()`. Alerts and profit-lock actions are pure functions of position
   state + latest price/orderflow data.
2. Zero Look-Ahead: only sees the price/flow data that has already been
   fed to it (timestamped updates).
3. Safety Clamp Invariant: `clamp_protective_stop` guarantees that no Quant rule or AI Sentinel
   can EVER widen a stop-loss (increase risk) or place a stop on the wrong side of current price.
"""
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# --- Tactical alert thresholds (parameterizable) -----------------------------
MFE_BLEED_R_THRESHOLD = 0.5     # MFE must exceed 0.5R to arm Rule 1
MFE_BLEED_DROP_RATIO = 0.5      # profit must fall to <=50% of MFE
TIME_STOP_SECONDS = 300         # 5 minutes in trade
TIME_STOP_R_THRESHOLD = 0.2     # profit still < 0.2R

# --- Tier-1 Profit-Lock Sentinel thresholds (Block 3) ------------------------
BREAKEVEN_LOCK_R = 0.80         # At +0.8R MFE -> lock SL at fee-adjusted breakeven
STEP_LOCK_1_MFE_R = 1.20        # At +1.2R MFE -> lock SL at +0.40R
STEP_LOCK_1_TARGET_R = 0.40
STEP_LOCK_2_MFE_R = 1.80        # At +1.8R MFE -> lock SL at +0.90R
STEP_LOCK_2_TARGET_R = 0.90
ABSORPTION_REVERSAL_MFE_R = 0.70
ABSORPTION_LOCK_TARGET_R = 0.50


def clamp_protective_stop(
    side: str,
    current_stop: float,
    proposed_stop: float,
    current_price: float,
    tick_size: float = 0.0,
) -> float:
    """
    Строгий предохранитель безопасности (Safety Clamp):
    - Для LONG: новый стоп должен быть >= current_stop (только подтягивание вверх)
      и строго < current_price - tick_size.
    - Для SHORT: новый стоп должен быть <= current_stop (если current_stop > 0, только подтягивание вниз)
      и строго > current_price + tick_size.
    Никогда не позволяет ИИ или правилу расширить стоп или пересечь текущую рыночную цену.
    """
    cur_sl = float(current_stop or 0.0)
    prop_sl = float(proposed_stop or 0.0)
    price = float(current_price or 0.0)
    min_gap = max(float(tick_size or 0.0), price * 0.0001)

    if prop_sl <= 0.0 or price <= 0.0:
        return cur_sl

    direction = str(side or "LONG").upper()
    if direction == "LONG":
        max_valid_sl = price - min_gap
        clamped = min(prop_sl, max_valid_sl)
        if cur_sl > 0.0 and clamped <= cur_sl:
            return cur_sl
        return round(clamped, 8)
    else:
        min_valid_sl = price + min_gap
        clamped = max(prop_sl, min_valid_sl)
        if cur_sl > 0.0 and clamped >= cur_sl:
            return cur_sl
        return round(clamped, 8)


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
    breakeven_triggered: bool = False
    step_lock_level: int = 0
    partial_profit_taken: bool = False
    last_ai_sentinel_ts: int = 0
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

    @property
    def mae_r(self) -> float:
        if self.risk_amount <= 0:
            return 0.0
        return self.mae / self.risk_amount

    @property
    def r_price_distance(self) -> float:
        """Price distance corresponding to 1.0R."""
        if self.qty <= 0 or self.risk_amount <= 0:
            return max(self.entry_price * 0.008, 1e-8)
        return max(self.risk_amount / self.qty, 1e-8)


class EarlyExitEngine:
    """
    Monitors active paper positions, emits tactical exit alerts, and computes
    Tier-1 deterministic Profit-Lock actions (Block 3).

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

        # Rule 0: Dynamic Breakeven triggered (+0.5R reached)
        if position_state.mfe_r >= self.mfe_bleed_r_threshold and not position_state.breakeven_triggered:
            position_state.breakeven_triggered = True
            alerts.append({
                "symbol": position_state.symbol,
                "alert_type": "Dynamic_Breakeven",
                "severity": "INFO",
                "message": "INFO: MFE >= +0.5R reached. Stop-Loss moved to Breakeven (+2*Fee+1tick)",
                "mfe": round(position_state.mfe, 6),
                "mfe_r": round(mfe_r, 4),
                "current_pnl": round(position_state.current_pnl, 6),
                "timestamp": now_ts,
            })

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

    def evaluate_profit_lock_action(
        self,
        position_state: PositionTrackState,
        current_stop: float,
        *,
        taker_fee_pct: float = 0.05,
        tick_size: float = 0.0,
        latest_orderflow_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Tier-1 Cold Quant Profit-Lock Sentinel (0 ms latency, deterministic):
        Evaluates open position excursion and order-flow context to lock in unrealized profit
        before MFE bleed turns a winning trade into a loss.

        Returns dict:
          {
            "action": "HOLD" | "MOVE_SL_BREAKEVEN" | "STEP_LOCK_SL" | "PARTIAL_CLOSE_50" | "EARLY_EXIT_MARKET",
            "new_stop_price": float,
            "should_trigger_ai_sentinel": bool,
            "reason": str,
            "mfe_r": float,
            "current_pnl_r": float,
          }
        """
        if position_state is None or position_state.entry_price <= 0 or position_state.last_price <= 0:
            return {
                "action": "HOLD",
                "new_stop_price": float(current_stop or 0.0),
                "should_trigger_ai_sentinel": False,
                "reason": "Нет активных данных позиции",
                "mfe_r": 0.0,
                "current_pnl_r": 0.0,
            }

        sign = 1 if position_state.side == "LONG" else -1
        entry = float(position_state.entry_price)
        price = float(position_state.last_price)
        cur_sl = float(current_stop or 0.0)
        r_dist = position_state.r_price_distance
        mfe_r = position_state.mfe_r
        pnl_r = position_state.current_pnl_r
        flow = dict(latest_orderflow_data or {})

        # Round-trip fee + 1 tick buffer in price units
        fee_buffer_pct = (2.0 * max(0.01, float(taker_fee_pct or 0.05)) + 0.02) / 100.0
        be_stop_raw = entry * (1.0 + sign * fee_buffer_pct)

        # Check adverse order-flow reversal signals (opposite absorption or heavy opposing delta)
        depth_delta_pct = float(flow.get("depth_delta_pct", 0.0) or 0.0)
        opposing_absorption = bool(flow.get("opposing_absorption", False))
        adverse_flow = opposing_absorption or (
            (sign == 1 and depth_delta_pct <= -18.0) or (sign == -1 and depth_delta_pct >= 18.0)
        )

        # 1. Absorption / Orderflow Reversal while in solid profit (MFE >= 0.7R and current PnL > 0.35R)
        if mfe_r >= ABSORPTION_REVERSAL_MFE_R and pnl_r >= 0.35 and adverse_flow and not position_state.partial_profit_taken:
            target_lock_raw = entry + sign * (r_dist * min(ABSORPTION_LOCK_TARGET_R, max(0.2, pnl_r * 0.6)))
            safe_sl = clamp_protective_stop(position_state.side, cur_sl, max(be_stop_raw, target_lock_raw) if sign == 1 else min(be_stop_raw, target_lock_raw), price, tick_size)
            position_state.partial_profit_taken = True
            return {
                "action": "PARTIAL_CLOSE_50",
                "new_stop_price": safe_sl,
                "should_trigger_ai_sentinel": True,
                "reason": (
                    f"Встречное поглощение/дисбаланс (delta={depth_delta_pct:+.1f}%) при MFE={mfe_r:.2f}R: "
                    f"фиксация 50% прибыли и перенос SL в +{ABSORPTION_LOCK_TARGET_R:.1f}R"
                ),
                "mfe_r": round(mfe_r, 3),
                "current_pnl_r": round(pnl_r, 3),
            }

        # 2. Step-Lock Level 2: MFE >= 1.8R -> Lock +0.9R
        if mfe_r >= STEP_LOCK_2_MFE_R:
            target_sl_raw = entry + sign * (r_dist * STEP_LOCK_2_TARGET_R)
            safe_sl = clamp_protective_stop(position_state.side, cur_sl, target_sl_raw, price, tick_size)
            if safe_sl != cur_sl:
                position_state.step_lock_level = max(position_state.step_lock_level, 2)
                return {
                    "action": "STEP_LOCK_SL",
                    "new_stop_price": safe_sl,
                    "should_trigger_ai_sentinel": True,
                    "reason": f"Step-Lock L2: MFE достиг +{mfe_r:.2f}R -> фиксация стопа на уровне +{STEP_LOCK_2_TARGET_R:.2f}R ({safe_sl})",
                    "mfe_r": round(mfe_r, 3),
                    "current_pnl_r": round(pnl_r, 3),
                }

        # 3. Step-Lock Level 1: MFE >= 1.2R -> Lock +0.4R
        if mfe_r >= STEP_LOCK_1_MFE_R:
            target_sl_raw = entry + sign * (r_dist * STEP_LOCK_1_TARGET_R)
            safe_sl = clamp_protective_stop(position_state.side, cur_sl, target_sl_raw, price, tick_size)
            if safe_sl != cur_sl:
                position_state.step_lock_level = max(position_state.step_lock_level, 1)
                return {
                    "action": "STEP_LOCK_SL",
                    "new_stop_price": safe_sl,
                    "should_trigger_ai_sentinel": True,
                    "reason": f"Step-Lock L1: MFE достиг +{mfe_r:.2f}R -> защита +{STEP_LOCK_1_TARGET_R:.2f}R прибыли ({safe_sl})",
                    "mfe_r": round(mfe_r, 3),
                    "current_pnl_r": round(pnl_r, 3),
                }

        # 4. Fee-Adjusted Breakeven Lock: MFE >= 0.8R -> Lock entry + 2*Fee + 1 tick
        if mfe_r >= BREAKEVEN_LOCK_R:
            safe_sl = clamp_protective_stop(position_state.side, cur_sl, be_stop_raw, price, tick_size)
            if safe_sl != cur_sl:
                position_state.breakeven_triggered = True
                return {
                    "action": "MOVE_SL_BREAKEVEN",
                    "new_stop_price": safe_sl,
                    "should_trigger_ai_sentinel": True,
                    "reason": f"Fee-Aware Breakeven: MFE достиг +{mfe_r:.2f}R -> стоп перенесён в безубыток с учётом комиссий ({safe_sl})",
                    "mfe_r": round(mfe_r, 3),
                    "current_pnl_r": round(pnl_r, 3),
                }

        # 5. Smart Time-Stop: trade stagnates > time_stop_seconds with weak PnL and adverse flow
        if position_state.time_in_trade_sec > self.time_stop_seconds and pnl_r < self.time_stop_r_threshold:
            if adverse_flow and pnl_r <= -0.15:
                return {
                    "action": "EARLY_EXIT_MARKET",
                    "new_stop_price": cur_sl,
                    "should_trigger_ai_sentinel": True,
                    "reason": (
                        f"Smart Time-Stop: позиция без импульса {position_state.time_in_trade_sec:.0f}с "
                        f"(PnL={pnl_r:+.2f}R) на фоне встречного потока (delta={depth_delta_pct:+.1f}%)"
                    ),
                    "mfe_r": round(mfe_r, 3),
                    "current_pnl_r": round(pnl_r, 3),
                }

        # Check if AI Sentinel should be consulted on MFE Bleed warning
        mfe_bleed_active = (
            mfe_r >= self.mfe_bleed_r_threshold
            and position_state.mfe > 0
            and position_state.current_pnl <= position_state.mfe * self.mfe_bleed_drop_ratio
        )
        return {
            "action": "HOLD",
            "new_stop_price": cur_sl,
            "should_trigger_ai_sentinel": bool(mfe_bleed_active or adverse_flow),
            "reason": "Удержание позиции по плану",
            "mfe_r": round(mfe_r, 3),
            "current_pnl_r": round(pnl_r, 3),
        }

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
            "step_lock_level": track.step_lock_level,
            "partial_profit_taken": track.partial_profit_taken,
            "active_alerts": list(track.active_alerts),
        }

    @staticmethod
    def _pct(excursion_abs: float, entry_price: float, qty: float) -> float:
        notional = entry_price * qty
        if notional <= 0:
            return 0.0
        return (excursion_abs / notional) * 100.0
