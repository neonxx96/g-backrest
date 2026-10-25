"""
Селективный динамический расчёт SL/TP через конус волатильности (ATR) и Liquidity Magnet (Блок 2)
==================================================================================================
Модуль решает проблему универсального применения стенок стакана ко всем монетам:
- На парах с глубоким институциональным стаканом (`BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `XRPUSDT`)
  крупные лимитные плотности в L2-стакане работают как реальные магниты цены (`magnet_hybrid`).
- На высоковолатильных альткоинах (`SOLUSDT`, `DOGEUSDT`, `SUIUSDT`, `NEARUSDT`), где стенки
  в стакане тоньше и чаще подвержены спуфингу, применяется волатильностный конус (`atr_cone`).
- Режим `auto_calibrated` сравнивает `fixed`, `atr_cone` и `magnet_hybrid` на историческом
  train-срезе конкретной пары (Zero Look-Ahead) и выбирает режим с лучшим Net Profit Factor.
- Режим `fixed` сохраняет 100% обратную совместимость с фиксированными процентами `stop_loss_pct` / `take_profit_pct`.
"""

import math
from typing import Any, Dict, Optional

from backend.app.engine.cluster_filters import compute_fee_aware_rr_bounds
from backend.app.engine.execution import _estimate_tick_size

SL_TP_MODES = ("fixed", "atr_cone", "magnet_hybrid", "auto_calibrated")

# Пары первого эшелона с глубоким L2-стаканом, где плотности выступают устойчивыми магнитами ликвидности
DEEP_BOOK_SYMBOLS = frozenset({"BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT"})

# Минимальный объём стенки (USD), ниже которого Liquidity Magnet отключается (защита от спуфинга)
MIN_VERIFIED_MAGNET_WALL_USD = {
    "BTCUSDT": 600_000.0,
    "ETHUSDT": 350_000.0,
    "BNBUSDT": 200_000.0,
    "XRPUSDT": 180_000.0,
}
DEFAULT_MIN_MAGNET_WALL_USD = 250_000.0


