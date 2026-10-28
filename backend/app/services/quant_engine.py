"""
Quant Analytics Engine: The 3 Cores / Consilium
- Core 3: Cold Quant & Math (Depth delta skew, Liq Magnet distance, Price deviation, R:R filter, Veto logic)
- Core 1: Perception & Market Sentiment snapshot
- Core 2: Knowledge Base (Auction Market Theory / Wyckoff / VPA context)
- Signal Quarantine & Backtest Journal tracking
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Literal
from pydantic import BaseModel, Field

from backend.app.services.market_data_factory import market_data_provider
from backend.app.services.market_data_provider import (
    UnifiedMarketDataResponse,
    OrderBookDepthData,
    LiqEstimatesData,
    MarketSnapshot,
)

logger = logging.getLogger(__name__)

JOURNAL_FILE_PATH = Path("data/quarantine_journal.json")


class Core3MathReport(BaseModel):
    depth_delta_skew_pct: float
    depth_bias: Literal["BULLISH_SUPPORT", "BEARISH_PRESSURE", "BALANCED"]
    closest_short_liq_dist_pct: float
    closest_long_liq_dist_pct: float
    strongest_liq_magnet: Literal["SHORTS_ABOVE", "LONGS_BELOW"]
    funding_annualized_pct: float
    suggested_entry: float
    suggested_stop_loss: float
    suggested_take_profit: float
    risk_reward_ratio: float
    verdict: Literal["READY_FOR_PAPER", "VETO_RR_TOO_LOW", "VETO_TOXIC_SKEW", "VETO_DATA_UNAVAILABLE"]
    verdict_reasons: List[str]


class MarketSnapshotPrompt(BaseModel):
    markdown_prompt: str
    json_snapshot: Dict[str, Any]


class QuarantineSignalRecord(BaseModel):
    id: str
    symbol: str
    timestamp: int
    created_at: str
    entry_price: float
    stop_loss: float
    take_profit: float
    rr_ratio: float
    verdict: str
    reasons: List[str]
    core3_math: Core3MathReport
    status: Literal["PENDING", "TP_HIT", "SL_HIT", "EXPIRED"] = "PENDING"
    exit_price: Optional[float] = None
    exit_timestamp: Optional[int] = None
    net_pnl_pct: Optional[float] = None


class QuantEngine:
    """
    Coordinates quantitative decision making across the 3 Cores:
    1. Fast mathematical evaluation (Core 3)
    2. Context generation for AI prompt and local export (Cores 1 & 2)
    3. Shadow Quarantine recording & verification
    """

    def __init__(self):
        JOURNAL_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)
        if not JOURNAL_FILE_PATH.exists():
            with open(JOURNAL_FILE_PATH, "w", encoding="utf-8") as f:
                json.dump([], f)

    # -------------------------------------------------------------
    # 1. Core 3: Cold Quant & Risk/Reward Calculation
    # -------------------------------------------------------------
    def evaluate_core3_math(self, unified_data: UnifiedMarketDataResponse) -> Core3MathReport:
        snap = unified_data.snapshot
        depth = unified_data.orderbook_depth
        liqs = unified_data.liq_estimates
        current_price = snap.price

        # Depth Delta (2.5% band)
        dd_2_5 = depth.depth_deltas.get("2.5%")
        delta_pct = dd_2_5.delta_pct if dd_2_5 else 0.0

        if delta_pct > 15.0:
            bias = "BULLISH_SUPPORT"
        elif delta_pct < -15.0:
            bias = "BEARISH_PRESSURE"
        else:
            bias = "BALANCED"

        # Liquidations Distance
        top_short = liqs.biggest_short
        top_long = liqs.biggest_long

        dist_short = abs(top_short.pct_from_price) if top_short else 99.0
        dist_long = abs(top_long.pct_from_price) if top_long else 99.0

        strongest_magnet = "SHORTS_ABOVE" if (top_short and (not top_long or top_short.amount_usd >= top_long.amount_usd)) else "LONGS_BELOW"

        # Calculate dynamic Entry, SL, TP based on Orderbook Walls and Liq Magnets
        walls = depth.walls
        bid_walls = [w for w in walls if w.price < current_price]
        ask_walls = [w for w in walls if w.price > current_price]

        reasons: List[str] = []

        # Decision direction matching order flow skew & magnets
        if bias == "BULLISH_SUPPORT" or strongest_magnet == "SHORTS_ABOVE":
            direction = "LONG"
            entry = current_price
            # SL placed behind the strongest spot bid wall (or 0.8% below)
            if bid_walls:
                sl = round(bid_walls[0].price * 0.9985, 2)
            else:
                sl = round(current_price * 0.992, 2)
            # TP targeted at highest short liquidation pool magnet
            tp = round(top_short.price, 2) if top_short else round(current_price * 1.025, 2)

            risk = entry - sl
            reward = tp - entry
            rr = round(reward / risk, 2) if risk > 0 else 0.0

            reasons.append(f"Depth Delta (+{delta_pct}%) подтверждает доминирование лимитных бидов")
            if top_short:
                reasons.append(f"Магнит ликвидаций шортистов: {top_short.amount_str} @ ${top_short.price}")

        else:
            direction = "SHORT"
            entry = current_price
            if ask_walls:
                sl = round(ask_walls[0].price * 1.0015, 2)
            else:
                sl = round(current_price * 1.008, 2)
            tp = round(top_long.price, 2) if top_long else round(current_price * 0.975, 2)

            risk = sl - entry
            reward = entry - tp
            rr = round(reward / risk, 2) if risk > 0 else 0.0

            reasons.append(f"Depth Delta ({delta_pct}%) отражает преобладание давления асков")
            if top_long:
                reasons.append(f"Магнит ликвидаций лонгистов: {top_long.amount_str} @ ${top_long.price}")

        # Data quality is a hard veto: an attractive order-book calculation
        # must never be presented as paper-ready when the snapshot itself is
        # partial or unavailable.
        funding_ann = round(snap.funding_rate * 3 * 365 * 100, 2)
        snapshot_status = getattr(snap, "data_status", "available")
        unavailable_fields = getattr(snap, "unavailable_fields", []) or []

        if snapshot_status != "available":
            verdict = "VETO_DATA_UNAVAILABLE"
            reasons.append(
                "VETO: MarketSnapshot неполный "
                f"({snapshot_status}; недоступно: {', '.join(unavailable_fields) or 'неуточнённые поля'})."
            )
        elif rr < 2.0:
            verdict = "VETO_RR_TOO_LOW"
            reasons.append(f"VETO: Соотношение Risk/Reward ({rr}) ниже институционального порога 1:2.0")
        elif abs(delta_pct) < 3.0:
            verdict = "VETO_TOXIC_SKEW"
            reasons.append("VETO: Стакан сбалансирован, выраженный направленный импульс отсутствует")
        else:
            verdict = "READY_FOR_PAPER"
            reasons.append(f"Параметры валидны: R:R = 1:{rr}, точка входа защищена плотностью")

        return Core3MathReport(
            depth_delta_skew_pct=round(delta_pct, 2),
            depth_bias=bias,
            closest_short_liq_dist_pct=round(dist_short, 2),
            closest_long_liq_dist_pct=round(dist_long, 2),
            strongest_liq_magnet=strongest_magnet,
            funding_annualized_pct=funding_ann,
            suggested_entry=round(entry, 2),
            suggested_stop_loss=round(sl, 2),
            suggested_take_profit=round(tp, 2),
            risk_reward_ratio=rr,
            verdict=verdict,
            verdict_reasons=reasons,
        )

    # -------------------------------------------------------------
    # 2. Cores 1 & 2: Generate One-Click Prompt / Context Snapshot
    # -------------------------------------------------------------
    def build_snapshot_prompt(
        self, unified_data: UnifiedMarketDataResponse, core3: Core3MathReport
    ) -> MarketSnapshotPrompt:
        snap = unified_data.snapshot
        depth = unified_data.orderbook_depth
        liqs = unified_data.liq_estimates

        md_prompt = f"""# 🧠 INSTITUTIONAL QUANT SNAPSHOT: {snap.symbol}
