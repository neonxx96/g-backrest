import SymbolLink from './ui/SymbolLink.jsx';
import React, { useEffect, useState } from 'react';
import { Button } from './ui/button.jsx';
import { Badge } from './ui/badge.jsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog.jsx';

const API = '/api/overnight-pilot';

const STRATEGY_OPTIONS = [
  { value: 'confluence_ema', label: 'Confluence EMA · CVD/RSI/ATR' },
  { value: 'cvd_absorption', label: 'CVD Absorption' },
  { value: 'cluster_volume_bounce', label: 'Cluster Volume Bounce' },
  { value: 'ema_pullback', label: 'EMA Pullback · отскок к EMA20 в тренде' },
  { value: 'ema_trend', label: 'EMA Trend · пересечение 20/50' },
  { value: 'ema_trend_window', label: 'EMA Trend Window · подтверждение кросса 8 баров' },
];

function formatPct(value, digits = 3) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

function formatRemaining(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const total = Math.max(0, Math.round(Number(seconds)));
  return `${Math.floor(total / 3600)}ч ${Math.floor((total % 3600) / 60)}м`;
}

function paperFloatingPnl(paper) {
  if (!paper) return null;
  if (paper.unrealized_pnl_usd != null) return Number(paper.unrealized_pnl_usd);
  if (paper.unrealized_pnl != null) return Number(paper.unrealized_pnl);
  if (paper.equity != null && paper.starting_balance != null && paper.net_pnl_usd != null) {
    return Number(paper.equity) - Number(paper.starting_balance) - Number(paper.net_pnl_usd);
  }
  return null;
}

function rowPaperFloatingPnl(row) {
  if (!row) return null;
  if (row.paper_unrealized_pnl != null) return Number(row.paper_unrealized_pnl);
  if (row.paper_equity != null && row.paper_starting_balance != null && row.paper_pnl != null) {
    return Number(row.paper_equity) - Number(row.paper_starting_balance) - Number(row.paper_pnl);
  }
  return null;
}

const VERDICT_STYLES = {
  PASS: 'border-emerald-700 bg-bull-soft/60 text-emerald-300',
  WARNING: 'border-amber-700 bg-amber-950/60 text-amber-300',
  BLOCK: 'border-red-700 bg-bear-soft/60 text-red-300'
};

function VerdictBadge({ verdict }) {
  if (!verdict || !verdict.level) return null;
  const style = VERDICT_STYLES[verdict.level] || VERDICT_STYLES.WARNING;
  const title = [...(verdict.reasons || []), ...(verdict.flags || [])].join('\n');
  return (
    <span
      title={title || verdict.level}
      className={`inline-block rounded border px-1 py-px font-mono text-[8px] font-bold ${style}`}
    >
      {verdict.level}
    </span>
  );
}

function Metric({ label, value }) {
  return <div className="rounded border border-border bg-background/70 p-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="font-mono text-[11px] text-foreground">{value ?? '—'}</div></div>;
}

function BacktestQuality({ backtest }) {
  const summary = backtest?.summary || {};
  const trades = Number(summary.total_trades || 0);
  const avg = Number(summary.total_trades) > 0
    ? Number(summary.net_pnl_usd || 0) / Number(summary.total_trades)
    : 0;
  const availability = backtest?.meta?.data_availability || backtest?.data_availability || {};
  const source = availability.ohlcv_source || availability?.ohlcv?.source || 'Источник не указан';
  const warning = trades < 30
    ? 'Недостаточно сделок для устойчивой статистики (нужно минимум 30).'
    : backtest?.monte_carlo?.reason;
  return (
    <div className="space-y-1 rounded border border-border bg-background/50 px-2 py-1.5 text-[8px] text-muted-foreground">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>Сделки <b className="text-foreground">{trades}</b></span>
        <span>Средняя <b className="text-foreground">${avg.toFixed(2)}</b></span>
        <span>Источник <b className="text-cyan-300">{source}</b></span>
      </div>
      {warning && <div className="text-amber-200">⚠ {warning}</div>}
    </div>
  );
}

