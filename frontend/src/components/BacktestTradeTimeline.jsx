import React, { useMemo } from 'react';

const normalizeTimestamp = (value) => {
  const numeric = Number(value || 0);
  return numeric > 100000000000 ? numeric : numeric * 1000;
};

const formatClock = (value) => {
  if (!value) return '—';
  return new Date(normalizeTimestamp(value)).toLocaleString('ru-RU', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (entry, exit) => {
  const ms = Math.max(0, normalizeTimestamp(exit) - normalizeTimestamp(entry));
  if (!ms) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}ч${rest ? ` ${rest}м` : ''}`;
};

const formatPrice = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number >= 1000 ? number.toFixed(1) : number >= 1 ? number.toFixed(2) : number.toFixed(5);
};

function Event({ label, value, tone }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
      <div className="min-w-0">
        <div className="text-[8px] uppercase tracking-wide text-neutral-500">{label}</div>
        <div className="truncate font-mono text-[10px] text-neutral-100">{value}</div>
      </div>
    </div>
  );
}

export default function BacktestTradeTimeline({ trades = [], selectedId, onSelect }) {
  const selected = useMemo(
    () => trades.find((trade) => String(trade.id) === String(selectedId)) || trades[0] || null,
    [trades, selectedId],
  );

  if (!selected) {
    return (
      <div data-testid="backtest-trade-timeline" className="border-b border-neutral-800 bg-[#0b0f15] px-3 py-3 text-[10px] text-neutral-500">
        Нет завершённых сделок для отображения timeline.
      </div>
    );
  }

  const isWin = Number(selected.pnl_usd ?? 0) >= 0;
  const entryReasons = Array.isArray(selected.entry_reason) ? selected.entry_reason : [selected.entry_reason || selected.reason || 'Правило стратегии'];

  return (
    <div data-testid="backtest-trade-timeline" className="border-b border-neutral-800 bg-[#0b0f15] px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">СДЕЛКА #{selected.id}</span>
          <span className={`text-[10px] font-bold ${selected.type === 'BUY' ? 'text-emerald-300' : 'text-red-300'}`}>{selected.type === 'BUY' ? 'LONG' : 'SHORT'}</span>
          <span className="truncate text-[9px] text-neutral-500">{entryReasons.join(' · ')}</span>
        </div>
        <span className={`shrink-0 font-mono text-[11px] font-bold ${isWin ? 'text-emerald-300' : 'text-red-300'}`}>
          {isWin ? '+' : ''}${Number(selected.pnl_usd ?? 0).toFixed(2)} ({isWin ? '+' : ''}{Number(selected.pnl_pct ?? 0).toFixed(2)}%)
        </span>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto">
        <Event label="Сигнал / вход" value={`${formatClock(selected.entry_time)} · ${formatPrice(selected.entry_price)}`} tone="bg-sky-400" />
        <div className="h-px min-w-3 flex-1 bg-neutral-700" />
        <Event label="Выход" value={`${formatClock(selected.exit_time)} · ${formatPrice(selected.exit_price)}`} tone={isWin ? 'bg-emerald-400' : 'bg-red-400'} />
        <div className="h-px min-w-3 flex-1 bg-neutral-700" />
        <Event label="Длительность" value={formatDuration(selected.entry_time, selected.exit_time)} tone="bg-amber-400" />
        <div className="h-px min-w-3 flex-1 bg-neutral-700" />
        <Event label="Причина выхода" value={selected.exit_reason || 'Не указана'} tone="bg-violet-400" />
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-neutral-500">
        <span>Вход: <b className="text-white">{formatPrice(selected.entry_price)}</b></span>
        <span>Выход: <b className="text-white">{formatPrice(selected.exit_price)}</b></span>
        <span>Gross: <b className="text-neutral-300">${Number(selected.gross_pnl_usd ?? selected.pnl_usd ?? 0).toFixed(2)}</b></span>
        <span>Комиссии/слип: <b className="text-amber-300">-${(Number(selected.fee_paid_usd || 0) + Number(selected.slippage_cost_usd || 0)).toFixed(2)}</b></span>
        <span>TP1: <b className={selected.tp1_hit ? 'text-emerald-300' : 'text-neutral-400'}>{selected.tp1_hit ? 'достигнут' : 'не достигнут'}</b></span>
      </div>

      <div className="mt-2 flex gap-1 overflow-x-auto">
        {trades.slice(0, 24).map((trade) => (
          <button
            key={trade.id}
            type="button"
            onClick={() => onSelect?.(trade)}
            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[8px] ${String(trade.id) === String(selected.id) ? 'border-sky-400/70 bg-sky-400/15 text-sky-200' : 'border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-white'}`}
            title={`Сделка #${trade.id}: ${formatClock(trade.entry_time)} → ${formatClock(trade.exit_time)}`}
          >
            #{trade.id} {Number(trade.pnl_usd ?? 0) >= 0 ? '+' : ''}{Number(trade.pnl_usd ?? 0).toFixed(0)}$
          </button>
        ))}
      </div>
    </div>
  );
}
