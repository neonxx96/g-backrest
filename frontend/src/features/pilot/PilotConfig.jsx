import React, { useState } from 'react';
import { STRATEGIES, allocateCapital } from './model.js';

export const control = 'w-full min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-400 disabled:opacity-50';
export const button = 'rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed';

export function NumberField({ label, hint, value, onChange, min, max, step = 'any', testId }) {
  return <label className="min-w-0 text-xs text-foreground/80">{label}<input data-testid={testId} className={`${control} mt-1`} type="number" value={value ?? ''} min={min} max={max} step={step} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} /><span className="mt-1 block text-[11px] leading-snug text-muted-foreground">{hint}</span></label>;
}

export default function PilotConfig({ configs, setConfigs, updateConfig, allocate, busy }) {
  const total = configs.reduce((sum, c) => sum + Number(c.initial_capital || 0), 0);
  const [budget, setBudget] = useState('');
  const [symbol, setSymbol] = useState('');
  const addSymbol = () => {
    const next = symbol.trim().toUpperCase();
    if (!next || !configs.length || configs.some(c => c.symbol === next) || configs.length >= 5) return;
    const amounts = allocateCapital(total, configs.length + 1);
    setConfigs([...configs, { ...configs[0], symbol: next }].map((c, i) => ({ ...c, initial_capital: amounts[i] })));
    setSymbol('');
  };
  return <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-4">
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-end">
        <div className="min-w-0 flex-1"><div className="text-xs text-muted-foreground">Общий виртуальный капитал</div><div className="mt-1 text-xl font-mono text-foreground">${total.toFixed(2)}</div><p className="text-xs text-muted-foreground">Независимые кошельки монет; доли не используют маржу друг друга.</p></div>
        <label className="text-xs">Распределить сумму $<input aria-label="Общий депозит" className={`${control} mt-1`} type="number" min="0.01" value={budget} placeholder={String(total)} onChange={e => setBudget(e.target.value)} /></label>
        <button type="button" className={button} disabled={budget === ''} onClick={() => allocate(Number(budget))}>Поровну по монетам</button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{configs.map(c => <span key={c.symbol} className="rounded bg-muted px-2 py-1 text-xs font-mono">{c.symbol} · {total > 0 ? (Number(c.initial_capital || 0) / total * 100).toFixed(1) : '—'}%</span>)}</div>
    </div>
    <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
      {configs.map((c, index) => <section key={index} className="min-w-0 space-y-3 rounded-lg border border-border bg-card/30 p-3">
        <div className="flex items-center justify-between gap-2"><strong className="font-mono text-sm text-cyan-200">{c.symbol}</strong><button type="button" aria-label={`Удалить ${c.symbol}`} className="text-xs text-muted-foreground hover:text-red-300 disabled:opacity-30" disabled={configs.length === 1} onClick={() => setConfigs(configs.filter((_, i) => i !== index))}>Удалить</button></div>
        <label className="block text-xs">Стратегия<select aria-label={`${c.symbol} стратегия`} className={`${control} mt-1`} value={c.strategy_type} onChange={e => updateConfig(index, { strategy_type: e.target.value })}>{STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs">Таймфрейм<select aria-label={`${c.symbol} таймфрейм`} className={`${control} mt-1`} value={c.timeframe} onChange={e => updateConfig(index, { timeframe: e.target.value })}>{['1m', '5m', '15m', '1h'].map(tf => <option key={tf}>{tf}</option>)}</select><span className="mt-1 block text-[11px] text-muted-foreground">Период одной свечи сигнала.</span></label><NumberField label="История, дней" value={c.days} min={1} max={30} step={1} onChange={days => updateConfig(index, { days })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Доля депозита, $" hint="Капитал этой монеты." value={c.initial_capital} min={0.01} onChange={initial_capital => updateConfig(index, { initial_capital })} />
          <NumberField label="Риск на сделку, %" hint={`Бюджет до издержек: $${(Number(c.initial_capital || 0) * Number(c.risk_per_trade_pct || 0) / 100).toFixed(2)}`} value={c.risk_per_trade_pct} min={0.01} max={10} onChange={risk_per_trade_pct => updateConfig(index, { risk_per_trade_pct })} />
          <NumberField label="Stop Loss, %" hint="Расстояние от входа до защитного стопа." value={c.stop_loss_pct} min={0.01} max={50} onChange={stop_loss_pct => updateConfig(index, { stop_loss_pct })} />
          <NumberField label="Take Profit, %" hint="Цель до комиссий и частичных выходов." value={c.take_profit_pct} min={0.01} max={200} onChange={take_profit_pct => updateConfig(index, { take_profit_pct })} />
          <NumberField label="Длительность, часов" hint="После срока runner прекращает наблюдение." value={c.duration_hours} min={1} max={12} onChange={duration_hours => updateConfig(index, { duration_hours })} />
          <NumberField label="Плечо" hint="Влияет на требуемую маржу." value={c.leverage} min={1} max={125} onChange={leverage => updateConfig(index, { leverage })} />
        </div>
        <div className="rounded border border-border px-2 py-1.5 text-xs">Плановый R:R <b className="font-mono text-cyan-200">1 : {Number(c.stop_loss_pct) > 0 ? (Number(c.take_profit_pct) / Number(c.stop_loss_pct)).toFixed(2) : '—'}</b><span className="ml-2 text-muted-foreground">фактический зависит от исполнения и Multi-TP</span></div>
        <details><summary className="cursor-pointer text-xs text-muted-foreground">Фильтры и ведение позиции</summary><div className="mt-3 grid grid-cols-2 gap-3">
          <NumberField label="Объём ×" hint="Минимум к среднему объёму." value={c.volume_multiplier} min={0} max={20} onChange={volume_multiplier => updateConfig(index, { volume_multiplier })} />
          <NumberField label="Плотность, $" hint="L2-фильтр истории недоступен без записанного стакана." value={c.min_density_usd} min={0} onChange={min_density_usd => updateConfig(index, { min_density_usd })} />
          {[[ 'use_rsi_filter', 'RSI 42–58' ], ['use_cvd_filter', 'Направление CVD'], ['use_atr_filter', 'Фильтр ATR'], ['use_multi_tp', 'Частичные TP'], ['use_trailing', 'Трейлинг']].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(c[key])} onChange={e => updateConfig(index, { [key]: e.target.checked })} />{label}</label>)}
          <NumberField label="Трейлинг, %" value={c.trailing_pct} min={0.01} max={20} onChange={trailing_pct => updateConfig(index, { trailing_pct })} />
          <NumberField label="Активация трейлинга, %" hint="Движение в прибыль перед подтягиванием стопа." value={c.trailing_activation_pct ?? 0} min={0} max={20} onChange={trailing_activation_pct => updateConfig(index, { trailing_activation_pct })} />
          <NumberField label="TP1, R" value={c.tp1_rr_ratio} min={0.5} max={10} onChange={tp1_rr_ratio => updateConfig(index, { tp1_rr_ratio })} />
          <NumberField label="TP2, R" value={c.tp2_rr_ratio} min={1} max={15} onChange={tp2_rr_ratio => updateConfig(index, { tp2_rr_ratio })} />
        </div></details>
      </section>)}
    </div>
    <div className="flex flex-wrap gap-2"><input aria-label="Добавить монету" className={`${control} flex-1`} value={symbol} placeholder="Например, LINKUSDT" onChange={e => setSymbol(e.target.value)} /><button type="button" className={button} disabled={configs.length >= 5 || !/^[A-Z0-9]{2,20}USDT$/i.test(symbol.trim())} onClick={addSymbol}>Добавить монету</button></div>
  </fieldset>;
}
