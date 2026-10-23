"""PDF- и HTML-отчёты бэктеста (задача 6.5 + 6.4 HTML).

PDF: рендерит многостраничный PDF из ответа /api/backtest/run (тот же JSON, что
хранится в backtestStore.result на фронте). Только matplotlib (PdfPages) — новых
зависимостей нет; DejaVu Sans покрывает кириллицу.

Страницы PDF:
  1. Сводка — заголовок, таблица метрик, кривая equity (net vs gross).
  2. Монте-Карло — веер P5–P95, медиана, фактическая кривая, вердикт робастности.
  3. Разбор сделок — тепловая карта Net PnL по дням недели × часам (UTC), топ-20 сделок.

HTML: render_backtest_report_html — самодостаточный документ (inline CSS/SVG, тёмная
тема терминала, без внешних зависимостей): те же секции, кривая equity как inline SVG,
тепловая карта как HTML-таблица с rgba-заливкой, Монте-Карло — вердикт + перцентили.

Все расчёты — только из переданного payload, без обращений к движку/бирже.
Degenerate-входы (пустые сделки/кривые) рендерят секцию с честным «Нет данных».
"""

from __future__ import annotations

import io
import math
from html import escape
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


# ---------------------------------------------------------------------------
# HTML-отчёт (задача 6.4): самодостаточный документ, тёмная тема терминала.
# Никаких внешних зависимостей — только stdlib (html.escape) и stringbuilding.
# ---------------------------------------------------------------------------

_HTML_CSS = """
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  background: #0B0E11; color: #e5e7eb;
  font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 13px; line-height: 1.45;
}
.report { max-width: 980px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; color: #f9fafb; }
h2 {
  font-size: 15px; margin: 28px 0 10px; padding-bottom: 6px;
  border-bottom: 1px solid #1f2937; color: #f3f4f6;
}
.sub { color: #9ca3af; font-size: 12px; margin: 0 0 2px; }
.net-pnl { font-size: 26px; font-weight: 700; margin: 10px 0 0; }
.pos { color: #16a34a; } .neg { color: #dc2626; } .neu { color: #9ca3af; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; }
th, td {
  padding: 6px 10px; text-align: left; font-size: 12px;
  border-bottom: 1px solid #1f2937;
}
th { color: #9ca3af; font-weight: 600; text-transform: uppercase; font-size: 10.5px; letter-spacing: .04em; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.metric td:first-child { color: #9ca3af; }
tr.metric td:last-child { font-weight: 600; color: #f3f4f6; }
.badge {
  display: inline-block; padding: 4px 10px; border-radius: 6px;
  font-weight: 700; font-size: 12px; margin: 4px 0;
}
.badge.robust { background: rgba(22,163,74,.15); color: #4ade80; border: 1px solid rgba(22,163,74,.4); }
.badge.over { background: rgba(217,119,6,.15); color: #fbbf24; border: 1px solid rgba(217,119,6,.4); }
.mc-meta { color: #9ca3af; font-size: 12px; margin: 4px 0; }
.reason { color: #6b7280; font-size: 11.5px; margin: 4px 0 10px; }
.heatmap th, .heatmap td { padding: 3px 4px; text-align: center; font-size: 10px; border-bottom: none; }
.heatmap td { min-width: 30px; border-radius: 2px; color: #e5e7eb; }
.heatmap td.axis { background: transparent; color: #6b7280; font-weight: 600; }
.legend { color: #6b7280; font-size: 11px; margin-top: 6px; }
.footer {
  margin-top: 32px; padding-top: 10px; border-top: 1px solid #1f2937;
  color: #4b5563; font-size: 10.5px;
}
.no-data { color: #60697b; padding: 18px; text-align: center; border: 1px dashed #374151; border-radius: 6px; }
svg.chart { width: 100%; height: auto; background: #0f1419; border: 1px solid #1f2937; border-radius: 6px; }
"""


def _svg_polyline(points: List[tuple], color: str, width: float, dash: Optional[str] = None) -> str:
    pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in points)
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    return (
        f'<polyline fill="none" stroke="{color}" stroke-width="{width}"'
        f'{dash_attr} stroke-linejoin="round" stroke-linecap="round" points="{pts}"/>'
    )


