import React from 'react';
import { readReport, configKey } from './model.js';
import { button } from './PilotConfig.jsx';

export const number = (value, suffix = '', digits = 2) => value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(digits)}${suffix}`;
export const time = value => { if (!value) return '—'; const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); };

export function Metrics({ metrics, trades }) {
  return <dl className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">{[
    ['Net PnL', number(metrics?.net_pnl_usd, ' $')], ['WinRate', trades === 0 ? '—' : number(metrics?.win_rate_pct, '%')],
    ['Profit Factor', trades === 0 ? '—' : number(metrics?.profit_factor)], ['Max Drawdown', number(metrics?.max_drawdown_pct, '%')],
  ].map(([label, value]) => <div key={label} className="min-w-0 rounded-md bg-neutral-950 p-2"><dt className="text-[11px] text-neutral-500">{label}</dt><dd className="mt-1 font-mono text-sm text-neutral-100">{value}</dd></div>)}</dl>;
}

export function Report({ result, title }) {
  const r = readReport(result);
  return <section className="space-y-2"><h3 className="text-xs font-semibold text-neutral-300">{title}</h3><Metrics metrics={r.metrics} trades={r.sample?.closed_trades} />
    <p className="text-xs text-neutral-400">Свечей: {r.sample?.candles ?? '—'} · Закрытых сделок: {r.sample?.closed_trades ?? '—'} · Комиссии: {number(r.metrics?.total_fees_usd, ' $')} · Slippage: {number(r.metrics?.total_slippage_usd, ' $')} (в цене исполнения)</p>
    {r.status === 'insufficient_evidence' && <p className="rounded border border-amber-800/60 bg-amber-950/20 p-2 text-xs text-amber-200">Недостаточно OOS-данных: требуется минимум 100 свечей и 20 закрытых сделок. Подтверждённая оценка отсутствует.</p>}
    {r.status === 'unavailable' && <p className="text-xs text-amber-200">Отчёт нового формата недоступен. Проверьте версию backend и повторите расчёт.</p>}
    {r.sample?.closed_trades === 0 && <p className="text-xs text-amber-200">За этот период стратегия не закрыла сделок.</p>}
  </section>;
}

export function Forecast({ forecast }) {
  if (!forecast) return <p className="text-xs text-neutral-500">Прогноз ещё не рассчитан.</p>;
  const signal = forecast.unified_signal || forecast.base_scenario || {};
  const diagnostic = forecast.decision_diagnostic || {};
  return <section className="space-y-1 rounded-md border border-neutral-800 p-2 text-xs"><h3 className="text-cyan-200">Текущий прогноз: {signal.direction || forecast.direction || 'NO_TRADE'}</h3><p>{signal.reason || diagnostic.reason || forecast.reason || 'Причина не передана сервером.'}</p><p className="text-neutral-500">Данные: {forecast.data_status || 'unknown'} · Обновление: {time(forecast.updated_at)}</p>{diagnostic.failed_checks?.length > 0 && <p className="text-amber-200">Не пройдены: {diagnostic.failed_checks.join(', ')}</p>}<p className="text-neutral-500">Условный сценарий по текущим данным; вход произойдёт только при выполнении условий.</p></section>;
}

export default function PilotResults({ configs, status, optimizations, compare, busy, optimize, applyOptimization }) {
  return <div className="space-y-4">{configs.map((c, index) => {
    const session = status?.sessions?.[c.symbol];
    const saved = optimizations[c.symbol];
    const result = saved?.result;
    const isCurrent = saved?.key === configKey([c]);
    return <article key={c.symbol} className="min-w-0 space-y-3 rounded-lg border border-neutral-800 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-mono text-sm text-cyan-200">{c.symbol} · {c.timeframe} · {c.strategy_type}</h2><button className={button} disabled={Boolean(busy)} onClick={() => optimize(index)}>Подобрать параметры</button></div>
      {session?.error && <p role="alert" className="text-xs text-red-300">{session.error}</p>}
      <Report result={session?.backtest} title="Исторический бэктест · описательная статистика" />
      <details className="text-xs"><summary className="cursor-pointer text-neutral-400">Исторические сделки · вход и выход ({session?.backtest?.trades?.length ?? 0})</summary><div className="mt-2 space-y-2">{(session?.backtest?.trades || []).slice(-30).reverse().map((trade, i) => <div key={trade.id || i} className="rounded bg-neutral-900 p-2"><p>{trade.direction || trade.type} · {time(trade.entry_time)} → {time(trade.exit_time)}</p><p>Вход {number(trade.entry_price, '', 4)} → Выход {number(trade.exit_price, '', 4)} · Net {number(trade.pnl_usd, ' $')}</p><p className="text-neutral-400">{Array.isArray(trade.entry_reason) ? trade.entry_reason.join(', ') : trade.entry_reason || 'Причина входа не передана'} → {trade.exit_reason || 'Причина выхода не передана'}</p></div>)}</div></details>
      <p className="text-xs text-neutral-500">История: {time(session?.backtest?.meta?.from_time)} — {time(session?.backtest?.meta?.to_time)} · {session?.backtest?.data_availability?.ohlcv?.source || 'Источник пока не получен'}. Исторический L2: {session?.backtest?.data_availability?.l2_history?.available ? 'доступен' : 'недоступен'}.</p>
      {!compare && <Forecast forecast={session?.forecast} />}
      {compare && result && <><Report result={result} title="Финальный holdout · вне подбора параметров" /><div className="grid gap-2 @2xl:grid-cols-2"><div><p className="mb-1 text-xs text-neutral-500">Development · исходные параметры</p><Metrics metrics={result.before_optimization} trades={result.before_optimization?.total_trades} /></div><div><p className="mb-1 text-xs text-neutral-500">Development · после подбора</p><Metrics metrics={result.after_optimization} trades={result.after_optimization?.total_trades} /></div></div>
        <p className="text-xs text-neutral-400">Walk-forward окон: {result.report?.validation?.walk_forward?.fold_count ?? '—'}. Параметры: SL {number(result.meta?.best_params?.stop_loss_pct, '%')} · TP {number(result.meta?.best_params?.take_profit_pct, '%')}.</p>
        <button className={button} disabled={Boolean(busy) || !isCurrent} onClick={() => applyOptimization(index)}>Перенести параметры в новый черновик</button><p className="text-xs text-neutral-500">Переносятся поддержанные SL/TP/плотность/фильтры. Требуется повторная проверка; параметры индикаторов вне контракта pilot не меняются.</p>{!isCurrent && <p className="text-xs text-amber-200">Этот подбор относится к другой версии настроек.</p>}
      </>}
      {compare && !result && <p className="text-xs text-neutral-500">Запустите подбор для сравнения development и holdout. AI-рекомендация сама по себе не является OOS-проверкой.</p>}
    </article>;
  })}</div>;
}
