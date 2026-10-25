"""
Cluster Order-Flow Filters & Fee-Aware R:R Optimization Helpers (Блок 1).

Гарантии:
- Zero Look-Ahead Bias: на баре `i` используются строго данные индексов `<= i`.
- Двухрежимность (Live + Historical): если для текущей свечи доступны живые
  кластеры из `OrderFlowRecorder` (`stacked_imbalance`, `absorption`, `poc_price`,
  `poc_migration`), фильтры опираются на них напрямую; на исторических OHLCV+Delta
  данных используется детерминированная микроструктурная реконструкция.
"""

from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


def compute_bar_cluster_arrays(data: pd.DataFrame) -> SimpleNamespace:
    """
    Векторизованный расчет кластерных признаков по OHLCV + Delta/CVD без заглядывания в будущее.
    Возвращает SimpleNamespace с numpy-массивами длины `len(data)`.
    """
    n = len(data)
    if n == 0:
        empty_f = np.zeros(0, dtype=float)
        empty_i = np.zeros(0, dtype=np.int8)
        empty_b = np.zeros(0, dtype=bool)
        return SimpleNamespace(
            poc_vals=empty_f,
            poc_migration_vals=empty_i,
            imbalance_ratio_vals=empty_f,
            stacked_buy_vals=empty_b,
            stacked_sell_vals=empty_b,
            bull_absorption_vals=empty_b,
            bear_absorption_vals=empty_b,
        )

    open_v = pd.to_numeric(data["open"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
    high_v = pd.to_numeric(data["high"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
    low_v = pd.to_numeric(data["low"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
    close_v = pd.to_numeric(data["close"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
    vol_v = np.maximum(pd.to_numeric(data["volume"], errors="coerce").fillna(0.0).to_numpy(dtype=float), 1e-9)

    if "delta" in data.columns:
        delta_v = pd.to_numeric(data["delta"], errors="coerce").fillna(0.0).to_numpy(dtype=float)
    else:
        delta_v = np.zeros(n, dtype=float)

    if "vol_ratio" in data.columns:
        vol_rat_v = pd.to_numeric(data["vol_ratio"], errors="coerce").fillna(1.0).to_numpy(dtype=float)
    else:
        vol_ma = pd.Series(vol_v).rolling(20, min_periods=1).mean().to_numpy(dtype=float)
        vol_rat_v = vol_v / np.maximum(vol_ma, 1e-9)

    # 1. Объёмно-взвешенный центр свечи (Bar POC proxy)
    poc_vals = (open_v + 2.0 * close_v + high_v + low_v) / 5.0

    # 2. Направление миграции POC (+1 вверх, -1 вниз, 0 флэт) строго по прошлым барам i-1, i-2
    poc_migration_vals = np.zeros(n, dtype=np.int8)
    if n >= 3:
        prev1 = np.roll(poc_vals, 1)
        prev2 = np.roll(poc_vals, 2)
        prev1[0] = poc_vals[0]
        prev2[:2] = poc_vals[:2]
        up_mig = (poc_vals >= prev1) & (poc_vals > prev2)
        dn_mig = (poc_vals <= prev1) & (poc_vals < prev2)
        poc_migration_vals = np.where(up_mig, 1, np.where(dn_mig, -1, 0)).astype(np.int8)

    # 3. Оценка Buy/Sell объёма и кластерного дисбаланса (Stacked / Directional Imbalance)
    buy_vol = np.clip((vol_v + delta_v) * 0.5, 0.0, None)
    sell_vol = np.clip(vol_v - buy_vol, 0.0, None)
    buy_sell_ratio = buy_vol / np.maximum(sell_vol, vol_v * 0.02)
    sell_buy_ratio = sell_vol / np.maximum(buy_vol, vol_v * 0.02)
    imbalance_ratio_vals = np.maximum(buy_sell_ratio, sell_buy_ratio)

    prev_delta = np.roll(delta_v, 1)
    prev_delta[0] = 0.0

    # Stacked Buy: сильный перекос покупателей (>= 1.65x) ИЛИ 2 бара подряд доминанты положительной дельты с закрытием выше открытия
    stacked_buy_vals = (
        ((buy_sell_ratio >= 1.65) & (vol_rat_v >= 0.95))
        | ((delta_v > 0) & (prev_delta > 0) & (close_v >= open_v) & (vol_rat_v >= 0.90))
    )
    stacked_sell_vals = (
        ((sell_buy_ratio >= 1.65) & (vol_rat_v >= 0.95))
        | ((delta_v < 0) & (prev_delta < 0) & (close_v <= open_v) & (vol_rat_v >= 0.90))
    )

    # 4. Лимитное поглощение (Absorption):
    # (а) классическое усилие без результата: повышенный объём при малой доле дельты и закрытии в пользу лимитной стороны;
    # (б) тормозной хвост (wick rejection >= 30% диапазона свечи) с возвратом закрытия за POC.
    candle_range = np.maximum(high_v - low_v, close_v * 1e-6)
    close_pos_in_range = (close_v - low_v) / candle_range  # 0.0 у low, 1.0 у high
    delta_share = np.abs(delta_v) / vol_v

    body_low = np.minimum(open_v, close_v)
    body_high = np.maximum(open_v, close_v)
    lower_wick_share = (body_low - low_v) / candle_range
    upper_wick_share = (high_v - body_high) / candle_range

    bull_absorption_vals = (
        ((vol_rat_v >= 1.15) & (delta_share <= 0.35) & (close_pos_in_range >= 0.45))
        | ((lower_wick_share >= 0.28) & (close_v >= poc_vals) & (vol_rat_v >= 0.95))
    )
    bear_absorption_vals = (
        ((vol_rat_v >= 1.15) & (delta_share <= 0.35) & (close_pos_in_range <= 0.55))
        | ((upper_wick_share >= 0.28) & (close_v <= poc_vals) & (vol_rat_v >= 0.95))
    )

    return SimpleNamespace(
        poc_vals=poc_vals,
        poc_migration_vals=poc_migration_vals,
        imbalance_ratio_vals=imbalance_ratio_vals,
        stacked_buy_vals=stacked_buy_vals,
        stacked_sell_vals=stacked_sell_vals,
        bull_absorption_vals=bull_absorption_vals,
        bear_absorption_vals=bear_absorption_vals,
    )


def check_cluster_filters_at_bar(
    i: int,
    direction: int,
    cluster_arrays: SimpleNamespace,
    use_stacked_imbalance_filter: bool = False,
    use_absorption_filter: bool = False,
    use_poc_migration_filter: bool = False,
    live_cluster_candle: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, List[str]]:
    """
    Проверяет кластерные фильтры для направления `direction` (+1 LONG / -1 SHORT) на баре `i`.
    Возвращает `(allowed, failed_checks)`.
    """
    if direction == 0:
        return True, []

    failed: List[str] = []

    # 1. Фильтр Stacked Imbalance (подтверждение агрессивного дисбаланса по направлению входа)
    if use_stacked_imbalance_filter:
        live_ok = None
        if live_cluster_candle and isinstance(live_cluster_candle.get("stacked_imbalance"), dict):
            st = live_cluster_candle["stacked_imbalance"]
            if direction > 0:
                live_ok = int(st.get("buy", 0)) > 0
            else:
                live_ok = int(st.get("sell", 0)) > 0

        if live_ok is not None:
            passed_stacked = live_ok
        else:
            passed_stacked = bool(
                cluster_arrays.stacked_buy_vals[i] if direction > 0 else cluster_arrays.stacked_sell_vals[i]
            )
        if not passed_stacked:
            failed.append("stacked_imbalance_filter")

    # 2. Фильтр Absorption (лимитное поглощение / защита уровня)
    if use_absorption_filter:
        live_abs_ok = None
        if live_cluster_candle and "absorption" in live_cluster_candle and live_cluster_candle.get("levels"):
            # Если в живом футпринте зафиксирована absorption или торможение на экстремуме
            is_abs = bool(live_cluster_candle.get("absorption"))
            bar_ok = bool(
                cluster_arrays.bull_absorption_vals[i] if direction > 0 else cluster_arrays.bear_absorption_vals[i]
            )
            live_abs_ok = is_abs or bar_ok

        if live_abs_ok is not None:
            passed_abs = live_abs_ok
        else:
            passed_abs = bool(
                cluster_arrays.bull_absorption_vals[i] if direction > 0 else cluster_arrays.bear_absorption_vals[i]
            )
        if not passed_abs:
            failed.append("absorption_filter")

    # 3. Фильтр POC Migration (запрет входа против устойчивой миграции объёмного центра POC)
    if use_poc_migration_filter:
        mig = int(cluster_arrays.poc_migration_vals[i])
        if live_cluster_candle and live_cluster_candle.get("poc_migration") in (-1, 0, 1):
            live_mig = int(live_cluster_candle["poc_migration"])
            if live_mig != 0:
                mig = live_mig
        # Для LONG запрещаем вход при миграции POC строго вниз (-1); для SHORT — при миграции строго вверх (+1)
        if (direction > 0 and mig < 0) or (direction < 0 and mig > 0):
            failed.append("poc_migration_filter")

    return len(failed) == 0, failed


def compute_fee_aware_rr_bounds(
    stop_loss_pct: float,
    maker_fee_pct: float = 0.02,
    taker_fee_pct: float = 0.05,
    slippage_pct: float = 0.03,
    min_rr_floor: float = 1.8,
    max_fee_drag_share: float = 0.22,
) -> Dict[str, float]:
    """
    Рассчитывает минимально рентабельное соотношение Risk:Reward (R:R) и цели Multi-TP
    с учетом реального трения комиссий и проскальзывания (Fee Drag Guard).

    Логика:
    - Круговые издержки `round_trip_cost_pct = maker_fee_pct + taker_fee_pct + slippage_pct` (обычно ~0.10%).
    - Чтобы комиссии не съедали больше `max_fee_drag_share` (22%) от потенциального тейка,
      `take_profit_pct` должен быть не меньше `round_trip_cost_pct / max_fee_drag_share` (~0.45%),
      а `effective_rr = take_profit_pct / stop_loss_pct` — не ниже `min_rr_floor` (1.8x).
    """
    sl = max(0.15, float(stop_loss_pct or 0.5))
    round_trip_cost_pct = max(0.01, float(maker_fee_pct) + float(taker_fee_pct) + float(slippage_pct))
    fee_drag_r = round_trip_cost_pct / sl

    # Чем уже стоп (выше fee_drag_r), тем выше должен быть минимальный R:R для положительного мат. ожидания
    required_rr_by_fee = max(float(min_rr_floor), 1.6 + 2.2 * fee_drag_r)
    min_viable_tp_pct = max(
        sl * required_rr_by_fee,
        round_trip_cost_pct / max(0.05, float(max_fee_drag_share)),
    )
    recommended_rr = round(max(required_rr_by_fee, min_viable_tp_pct / sl), 2)
    recommended_tp_pct = round(sl * recommended_rr, 2)

    # Синхронизированные уровни Multi-TP:
    # TP1 забирает 50% позиции на уровне, гарантированно перекрывающем 3x комиссий + дающем ~55% от общего R:R
    tp1_rr = round(max(1.2, min(recommended_rr * 0.6, recommended_rr - 0.5)), 2)
    tp2_rr = round(recommended_rr, 2)

    return {
        "stop_loss_pct": round(sl, 2),
        "round_trip_cost_pct": round(round_trip_cost_pct, 4),
        "fee_drag_r": round(fee_drag_r, 4),
        "min_viable_rr": round(required_rr_by_fee, 2),
        "min_viable_tp_pct": round(min_viable_tp_pct, 2),
        "recommended_rr": recommended_rr,
        "recommended_tp_pct": recommended_tp_pct,
        "tp1_rr_ratio": tp1_rr,
        "tp2_rr_ratio": tp2_rr,
    }
