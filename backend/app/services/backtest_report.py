"""PDF-отчёт бэктеста (задача 6.5).

Рендерит многостраничный PDF из ответа /api/backtest/run (тот же JSON, что хранится
в backtestStore.result на фронте). Только matplotlib (PdfPages) — новых
зависимостей нет; DejaVu Sans покрывает кириллицу.

Страницы:
  1. Сводка — заголовок, таблица метрик, кривая equity (net vs gross).
  2. Монте-Карло — веер P5–P95, медиана, фактическая кривая, вердикт робастности.
  3. Разбор сделок — тепловая карта Net PnL по дням недели × часам (UTC), топ-20 сделок.

Все расчёты — только из переданного payload, без обращений к движку/бирже.
Degenerate-входы (пустые сделки/кривые) рендерят страницу с честным «Нет данных».
"""

from __future__ import annotations

import io
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.backends.backend_pdf import PdfPages

plt.rcParams["font.family"] = "DejaVu Sans"
plt.rcParams["axes.unicode_minus"] = False

_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]


def _ms_to_dt(ms: Any) -> Optional[datetime]:
    try:
        v = float(ms)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v <= 0:
        return None
    return datetime.fromtimestamp(v / 1000.0, tz=timezone.utc)


def _fmt_ms(ms: Any) -> str:
    dt = _ms_to_dt(ms)
    return dt.strftime("%d.%m.%Y %H:%M UTC") if dt else "—"


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _money(v: float) -> str:
    return f"{v:+,.2f}$"


def _pct(v: float) -> str:
    return f"{v:+.2f}%"


def _no_data_page(pdf: PdfPages, title: str) -> None:
    fig = plt.figure(figsize=(8.27, 11.69))
    fig.text(0.5, 0.5, f"{title}: нет данных", ha="center", va="center", fontsize=14, color="#60697b")
    pdf.savefig(fig)
    plt.close(fig)


