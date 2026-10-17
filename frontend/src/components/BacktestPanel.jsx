import React, { useState, useCallback } from 'react';
import { BarChart3, Play, Loader2, Eye, EyeOff, X, AlertTriangle, Grid, Sliders } from 'lucide-react';

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
    <div
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
      className="flex-1 min-w-[82px] border rounded px-2 py-1"
    >
      <div className="text-[9px] uppercase text-[#60697b] font-semibold tracking-wide truncate">{label}</div>
      <div className={`text-[15px] font-bold font-mono-numbers leading-tight ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-[#60697b] font-mono truncate">{sub}</div>}
    </div>
  );
}

function NumField({ label, value, onChange, step = 0.1, min = 0, max, suffix }) {
  return (
    <label className="flex flex-col text-[9.5px] text-[#787f91] font-mono min-w-0">
      <span className="mb-0.5 truncate">{label}</span>
      <div className="flex items-center">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ backgroundColor: 'var(--bg-root)', borderColor: 'var(--border-subtle)' }}
          className="w-full border rounded px-1.5 py-0.5 text-white text-[10.5px] text-right outline-none focus:border-[#2563eb]"
        />
        {suffix && <span className="ml-0.5 text-[#60697b] text-[9px]">{suffix}</span>}
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
  onApplyStrategy,
  onStrategyChange,
}) {
  const [mode, setMode] = useState('single'); // 'single' | 'grid'
  const [strategy, setStrategy] = useState('delta_absorption');
  const [timeframe, setTimeframe] = useState('5m');
  const [days, setDays] = useState(14);
  const [sl, setSl] = useState(0.8);
  const [tp, setTp] = useState(1.6);
  const [minWallK, setMinWallK] = useState(100);
  const [volMult, setVolMult] = useState(1.0);
  const [leverage, setLeverage] = useState(2);

  // Grid Search parameters (ТАКТ 2: SL 0.2%-1.0%, TP 0.5%-3.0%, Min Wall $200k-$2M)
  const [slMin, setSlMin] = useState(0.2);
  const [slMax, setSlMax] = useState(1.0);
  const [slStep, setSlStep] = useState(0.2);
  const [tpMin, setTpMin] = useState(0.5);
  const [tpMax, setTpMax] = useState(3.0);
  const [tpStep, setTpStep] = useState(0.5);
  const [wallMinK, setWallMinK] = useState(200);
  const [wallMaxK, setWallMaxK] = useState(2000);
  const [wallStepK, setWallStepK] = useState(600);
  const [appliedFeedback, setAppliedFeedback] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runSingle = useCallback(async (overrideParams = null) => {
    setLoading(true);
    setError(null);
    onResult(null);
    const pSl = overrideParams?.sl ?? sl;
    const pTp = overrideParams?.tp ?? tp;
    const pWallK = overrideParams?.minWallK ?? minWallK;
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
            stop_loss_pct: Number(pSl) || 0.8,
            take_profit_pct: Number(pTp) || 1.5,
            min_density_usd: (Number(pWallK) || 0) * 1000,
            volume_multiplier: Number(volMult) || 1.0,
            leverage: Math.max(1, Math.round(Number(leverage) || 1)),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
      onResult({ ...data, symbol, timeframe, mode: 'single' });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, days, strategy, sl, tp, minWallK, volMult, leverage, onResult]);

  const applySetup = useCallback((row) => {
    const newSl = row.stop_loss_pct;
    const newTp = row.take_profit_pct;
    const newWallK = Math.round(row.min_density_usd / 1000);
    setSl(newSl);
    setTp(newTp);
    setMinWallK(newWallK);
    setAppliedFeedback(`Параметры #${row.rank} применены: SL ${newSl}%, TP ${newTp}%, Стенка $${newWallK}k`);
    setTimeout(() => setAppliedFeedback(null), 3500);

    if (onApplyStrategy) {
      onApplyStrategy({
        strategy,
        sl: newSl,
        tp: newTp,
        minWallK: newWallK,
        leverage,
        volMult
      });
    }

    setMode('single');
    runSingle({ sl: newSl, tp: newTp, minWallK: newWallK });
  }, [strategy, leverage, volMult, onApplyStrategy, runSingle]);

  const runGrid = useCallback(async () => {
    setLoading(true);
    setError(null);
    onResult(null);
    try {
      const res = await fetch(`${API_BASE}/backtest/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          days: Math.min(30, Math.max(1, Number(days) || 7)),
          strategy_type: strategy,
          sl_min: Number(slMin) || 0.2,
          sl_max: Number(slMax) || 1.0,
          sl_step: Math.max(0.05, Number(slStep) || 0.2),
          tp_min: Number(tpMin) || 0.5,
          tp_max: Number(tpMax) || 3.0,
          tp_step: Math.max(0.1, Number(tpStep) || 0.5),
          wall_min_usd: (Number(wallMinK) || 200) * 1000,
          wall_max_usd: (Number(wallMaxK) || 2000) * 1000,
          wall_step_usd: Math.max(50, Number(wallStepK) || 600) * 1000,
          volume_multiplier: Number(volMult) || 1.0,
          leverage: Math.max(1, Math.round(Number(leverage) || 1)),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
      onResult({ ...data, symbol, timeframe, mode: 'grid' });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe, days, strategy, slMin, slMax, slStep, tpMin, tpMax, tpStep, wallMinK, wallMaxK, wallStepK, volMult, leverage, onResult]);

  if (!isOpen) return null;

  const s = result?.summary;
  const pnlTone = s ? (s.total_pnl_pct > 0 ? 'pos' : s.total_pnl_pct < 0 ? 'neg' : null) : null;
  const lastTrades = result?.trades ? [...result.trades].slice(-10).reverse() : [];
  const gridRows = result?.grid_results || [];

  return (
    <div
      style={{ height: 315, backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
      className="absolute left-0 right-0 bottom-0 z-40 border-t shadow-[0_-8px_24px_rgba(0,0,0,0.65)] text-xs flex flex-col"
    >
      {/* Header */}
      <div
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-3 py-1 border-b"
      >
        <div className="flex items-center space-x-2 font-bold text-white text-[11px] min-w-0">
          <BarChart3 size={13} className="text-[#38bdf8] shrink-0" />
          <span className="truncate">Бэктест & Оптимизация</span>
          <span className="font-mono text-[#38bdf8] bg-[#14171f] border border-[#1f2430] rounded px-1.5 shrink-0">
            {symbol}
          </span>

          {/* Mode Switcher */}
          <div className="flex items-center bg-[#08090c] p-0.5 rounded border border-[#1f2430] font-mono text-[9.5px] ml-2 shrink-0">
            <button
              onClick={() => setMode('single')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition ${
                mode === 'single' ? 'bg-[#2563eb] text-white font-bold' : 'text-[#787f91] hover:text-white'
              }`}
            >
              <Sliders size={10} />
              <span>Одиночный прогон</span>
            </button>
            <button
              onClick={() => setMode('grid')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition ${
                mode === 'grid' ? 'bg-[#a855f7] text-white font-bold' : 'text-[#787f91] hover:text-white'
              }`}
            >
              <Grid size={10} />
              <span>Сетка параметров (Grid Search)</span>
            </button>
          </div>

          {appliedFeedback && (
            <span className="hidden sm:inline font-mono text-[10px] text-[#26a69a] bg-[#26a69a18] border border-[#26a69a40] rounded px-2 py-0.5 animate-pulse truncate">
              ✓ {appliedFeedback}
            </span>
          )}

          {result?.meta && (
            <span className="hidden xl:inline font-mono text-[10px] text-[#60697b] font-normal truncate">
              {result.meta.candles} свечей {result.meta.timeframe}
              {result.meta.combinations_tested ? ` • Комбинаций: ${result.meta.combinations_tested}` : ''}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-[#60697b] hover:text-white shrink-0" title="Закрыть (B)">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Settings column */}
        <div
          style={{ borderColor: 'var(--border-subtle)' }}
          className="w-[305px] shrink-0 p-2 border-r space-y-1.5 overflow-y-auto"
        >
          <div className="flex space-x-1">
            {STRATEGIES.map((st) => (
              <button
                key={st.id}
                onClick={() => {
                  setStrategy(st.id);
                  if (onStrategyChange) onStrategyChange(st.id);
                }}
                className={`flex-1 px-1 py-1 rounded text-[9.5px] font-mono truncate transition ${
                  strategy === st.id ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          <div className="flex items-center space-x-1">
            <span className="text-[9.5px] text-[#787f91] font-mono shrink-0">ТФ:</span>
            <div className="flex flex-1 space-x-0.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={`flex-1 py-0.5 rounded text-[9.5px] font-mono transition ${
                    timeframe === tf ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          {mode === 'single' ? (
            <div className="grid grid-cols-3 gap-1.5">
              <NumField label="Период" value={days} onChange={setDays} step={1} min={1} max={30} suffix="дн" />
              <NumField label="SL" value={sl} onChange={setSl} step={0.1} min={0.1} suffix="%" />
              <NumField label="TP" value={tp} onChange={setTp} step={0.1} min={0.1} suffix="%" />
              <NumField label="Стенка" value={minWallK} onChange={setMinWallK} step={10} min={0} suffix="$k" />
              <NumField label="Объём ×" value={volMult} onChange={setVolMult} step={0.1} min={0.5} />
              <NumField label="Плечо" value={leverage} onChange={setLeverage} step={1} min={1} max={125} suffix="x" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1">
                <NumField label="SL от" value={slMin} onChange={setSlMin} step={0.1} min={0.1} suffix="%" />
                <NumField label="SL до" value={slMax} onChange={setSlMax} step={0.1} min={0.1} suffix="%" />
                <NumField label="SL шаг" value={slStep} onChange={setSlStep} step={0.1} min={0.05} suffix="%" />
              </div>
              <div className="grid grid-cols-3 gap-1">
                <NumField label="TP от" value={tpMin} onChange={setTpMin} step={0.2} min={0.2} suffix="%" />
                <NumField label="TP до" value={tpMax} onChange={setTpMax} step={0.2} min={0.2} suffix="%" />
                <NumField label="TP шаг" value={tpStep} onChange={setTpStep} step={0.2} min={0.1} suffix="%" />
              </div>
              <div className="grid grid-cols-3 gap-1">
                <NumField label="Стенка от" value={wallMinK} onChange={setWallMinK} step={100} min={0} suffix="k" />
                <NumField label="Стенка до" value={wallMaxK} onChange={setWallMaxK} step={100} min={0} suffix="k" />
                <NumField label="Шаг $k" value={wallStepK} onChange={setWallStepK} step={100} min={50} suffix="k" />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <NumField label="Период" value={days} onChange={setDays} step={1} min={1} max={30} suffix="дн" />
                <NumField label="Плечо" value={leverage} onChange={setLeverage} step={1} min={1} max={125} suffix="x" />
              </div>
            </div>
          )}

          <button
            onClick={() => (mode === 'grid' ? runGrid() : runSingle())}
            disabled={loading}
            className={`w-full flex items-center justify-center space-x-1.5 py-1.5 rounded disabled:opacity-60 text-white font-bold text-[11px] transition shadow-xs ${
              mode === 'grid' ? 'bg-[#9333ea] hover:bg-[#7e22ce]' : 'bg-[#2563eb] hover:bg-[#1d4ed8]'
            }`}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
            <span>
              {loading
                ? 'Считаю…'
                : mode === 'grid'
                ? '⚡ Оптимизировать параметры'
                : 'Запустить тест'}
            </span>
          </button>

          {error && (
            <div className="flex items-start space-x-1 text-[10px] text-[#ef5350] bg-[#ef535014] border border-[#ef535040] rounded p-1.5 font-mono">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        {/* Results column */}
        <div className="flex-1 min-w-0 p-2 flex flex-col space-y-1.5 overflow-hidden">
          {!s && !loading && (
            <div className="flex-1 flex items-center justify-center text-[#60697b] text-[11px] font-mono">
              {mode === 'grid'
                ? 'Задайте диапазоны SL, TP и порога стенки ($k) и нажмите «⚡ Оптимизировать параметры»'
                : 'Настройте стратегию и нажмите «Запустить тест»'}
            </div>
          )}
          {loading && (
            <div className="flex-1 flex items-center justify-center text-[#38bdf8] text-[11px] font-mono">
              <Loader2 size={16} className="animate-spin mr-2" />
              {mode === 'grid'
                ? 'Быстрый расчет комбинаций сетки и сортировка по Profit Factor и Sharpe Ratio…'
                : 'Загрузка истории Binance и расчёт…'}
            </div>
          )}

          {s && !loading && (
            <>
              <div className="flex space-x-1.5 min-w-0">
                <Card label={gridRows.length ? 'Лучший PnL' : 'Net PnL'} value={`${s.total_pnl_pct > 0 ? '+' : ''}${s.total_pnl_pct}%`} tone={pnlTone} />
                <Card label="Win Rate" value={`${s.win_rate_pct}%`} tone={s.win_rate_pct >= 50 ? 'pos' : null} sub={`${s.winning_trades}W / ${s.losing_trades}L`} />
                <Card label="Profit Factor" value={s.profit_factor >= 999 ? '∞' : s.profit_factor} tone={s.profit_factor >= 1 ? 'pos' : 'neg'} />
                <Card label="Max DD" value={`-${s.max_drawdown_pct}%`} tone={s.max_drawdown_pct > 15 ? 'neg' : null} />
                <Card label="Сделок" value={s.total_trades} sub={`Sharpe ${s.sharpe_ratio}`} />
                <button
                  onClick={onToggleSignals}
                  className={`flex flex-col items-center justify-center px-2 rounded border text-[10px] font-mono shrink-0 transition ${
                    showSignals ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]' : 'text-[#60697b] border-[#1f2430] hover:text-white'
                  }`}
                  title="Показать / скрыть сигналы на графике"
                >
                  {showSignals ? <Eye size={13} /> : <EyeOff size={13} />}
                  <span>{showSignals ? 'Сигналы' : 'Скрыты'}</span>
                </button>
              </div>

              {/* Table: either Grid Search Leaderboard or Last 10 Trades */}
              <div
                style={{ borderColor: 'var(--border-subtle)' }}
                className="flex-1 overflow-y-auto border rounded"
              >
                {gridRows.length > 0 && mode === 'grid' ? (
                  <table className="w-full text-[10.5px] font-mono-numbers">
                    <thead
                      style={{ backgroundColor: 'var(--bg-panel)' }}
                      className="sticky top-0 text-[#60697b] text-[9px] uppercase"
                    >
                      <tr>
                        <th className="text-left px-2 py-1">#</th>
                        <th className="text-right px-2">SL %</th>
                        <th className="text-right px-2">TP %</th>
                        <th className="text-right px-2">Wall $</th>
                        <th className="text-right px-2">WinRate %</th>
                        <th className="text-right px-2">PnL %</th>
                        <th className="text-right px-2">PF</th>
                        <th className="text-right px-2">Sharpe</th>
                        <th className="text-center px-2">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#13161f]">
                      {gridRows.map((row) => (
                        <tr
                          key={row.rank}
                          className={`hover:bg-[#161922] ${row.rank === 1 ? 'bg-[#2563eb15]' : ''}`}
                        >
                          <td className="px-2 py-1 font-bold text-[#a855f7]">#{row.rank}</td>
                          <td className="px-2 text-right text-white font-mono">{row.stop_loss_pct}%</td>
                          <td className="px-2 text-right text-[#787f91] font-mono">{row.take_profit_pct}%</td>
                          <td className="px-2 text-right text-[#ffb300] font-mono">
                            ${(row.min_density_usd / 1000).toFixed(0)}k
                          </td>
                          <td className="px-2 text-right text-[#d1d4dc] font-mono">{row.win_rate_pct}%</td>
                          <td className={`px-2 text-right font-bold font-mono ${row.total_pnl_pct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                            {row.total_pnl_pct >= 0 ? '+' : ''}{row.total_pnl_pct}%
                          </td>
                          <td className="px-2 text-right text-[#d1d4dc] font-mono">{row.profit_factor >= 999 ? '∞' : row.profit_factor}</td>
                          <td className={`px-2 text-right font-bold font-mono ${row.sharpe_ratio > 0 ? 'text-[#38bdf8]' : 'text-[#787f91]'}`}>
                            {row.sharpe_ratio}
                          </td>
                          <td className="px-2 text-center">
                            <button
                              onClick={() => applySetup(row)}
                              className="px-2 py-0.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-[9.5px] transition shadow-xs"
                              title="Мгновенно применить параметры к стратегии"
                            >
                              Применить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                ) : (
                  <table className="w-full text-[10.5px] font-mono-numbers">
                    <thead
                      style={{ backgroundColor: 'var(--bg-panel)' }}
                      className="sticky top-0 text-[#60697b] text-[9px] uppercase"
                    >
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
                        <tr>
                          <td colSpan={6} className="text-center py-3 text-[#60697b]">
                            Сделок не найдено — ослабьте фильтры (объём ×, стенка)
                          </td>
                        </tr>
                      )}
                      {lastTrades.map((t) => (
                        <tr key={t.id} className="hover:bg-[#161922]">
                          <td className="px-2 py-0.5 text-[#787f91]">{fmtTime(t.entry_time)}</td>
                          <td className={`px-2 font-bold ${t.type === 'BUY' ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                            {t.type}
                          </td>
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
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
