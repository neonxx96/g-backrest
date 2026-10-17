import React, { useState, useCallback } from 'react';
import { BarChart3, Play, Loader2, Eye, EyeOff, X, AlertTriangle } from 'lucide-react';

const API_BASE = '/api';

const STRATEGIES = [
  { id: 'delta_absorption', label: 'Delta Absorption' },
  { id: 'density_bounce', label: 'Density Bounce' },
  { id: 'ema_trend', label: 'EMA Trend' },
];
const TIMEFRAMES = ['1m', '5m', '15m', '1h'];

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('ru-RU', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const fmtPrice = (p) => (p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toFixed(5));

function Card({ label, value, tone, sub }) {
  const color = tone === 'pos' ? 'text-[#26a69a]' : tone === 'neg' ? 'text-[#ef5350]' : 'text-white';
  return (
    <div className="flex-1 min-w-[90px] bg-[#0c0e12] border border-[#161922] rounded px-2.5 py-1.5">
      <div className="text-[9px] uppercase text-[#60697b] font-semibold tracking-wide">{label}</div>
      <div className={`text-[17px] font-bold font-mono-numbers leading-tight ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-[#60697b] font-mono">{sub}</div>}
    </div>
  );
}

function NumField({ label, value, onChange, step = 0.1, min = 0, max, suffix }) {
  return (
    <label className="flex flex-col text-[10px] text-[#787f91] font-mono">
      <span className="mb-0.5">{label}</span>
      <div className="flex items-center">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-full bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-white text-[11px] text-right outline-none focus:border-[#2563eb]"
        />
        {suffix && <span className="ml-1 text-[#60697b]">{suffix}</span>}
      </div>
    </label>
  );
}

export default function BacktestPanel({
  isOpen,
  onClose,
  symbol,
  result,
  onResult,
  showSignals,
  onToggleSignals,
}) {
  const [strategy, setStrategy] = useState('delta_absorption');
  const [timeframe, setTimeframe] = useState('5m');
  const [days, setDays] = useState(14);
  const [sl, setSl] = useState(0.8);
  const [tp, setTp] = useState(1.6);
  const [minWallK, setMinWallK] = useState(100);
  const [volMult, setVolMult] = useState(1.0);
  const [leverage, setLeverage] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    onResult(null); // clear previous markers right away
    try {
      const res = await fetch(`${API_BASE}/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          days: Math.min(30, Math.max(1, Number(days) || 7)),
          strategy_type: strategy,
          params: {
            stop_loss_pct: Number(sl) || 0.8,
            take_profit_pct: Number(tp) || 1.5,
            min_density_usd: (Number(minWallK) || 0) * 1000,
            volume_multiplier: Number(volMult) || 1.0,
            leverage: Math.max(1, Math.round(Number(leverage) || 1)),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
      onResult({ ...data, symbol, timeframe });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, days, strategy, sl, tp, minWallK, volMult, leverage, onResult]);

  if (!isOpen) return null;

  const s = result?.summary;
  const pnlTone = s ? (s.total_pnl_pct > 0 ? 'pos' : s.total_pnl_pct < 0 ? 'neg' : null) : null;
  const lastTrades = result ? [...result.trades].slice(-10).reverse() : [];

  return (
    <div className="absolute left-0 right-0 bottom-0 z-40 bg-[#101217] border-t border-[#2563eb66] shadow-[0_-8px_24px_rgba(0,0,0,0.6)] text-xs flex flex-col"
         style={{ height: 330 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[#161922] bg-[#0c0e12]">
        <div className="flex items-center space-x-2 font-bold text-white text-[11px]">
          <BarChart3 size={13} className="text-[#38bdf8]" />
          <span>Бэктест стратегий</span>
          <span className="font-mono text-[#38bdf8] bg-[#14171f] border border-[#1f2430] rounded px-1.5">{symbol}</span>
          {result?.meta && (
            <span className="font-mono text-[10px] text-[#60697b] font-normal">
              {result.meta.candles} свечей {result.meta.timeframe} • {fmtTime(result.meta.from_time)} → {fmtTime(result.meta.to_time)}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-[#60697b] hover:text-white" title="Закрыть (B)">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Settings column */}
        <div className="w-[300px] shrink-0 p-2.5 border-r border-[#161922] space-y-2 overflow-y-auto">
          <div>
            <div className="text-[10px] text-[#787f91] font-mono mb-0.5">Стратегия</div>
            <div className="flex space-x-0.5">
              {STRATEGIES.map((st) => (
                <button
                  key={st.id}
                  onClick={() => setStrategy(st.id)}
                  className={`flex-1 px-1 py-1 rounded text-[10px] font-mono transition ${
                    strategy === st.id ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-[#787f91] font-mono mb-0.5">Таймфрейм</div>
            <div className="flex space-x-0.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`flex-1 px-1 py-0.5 rounded text-[10px] font-mono transition ${
                    timeframe === tf ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <NumField label="Период" value={days} onChange={setDays} step={1} min={1} max={30} suffix="дн" />
            <NumField label="SL" value={sl} onChange={setSl} step={0.1} min={0.1} suffix="%" />
            <NumField label="TP" value={tp} onChange={setTp} step={0.1} min={0.1} suffix="%" />
            <NumField label="Стенка" value={minWallK} onChange={setMinWallK} step={10} min={0} suffix="$k" />
            <NumField label="Объём ×" value={volMult} onChange={setVolMult} step={0.1} min={0.5} />
            <NumField label="Плечо" value={leverage} onChange={setLeverage} step={1} min={1} max={125} suffix="x" />
          </div>

          <button
            onClick={run}
            disabled={loading}
            className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 text-white font-bold text-[11px] transition"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
            <span>{loading ? 'Считаю…' : 'Запустить тест'}</span>
          </button>

          {error && (
            <div className="flex items-start space-x-1 text-[10px] text-[#ef5350] bg-[#ef535014] border border-[#ef535040] rounded p-1.5 font-mono">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
          {strategy === 'density_bounce' && (
            <div className="text-[9px] text-[#60697b] font-mono leading-snug">
              «Стенка» в тесте = минимальный оборот свечи отскока (close×volume): исторический L2 стакана в тесте не используется.
            </div>
          )}
        </div>

        {/* Results column */}
        <div className="flex-1 min-w-0 p-2.5 flex flex-col space-y-2 overflow-hidden">
          {!s && !loading && (
            <div className="flex-1 flex items-center justify-center text-[#60697b] text-[11px] font-mono">
              Настройте стратегию и нажмите «Запустить тест»
            </div>
          )}
          {loading && (
            <div className="flex-1 flex items-center justify-center text-[#38bdf8] text-[11px] font-mono">
              <Loader2 size={16} className="animate-spin mr-2" /> Загрузка истории Binance и расчёт…
            </div>
          )}

          {s && !loading && (
            <>
              <div className="flex space-x-1.5">
                <Card label="Net PnL" value={`${s.total_pnl_pct > 0 ? '+' : ''}${s.total_pnl_pct}%`} tone={pnlTone} />
                <Card label="Win Rate" value={`${s.win_rate_pct}%`} tone={s.win_rate_pct >= 50 ? 'pos' : null} sub={`${s.winning_trades}W / ${s.losing_trades}L`} />
                <Card label="Profit Factor" value={s.profit_factor >= 999 ? '∞' : s.profit_factor} tone={s.profit_factor >= 1 ? 'pos' : 'neg'} />
                <Card label="Max DD" value={`-${s.max_drawdown_pct}%`} tone={s.max_drawdown_pct > 15 ? 'neg' : null} />
                <Card label="Сделок" value={s.total_trades} sub={`Sharpe ${s.sharpe_ratio}`} />
                <button
                  onClick={onToggleSignals}
                  className={`flex flex-col items-center justify-center px-2.5 rounded border text-[10px] font-mono transition ${
                    showSignals ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]' : 'text-[#60697b] border-[#1f2430] hover:text-white'
                  }`}
                  title="Показать / скрыть сигналы на графике"
                >
                  {showSignals ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span>{showSignals ? 'Сигналы' : 'Скрыты'}</span>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto border border-[#161922] rounded">
                <table className="w-full text-[10.5px] font-mono-numbers">
                  <thead className="sticky top-0 bg-[#0c0e12] text-[#60697b] text-[9px] uppercase">
                    <tr>
                      <th className="text-left px-2 py-1">Время</th>
                      <th className="text-left px-2">Тип</th>
                      <th className="text-right px-2">Вход</th>
                      <th className="text-right px-2">Выход</th>
                      <th className="text-right px-2">PnL %</th>
                      <th className="text-left px-2">Результат</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#13161f]">
                    {lastTrades.length === 0 && (
                      <tr><td colSpan={6} className="text-center py-3 text-[#60697b]">Сделок не найдено — ослабьте фильтры (объём ×, стенка)</td></tr>
                    )}
                    {lastTrades.map((t) => (
                      <tr key={t.id} className="hover:bg-[#161922]">
                        <td className="px-2 py-0.5 text-[#787f91]">{fmtTime(t.entry_time)}</td>
                        <td className={`px-2 font-bold ${t.type === 'BUY' ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>{t.type}</td>
                        <td className="px-2 text-right text-[#d1d4dc]">{fmtPrice(t.entry_price)}</td>
                        <td className="px-2 text-right text-[#d1d4dc]">{fmtPrice(t.exit_price)}</td>
                        <td className={`px-2 text-right font-bold ${t.pnl_pct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                          {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct}%
                        </td>
                        <td className="px-2 text-[#787f91]">{t.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