def _page_summary(pdf: PdfPages, payload: Dict[str, Any]) -> None:
    summary = payload.get("summary") or {}
    meta = payload.get("meta") or {}
    symbol = str(payload.get("symbol") or meta.get("symbol") or "UNKNOWN")
    strategy = str(payload.get("strategy_type") or meta.get("strategy_type") or "—")
    timeframe = str(payload.get("timeframe") or meta.get("timeframe") or "—")

    net = _safe_float(summary.get("net_pnl_usd"))
    gross = _safe_float(summary.get("gross_pnl_usd"))
    fees = _safe_float(summary.get("total_fees_usd"))
    slip = _safe_float(summary.get("total_slippage_usd"))
    cost = _safe_float(summary.get("total_exchange_cost_usd"), fees + slip)
    roi = _safe_float(summary.get("total_pnl_pct"))
    win = _safe_float(summary.get("win_rate_pct"))
    pf = _safe_float(summary.get("profit_factor"))
    rec = _safe_float(summary.get("recovery_factor"))
    dd = _safe_float(summary.get("max_drawdown_pct"))
    sharpe = _safe_float(summary.get("sharpe_ratio"))
    sortino = _safe_float(summary.get("sortino_ratio"))
    total = int(_safe_float(summary.get("total_trades")))
    wins = int(_safe_float(summary.get("winning_trades")))
    losses = int(_safe_float(summary.get("losing_trades")))

    capital = _safe_float(payload.get("initial_capital"), 10000.0)
    cost_pct_capital = (cost / max(1e-9, capital)) * 100.0

    rows = [
        ("Net PnL", f"{_money(net)}  ({_pct(roi)})"),
        ("Gross PnL (до комиссий)", _money(gross)),
        ("Комиссии + проскальзывание", f"{_money(-cost)}  ({cost_pct_capital:.2f}% от капитала)"),
        ("Win Rate", f"{win:.1f}%"),
        ("Profit Factor", f"{pf:.2f}"),
        ("Recovery Factor", f"{rec:.2f}"),
        ("Max Drawdown", f"-{dd:.2f}%"),
        ("Sharpe / Sortino", f"{sharpe:.2f} / {sortino:.2f}"),
        ("Сделок", f"{total} (прибыльных {wins} / убыточных {losses})"),
        ("Свечей", str(meta.get("candles") or "—")),
        ("Период", f"{_fmt_ms(meta.get('from_time'))} — {_fmt_ms(meta.get('to_time'))}"),
        ("Просмотрено дней (запрос)", str(meta.get("requested_days") or "—")),
    ]

    equity_curve = payload.get("equity_curve") or []

    fig = plt.figure(figsize=(8.27, 11.69))
    fig.patch.set_facecolor("white")

    fig.text(0.06, 0.965, "SignalScript — Отчёт бэктеста", fontsize=18, fontweight="bold", color="#111827")
    fig.text(
        0.06, 0.935,
        f"{symbol}  •  {strategy}  •  {timeframe}  •  начальный капитал {capital:,.0f}$",
        fontsize=11, color="#374151",
    )
    fig.text(0.06, 0.915, f"Сформирован: {datetime.now(timezone.utc):%d.%m.%Y %H:%M UTC}", fontsize=9, color="#6b7280")

    color = "#16a34a" if net >= 0 else "#dc2626"
    fig.text(0.94, 0.955, _money(net), fontsize=22, fontweight="bold", color=color, ha="right")
    fig.text(0.94, 0.928, _pct(roi), fontsize=13, color=color, ha="right")

    # Таблица метрик (две колонки пар label/value на всю ширину)
    ax_tbl = fig.add_axes([0.06, 0.62, 0.88, 0.26])
    ax_tbl.axis("off")
    tbl = ax_tbl.table(
        cellText=rows,
        colLabels=None,
        colWidths=[0.42, 0.58],
        loc="upper center",
        cellLoc="left",
    )
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(10)
    tbl.scale(1.0, 1.55)
    for (r, c), cell in tbl.get_celld().items():
        cell.set_edgecolor("#e5e7eb")
        cell.set_linewidth(0.5)
        if c == 0:
            cell.set_text_props(color="#4b5563")
        else:
            cell.set_text_props(fontweight="bold", color="#111827")

    # Кривая equity (net vs gross)
    ax_eq = fig.add_axes([0.08, 0.10, 0.86, 0.42])
    if len(equity_curve) >= 2:
        t = np.array([_safe_float(p.get("time")) for p in equity_curve], dtype=float)
        eq = np.array([_safe_float(p.get("equity")) for p in equity_curve], dtype=float)
        gq = np.array([_safe_float(p.get("gross_equity"), eq[i]) for i, p in enumerate(equity_curve)])
        t0 = t[0]
        hours = (t - t0) / 3_600_000.0
        ax_eq.plot(hours, eq, color="#16a34a", lw=1.6, label="Чистый equity")
        if np.any(np.abs(gq - eq) > 1e-9):
            ax_eq.plot(hours, gq, color="#d97706", lw=1.0, ls="--", label="До комиссий (Gross)")
        ax_eq.axhline(capital, color="#6b7280", lw=0.8, ls=":")
        ax_eq.set_title("Кривая Equity", fontsize=12, loc="left")
        ax_eq.set_xlabel("Часы от начала периода")
        ax_eq.set_ylabel("Equity, $")
        ax_eq.grid(alpha=0.25)
        ax_eq.legend(loc="best", fontsize=9)
        ax_eq.tick_params(labelsize=9)
    else:
        ax_eq.text(0.5, 0.5, "Нет данных equity_curve", ha="center", va="center", color="#60697b")
        ax_eq.set_xticks([])
        ax_eq.set_yticks([])

    fig.text(0.06, 0.03, "Строго консультативно. Симуляция на реальных исторических данных; не является финансовой рекомендацией.", fontsize=8, color="#9ca3af")

    pdf.savefig(fig)
    plt.close(fig)