**Timestamp:** {datetime.fromtimestamp(snap.timestamp / 1000).strftime('%Y-%m-%d %H:%M:%S UTC')}
**Current Price:** ${snap.price:,.2f} (24h: {snap.change_24h_pct:+.2f}%)
**Funding Rate:** {snap.funding_rate:+.6f} ({core3.funding_annualized_pct:+.2f}% APR)
**Open Interest:** ${snap.open_interest_usd / 1e9:.3f}B
**Cumulative Volume Delta (CVD):** {snap.cvd_value:+,.1f}

---

## 1. SPOT ORDER BOOK DEPTH & WALLS (TRDR Method)
- **Depth Delta (2.5% Range):** {core3.depth_delta_skew_pct:+.2f}% ({core3.depth_bias})
- **Depth Delta (10.0% Range):** {depth.depth_deltas.get('10%', {}).delta_pct:+.2f}%
- **Top Limit Walls:**
{chr(10).join([f"  • ${w.price:,.2f} — {w.size:,.2f} ({w.wall_ratio}x avg level)" for w in depth.walls[:4]])}

---

## 2. SYNTHETIC LIQUIDATION POOLS (Coinglass Cascade Model)
- **Shorts Above Current Price:** ${liqs.shorts_above_usd / 1e6:.2f}M
  - Strongest Short Magnet: {liqs.biggest_short.amount_str if liqs.biggest_short else 'N/A'} @ ${liqs.biggest_short.price if liqs.biggest_short else 0} ({liqs.biggest_short.pct_from_price if liqs.biggest_short else 0:+.1f}%)