function AppliedProfile({ session }) {
  if (!session) return null;
  const config = session.config || {};
  const backtestMeta = session.backtest?.meta || {};
  const availability = backtestMeta.data_availability || session.backtest?.data_availability || {};
  const forecast = session.forecast || {};
  const application = forecast.profile_application || {};
  const requiresLiveClusterEvidence = Boolean(
    application.filters?.stacked_imbalance
    || application.filters?.absorption
    || application.filters?.poc_migration,
  );
  const sameProfile = forecast.strategy_type === config.strategy_type
    && application.strategy_type === config.strategy_type
    && application.signal_engine === 'shared_ohlcv_evaluator'
    && !requiresLiveClusterEvidence;
  const filters = Object.entries(application.filters || {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name.replaceAll('_', ' '));
  const fingerprint = session.config_fingerprint ? session.config_fingerprint.slice(0, 12) : '—';

  return (
    <div className="space-y-1 rounded border border-border bg-background/50 px-2 py-1.5 text-[8px] text-muted-foreground" data-testid="overnight-applied-profile">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="font-bold uppercase tracking-wide text-foreground">Applied profile</span>
        <span className="font-mono" title={session.config_fingerprint || ''}>#{fingerprint}</span>
      </div>
      <div>
        {config.strategy_type || '—'} · {config.timeframe || '—'} · {config.days ?? '—'}d · risk {config.risk_per_trade_pct ?? '—'}% · SL/TP {config.stop_loss_pct ?? '—'}% / {config.take_profit_pct ?? '—'}% · x{config.leverage ?? '—'}
      </div>
      <div>
        Backtest: {availability.closed_candles_only ? 'closed candles' : 'candle-close contract unavailable'} · {availability.ohlcv_source || 'OHLCV source unavailable'} · OI {availability.open_interest?.available ? 'available' : 'not in history'}
      </div>
      <div className={sameProfile ? 'text-bull' : 'text-warning'}>
        Scenario: {sameProfile ? 'same strategy + OHLCV evaluator' : requiresLiveClusterEvidence ? 'same config; live cluster evidence is evaluated separately' : 'profile parity unavailable'}{filters.length ? ` · filters: ${filters.join(', ')}` : ''}
      </div>
    </div>
  );
}

function RecentBacktestTrades({ backtest }) {
  const trades = (backtest?.trades || []).slice(-5).reverse();
  const formatTime = (value) => {
    if (value == null || value === '') return '—';
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };
  const duration = (entry, exit) => {
    const parse = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : new Date(value).getTime();
    };
    const ms = parse(exit) - parse(entry);
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const minutes = Math.round(ms / 60000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}ч ${minutes % 60}м` : `${minutes}м`;
  };
  if (!trades.length) return <div className="rounded border border-border bg-background/50 px-2 py-1.5 text-[8px] text-muted-foreground">Сделок за выбранный период нет.</div>;
  return (
    <div className="rounded border border-border bg-background/50 px-2 py-1.5 text-[8px]" data-testid="overnight-backtest-trades">
      <div className="mb-1 font-bold uppercase tracking-wide text-muted-foreground">Последние сделки · вход → выход</div>
      <div className="space-y-1">
        {trades.map((trade, index) => {
          const pnl = Number(trade.pnl_usd || 0);
          return <div key={`${trade.id || index}-${trade.entry_time}`} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-muted-foreground">
            <span className={trade.direction === 'LONG' ? 'text-emerald-300' : 'text-red-300'}>{trade.direction || trade.type || '—'}</span>
            <span className="truncate" title={`${trade.entry_reason || '—'} → ${trade.exit_reason || '—'}`}>{formatTime(trade.entry_time)} → {formatTime(trade.exit_time)} · {duration(trade.entry_time, trade.exit_time)} · {trade.exit_reason || 'Выход'}</span>
            <span className="text-foreground">{Number(trade.entry_price || 0).toFixed(4)} → {Number(trade.exit_price || 0).toFixed(4)}</span>
            <span className={pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
          </div>;
        })}
      </div>
    </div>
  );
}

function PaperTradeTimeline({ paper }) {
  const trades = (paper?.closed_trades || []).slice(-5).reverse();
  const positions = (paper?.open_positions || paper?.positions || []).filter((position) => !position.closed && Number(position.qty || 0) > 0);
  const asDate = (value) => {
    if (value == null || value === '') return null;
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 1e12 ? numeric * 1000 : numeric)
      : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const time = (value) => asDate(value)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '—';
  const duration = (entry, exit) => {
    const start = asDate(entry)?.getTime();
    const end = asDate(exit)?.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
    const minutes = Math.round((end - start) / 60000);
    return minutes >= 60 ? `${Math.floor(minutes / 60)}ч ${minutes % 60}м` : `${minutes}м`;
  };
  return (
    <div className="space-y-1 rounded border border-emerald-900/50 bg-bull-soft/10 px-2 py-1.5 text-[8px]" data-testid="overnight-paper-trades">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold uppercase tracking-wide text-emerald-300">Paper journal · виртуальные исполнения</div>
        <div className="text-muted-foreground">open {positions.length} · closed {trades.length}</div>
      </div>
      {trades.length === 0 && positions.length === 0 ? (
        <div className="text-muted-foreground">Сделок пока нет. Forecast не открывает позицию автоматически без подтверждённого сигнала.</div>
      ) : (
        <div className="space-y-1">
          {trades.map((trade, index) => {
            const entry = trade.entry_ts ?? trade.entry_time;
            const exit = trade.exit_ts ?? trade.exit_time;
            const pnl = Number(trade.net_pnl ?? trade.pnl_usd ?? 0);
            const reason = `${trade.entry_reason || 'Вход'} → ${trade.reason || trade.exit_reason || 'Выход'}`;
            return <div key={`${trade.symbol || index}-${entry}-${exit}`} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-muted-foreground">
              <span className={trade.side === 'LONG' ? 'text-emerald-300' : 'text-red-300'}>{trade.side || '—'}</span>
              <span className="truncate" title={reason}>{time(entry)} → {time(exit)} · {duration(entry, exit)} · {reason}</span>
              <span className="text-foreground">{Number(trade.entry_price || 0).toFixed(4)} → {Number(trade.exit_price || 0).toFixed(4)}</span>
              <span className={pnl >= 0 ? 'text-emerald-300' : 'text-red-300'}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
            </div>;
          })}
          {positions.map((position) => {
            const unrealized = Number(position.unrealized_pnl || 0);
            const price = (value) => Number(value) > 0 ? Number(value).toFixed(4) : '—';
            const levels = [
              `SL ${price(position.stop_price)}`,
              `TP1 ${price(position.target_price)}`,
              position.tp2_price > 0 ? `TP2 ${price(position.tp2_price)}` : null,
              position.breakeven_triggered ? 'BE активирован' : 'BE не активирован',
            ].filter(Boolean).join(' · ');
            return <div key={`open-${position.symbol}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 text-amber-200">
              <span>{position.side || '—'}</span>
              <span className="truncate" title={`${position.reason || 'Открытая виртуальная позиция'} · ${levels}`}>
                OPEN · entry {price(position.avg_entry_price)} → current {price(position.last_price)} · {duration(position.entry_ts, Date.now())} · {levels} · qty {Number(position.qty || 0).toFixed(4)}
              </span>
              <span className={unrealized >= 0 ? 'text-emerald-300' : 'text-red-300'}>{unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)} unrealized</span>
            </div>;
          })}
        </div>
      )}
    </div>
  );
}