def _equity_svg(equity_curve: List[Dict[str, Any]], capital: float) -> str:
    """Кривая equity (net vs gross) как inline SVG. Возвращает пустую строку при <2 точек."""
    if len(equity_curve) < 2:
        return ""
    eq = [_safe_float(p.get("equity")) for p in equity_curve]
    gq = [_safe_float(p.get("gross_equity"), eq[i]) for i, p in enumerate(equity_curve)]
    all_v = [v for v in eq + gq if math.isfinite(v)]
    if not all_v:
        return ""
    lo, hi = min(all_v), max(all_v)
    if hi - lo < 1e-9:
        hi = lo + 1.0
    pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad

    w, h, ml, mr, mt, mb = 960, 300, 56, 12, 12, 26
    n = len(equity_curve)

    def xy(i: int, v: float) -> tuple:
        x = ml + (w - ml - mr) * (i / max(1, n - 1))
        y = mt + (h - mt - mb) * (1.0 - (v - lo) / (hi - lo))
        return x, y

    net_pts = [xy(i, v) for i, v in enumerate(eq) if math.isfinite(v)]
    gross_pts = [xy(i, v) for i, v in enumerate(gq) if math.isfinite(v)]
    if len(net_pts) < 2:
        return ""

    zero_pts = None
    if lo <= capital <= hi:
        zy = mt + (h - mt - mb) * (1.0 - (capital - lo) / (hi - lo))
        zero_pts = f'<line x1="{ml}" y1="{zy:.1f}" x2="{w - mr}" y2="{zy:.1f}" stroke="#6b7280" stroke-width="1" stroke-dasharray="3,4"/>'

    has_gross = len(gross_pts) >= 2 and any(abs(g - e) > 1e-9 for g, e in zip(gq, eq))
    parts = [f'<svg class="chart" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" role="img">']
    if zero_pts:
        parts.append(zero_pts)
    if has_gross:
        parts.append(_svg_polyline(gross_pts, "#d97706", 1.2, "5,4"))
    parts.append(_svg_polyline(net_pts, "#16a34a", 2.0))
    # Подписи min/max по оси Y
    for v, anchor in ((hi, mt), (lo, h - mb)):
        y = mt + (h - mt - mb) * (1.0 - (v - lo) / (hi - lo))
        parts.append(
            f'<text x="{ml - 6}" y="{y + 3:.1f}" text-anchor="end" fill="#6b7280" font-size="10">{v:,.0f}</text>'
        )
    parts.append(
        '<text x="' + str(ml + 8) + '" y="' + str(mt + 14) +
        '" fill="#16a34a" font-size="11" font-weight="600">Чистый equity (Net)</text>'
    )
    if has_gross:
        parts.append(
            '<text x="' + str(ml + 8) + '" y="' + str(mt + 30) +
            '" fill="#d97706" font-size="11">До комиссий (Gross)</text>'
        )
    parts.append("</svg>")
    return "".join(parts)


def _heatmap_html(trades: List[Dict[str, Any]]) -> str:
    """Тепловая карта Net PnL (день недели × час UTC) как HTML-таблица с rgba-заливкой."""
    grid = [[0.0] * 24 for _ in range(7)]
    counts = [[0] * 24 for _ in range(7)]
    for t in trades:
        dt = _ms_to_dt(t.get("entry_time"))
        if dt is None:
            continue
        grid[dt.weekday()][dt.hour] += _safe_float(t.get("pnl_usd"))
        counts[dt.weekday()][dt.hour] += 1
    vmax = max(1e-9, max(abs(grid[wd][h]) for wd in range(7) for h in range(24)))

    flat = [(grid[wd][h], wd, h) for wd in range(7) for h in range(24) if counts[wd][h] > 0]
    best = max(flat) if flat else None
    worst = min(flat) if flat else None

    parts = ['<table class="heatmap"><thead><tr><th></th>']
    parts += [f"<th>{h:02d}</th>" for h in range(24)]
    parts.append("</tr></thead><tbody>")
    for wd in range(7):
        parts.append(f'<tr><td class="axis">{_WEEKDAYS[wd]}</td>')
        for h in range(24):
            if counts[wd][h] == 0:
                parts.append('<td style="background:#111827;color:#374151">·</td>')
                continue
            v = grid[wd][h]
            alpha = min(1.0, 0.18 + 0.82 * (abs(v) / vmax))
            if v >= 0:
                style = f"background:rgba(22,163,74,{alpha:.2f})"
            else:
                style = f"background:rgba(220,38,38,{alpha:.2f})"
            parts.append(f'<td style="{style}" title="{_WEEKDAYS[wd]} {h:02d}:00 UTC: {v:+.2f}$ ({counts[wd][h]})">{v:+.0f}</td>')
        parts.append("</tr>")
    parts.append("</tbody></table>")

    if best and worst:
        parts.append(
            '<div class="legend">Лучший слот: '
            f'<b class="pos">{_WEEKDAYS[best[1]]} {best[2]:02d}:00 UTC ({best[0]:+.2f}$)</b>'
            " &nbsp;•&nbsp; Худший слот: "
            f'<b class="neg">{_WEEKDAYS[worst[1]]} {worst[2]:02d}:00 UTC ({worst[0]:+.2f}$)</b>'
            " &nbsp;•&nbsp; интенсивность заливки — модуль Net PnL слота.</div>"
        )
    return "".join(parts)


