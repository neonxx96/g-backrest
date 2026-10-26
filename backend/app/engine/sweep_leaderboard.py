"""Quant Sweep Leaderboard (SRS M5.1) — ранжированный Top-10 артефакт
результатов grid-оптимизации. Нормализует вывод WalkForwardOptimizer
(optimize_train_oos) в стабильный контракт и персистит его в
`data/sweep_leaderboard.json`.

Truth-first: лидерборд строится только из реальных прогонов; пустой вход
не синтезирует записи. Verdict (ROBUST/MODERATE/OVERFITTED) приходит из
OOS-оценки оптимизатора и не перевычисляется здесь.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

MAX_ENTRIES_PER_RUN = 10


def build_leaderboard_entries(
    opt_result: Dict[str, Any],
    symbol: str,
    timeframe: str,
    top_n: int = MAX_ENTRIES_PER_RUN,
) -> List[Dict[str, Any]]:
    """Нормализует leaderboard оптимизатора в ранжированные записи артефакта.
    Ранг — по oos_score (основной критерий живучести), тай-брейк train_score."""
    if top_n <= 0:
        raise ValueError("top_n must be positive")
    raw = list(opt_result.get("leaderboard") or [])

    def _metrics(entry: Dict[str, Any]) -> Dict[str, Any]:
        oos = entry.get("oos_metrics") or {}
        train = entry.get("train_metrics") or {}
        return {
            "train_sharpe": train.get("sharpe", 0.0),
            "oos_sharpe": oos.get("sharpe", 0.0),
            "oos_max_drawdown_pct": oos.get("max_drawdown_pct", 0.0),
            "oos_trade_count": oos.get("trade_count", 0),
            "oos_win_rate": oos.get("win_rate", 0.0),
        }

    entries = []
    for entry in raw:
        entries.append({
            "params": entry.get("params") or {},
            "train_score": entry.get("train_score", 0.0),
            "oos_score": entry.get("oos_score", 0.0),
            "sharpe_degradation": entry.get("sharpe_degradation", 0.0),
            "verdict": entry.get("verdict", "UNKNOWN"),
            **_metrics(entry),
        })

    entries.sort(key=lambda e: (e["oos_score"], e["train_score"]), reverse=True)
    for rank, entry in enumerate(entries[:top_n], start=1):
        entry["rank"] = rank
    return entries[:top_n]


class SweepLeaderboardStore:
    """Персист артефактов прогонов: последний прогон на (symbol, timeframe, strategy)."""

    def __init__(self, path: Path):
        self.path = Path(path)

    def _load(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {"runs": {}}
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {"runs": {}}

    def _save(self, data: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def _key(symbol: str, timeframe: str, strategy_type: str) -> str:
        return f"{symbol.upper()}|{timeframe}|{strategy_type}"

    def record_run(
        self,
        opt_result: Dict[str, Any],
        symbol: str,
        timeframe: str,
        top_n: int = MAX_ENTRIES_PER_RUN,
    ) -> Dict[str, Any]:
        """Сохраняет прогон как артефакт и возвращает его."""
        strategy = str(opt_result.get("strategy_type", "unknown"))
        entries = build_leaderboard_entries(opt_result, symbol, timeframe, top_n=top_n)
        artifact = {
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "strategy_type": strategy,
            "recorded_at": int(time.time() * 1000),
            "combinations_tested": opt_result.get("combinations_tested", 0),
            "train_bars": opt_result.get("train_bars", 0),
            "oos_bars": opt_result.get("oos_bars", 0),
            "entries": entries,
        }
        data = self._load()
        data.setdefault("runs", {})[self._key(symbol, timeframe, strategy)] = artifact
        self._save(data)
        return artifact

    def latest(
        self,
        symbol: Optional[str] = None,
        timeframe: Optional[str] = None,
        strategy_type: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Последний артефакт по фильтрам (None = любой). Пусто → None."""
        runs = list(self._load().get("runs", {}).values())
        if symbol:
            runs = [r for r in runs if r.get("symbol") == symbol.upper()]
        if timeframe:
            runs = [r for r in runs if r.get("timeframe") == timeframe]
        if strategy_type:
            runs = [r for r in runs if r.get("strategy_type") == strategy_type]
        if not runs:
            return None
        return max(runs, key=lambda r: r.get("recorded_at", 0))

    def list_runs(self) -> List[Dict[str, Any]]:
        """Все артефакты без тел записей (для индекса UI)."""
        return [
            {k: v for k, v in run.items() if k != "entries"}
            for run in sorted(
                self._load().get("runs", {}).values(),
                key=lambda r: r.get("recorded_at", 0), reverse=True,
            )
        ]