def _page_monte_carlo(pdf: PdfPages, payload: Dict[str, Any]) -> None:
    mc = payload.get("monte_carlo")
    if not mc:
        _no_data_page(pdf, "Монте-Карло")
        return

    fan = mc.get("fan_chart") or []
    if len(fan) < 2:
        _no_data_page(pdf, "Монте-Карло (недостаточно сделок)")
        return

    samples = mc.get("sample_paths") or []
    # Субдискретизация траекторий: на графике не более 60 линий
    if len(samples) > 60:
        step = max(1, len(samples) // 60)
        samples = samples[::step][:60]

    idx = np.arange(len(fan))

    def col(key: str, default: float = np.nan) -> np.ndarray:
        return np.array([_safe_float(p.get(key), default) for p in fan], dtype=float)

    p5, p25, p50, p75, p95 = col("p5"), col("p25"), col("p50"), col("p75"), col("p95")
    actual = col("actual")
    gross = np.array([_safe_float(p.get("gross"), actual[i]) for i, p in enumerate(fan)])

    fig = plt.figure(figsize=(8.27, 11.69))
    fig.patch.set_facecolor("white")
    fig.text(0.06, 0.965, "Стресс-тест Монте-Карло", fontsize=16, fontweight="bold", color="#111827")

    verdict = str(mc.get("verdict") or "—")
    score = _safe_float(mc.get("robustness_score"))
    prob_dd = _safe_float(mc.get("prob_drawdown_gt_10_pct"))
    worst_dd = _safe_float(mc.get("worst_case_dd_pct"))
    sims = int(_safe_float(mc.get("simulations_count")))
    badge = str(mc.get("badge_text") or "")
    reason = str(mc.get("reason") or "")

    ax_txt = fig.add_axes([0.06, 0.83, 0.88, 0.10])
    ax_txt.axis("off")
    verdict_color = "#16a34a" if verdict.upper() == "ROBUST" else "#d97706"
    ax_txt.text(0.0, 0.85, badge or verdict, fontsize=13, fontweight="bold", color=verdict_color, transform=ax_txt.transAxes)
    ax_txt.text(
        0.0, 0.35,
        f"Score: {score:.0f}/100  •  Вероятность просадки >10%: {prob_dd:.1f}%  •  "
        f"Худший DD (95%): -{worst_dd:.1f}%  •  Симуляций: {sims}",
        fontsize=10, color="#374151", transform=ax_txt.transAxes,
    )
    if reason:
        ax_txt.text(0.0, 0.02, reason[:180], fontsize=9, color="#6b7280", transform=ax_txt.transAxes, wrap=True)

    ax = fig.add_axes([0.09, 0.14, 0.87, 0.62])
    ax.fill_between(idx, p5, p95, color="#38bdf8", alpha=0.12, label="P5–P95")
    ax.fill_between(idx, p25, p75, color="#38bdf8", alpha=0.25, label="P25–P75")
    for path in samples:
        arr = np.array([_safe_float(v, np.nan) for v in path], dtype=float)
        if arr.size == idx.size:
            ax.plot(idx, arr, color="#94a3b8", alpha=0.15, lw=0.7)
    ax.plot(idx, p50, color="#38bdf8", lw=1.2, ls="--", label="P50 (медиана)")
    if np.any(np.isfinite(gross)) and np.any(np.abs(gross - actual) > 1e-9):
        ax.plot(idx, gross, color="#d97706", lw=1.1, ls="--", label="Факт (Gross)")
    ax.plot(idx, actual, color="#16a34a", lw=2.0, label="Факт (Net)")
    ax.set_title("Веер траекторий (500 прогонов)", fontsize=12, loc="left")
    ax.set_xlabel("Шаг симуляции")
    ax.set_ylabel("Equity, $")
    ax.grid(alpha=0.25)
    ax.legend(loc="best", fontsize=9)
    ax.tick_params(labelsize=9)

    pdf.savefig(fig)
    plt.close(fig)


def _page_trades(pdf: PdfPages, payload: Dict[str, Any]) -> None:
    trades: List[Dict[str, Any]] = list(payload.get("trades") or [])
    fig = plt.figure(figsize=(8.27, 11.69))
    fig.patch.set_facecolor("white")
    fig.text(0.06, 0.965, "Разбор сделок", fontsize=16, fontweight="bold", color="#111827")

    ax_hm = fig.add_axes([0.10, 0.56, 0.82, 0.32])

    if trades:
        grid = np.zeros((7, 24), dtype=float)
        counts = np.zeros((7, 24), dtype=int)
        for t in trades:
            dt = _ms_to_dt(t.get("entry_time"))
            if dt is None:
                continue
            wd = (dt.weekday())  # Пн=0 … Вс=6
            grid[wd, dt.hour] += _safe_float(t.get("pnl_usd"))
            counts[wd, dt.hour] += 1

        vmax = max(1e-9, float(np.abs(grid).max()))
        im = ax_hm.imshow(grid, cmap="RdYlGn", vmin=-vmax, vmax=vmax, aspect="auto")
        ax_hm.set_xticks(range(0, 24, 2))
        ax_hm.set_xticklabels([f"{h:02d}" for h in range(0, 24, 2)], fontsize=8)
        ax_hm.set_yticks(range(7))
        ax_hm.set_yticklabels(_WEEKDAYS, fontsize=9)
        ax_hm.set_xlabel("Час (UTC)", fontsize=10)
        ax_hm.set_title("Тепловая карта Net PnL: день недели × час", fontsize=12, loc="left")
        fig.colorbar(im, ax=ax_hm, fraction=0.04, pad=0.02, label="Net PnL, $")

        flat = [(grid[wd, h], wd, h) for wd in range(7) for h in range(24) if counts[wd, h] > 0]
        if flat:
            best = max(flat)
            worst = min(flat)
            fig.text(
                0.10, 0.515,
                f"Лучший слот: {_WEEKDAYS[best[1]]} {best[2]:02d}:00 UTC ({best[0]:+.2f}$)   •   "
                f"Худший слот: {_WEEKDAYS[worst[1]]} {worst[2]:02d}:00 UTC ({worst[0]:+.2f}$)",
                fontsize=9, color="#374151",
            )
    else:
        ax_hm.text(0.5, 0.5, "Нет сделок", ha="center", va="center", color="#60697b")
        ax_hm.set_xticks([])
        ax_hm.set_yticks([])

    # Таблица сделок (топ-20 по времени входа)
    ax_tbl = fig.add_axes([0.04, 0.05, 0.92, 0.40])
    ax_tbl.axis("off")
    recent = sorted(trades, key=lambda t: _safe_float(t.get("entry_time")))[:20]
    if recent:
        header = ["#", "Вход (UTC)", "Тип", "Цена вх.", "Цена вых.", "Чистый PnL", "Выход"]
        body = []
        for t in recent:
            reason = t.get("exit_reason") or t.get("reason") or "—"
            if isinstance(reason, list):
                reason = reason[0] if reason else "—"
            body.append([
                str(t.get("id") or "—"),
                (_fmt_ms(t.get("entry_time")) or "")[:16],
                str(t.get("type") or t.get("direction") or "—"),
                f"{_safe_float(t.get('entry_price')):,.2f}",
                f"{_safe_float(t.get('exit_price')):,.2f}",
                f"{_safe_float(t.get('pnl_usd')):+,.2f}$",
                str(reason)[:28],
            ])
        tbl = ax_tbl.table(cellText=body, colLabels=header, loc="upper center", cellLoc="left")
        tbl.auto_set_font_size(False)
        tbl.set_fontsize(8)
        tbl.scale(1.0, 1.3)
        for (r, c), cell in tbl.get_celld().items():
            cell.set_edgecolor("#e5e7eb")
            cell.set_linewidth(0.4)
            if r == 0:
                cell.set_text_props(fontweight="bold", color="#374151")
        if len(trades) > len(recent):
            ax_tbl.text(
                0.0, -0.02,
                f"Показано {len(recent)} из {len(trades)} сделок (первые по времени входа).",
                fontsize=8, color="#6b7280", transform=ax_tbl.transAxes,
            )
    else:
        ax_tbl.text(0.5, 0.8, "Нет закрытых сделок за период", ha="center", fontsize=11, color="#60697b")

    pdf.savefig(fig)
    plt.close(fig)


def render_backtest_report_pdf(payload: Dict[str, Any]) -> bytes:
    """Рендерит PDF-отчёт из payload ответа /api/backtest/run. Возвращает bytes."""
    buf = io.BytesIO()
    with PdfPages(buf) as pdf:
        _page_summary(pdf, payload)
        _page_monte_carlo(pdf, payload)
        _page_trades(pdf, payload)
    return buf.getvalue()