def _trades_table_html(trades: List[Dict[str, Any]]) -> str:
    """Топ-20 сделок (первые по времени входа) — HTML-таблица."""
    recent = sorted(trades, key=lambda t: _safe_float(t.get("entry_time")))[:20]
    if not recent:
        return '<div class="no-data">Нет закрытых сделок за период</div>'
    parts = [
        "<table><thead><tr>",
        "<th>#</th><th>Вход (UTC)</th><th>Тип</th>",
        '<th class="num">Цена вх.</th><th class="num">Цена вых.</th>',
        '<th class="num">Чистый PnL</th><th>Выход</th>',
        "</tr></thead><tbody>",
    ]
    for t in recent:
        reason = t.get("exit_reason") or t.get("reason") or "—"
        if isinstance(reason, list):
            reason = reason[0] if reason else "—"
        pnl = _safe_float(t.get("pnl_usd"))
        cls = "pos" if pnl >= 0 else "neg"
        parts.append(
            "<tr>"
            f"<td>{escape(str(t.get('id') or '—'))}</td>"
            f"<td>{escape(_fmt_ms(t.get('entry_time'))[:16])}</td>"
            f"<td>{escape(str(t.get('type') or t.get('direction') or '—'))}</td>"
            f'<td class="num">{_safe_float(t.get("entry_price")):,.2f}</td>'
            f'<td class="num">{_safe_float(t.get("exit_price")):,.2f}</td>'
            f'<td class="num {cls}">{pnl:+,.2f}$</td>'
            f"<td>{escape(str(reason)[:28])}</td>"
            "</tr>"
        )
    parts.append("</tbody></table>")
    if len(trades) > len(recent):
        parts.append(f'<div class="legend">Показано {len(recent)} из {len(trades)} сделок (первые по времени входа).</div>')
    return "".join(parts)