function ForecastCard({ forecast }) {
  const base = forecast?.base_scenario || {};
  const signal = forecast?.unified_signal || {};
  const idea = forecast?.trading_idea || {};
  const direction = base.direction || signal.direction || 'NO_TRADE';
  const rawReason = signal.reason || base.reason || idea.reasoning || [];
  const reason = (Array.isArray(rawReason) ? rawReason : [rawReason]).filter(Boolean).slice(0, 2);
  const diagnostic = forecast?.decision_diagnostic || {};
  const fmt = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(4) : '—';
  const hasTradeSignal = Boolean(forecast?.unified_signal) && (direction === 'LONG' || direction === 'SHORT');
  const level = (value) => hasTradeSignal ? fmt(value) : '—';
  return (
    <div className="space-y-1 rounded border border-cyan-900/50 bg-cyan-950/10 p-2" data-testid="overnight-forecast-card">
      <div className="flex items-center justify-between text-[9px]">
        <span className="font-bold uppercase tracking-wide text-cyan-300">Live forecast</span>
        <span className={`font-mono font-bold ${direction === 'LONG' ? 'text-emerald-300' : direction === 'SHORT' ? 'text-red-300' : 'text-muted-foreground'}`}>{direction}</span>
      </div>
      <div className="grid grid-cols-5 gap-1 text-[8px] text-muted-foreground">
        <span>Entry <b className="block text-foreground">{level(signal.entry_price || idea.entry_price)}</b></span>
        <span>SL <b className="block text-red-300">{level(signal.sl || idea.sl_price)}</b></span>
        <span>TP1 <b className="block text-emerald-300">{level(signal.tp1 || idea.tp1_price)}</b></span>
        <span>TP2 <b className="block text-emerald-300">{level(signal.tp2 || idea.tp2_price)}</b></span>
        <span>BE <b className="block text-amber-200">{level(idea.breakeven_price)}</b></span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-[8px] text-muted-foreground">
        <span>Regime <b className="text-violet-300">{base.market_regime || forecast?.market_regime || '—'}</b></span>
        <span>Confidence <b className="text-foreground">{signal.confidence != null ? `${(Number(signal.confidence) * 100).toFixed(0)}%` : '—'}</b></span>
        <span>R:R <b className="text-foreground">{hasTradeSignal ? (signal.expected_rr || idea.risk_reward_ratio || '—') : '—'}</b></span>
        <span>Data <b className="text-cyan-300">{forecast?.data_status || 'unknown'}</b></span>
        <span>Updated <b className="text-foreground">{forecast?.updated_at ? new Date(forecast.updated_at).toLocaleTimeString() : '—'}</b></span>
      </div>
      {!hasTradeSignal && <div className="rounded bg-background/60 px-1.5 py-1 text-[8px] text-amber-200">Ожидание подтверждения: уровни входа и выхода не являются ордером.</div>}
      {reason.length > 0 && <div className="truncate text-[8px] text-muted-foreground" title={reason.join(' · ')}>{reason.join(' · ')}</div>}
      {!hasTradeSignal && diagnostic.failed_checks?.length > 0 && <div className="truncate text-[8px] text-amber-300" title={diagnostic.failed_checks.join(' · ')}>Не прошли фильтры: {diagnostic.failed_checks.join(' · ')}</div>}
    </div>
  );
}

function OptimizationResult({ result, onApply, disabled }) {
  if (result?.status === 'error' || result?.status === 'unavailable') {
    return <div className="rounded border border-red-900/50 bg-bear-soft/10 px-2 py-1.5 text-[8px] text-red-300" data-testid="overnight-optimization-error">Оптимизатор не завершился: {result.error || 'причина не указана'}. Backtest и forecast остаются доступны.</div>;
  }
  const recommendation = result?.recommendation || {};
  const best = recommendation?.meta?.best_params || recommendation?.after_optimization || {};
  const before = recommendation?.before_optimization || {};
  const oos = recommendation?.meta?.oos || recommendation?.oos;
  const oosTrades = Number(oos?.metrics?.total_trades || 0);
  if (!Object.keys(best).length) return null;
  return (
    <div className="space-y-1 rounded border border-violet-900/50 bg-violet-950/10 px-2 py-1.5 text-[8px]" data-testid="overnight-optimization-result">
      <div className="font-bold uppercase tracking-wide text-violet-300">Генетический оптимизатор · pre-run</div>
      <div className="grid grid-cols-3 gap-1 text-muted-foreground">
        <span>SL <b className="text-foreground">{Number(best.stop_loss_pct ?? 0).toFixed(2)}%</b></span>
        <span>TP <b className="text-foreground">{Number(best.take_profit_pct ?? 0).toFixed(2)}%</b></span>
        <span>Wall <b className="text-foreground">${Number(best.min_density_usd ?? 0).toLocaleString()}</b></span>
      </div>
      <div className="text-muted-foreground">Before: {formatPct(before.total_pnl_pct, 2)} · PF {Number(before.profit_factor || 0).toFixed(2)} · {before.total_trades || 0} trades → <span className="text-emerald-300">After: {formatPct(best.total_pnl_pct, 2)} · PF {Number(best.profit_factor || 0).toFixed(2)} · {best.total_trades || 0} trades</span></div>
      {oos?.available && oos.metrics ? (
        <div className="rounded bg-cyan-950/20 px-1.5 py-1 text-cyan-200">OOS: {formatPct(oos.metrics.total_pnl_pct, 2)} · PF {Number(oos.metrics.profit_factor || 0).toFixed(2)} · {oosTrades} trades · {oos.oos_candles} candles {oosTrades < 30 && <span className="text-amber-200">⚠ мало сделок для уверенной OOS-оценки</span>}</div>
      ) : oos?.warning ? (
        <div className="rounded bg-amber-950/20 px-1.5 py-1 text-amber-200">OOS: {oos.warning}</div>
      ) : null}
      <button disabled={disabled} onClick={() => onApply(best)} className="rounded border border-emerald-400/40 bg-bull-soft/20 px-2 py-1 text-[8px] font-bold text-emerald-200 disabled:opacity-50">Применить лучший набор к следующему запуску</button>
      <div className="text-muted-foreground">Результат консультативный: параметры не применяются автоматически и реальные ордера не создаются.</div>
    </div>
  );
}