- **Longs Below Current Price:** ${liqs.longs_below_usd / 1e6:.2f}M
  - Strongest Long Magnet: {liqs.biggest_long.amount_str if liqs.biggest_long else 'N/A'} @ ${liqs.biggest_long.price if liqs.biggest_long else 0} ({liqs.biggest_long.pct_from_price if liqs.biggest_long else 0:+.1f}%)

---

## 3. CORE 3 (COLD QUANT) PRE-EVALUATION
- **Verdict:** {core3.verdict}
- **Calculated Entry:** ${core3.suggested_entry:,.2f}
- **Stop Loss:** ${core3.suggested_stop_loss:,.2f}
- **Take Profit:** ${core3.suggested_take_profit:,.2f}
- **Risk/Reward Ratio:** 1:{core3.risk_reward_ratio}
- **Core 3 Reasons:**
{chr(10).join([f"  - {r}" for r in core3.verdict_reasons])}

---

### INSTRUCTION FOR AI AGENT / RESEARCHER:
Ты — Главный Квант фонда. Оцени контекст аукциона (Auction Market Theory), реакцию на плотности стакана и магниты ликвидаций.
Дай конкретный вердикт: **CONFIRM** (подтвердить вход), **ADJUST** (скорректировать уровни) или **REJECT** (отклонить). Объясни механику ликвидности в 3 тезисах.
"""

        json_dump = {
            "symbol": snap.symbol,
            "timestamp": snap.timestamp,
            "current_price": snap.price,
            "core3": core3.model_dump(),
            "orderbook_depth": depth.model_dump(),
            "liq_estimates": liqs.model_dump(),
        }

        return MarketSnapshotPrompt(
            markdown_prompt=md_prompt,
            json_snapshot=json_dump,
        )

    # -------------------------------------------------------------
    # 3. Shadow Quarantine Journal
    # -------------------------------------------------------------
    def save_to_quarantine(
        self, unified_data: UnifiedMarketDataResponse, core3: Core3MathReport
    ) -> QuarantineSignalRecord:
        snap = unified_data.snapshot
        sig_id = f"sig_{snap.symbol}_{int(datetime.utcnow().timestamp())}"

        record = QuarantineSignalRecord(
            id=sig_id,
            symbol=snap.symbol,
            timestamp=snap.timestamp,
            created_at=datetime.utcnow().isoformat(),
            entry_price=core3.suggested_entry,
            stop_loss=core3.suggested_stop_loss,
            take_profit=core3.suggested_take_profit,
            rr_ratio=core3.risk_reward_ratio,
            verdict=core3.verdict,
            reasons=core3.verdict_reasons,
            core3_math=core3,
            status="PENDING",
        )

        try:
            records = []
            if JOURNAL_FILE_PATH.exists():
                with open(JOURNAL_FILE_PATH, "r", encoding="utf-8") as f:
                    records = json.load(f)
            records.insert(0, record.model_dump())
            with open(JOURNAL_FILE_PATH, "w", encoding="utf-8") as f:
                json.dump(records[:200], f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to persist quarantine record: {e}")

        return record

    def list_quarantine_records(self) -> List[Dict[str, Any]]:
        if not JOURNAL_FILE_PATH.exists():
            return []
        try:
            with open(JOURNAL_FILE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []


# Global singleton
quant_engine = QuantEngine()