def recommend_pair_sl_tp_mode(
    symbol: str,
    *,
    requested_mode: Optional[str] = None,
    orderbook_depth_usd: Optional[float] = None,
    wall_volume_usd: Optional[float] = None,
    min_density_usd: Optional[float] = None,
    atr_pct: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Определяет оптимальный режим расчёта SL/TP для конкретной торговой пары
    с учётом глубины стакана и волатильности.
    """
    sym = str(symbol or "BTCUSDT").strip().upper()
    is_deep_book = sym in DEEP_BOOK_SYMBOLS
    min_wall_req = float(min_density_usd) if (min_density_usd is not None and min_density_usd > 0) else MIN_VERIFIED_MAGNET_WALL_USD.get(sym, DEFAULT_MIN_MAGNET_WALL_USD)

    # Если явно передан объём стенки или глубина стакана и они слишком тонкие — отключаем magnet_hybrid
    if wall_volume_usd is not None and float(wall_volume_usd) < min_wall_req:
        return {
            "symbol": sym,
            "recommended_mode": "atr_cone",
            "is_deep_book": is_deep_book,
            "reason": (
                f"Плотность стенки (${float(wall_volume_usd):,.0f}) ниже порога устойчивости "
                f"${min_wall_req:,.0f} для {sym} — используется конус волатильности ATR (защита от спуфинга)."
            ),
        }

    if orderbook_depth_usd is not None and float(orderbook_depth_usd) < min_wall_req * 1.5:
        return {
            "symbol": sym,
            "recommended_mode": "atr_cone",
            "is_deep_book": False,
            "reason": (
                f"Тонкий стакан (${float(orderbook_depth_usd):,.0f}) на {sym} — "
                f"применяется чистый ATR Volatility Cone."
            ),
        }

    # Если волатильность экстремальная (ATR > 1.8% на 5m/15m), стенки пробиваются импульсом -> atr_cone
    if atr_pct is not None and float(atr_pct) >= 1.8:
        return {
            "symbol": sym,
            "recommended_mode": "atr_cone",
            "is_deep_book": is_deep_book,
            "reason": (
                f"Экстремальная волатильность ATR ({float(atr_pct):.2f}%) на {sym} — "
                f"цели рассчитываются по расширению конуса волатильности."
            ),
        }

    if is_deep_book:
        return {
            "symbol": sym,
            "recommended_mode": "magnet_hybrid",
            "is_deep_book": True,
            "reason": (
                f"Глубокий институциональный стакан {sym}: стоп за границей шума ATR, "
                f"тейк-профит перед подтверждённой плотностью Liquidity Magnet."
            ),
        }

    return {
        "symbol": sym,
        "recommended_mode": "atr_cone",
        "is_deep_book": False,
        "reason": (
            f"Волатильный альткоин {sym}: лимитные стенки подвержены спуфингу, "
            f"применяется динамический конус волатильности ATR."
        ),
    }


def compute_dynamic_sl_tp_levels(
    *,
    symbol: str,
    direction: str | int = "LONG",
    side: Optional[str | int] = None,
    entry_price: float,
    atr: float,
    sl_tp_mode: str = "fixed",
    stop_loss_pct: float = 0.8,
    take_profit_pct: float = 1.8,
    sl_pct: Optional[float] = None,
    tp_pct: Optional[float] = None,
    atr_multiplier: float = 1.35,
    tp1_rr_ratio: float = 1.5,
    tp2_rr_ratio: float = 2.5,
    use_multi_tp: bool = True,
    horizon_bars: int = 12,
    nearest_support_wall_price: Optional[float] = None,
    nearest_support_wall_usd: Optional[float] = None,
    nearest_resistance_wall_price: Optional[float] = None,
    nearest_resistance_wall_usd: Optional[float] = None,
    wall_volume_usd: Optional[float] = None,
    min_density_usd: Optional[float] = None,
    front_run_ticks: int = 3,
    maker_fee_pct: float = 0.02,
    taker_fee_pct: float = 0.05,
    slippage_bps: float = 2.0,
    price_dec: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Вычисляет цены и дистанции SL, TP1, TP2 для выбранного `sl_tp_mode`:
    - `fixed`: строго по `stop_loss_pct` и `take_profit_pct`.
    - `atr_cone`: SL = clamp(atr_multiplier * ATR, 0.25%..2.5%), TP по конусу ±1σ/±1.5σ с защитой Fee-Aware R:R.
    - `magnet_hybrid`: для глубоких пар ставит TP на `front_run_ticks` тиков ПЕРЕД противостоящей стенкой
      Liquidity Magnet (если R:R >= 1.8 и стенка внутри 2σ конуса). Если стенка слишком близко (< 1.2R),
      выставляет флаг `magnet_veto = True`.
    """
    p = max(1e-8, float(entry_price))
    dec = price_dec if price_dec is not None else (1 if p >= 1000 else (2 if p >= 10 else 4))
    tick_sz = _estimate_tick_size(p)
    eff_dir = side if side is not None else direction
    sign = 1 if (eff_dir in (1, "LONG", "BUY", "BULLISH")) else -1
    dir_str = "LONG" if sign == 1 else "SHORT"
    mode = str(sl_tp_mode or "fixed").strip().lower()
    if mode not in SL_TP_MODES:
        mode = "fixed"

    eff_wall_usd = wall_volume_usd
    if eff_wall_usd is None:
        opposing_wall_usd = nearest_resistance_wall_usd if sign == 1 else nearest_support_wall_usd
        if opposing_wall_usd is not None and opposing_wall_usd > 0:
            eff_wall_usd = opposing_wall_usd

    # Если выбран auto_calibrated без предварительного прогона — выбираем рекомендованный профиль по паре
    effective_mode = mode
    pair_rec = recommend_pair_sl_tp_mode(
        symbol,
        wall_volume_usd=eff_wall_usd,
        min_density_usd=min_density_usd,
        atr_pct=(atr / p * 100.0) if atr > 0 else None,
    )
    if effective_mode == "auto_calibrated":
        effective_mode = pair_rec["recommended_mode"]
    elif effective_mode == "magnet_hybrid" and pair_rec["recommended_mode"] == "atr_cone" and eff_wall_usd is not None:
        # Защита от спуфинга: если передан слабый объём стенки, переключаемся на чистый atr_cone
        effective_mode = "atr_cone"

    safe_sl_pct = max(0.05, float((sl_pct if sl_pct is not None else stop_loss_pct) or 0.8))
    safe_tp_pct = max(0.10, float((tp_pct if tp_pct is not None else take_profit_pct) or 1.8))
    safe_tp1_rr = max(1.0, float(tp1_rr_ratio or 1.5))
    safe_tp2_rr = max(1.8, float(tp2_rr_ratio or 2.5))

    # 1. Режим FIXED (100% обратная совместимость)
    if effective_mode == "fixed" or atr <= 0:
        sl_dist = p * (safe_sl_pct / 100.0)
        tp2_dist = p * (safe_tp_pct / 100.0)
        tp1_dist = min(tp2_dist, sl_dist * safe_tp1_rr)
        sl_price = round(max(1e-8, p - sign * sl_dist), dec)
        tp1_price = round(max(1e-8, p + sign * tp1_dist), dec)
        tp2_price = round(max(1e-8, p + sign * tp2_dist), dec)
        eff_rr = round(tp2_dist / max(1e-9, sl_dist), 2)
        return {
            "mode_requested": mode,
            "mode_applied": "fixed",
            "applied_mode": "fixed",
            "direction": dir_str,
            "entry_price": round(p, dec),
            "sl_price": sl_price,
            "tp1_price": tp1_price,
            "tp2_price": tp2_price,
            "sl_dist": sl_dist,
            "tp1_dist": tp1_dist,
            "tp2_dist": tp2_dist,
            "sl_pct": round(sl_dist / p * 100.0, 3),
            "tp1_pct": round(tp1_dist / p * 100.0, 3),
            "tp2_pct": round(tp2_dist / p * 100.0, 3),
            "expected_rr": eff_rr,
            "magnet_snapped": False,
            "magnet_veto": False,
            "reason": f"Фиксированный профиль SL {safe_sl_pct:.2f}% / TP {safe_tp_pct:.2f}% (R:R 1:{eff_rr})",
        }

    # 2. Базовый расчёт по конусу волатильности ATR (atr_cone)
    atr_mult = max(0.6, min(4.0, float(atr_multiplier or 1.35)))
    raw_atr_sl_dist = float(atr) * atr_mult
    # Ограничиваем стоп разумным коридором 0.25% .. 2.5% от цены входа
    sl_dist = max(p * 0.0025, min(p * 0.025, raw_atr_sl_dist))

    # В режиме magnet_hybrid проверяем, есть ли защитная стенка позади входа (support для LONG, resistance для SHORT)
    protective_wall = nearest_support_wall_price if sign == 1 else nearest_resistance_wall_price
    if effective_mode == "magnet_hybrid" and protective_wall is not None and protective_wall > 0:
        wall_behind_valid = (sign == 1 and protective_wall < p) or (sign == -1 and protective_wall > p)
        if wall_behind_valid:
            wall_gap = abs(p - float(protective_wall)) + max(1, int(front_run_ticks)) * tick_sz
            # Если защитная стенка находится на разумном расстоянии (до 1.8x ATR), прячем стоп за неё
            if p * 0.0020 <= wall_gap <= max(sl_dist * 1.35, float(atr) * 1.8):
                sl_dist = wall_gap

    sl_pct_eff = (sl_dist / p) * 100.0
    rr_bounds = compute_fee_aware_rr_bounds(
        sl_pct_eff,
        maker_fee_pct=maker_fee_pct,
        taker_fee_pct=taker_fee_pct,
    )
    min_viable_rr = max(1.8, float(rr_bounds["min_viable_rr"]))
    target_tp2_rr = max(min_viable_rr, safe_tp2_rr)

    # Конус волатильности на горизонте horizon_bars свечей
    h_bars = max(4, min(32, int(horizon_bars or 12)))
    sigma_1_bar = float(atr) * 0.9
    cone_1sigma_dist = sigma_1_bar * math.sqrt(h_bars)
    cone_2sigma_dist = cone_1sigma_dist * 1.96

    # TP2 по конусу: не ниже min_viable_rr * SL, но стремится к границе 1σ..1.4σ конуса
    tp2_dist = max(sl_dist * target_tp2_rr, min(cone_2sigma_dist * 0.85, max(cone_1sigma_dist, sl_dist * safe_tp2_rr)))
    tp1_dist = min(tp2_dist * 0.68, max(sl_dist * safe_tp1_rr, cone_1sigma_dist * 0.55))

    magnet_snapped = False
    magnet_veto = False
    reason = (
        f"ATR Volatility Cone ({h_bars} баров): SL={sl_pct_eff:.2f}% ({atr_mult:.2f}×ATR), "
        f"TP2 по конусу волатильности (R:R 1:{tp2_dist / max(1e-9, sl_dist):.2f})"
    )

    # 3. Гибридная привязка к Liquidity Magnet (только для magnet_hybrid)
    opposing_wall = nearest_resistance_wall_price if sign == 1 else nearest_support_wall_price
    if effective_mode == "magnet_hybrid" and opposing_wall is not None and opposing_wall > 0:
        wall_ahead_valid = (sign == 1 and opposing_wall > p) or (sign == -1 and opposing_wall < p)
        if wall_ahead_valid:
            front_offset = max(1, int(front_run_ticks)) * tick_sz
            candidate_tp_price = (float(opposing_wall) - front_offset) if sign == 1 else (float(opposing_wall) + front_offset)
            candidate_tp_dist = abs(candidate_tp_price - p)
            candidate_rr = candidate_tp_dist / max(1e-9, sl_dist)

            if candidate_rr < 1.2:
                # Встречная крупная стенка стоит прямо перед носом (< 1.2R) — вход опасен!
                magnet_veto = True
                reason = (
                    f"Liquidity Magnet VETO: встречная стенка ${float(opposing_wall):,.2f} слишком близко "
                    f"(R:R всего 1:{candidate_rr:.2f} < 1:1.20)."
                )
            elif candidate_rr >= 1.8 and candidate_tp_dist <= cone_2sigma_dist * 1.15:
                # Стенка даёт отличный R:R >= 1.8 и достижима внутри конуса волатильности -> ставим TP2 перед стенкой!
                tp2_dist = candidate_tp_dist
                tp1_dist = min(tp2_dist * 0.65, max(sl_dist * safe_tp1_rr, tp2_dist * 0.5))
                magnet_snapped = True
                reason = (
                    f"Liquidity Magnet Hybrid: TP2 выставлен на {front_run_ticks} тика перед стенкой "
                    f"${float(opposing_wall):,.2f} (R:R 1:{candidate_rr:.2f})."
                )
            elif 1.25 <= candidate_rr < 1.8:
                # Стенка ближе финального TP2, но подходит для фиксации первого тейка TP1 (50% позиции + Б/У)!
                tp1_dist = candidate_tp_dist
                magnet_snapped = True
                reason = (
                    f"Liquidity Magnet Hybrid: TP1 (50% + Б/У) выставлен перед ближней стенкой "
                    f"${float(opposing_wall):,.2f} (1:{candidate_rr:.2f}R), TP2 по конусу ATR."
                )

    sl_price = round(max(1e-8, p - sign * sl_dist), dec)
    tp1_price = round(max(1e-8, p + sign * tp1_dist), dec)
    tp2_price = round(max(1e-8, p + sign * tp2_dist), dec)
    eff_rr = round(tp2_dist / max(1e-9, sl_dist), 2)

    return {
        "mode_requested": mode,
        "mode_applied": effective_mode,
        "applied_mode": effective_mode,
        "direction": dir_str,
        "entry_price": round(p, dec),
        "sl_price": sl_price,
        "tp1_price": tp1_price,
        "tp2_price": tp2_price,
        "sl_dist": sl_dist,
        "tp1_dist": tp1_dist,
        "tp2_dist": tp2_dist,
        "sl_pct": round(sl_dist / p * 100.0, 3),
        "tp1_pct": round(tp1_dist / p * 100.0, 3),
        "tp2_pct": round(tp2_dist / p * 100.0, 3),
        "expected_rr": eff_rr,
        "magnet_snapped": magnet_snapped,
        "magnet_veto": magnet_veto,
        "reason": reason,
    }


def calibrate_best_sl_tp_mode_for_df(
    backtester: Any,
    df: Any,
    *,
    symbol: str = "BTCUSDT",
    strategy_type: str = "confluence_ema",
    backtest_kwargs: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Автокалибровка режима SL/TP (`fixed` vs `atr_cone` vs `magnet_hybrid`) на историческом
    train-срезе (первые 70% свечей, чтобы исключить Look-Ahead Bias на финальном тесте).
    Возвращает выбранный режим и сравнительную таблицу метрик.
    """
    kwargs = dict(backtest_kwargs or {})
    # Отключаем тяжёлый Monte-Carlo и рекурсивный sl_tp_mode при внутреннем сравнении
    kwargs["compute_monte_carlo"] = False
    kwargs["fast_eval"] = True
    kwargs.pop("sl_tp_mode", None)

    pair_default = recommend_pair_sl_tp_mode(symbol)["recommended_mode"]
    if df is None or len(df) < 80:
        return {
            "selected_mode": pair_default,
            "symbol": symbol,
            "reason": f"Мало свечей для автокалибровки (<80) — выбран профиль пары {pair_default}",
            "candidates": {},
        }

    split_idx = max(60, int(len(df) * 0.70))
    train_df = df.iloc[:split_idx].reset_index(drop=True)

    candidates_cfg = {
        "fixed": {"sl_tp_mode": "fixed"},
        "atr_cone": {"sl_tp_mode": "atr_cone"},
        "magnet_hybrid": {"sl_tp_mode": "magnet_hybrid"},
    }

    results: Dict[str, Dict[str, Any]] = {}
    best_mode = pair_default
    best_score = -1e9

    for mode_name, mode_override in candidates_cfg.items():
        run_cfg = {**kwargs, **mode_override}
        res = backtester.run_backtest(train_df, strategy_type=strategy_type, **run_cfg)
        trades_cnt = int(res.get("total_trades", 0) or 0)
        pf = float(res.get("profit_factor", 0.0) or 0.0)
        net_pnl = float(res.get("net_pnl", 0.0) or 0.0)
        max_dd = float(res.get("max_drawdown_pct", 0.0) or 0.0)

        # Оценка качества режима: приоритет положительному Net PnL и Profit Factor при разумной просадке
        if trades_cnt < 2:
            score = -1000.0 + trades_cnt
        else:
            capped_pf = min(pf, 5.0)
            score = (capped_pf * 25.0) + (net_pnl * 0.05) - (max_dd * 1.2)
            # Небольшой бонус профильному режиму пары при близких результатах
            if mode_name == pair_default:
                score += 1.5

        results[mode_name] = {
            "total_trades": trades_cnt,
            "profit_factor": round(pf, 2),
            "net_pnl": round(net_pnl, 2),
            "max_drawdown_pct": round(max_dd, 2),
            "score": round(score, 2),
        }
        if score > best_score and trades_cnt >= 2:
            best_score = score
            best_mode = mode_name

    return {
        "selected_mode": best_mode,
        "symbol": symbol,
        "train_bars": len(train_df),
        "candidates": results,
        "reason": (
            f"Auto-Calibrated на {len(train_df)} train-свечах: выбран '{best_mode}' "
            f"(PF={results.get(best_mode, {}).get('profit_factor', 0.0)}, "
            f"Net PnL=${results.get(best_mode, {}).get('net_pnl', 0.0)})"
        ),
    }
