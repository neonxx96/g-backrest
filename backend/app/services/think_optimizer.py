"""Explainable strategy recommendations built from existing backtest outputs."""

from typing import Any, Dict


def analyze_post_mortem(payload: Dict[str, Any]) -> Dict[str, Any]:
    trades = list(payload.get("trades") or [])
    current = dict(payload.get("current") or {})
    stopouts = [trade for trade in trades if str(trade.get("exit_reason", "")).lower() in {"stop loss", "sl", "stop_loss"}]
    wins = [trade for trade in trades if float(trade.get("pnl_usd", 0) or 0) > 0]
    patch = {
        "stop_loss_pct": float(current.get("stop_loss_pct", 0.8)),
        "take_profit_pct": float(current.get("take_profit_pct", 1.6)),
        "leverage": float(current.get("leverage", 1)),
    }
    rationale = [f"Анализировано сделок: {len(trades)}", f"Winrate: {len(wins) / len(trades) * 100:.1f}%" if trades else "Нет сделок для оценки"]
    if len(stopouts) >= 2 and len(stopouts) >= max(1, len(trades) // 2):
        patch["stop_loss_pct"] = round(max(patch["stop_loss_pct"] * 1.625, patch["stop_loss_pct"] + 0.25), 2)
        rationale.append("Stop Loss доминирует среди выходов; рекомендован более широкий защитный диапазон")
    return {
        "mode": "post_mortem",
        "symbol": payload.get("symbol", "BTCUSDT"),
        "patch": patch,
        "evidence": {"total_trades": len(trades), "winning_trades": len(wins), "stop_loss_exits": len(stopouts)},
        "rationale": rationale,
        "disclaimer": "Консультативная рекомендация; автоматические реальные ордера запрещены.",
    }