def _mc_percentiles_html(mc: Dict[str, Any]) -> str:
    """Компактная таблица перцентилей из fan_chart (до 11 равномерных точек)."""
    fan = mc.get("fan_chart") or []
    if len(fan) < 2:
        return ""
    if len(fan) > 11:
        step = max(1, (len(fan) - 1) // 10)
        idxs = list(range(0, len(fan), step))
        if idxs[-1] != len(fan) - 1:
            idxs.append(len(fan) - 1)
    else:
        idxs = list(range(len(fan)))
    cols = ["p5", "p25", "p50", "p75", "p95", "actual", "gross"]
    labels = {"p5": "P5", "p25": "P25", "p50": "P50", "p75": "P75", "p95": "P95",
              "actual": "Факт (Net)", "gross": "Факт (Gross)"}
    parts = [
        "<table><thead><tr><th>Шаг</th>",
        "".join(f'<th class="num">{labels[c]}</th>' for c in cols),
        "</tr></thead><tbody>",
    ]
    for i in idxs:
        p = fan[i]
        parts.append(f"<tr><td>{i}</td>")
        for c in cols:
            v = _safe_float(p.get(c))
            parts.append(f'<td class="num">{v:,.0f}</td>')
        parts.append("</tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def render_backtest_report_html(payload: Dict[str, Any]) -> str:
    """Рендерит самодостаточный HTML-отчёт из payload ответа /api/backtest/run."""
    summary = payload.get("summary") or {}
    meta = payload.get("meta") or {}
    mc = payload.get("monte_carlo") or {}
    trades: List[Dict[str, Any]] = list(payload.get("trades") or [])

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
    net_cls = "pos" if net > 0 else ("neg" if net < 0 else "neu")

    e = escape
    parts: List[str] = []
    parts.append("<!DOCTYPE html><html lang=\"ru\"><head><meta charset=\"utf-8\">")
    parts.append(
        f"<title>SignalScript — Отчёт бэктеста {e(symbol)}</title>"
        f"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<style>{_HTML_CSS}</style></head><body><div class=\"report\">"
    )

    # Шапка
    parts.append("<h1>SignalScript — Отчёт бэктеста</h1>")
    parts.append(
        f'<p class="sub">{e(symbol)} &nbsp;•&nbsp; {e(strategy)} &nbsp;•&nbsp; '
        f"{e(timeframe)} &nbsp;•&nbsp; начальный капитал {capital:,.0f}$</p>"
    )
    parts.append(f'<p class="sub">Сформирован: {datetime.now(timezone.utc):%d.%m.%Y %H:%M UTC}</p>')
    parts.append(f'<div class="net-pnl {net_cls}">{_money(net)} <span style="font-size:15px">{_pct(roi)}</span></div>')

    # Сводка
    parts.append("<h2>Сводка</h2><table>")
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
    for label, value in rows:
        parts.append(f'<tr class="metric"><td>{e(label)}</td><td>{e(value)}</td></tr>')
    parts.append("</table>")

    parts.append("<h2>Кривая Equity</h2>")
    equity_svg = _equity_svg(payload.get("equity_curve") or [], capital)
    parts.append(equity_svg or '<div class="no-data">Нет данных equity_curve</div>')

    # Монте-Карло
    parts.append("<h2>Стресс-тест Монте-Карло</h2>")
    if not mc:
        parts.append('<div class="no-data">Монте-Карло: нет данных</div>')
    elif len(mc.get("fan_chart") or []) < 2:
        parts.append('<div class="no-data">Монте-Карло: недостаточно сделок для веера траекторий</div>')
        verdict = str(mc.get("verdict") or "—")
        badge = str(mc.get("badge_text") or verdict)
        cls = "robust" if verdict.upper() == "ROBUST" else "over"
        parts.append(f'<div><span class="badge {cls}">{e(badge)}</span></div>')
    else:
        verdict = str(mc.get("verdict") or "—")
        score = _safe_float(mc.get("robustness_score"))
        prob_dd = _safe_float(mc.get("prob_drawdown_gt_10_pct"))
        worst_dd = _safe_float(mc.get("worst_case_dd_pct"))
        sims = int(_safe_float(mc.get("simulations_count")))
        badge = str(mc.get("badge_text") or verdict)
        cls = "robust" if verdict.upper() == "ROBUST" else "over"
        parts.append(f'<div><span class="badge {cls}">{e(badge)}</span></div>')
        parts.append(
            '<p class="mc-meta">'
            f"Score: {score:.0f}/100 &nbsp;•&nbsp; Вероятность просадки &gt;10%: {prob_dd:.1f}%"
            f" &nbsp;•&nbsp; Худший DD (95%): -{worst_dd:.1f}% &nbsp;•&nbsp; Симуляций: {sims}"
            "</p>"
        )
        reason = str(mc.get("reason") or "")
        if reason:
            parts.append(f'<p class="reason">{e(reason[:180])}</p>')
        parts.append(_mc_percentiles_html(mc))

    # Разбор сделок
    parts.append("<h2>Разбор сделок</h2>")
    if trades:
        parts.append("<h2 style=\"border:none;margin:0 0 6px;font-size:12px;color:#9ca3af\">Тепловая карта Net PnL: день недели × час (UTC)</h2>")
        parts.append(_heatmap_html(trades))
    else:
        parts.append('<div class="no-data">Нет сделок</div>')
    parts.append(_trades_table_html(trades))

    parts.append(
        '<div class="footer">Строго консультативно. Симуляция на реальных исторических данных; '
        "не является финансовой рекомендацией. SignalScript Terminal.</div>"
    )
    parts.append("</div></body></html>")
    return "".join(parts)