function ClientAggregate({ summary }) {
  const rows = Array.isArray(summary) ? summary : [];
  if (!rows.length) return null;
  const btNet = rows.reduce((total, row) => total + Number(row.backtest_net_pnl || 0), 0);
  const btTrades = rows.reduce((total, row) => total + Number(row.backtest_trades || 0), 0);
  const weightedWin = btTrades > 0
    ? rows.reduce((total, row) => total + Number(row.backtest_win_rate_pct || 0) * Number(row.backtest_trades || 0), 0) / btTrades
    : 0;
  const forecast = rows.reduce((counts, row) => {
    const direction = row.forecast_direction || 'NO_TRADE';
    counts[direction] = (counts[direction] || 0) + 1;
    return counts;
  }, { LONG: 0, SHORT: 0, NO_TRADE: 0 });
  const sumIfPresent = (key) => rows.some((row) => row[key] != null)
    ? rows.reduce((total, row) => total + Number(row[key] || 0), 0)
    : null;
  const paperStarting = sumIfPresent('paper_starting_balance');
  const paperEquity = sumIfPresent('paper_equity');
  const paperPnl = sumIfPresent('paper_pnl');
  const paperNoEntry = sumIfPresent('paper_no_trade_count');
  const errors = sumIfPresent('paper_errors');
  return (
    <div className="mx-3 mb-3 rounded border border-amber-900/50 bg-amber-950/10 p-2" data-testid="overnight-client-aggregate">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-bold text-amber-200">Промежуточная сводка · Backtest / Forecast / Paper</div>
        <div className="text-[8px] text-amber-300">Client-derived · источник строк не смешан</div>
      </div>
      <div className="grid gap-2 text-[11px] text-muted-foreground md:grid-cols-3">
        <div className="rounded border border-border bg-background/60 p-2"><div className="font-bold text-amber-200">Historical Backtest</div><div>Net PnL <b className="text-foreground">${btNet.toFixed(2)}</b> · Trades {btTrades}</div><div>Weighted Win {weightedWin.toFixed(1)}%</div></div>
        <div className="rounded border border-border bg-background/60 p-2"><div className="font-bold text-cyan-200">Live Forecast</div><div>LONG {forecast.LONG} · SHORT {forecast.SHORT} · NO_TRADE {forecast.NO_TRADE}</div><div>Data errors {errors == null ? '—' : errors}</div></div>
        <div className="rounded border border-border bg-background/60 p-2"><div className="font-bold text-emerald-200">Paper Trading</div><div>Balance {paperStarting == null ? '—' : `$${paperStarting.toFixed(2)}`} → {paperEquity == null ? '—' : `$${paperEquity.toFixed(2)}`}</div><div>Net PnL {paperPnl == null ? '—' : `$${paperPnl.toFixed(2)}`} · No-entry {paperNoEntry == null ? '—' : paperNoEntry}</div></div>
      </div>
    </div>
  );
}

