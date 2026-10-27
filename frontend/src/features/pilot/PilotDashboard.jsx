import React from 'react';
import { Metrics, number, time } from './PilotResults.jsx';
import { describePilotEvent, paperStatusLabel, pilotFilterLabel } from './model.js';

function TradeList({ paper }) {
  const open = (paper.positions || paper.open_positions || []).filter(p => !p.closed && Number(p.qty ?? p.quantity ?? 0) > 0);
  return <><h3 className="text-xs font-semibold">Открытые позиции ({open.length})</h3>{open.map((p, i) => <div key={p.id || i} className="rounded border border-border p-2 text-xs"><div>{p.side} · {time(p.entry_ts)} · вход {number(p.avg_entry_price, '', 4)} → сейчас {number(p.last_price, '', 4)} · количество {number(p.qty, '', 6)}</div><div className="text-muted-foreground">SL {number(p.stop_price, '', 4)} · TP1 {number(p.target_price, '', 4)} · TP2 {number(p.tp2_price, '', 4)} · Floating {number(p.unrealized_pnl, ' $')} · Б/У: {p.breakeven_triggered ? 'включён' : 'нет'}</div><p>{p.reason || 'Причина входа — в журнале решений.'}</p></div>)}
    {!paper.is_running && open.length > 0 && <p className="text-xs text-amber-200">Наблюдение остановлено. Открытые виртуальные позиции остаются в снимке и не считаются закрытой прибылью.</p>}
    <details><summary className="cursor-pointer text-xs">Закрытые сделки ({paper.closed_trades_count ?? 0}; показаны последние {paper.closed_trades?.length ?? 0})</summary><div className="mt-2 space-y-2">{(paper.closed_trades || []).slice(-50).reverse().map((t, i) => <div key={t.trade_id || t.id || i} className="rounded border border-border p-2 text-xs"><div>{t.side || t.direction} · {time(t.entry_ts ?? t.entry_time)} → {time(t.exit_ts ?? t.exit_time)}</div><div>Вход {number(t.entry_price, '', 4)} → Выход {number(t.exit_price, '', 4)}</div><div>Gross {number(t.gross_pnl, ' $')} · Комиссии {number(t.total_fees ?? t.fee_drag, ' $')} · Net {number(t.net_pnl ?? t.pnl_usd, ' $')}</div><p className="text-muted-foreground">{t.entry_reason || 'Вход: см. журнал'} → {t.exit_reason || t.reason || 'Причина выхода не передана'}</p></div>)}</div></details></>;
}

export default function PilotDashboard({ status, events }) {
  const sessions = Object.values(status?.sessions || {});
  return <div className="space-y-4">{sessions.map(s => {
    const p = s.paper;
    const summary = status.summary?.find(row => row.symbol === s.symbol);
    return <article key={s.symbol} className="min-w-0 space-y-3 rounded-lg border border-border p-3"><h2 className="font-mono text-sm text-cyan-200">{s.symbol} · {paperStatusLabel(p)} <span className="text-[10px] text-muted-foreground">{s.strategy_type} · {s.config?.timeframe || p?.timeframe} · run {s.run_id?.slice(0, 8) || '—'}</span></h2>
      {s.error && <p className="text-xs text-red-300">{s.error}</p>}
      {p && <><div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4 text-xs">{[['Баланс', p.balance], ['Equity', p.current_equity], ['Маржа свободна', p.available_margin], ['Маржа занята', p.used_margin], ['Realized PnL', p.realized_pnl], ['Floating PnL', p.unrealized_pnl], ['Комиссии', p.total_fees]].map(([label, value]) => <div key={label}><span className="block text-muted-foreground">{label}</span><span className="font-mono">{number(value, ' $')}</span></div>)}</div>
        <Metrics metrics={{ net_pnl_usd: p.realized_pnl, win_rate_pct: summary?.paper_win_rate_pct, profit_factor: summary?.paper_profit_factor, max_drawdown_pct: p.max_drawdown_pct }} trades={p.closed_trades_count} />
        <div className="text-xs text-muted-foreground">{p.is_running ? <>Фид: <b className={p.data_status === 'connected' ? 'text-emerald-300' : 'text-amber-200'}>{p.data_status || 'unknown'}</b> · Индикаторы: {p.indicator_freshness || p.indicator_data_status || 'unknown'} · До остановки: {p.duration_remaining_seconds == null ? '—' : `${Math.ceil(p.duration_remaining_seconds / 60)} мин`} · </> : 'Архивный снимок; фид больше не отслеживается · '}Ошибки фида за сессию: {p.data_error_count ?? '—'} · Реконнекты: {p.reconnect_count ?? '—'}</div>
        <p className="break-words text-xs text-muted-foreground">Проверено свечей: {p.evaluations ?? '—'} · Отказы: {p.blocked_evaluations ?? '—'} · Фильтры: {Object.entries(p.rejection_counts || {}).map(([key, count]) => `${pilotFilterLabel(key)}: ${count}`).join(' · ') || 'нет'}</p>
        <div className="rounded border border-amber-900/40 bg-amber-950/10 p-2 text-xs"><p>Последнее решение: {p.last_decision_checks?.length ? 'вход отклонён' : p.last_decision_reason || 'ожидание первого решения'}</p>{p.last_decision_checks?.length > 0 && <ul className="mt-1 space-y-1 text-muted-foreground">{p.last_decision_checks.map((c, i) => <li key={i}>{typeof c === 'string' ? pilotFilterLabel(c) : `${pilotFilterLabel(c.filter || c.name || c.reason_code)}: ${JSON.stringify(c.actual ?? c.observed)} ${c.operator || ''} ${JSON.stringify(c.threshold ?? c.expected)}`}</li>)}</ul>}{p.is_running && p.last_data_error && <p className="mt-1 text-red-300">{p.last_data_error}</p>}</div>
        <TradeList paper={p} />
      </>}
    </article>;
  })}
    <section className="min-w-0 space-y-2 rounded-lg border border-border p-3"><h2 className="text-sm">Журнал решений текущего запуска</h2><p className="text-xs text-muted-foreground">Последние 100 событий. Источник каждого события указан отдельно.</p>{!events.length && <p className="text-xs text-muted-foreground">События выбранного запуска ещё не получены.</p>}{events.slice().reverse().map(e => { const description = describePilotEvent(e, status?.sessions?.[e.symbol]?.paper); return <details key={e.event_id} className="min-w-0 rounded bg-card p-2 text-xs"><summary className="cursor-pointer break-words"><span className="text-muted-foreground">{time(e.timestamp)} · {e.source}</span> <b>{e.symbol} · {description.title}</b> — {description.reason}</summary><pre className="mt-2 whitespace-pre-wrap break-all text-[11px] text-muted-foreground">{JSON.stringify({ checks: e.checks, observed: e.observed, payload: e.payload }, null, 2)}</pre></details>; })}</section>
  </div>;
}
