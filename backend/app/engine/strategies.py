"""
Per-bar strategy signal generation (MODULARIZATION_PLAN п.3, слайс 6.4).

Тело if/elif-цепочки выносится из OrderFlowBacktester.run_backtest ДОСЛОВНО
(условия и пороги не менялись — поведение 1:1). Контекст бара (массивы индикаторов,
пороги стенок, скаляры текущей свечи) передаётся через SimpleNamespace `ctx`;
имена атрибутов совпадают с именами локальных переменных оригинала.

Стратегии:
- confluence_ema     — отскок/пробой EMA20 с объёмом, дельтой и RSI-фильтром
- ema_trend          — пересечение EMA fast/slow
- ema_trend_window   — подтверждение в окне 8 баров после свежего кросса EMA20/50
- ema_pullback       — отскок к EMA20 внутри тренда
- delta_absorption   — поглощение на экстремумах CVD (low_min10/high_max10)
- density_bounce     — пин-бар у плотности (limit_bounce alias)
- diagnostics_lenient / naked_test — диагностические генераторы
- wall_breakout      — импульсный пробой локального экстремума (breakout alias)
"""
from types import SimpleNamespace


def compute_raw_signal(i: int, ctx: SimpleNamespace, eff_strategy: str) -> int:
    """Возвращает raw_signal (-1/0/1) для бара i. Тело — дословный перенос из run_backtest."""
    passes_wall = ctx.passes_wall
    passes_lifetime = ctx.passes_lifetime
    c = ctx.c
    prev_c = ctx.prev_c
    ema = ctx.ema
    prev_ema = ctx.prev_ema
    v_rat = ctx.v_rat
    delta = ctx.delta
    rsi = ctx.rsi
    volume_multiplier = ctx.volume_multiplier
    ema20_vals = ctx.ema20_vals
    ema50_vals = ctx.ema50_vals
    low_vals = ctx.low_vals
    high_vals = ctx.high_vals
    low_min10_vals = ctx.low_min10_vals
    high_max10_vals = ctx.high_max10_vals
    cvd_vals = ctx.cvd_vals
    cvd_min10_vals = ctx.cvd_min10_vals
    cvd_max10_vals = ctx.cvd_max10_vals
    low_min6_vals = ctx.low_min6_vals
    high_max6_vals = ctx.high_max6_vals
    raw_signal = 0

    if eff_strategy == "confluence_ema":
        if passes_wall and passes_lifetime and prev_c <= prev_ema and c > ema and v_rat >= volume_multiplier and delta > 0 and 40 <= rsi <= 65:
            raw_signal = 1
        elif passes_wall and passes_lifetime and prev_c >= prev_ema and c < ema and v_rat >= volume_multiplier and delta < 0 and 35 <= rsi <= 60:
            raw_signal = -1

    elif eff_strategy == "ema_trend":
        cross_up = ema20_vals[i - 1] <= ema50_vals[i - 1] and ema20_vals[i] > ema50_vals[i]
        cross_dn = ema20_vals[i - 1] >= ema50_vals[i - 1] and ema20_vals[i] < ema50_vals[i]
        if passes_wall and passes_lifetime and cross_up and v_rat >= volume_multiplier and delta > 0:
            raw_signal = 1
        elif passes_wall and passes_lifetime and cross_dn and v_rat >= volume_multiplier and delta < 0:
            raw_signal = -1

    elif eff_strategy == "ema_trend_window":
        # Окно после свежего кросса EMA20/50 (W баров): вход не на самом кроссе
        # (это ema_trend), а на подтверждении — близость тренда сохранена и цена
        # закрылась обратно по стороне кросса. Реже pullback, чаще чистого кросса.
        W = 8
        j = 0
        cross_up_at_j = False
        for k in range(i, max(1, i - W), -1):
            if ema20_vals[k - 1] <= ema50_vals[k - 1] and ema20_vals[k] > ema50_vals[k]:
                j, cross_up_at_j = k, True
                break
            if ema20_vals[k - 1] >= ema50_vals[k - 1] and ema20_vals[k] < ema50_vals[k]:
                j, cross_up_at_j = k, False
                break
        # j < i: кросс строго раньше текущего бара (текущий кросс — зона ema_trend)
        if j and j < i:
            trend_up = ema20_vals[i] > ema50_vals[i]
            trend_dn = ema20_vals[i] < ema50_vals[i]
            if passes_wall and cross_up_at_j and trend_up and c > ema20_vals[i] and v_rat >= volume_multiplier and delta > 0:
                raw_signal = 1
            elif passes_wall and (not cross_up_at_j) and trend_dn and c < ema20_vals[i] and v_rat >= volume_multiplier and delta < 0:
                raw_signal = -1

    elif eff_strategy == "ema_pullback":
        # Отскок к EMA20 внутри тренда: касание EMA20 и закрытие обратно по направлению
        # тренда (EMA20 выше/ниже EMA50). Существенно чаще пересечения EMA20/50 —
        # основной вход в тренде, а не разворотный сигнал.
        trend_up = ema20_vals[i] > ema50_vals[i]
        trend_dn = ema20_vals[i] < ema50_vals[i]
        touch_reject_up = low_vals[i] <= ema20_vals[i] and c > ema20_vals[i]
        touch_reject_dn = high_vals[i] >= ema20_vals[i] and c < ema20_vals[i]
        if passes_wall and passes_lifetime and trend_up and touch_reject_up and v_rat >= volume_multiplier and delta > 0:
            raw_signal = 1
        elif passes_wall and passes_lifetime and trend_dn and touch_reject_dn and v_rat >= volume_multiplier and delta < 0:
            raw_signal = -1

    elif eff_strategy in ("delta_absorption", "cvd_absorption"):
        if passes_wall and passes_lifetime and low_vals[i] <= low_min10_vals[i] and cvd_vals[i] > cvd_min10_vals[i] and delta > 0 and rsi < 42 and v_rat >= volume_multiplier:
            raw_signal = 1
        elif passes_wall and passes_lifetime and high_vals[i] >= high_max10_vals[i] and cvd_vals[i] < cvd_max10_vals[i] and delta < 0 and rsi > 58 and v_rat >= volume_multiplier:
            raw_signal = -1

    elif eff_strategy in ("density_bounce", "limit_bounce"):
        if passes_wall and passes_lifetime:
            is_pinbar_bull = (c - low_vals[i]) > 1.8 * (high_vals[i] - c) and delta > 0
            is_pinbar_bear = (high_vals[i] - c) > 1.8 * (c - low_vals[i]) and delta < 0
            if is_pinbar_bull and v_rat >= volume_multiplier and rsi < 44:
                raw_signal = 1
            elif is_pinbar_bear and v_rat >= volume_multiplier and rsi > 56:
                raw_signal = -1

    elif eff_strategy == "diagnostics_lenient":
        if passes_wall and passes_lifetime and delta != 0:
            raw_signal = 1 if c >= ema else -1

    elif eff_strategy == "naked_test":
        raw_signal = 1 if c >= ema else -1

    elif eff_strategy in ("wall_breakout", "breakout"):
        # Пробой плотности (Wall Breakout): импульсный пробой локального экстремума/стенки на повышенном объёме и дельте
        if passes_wall and passes_lifetime:
            if c > high_max6_vals[i] and delta > 0 and v_rat >= max(1.1, volume_multiplier) and 48 <= rsi <= 74:
                raw_signal = 1
            elif c < low_min6_vals[i] and delta < 0 and v_rat >= max(1.1, volume_multiplier) and 26 <= rsi <= 52:
                raw_signal = -1
    return raw_signal