export default function OvernightPilotPanel({ onClose }) {
  const [configs, setConfigs] = useState([]);
  const [status, setStatus] = useState({ sessions: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [optimization, setOptimization] = useState({});
  const [preflightConfigKey, setPreflightConfigKey] = useState('');
  const [pairStates, setPairStates] = useState({});
  const pilotRunning = Object.values(status.sessions || {}).some((session) => session.paper?.is_running);
  const preflightCurrent = Boolean(status.preflight_id && preflightConfigKey === JSON.stringify(configs));

  const fetchPairs = async () => {
    try {
      const res = await fetch(`${API}/pairs`);
      if (res.ok) {
        const data = await res.json();
        const map = {};
        (data.pairs || []).forEach((p) => {
          map[p.symbol] = p.status;
        });
        setPairStates(map);
      }
    } catch (_) {}
  };

  const refresh = async () => {
    const res = await fetch(`${API}/status`);
    if (res.ok) setStatus(await res.json());
    await fetchPairs();
  };

  const pausePair = async (symbol) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/pairs/${encodeURIComponent(symbol)}/pause`, { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Не удалось приостановить ${symbol}`);
      }
      await fetchPairs();
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const resumePair = async (symbol) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/pairs/${encodeURIComponent(symbol)}/resume`, { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Не удалось возобновить ${symbol}`);
      }
      await fetchPairs();
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const closePair = async (symbol) => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/pairs/${encodeURIComponent(symbol)}/close`, { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Не удалось закрыть позицию по ${symbol}`);
      }
      await fetchPairs();
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const pauseAllPairs = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/pairs/pause-all`, { method: 'POST' });
      if (!res.ok) throw new Error('Не удалось приостановить все пары');
      await fetchPairs();
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const resumeAllPairs = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/pairs/resume-all`, { method: 'POST' });
      if (!res.ok) throw new Error('Не удалось возобновить все пары');
      await fetchPairs();
      await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    fetchPairs();
    Promise.all([
      fetch(`${API}/defaults`).then((res) => res.json()),
      fetch(`${API}/status`).then((res) => res.ok ? res.json() : null),
    ]).then(([defaultsPayload, restoredStatus]) => {
      const defaults = defaultsPayload.sessions || [];
      let saved = null;
      try { saved = JSON.parse(window.localStorage.getItem('signalscript_overnight_pilot_config') || 'null'); } catch { saved = null; }
      const restoredConfigs = restoredStatus
        ? Object.values(restoredStatus.sessions || {}).map((session) => session.config).filter(Boolean)
        : [];
      const hasRunningSessions = Object.values(restoredStatus?.sessions || {}).some((session) => session.paper?.is_running);
      const hasCurrentPreflight = Boolean(restoredStatus?.preflight_id);
      const selectedConfigs = hasRunningSessions && restoredConfigs.length
          ? restoredConfigs
          : hasCurrentPreflight && restoredConfigs.length
            ? restoredConfigs
          : Array.isArray(saved) && saved.length
            ? saved
            : restoredConfigs.length
              ? restoredConfigs
              : defaults;
      setConfigs(selectedConfigs);
      if (restoredStatus) {
        setStatus(restoredStatus);
        if (restoredStatus.preflight_id && !hasRunningSessions) setPreflightConfigKey(JSON.stringify(selectedConfigs));
      }
    }).catch((err) => setError(err.message));
    const timer = window.setInterval(() => refresh().catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (configs.length) window.localStorage.setItem('signalscript_overnight_pilot_config', JSON.stringify(configs));
  }, [configs]);

  const update = (index, key, value) => setConfigs((prev) => prev.map((item, i) => i === index ? { ...item, [key]: value } : item));

  const loadDiversifiedPaper = async () => {
    if (pilotRunning) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/diversified-paper/defaults`);
      const payload = await res.json();
      if (!res.ok || !Array.isArray(payload.sessions)) throw new Error(payload.detail || 'Не удалось загрузить диверсифицированный план');
      setConfigs(payload.sessions);
      setOptimization({});
      setError('Загружен диверсифицированный план: BTC EMA, ETH CVD Absorption, SOL Cluster Bounce. Выполните preflight перед запуском.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const start = async () => {
    if (!preflightCurrent) {
      setError('Конфигурация изменилась или не проверена. Выполните backtest + forecast заново.');
      return;
    }
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/start?preflight_id=${encodeURIComponent(status.preflight_id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(configs) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось запустить пилот');
      setStatus(data);
      setPreflightConfigKey('');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const preflight = async () => {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API}/preflight`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(configs) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось подготовить расчёт');
      setStatus(data);
      setPreflightConfigKey(JSON.stringify(configs));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try { const res = await fetch(`${API}/stop`, { method: 'POST' }); setStatus(await res.json()); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const optimize = async (config) => {
    setBusy(true); setError('');
    try {
      const session = status.sessions?.[config.symbol] || {};
      const res = await fetch('/api/quant/think-optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'pre_run',
          symbol: config.symbol,
          timeframe: config.timeframe,
          days: config.days,
          strategy_type: config.strategy_type,
          current: config,
          trades: session.backtest?.trades || [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Не удалось запустить оптимизацию');
      setOptimization((prev) => ({ ...prev, [config.symbol]: data }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const applyOptimization = (config, best) => {
    const paper = status.sessions?.[config.symbol]?.paper;
    if (paper?.is_running) {
      setError(`${config.symbol}: сначала остановите активную paper-сессию; текущий запуск не изменяется.`);
      return;
    }
    const next = {};
    if (best.stop_loss_pct != null) next.stop_loss_pct = Number(best.stop_loss_pct);
    if (best.take_profit_pct != null) next.take_profit_pct = Number(best.take_profit_pct);
    if (best.min_density_usd != null) next.min_density_usd = Number(best.min_density_usd);
    if (best.volume_multiplier != null) next.volume_multiplier = Number(best.volume_multiplier);
    if (best.use_cvd_filter != null) next.use_cvd_filter = Boolean(best.use_cvd_filter);
    setConfigs((prev) => prev.map((item) => item.symbol === config.symbol ? { ...item, ...next } : item));
    setError(`${config.symbol}: параметры применены к конфигурации. Нажмите «Подготовить backtest + forecast», чтобы пересчитать результаты.`);
  };

  return (
    <div data-testid="overnight-pilot-panel" className="absolute inset-3 z-50 rounded-lg border border-amber-400/30 bg-[#090c10] text-foreground shadow-2xl overflow-auto">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div><div className="text-[12px] font-bold text-amber-300">Ночной пилот · 3 стратегии</div><div className="text-[11px] text-muted-foreground">Backtest → Forecast → Paper Trading · реальные ордера отключены</div></div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="flex items-center justify-between px-3 pt-2">
        <div className="text-[11px] font-semibold text-foreground">Управление парами</div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="xs" disabled={busy} onClick={pauseAllPairs}>
            Приостановить все
          </Button>
          <Button variant="outline" size="xs" disabled={busy} onClick={resumeAllPairs}>
            Возобновить все
          </Button>
        </div>
      </div>
      <div className="grid gap-2 p-3 xl:grid-cols-3">
        {configs.map((config, index) => (
          <div key={config.symbol} className="space-y-2 rounded border border-border bg-[#0d1117] p-2">
            <div className="flex items-center justify-between gap-2"><SymbolLink symbol={config.symbol} /><label title="Стратегия должна быть поддержана историческим backtest и live paper runner; смена применяется после нового preflight."><select aria-label={`${config.symbol} strategy`} value={config.strategy_type} onChange={(e) => update(index, 'strategy_type', e.target.value)} className="max-w-[190px] rounded bg-background px-1 py-0.5 text-[9px] text-amber-300">{STRATEGY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
            <div className="flex items-center justify-between gap-1.5 rounded bg-muted/40 px-2 py-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Статус:</span>
                {pairStates[config.symbol] === 'paused' ? (
                  <Badge variant="warning" className="text-[9px]">paused</Badge>
                ) : pairStates[config.symbol] === 'closed' ? (
                  <Badge variant="neutral" className="text-[9px]">closed</Badge>
                ) : (
                  <Badge variant="success" className="text-[9px]">active</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="xs"
                  disabled={busy}
                  onClick={() => pairStates[config.symbol] === 'paused' ? resumePair(config.symbol) : pausePair(config.symbol)}
                >
                  {pairStates[config.symbol] === 'paused' ? 'Возобновить' : 'Приостановить'}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="xs" disabled={busy}>
                      Закрыть
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Экстренное закрытие {config.symbol}</AlertDialogTitle>
                      <AlertDialogDescription>
                        Вы уверены, что хотите экстренно закрыть позицию по рынку для {config.symbol}?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => closePair(config.symbol)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Закрыть по рынку
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
            <label title="Размер одной свечи. Меньший timeframe даёт больше сигналов, но больше рыночного шума." className="block text-[11px] text-muted-foreground">Timeframe<select value={config.timeframe} onChange={(e) => update(index, 'timeframe', e.target.value)} className="ml-2 rounded bg-background px-1 py-0.5 text-foreground"><option>5m</option><option>15m</option><option>1h</option></select></label>
            <div className="grid grid-cols-3 gap-1">
              <label title="Сколько последних дней полной истории использовать в backtest. При выборе прибыльного участка статистика искажается." className="text-[11px] text-muted-foreground">History days<input type="number" min="1" max="30" step="1" value={config.days} onChange={(e) => update(index, 'days', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Отдельный виртуальный баланс этой стратегии. Реальные средства не используются." className="text-[11px] text-muted-foreground">Paper $<input type="number" min="100" step="100" value={config.initial_capital} onChange={(e) => update(index, 'initial_capital', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Автоматическая остановка paper-сессии. По умолчанию 24 часа; остановить можно вручную раньше." className="text-[11px] text-muted-foreground">Duration h<input type="number" min="0.1" max="168" step="1" value={config.duration_hours} onChange={(e) => update(index, 'duration_hours', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <label title="Доля виртуального капитала, которую можно потерять при срабатывании стопа." className="text-[11px] text-muted-foreground">Risk %<input type="number" min="0.01" max="10" step="0.25" value={config.risk_per_trade_pct} onChange={(e) => update(index, 'risk_per_trade_pct', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Расстояние защитного стопа от входа в процентах." className="text-[11px] text-muted-foreground">SL %<input type="number" min="0.01" max="50" step="0.05" value={config.stop_loss_pct} onChange={(e) => update(index, 'stop_loss_pct', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Расстояние цели Take Profit от входа в процентах." className="text-[11px] text-muted-foreground">TP %<input type="number" min="0.01" max="200" step="0.1" value={config.take_profit_pct} onChange={(e) => update(index, 'take_profit_pct', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <label title="Плечо виртуальной позиции. Увеличивает размер позиции, но не отменяет ограничение риска на сделку." className="text-[11px] text-muted-foreground">Leverage<input type="number" min="1" max="125" step="0.5" value={config.leverage} onChange={(e) => update(index, 'leverage', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Минимальный множитель объёма для фильтра сигнала." className="text-[11px] text-muted-foreground">Vol ×<input type="number" min="0.5" max="20" step="0.1" value={config.volume_multiplier} onChange={(e) => update(index, 'volume_multiplier', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Минимальный размер плотности стакана для кластерной стратегии. В историческом OHLCV-бэктесте L2-фильтр не применяется." className="text-[11px] text-muted-foreground">Density $<input type="number" min="0" step="50000" value={config.min_density_usd} onChange={(e) => update(index, 'min_density_usd', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <label title="После частичной фиксации TP1 остаток позиции переводится в безубыток, если включён Multi-TP." className="text-[11px] text-muted-foreground">TP1 R:R<input type="number" min="0.5" max="10" step="0.1" value={config.tp1_rr_ratio} onChange={(e) => update(index, 'tp1_rr_ratio', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Целевое соотношение риск/доходность для второй части позиции после TP1." className="text-[11px] text-muted-foreground">TP2 R:R<input type="number" min="1" max="15" step="0.1" value={config.tp2_rr_ratio} onChange={(e) => update(index, 'tp2_rr_ratio', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <label title="Трейлинг-стоп подтягивает защитный стоп за ценой только после достижения порога активации." className="flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[11px] text-muted-foreground">
                <input data-testid="overnight-trailing-enabled" type="checkbox" checked={Boolean(config.use_trailing)} onChange={(e) => update(index, 'use_trailing', e.target.checked)} />
                Трейлинг
              </label>
              <label title="На сколько процентов от лучшей цены подтягивается trailing stop после активации." className="text-[11px] text-muted-foreground">Trail %<input data-testid="overnight-trailing-pct" type="number" min="0.01" max="20" step="0.05" value={config.trailing_pct} onChange={(e) => update(index, 'trailing_pct', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
              <label title="Минимальное благоприятное движение цены в процентах до включения trailing stop. Не меняет уже запущенную сессию." className="text-[11px] text-muted-foreground">Activate %<input data-testid="overnight-trailing-activation-pct" type="number" min="0" max="20" step="0.05" value={config.trailing_activation_pct ?? 0} onChange={(e) => update(index, 'trailing_activation_pct', Number(e.target.value))} className="mt-1 w-full rounded bg-background px-1 py-1 text-[10px] text-foreground" /></label>
            </div>
            <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
              {['use_atr_filter', 'use_cvd_filter', 'use_oi_filter', 'use_rsi_filter', 'use_multi_tp'].map((key) => (
                <label key={key} title={{ use_atr_filter: 'Фильтровать сделки по волатильности ATR.', use_cvd_filter: 'Подтверждать направление кумулятивной дельтой CVD.', use_oi_filter: 'Подтверждать сигнал изменением открытого интереса OI.', use_rsi_filter: 'Использовать RSI как фильтр экстремумов.', use_multi_tp: 'Разрешить частичную фиксацию TP1 и перевод в breakeven.' }[key]} className="flex items-center gap-1 rounded border border-border px-1.5 py-1">
                  <input type="checkbox" checked={Boolean(config[key])} onChange={(e) => update(index, key, e.target.checked)} />
                  {key.replace('use_', '').replace('_filter', '').replace('_', ' ').toUpperCase()}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1"><Metric label="Backtest ROI" value={formatPct(status.sessions?.[config.symbol]?.backtest?.summary?.total_pnl_pct)} /><Metric label="Net PnL" value={status.sessions?.[config.symbol]?.backtest?.summary?.net_pnl_usd != null ? `$${Number(status.sessions[config.symbol].backtest.summary.net_pnl_usd).toFixed(2)}` : null} /><Metric label="PF / Win" value={status.sessions?.[config.symbol]?.backtest?.summary?.profit_factor != null ? `${status.sessions[config.symbol].backtest.summary.profit_factor} / ${formatPct(status.sessions[config.symbol].backtest.summary.win_rate_pct, 1)}` : null} /></div>
            <div className="grid grid-cols-3 gap-1"><Metric label="Win rate" value={status.sessions?.[config.symbol]?.backtest?.summary?.win_rate_pct != null ? `${status.sessions[config.symbol].backtest.summary.win_rate_pct}%` : null} /><Metric label="Max DD" value={status.sessions?.[config.symbol]?.backtest?.summary?.max_drawdown_pct != null ? `${status.sessions[config.symbol].backtest.summary.max_drawdown_pct}%` : null} /><Metric label="Paper equity" value={status.sessions?.[config.symbol]?.paper?.current_equity != null ? `$${Number(status.sessions[config.symbol].paper.current_equity).toFixed(2)}` : 'IDLE'} /></div>
            <AppliedProfile session={status.sessions?.[config.symbol]} />
            <BacktestQuality backtest={status.sessions?.[config.symbol]?.backtest} />
            <button data-testid={`btn-think-optimize-${config.symbol}`} disabled={busy} onClick={() => optimize(config)} className="w-full rounded border border-violet-400/40 bg-violet-950/20 px-2 py-1 text-[9px] font-bold text-violet-200 disabled:opacity-50">{busy ? 'AI Think: расчёт…' : 'AI Think: подобрать параметры по этой стратегии'}</button>
            <OptimizationResult result={optimization[config.symbol] || status.sessions?.[config.symbol]?.backtest?.optimization} disabled={busy || status.sessions?.[config.symbol]?.paper?.is_running} onApply={(best) => applyOptimization(config, best)} />
            <RecentBacktestTrades backtest={status.sessions?.[config.symbol]?.backtest} />
            <PaperTradeTimeline paper={status.sessions?.[config.symbol]?.paper} />
            <ForecastCard forecast={status.sessions?.[config.symbol]?.forecast} />
            <div className="text-[11px] text-muted-foreground">Data: {status.sessions?.[config.symbol]?.paper?.data_status || status.sessions?.[config.symbol]?.forecast?.data_status || '—'} · Paper: {status.sessions?.[config.symbol]?.paper?.is_running ? 'running' : 'stopped'} · Remaining: <span className="text-amber-200">{formatRemaining(status.sessions?.[config.symbol]?.paper?.duration_remaining_seconds)}</span> · Session: <span className="font-mono text-muted-foreground">{status.sessions?.[config.symbol]?.session_id || 'not-created'}</span></div>
            {status.sessions?.[config.symbol]?.paper?.last_decision_reason && <div className="truncate rounded bg-background/60 px-1.5 py-1 text-[8px] text-amber-200" title={status.sessions[config.symbol].paper.last_decision_reason}>Decision: {status.sessions[config.symbol].paper.last_decision_reason}</div>}
            <div className="text-[8px] text-muted-foreground">Margin available ${status.sessions?.[config.symbol]?.paper?.available_margin == null ? '—' : Number(status.sessions[config.symbol].paper.available_margin).toFixed(2)} · used ${status.sessions?.[config.symbol]?.paper?.used_margin == null ? '—' : Number(status.sessions[config.symbol].paper.used_margin).toFixed(2)} · funding {(Number(status.sessions?.[config.symbol]?.paper?.funding_rate || 0) * 100).toFixed(4)}%</div>
            {status.sessions?.[config.symbol]?.error && <div className="text-[9px] text-red-300">{status.sessions[config.symbol].error}</div>}
          </div>
        ))}
      </div>
      {status.summary?.length > 0 && <div className="mx-3 mb-3 rounded border border-border bg-background/70 p-2"><div className="mb-1 text-[10px] font-bold text-amber-200">Сводка сравнения · Backtest / Forecast / Paper</div><div className="grid gap-1 text-[11px] text-muted-foreground md:grid-cols-3">{status.summary.map((row) => { const floating = rowPaperFloatingPnl(row); return <div key={row.symbol} className="rounded bg-card px-2 py-1"><div><SymbolLink symbol={row.symbol} /> <VerdictBadge verdict={row.verdict} /> · BT ROI {formatPct(row.backtest_roi_pct)} · PF {row.backtest_profit_factor} · DD {formatPct(row.backtest_max_drawdown_pct)}</div><div>BT Avg ${Number(row.backtest_average_trade_usd || 0).toFixed(2)} · Best ${Number(row.backtest_best_trade_usd || 0).toFixed(2)} · Worst ${Number(row.backtest_worst_trade_usd || 0).toFixed(2)}</div><div>Forecast {row.forecast_direction || 'NO_TRADE'} · Paper ${row.paper_starting_balance == null ? '—' : Number(row.paper_starting_balance).toFixed(2)} → ${row.paper_equity == null ? '—' : Number(row.paper_equity).toFixed(2)} · Realized {row.paper_pnl == null ? '—' : `$${Number(row.paper_pnl).toFixed(2)}`} · Floating {floating == null ? '—' : `$${floating.toFixed(2)}`}</div><div>Paper ROI {formatPct(row.paper_roi_pct, 3)} · Win {formatPct(row.paper_win_rate_pct, 1)} · PF {row.paper_profit_factor == null ? '—' : Number(row.paper_profit_factor).toFixed(2)} · Risk {row.paper_average_risk_pct == null ? '—' : `${Number(row.paper_average_risk_pct).toFixed(2)}%`}</div><div>Paper Avg ${Number(row.paper_average_trade_usd || 0).toFixed(2)} · Best ${Number(row.paper_best_trade_usd || 0).toFixed(2)} · Worst ${Number(row.paper_worst_trade_usd || 0).toFixed(2)}</div><div>Forecast NO_TRADE {row.forecast_no_trade_count || 0} · Paper no-entry {row.paper_no_trade_count || 0} · errors {row.paper_errors || 0} · data {row.paper_data_status || row.forecast_data_status || 'unknown'} · {row.forecast_backtest_divergence ? <span className="text-amber-300">forecast ≠ last BT</span> : 'forecast aligns'}{row.paper_losing_trade_reasons?.length ? ` · losses: ${row.paper_losing_trade_reasons.map((item) => item.exit_reason).join(', ')}` : ''}</div>{row.paper_last_decision_reason && <div className="truncate text-amber-200" title={row.paper_last_decision_reason}>Last paper decision: {row.paper_last_decision_reason}</div>}</div>; })}</div></div>}
      {!status.aggregate && status.summary?.length > 0 && <ClientAggregate summary={status.summary} />}
      {status.aggregate && <div className="mx-3 mb-3 rounded border border-cyan-900/50 bg-cyan-950/10 p-2" data-testid="overnight-aggregate-report">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="text-[10px] font-bold text-cyan-200">Итоговый отчёт · метрики не смешиваются</div><div className="text-[8px] text-muted-foreground">Лучший BT: <span className="text-foreground">{status.aggregate.best_backtest_symbol || '—'}</span> · Лучший Paper: <span className="text-foreground">{status.aggregate.best_paper_symbol || '—'}</span></div></div>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded border border-border bg-background/60 p-2 text-[11px] text-muted-foreground"><div className="mb-1 font-bold text-amber-200">Historical Backtest</div><div>Net PnL <b className="text-foreground">${Number(status.aggregate.backtest.net_pnl_usd || 0).toFixed(2)}</b> · ROI <b className="text-foreground">{Number(status.aggregate.backtest.roi_pct || 0).toFixed(2)}%</b></div><div>Trades {status.aggregate.backtest.trades} · Win {Number(status.aggregate.backtest.win_rate_pct || 0).toFixed(1)}% · PF {status.aggregate.backtest.profit_factor ?? '—'}</div><div>Max DD {Number(status.aggregate.backtest.max_drawdown_pct || 0).toFixed(2)}%</div></div>
          <div className="rounded border border-border bg-background/60 p-2 text-[11px] text-muted-foreground"><div className="mb-1 font-bold text-cyan-200">Live Forecast</div><div>LONG {status.aggregate.forecast.direction_counts?.LONG || 0} · SHORT {status.aggregate.forecast.direction_counts?.SHORT || 0} · NO_TRADE {status.aggregate.forecast.direction_counts?.NO_TRADE || 0}</div><div>NO_TRADE events {status.aggregate.forecast.no_trade_count}</div>{Object.entries(status.aggregate.forecast.no_trade_reasons || {}).map(([symbol, reason]) => <div key={symbol} className="truncate text-amber-200" title={reason}>{symbol}: {reason}</div>)}<div>Data errors {status.aggregate.data.error_count} · {Object.entries(status.aggregate.data.statuses || {}).map(([symbol, value]) => `${symbol}: ${value || 'unknown'}`).join(' · ')}</div></div>
          <div className="rounded border border-border bg-background/60 p-2 text-[11px] text-muted-foreground"><div className="mb-1 font-bold text-emerald-200">Paper Trading</div><div>Balance {status.aggregate.paper.starting_balance == null ? '—' : `$${Number(status.aggregate.paper.starting_balance).toFixed(2)}`} → Equity {status.aggregate.paper.equity == null ? '—' : `$${Number(status.aggregate.paper.equity).toFixed(2)}`}</div><div>Realized PnL {status.aggregate.paper.net_pnl_usd == null ? '—' : `$${Number(status.aggregate.paper.net_pnl_usd).toFixed(2)}`} · Floating {paperFloatingPnl(status.aggregate.paper) == null ? '—' : `$${paperFloatingPnl(status.aggregate.paper).toFixed(2)}`} · ROI {formatPct(status.aggregate.paper.roi_pct, 3)}</div><div>Closed trades {status.aggregate.paper.closed_trades} · Win {Number(status.aggregate.paper.win_rate_pct || 0).toFixed(1)}% · PF {status.aggregate.paper.profit_factor ?? '—'}</div><div>Avg ${Number(status.aggregate.paper.average_trade_usd || 0).toFixed(2)} · Best ${Number(status.aggregate.paper.best_trade_usd || 0).toFixed(2)} · Worst ${Number(status.aggregate.paper.worst_trade_usd || 0).toFixed(2)}</div><div>Risk {status.aggregate.paper.average_risk_pct == null ? '—' : `${Number(status.aggregate.paper.average_risk_pct).toFixed(2)}%`} · Max DD {status.aggregate.paper.max_drawdown_pct == null ? '—' : `${Number(status.aggregate.paper.max_drawdown_pct).toFixed(2)}%`} · NO_TRADE {status.aggregate.paper.no_trade_count}</div>{status.aggregate.paper.losing_trade_reasons?.length > 0 && <div className="truncate text-red-300" title={status.aggregate.paper.losing_trade_reasons.join(', ')}>Loss reasons: {status.aggregate.paper.losing_trade_reasons.join(', ')}</div>}</div>
        </div>
      </div>}
      {error && <div className="mx-3 rounded border border-red-500/30 bg-bear-soft/20 p-2 text-[10px] text-red-300">{error}</div>}
      {!pilotRunning && status.sessions && Object.keys(status.sessions).length > 0 && !preflightCurrent && <div data-testid="overnight-preflight-stale" className="mx-3 mb-2 rounded border border-amber-500/30 bg-amber-950/20 p-2 text-[10px] text-amber-200">Конфигурация не проверена или изменилась. Повторите backtest + forecast перед запуском.</div>}
      <div className="flex flex-wrap gap-2 px-3 pb-3"><button data-testid="btn-load-diversified-paper" disabled={busy || pilotRunning} onClick={loadDiversifiedPaper} title="Загрузить BTC EMA, ETH CVD Absorption и SOL Cluster Bounce с отдельными параметрами; активную paper-сессию не изменяет." className="rounded border border-violet-400/50 bg-violet-950/30 px-3 py-1.5 text-[10px] font-bold text-violet-200 disabled:opacity-50">Загрузить 3 стратегии</button><button data-testid="btn-overnight-preflight" disabled={busy || pilotRunning} onClick={preflight} title="Для каждого выбранного символа выполнит исторический backtest, live forecast и генетический поиск параметров с отдельной проверкой OOS." className="rounded border border-cyan-400/50 bg-cyan-950/30 px-3 py-1.5 text-[10px] font-bold text-cyan-200 disabled:opacity-50">{busy ? 'Расчёт…' : pilotRunning ? '1. Сначала остановите paper' : '1. Backtest + forecast + optimize'}</button><button data-testid="btn-overnight-start" disabled={busy || pilotRunning || !preflightCurrent} onClick={start} title={!preflightCurrent ? 'Сначала выполните backtest и forecast для этой конфигурации.' : 'Запустить paper на проверенной конфигурации.'} className="rounded bg-amber-300 px-3 py-1.5 text-[10px] font-bold text-neutral-950 disabled:opacity-50">{pilotRunning ? 'Paper уже запущен' : '2. Запустить paper'}</button><button disabled={busy} onClick={stop} className="rounded border border-red-400/40 px-3 py-1.5 text-[10px] text-red-300 disabled:opacity-50">Остановить все</button></div>
    </div>
  );
}
