import React, { useState, useCallback, useEffect } from 'react';
import {
  BarChart3,
  Play,
  Loader2,
  Eye,
  EyeOff,
  X,
  AlertTriangle,
  Grid,
  Sliders,
  Sparkles,
  Check,
  TrendingUp,
  ShieldCheck,
  Dna
} from 'lucide-react';

const API_BASE = '/api';

const PRESET_CHIPS = [
  { label: '🛡️ Консервативный BTC (5m)', text: 'Сделай консервативный сетап для скальпинга BTC на 5m с низким риском' },
  { label: '⚡ Агрессивный импульс CVD', text: 'Агрессивный лонг по поглощению дельты CVD с коротким стопом и плечом 5х' },
  { label: '🧱 Отскок от плотностей (1m)', text: 'Скальпинг отскока от плотностей стакана на 1m со стопом 0.4% и тейком 1.2%' },
  { label: '🎯 Сбалансированный ETH (15m)', text: 'Сбалансированная стратегия на ETH 15m с ATR фильтром и RSI' }
];

const STRATEGIES = [
  { id: 'delta_absorption', label: 'Delta Absorption' },
  { id: 'density_bounce', label: 'Density Bounce' },
  { id: 'ema_trend', label: 'EMA Trend' }
];
const TIMEFRAMES = ['1m', '5m', '15m', '1h'];

const fmtTime = (ms) =>
  new Date(ms).toLocaleString('ru-RU', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

const fmtPrice = (p) => (p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toFixed(5));

function Card({ label, value, tone, sub, testId }) {
  const color =
    tone === 'pos'
      ? 'text-[#26a69a]'
      : tone === 'neg'
      ? 'text-[#ef5350]'
      : tone === 'warn'
      ? 'text-[#ffb300]'
      : 'text-white';
  return (
    <div
      data-testid={testId}
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
      className="flex-1 min-w-[78px] border rounded px-2 py-1"
    >
      <div className="text-[8.5px] uppercase text-[#60697b] font-semibold tracking-wide truncate">{label}</div>
      <div className={`text-[13.5px] font-bold font-mono-numbers leading-tight ${color}`}>{value}</div>
      {sub && <div className="text-[8.5px] text-[#787f91] font-mono truncate">{sub}</div>}
    </div>
  );
}

function NumField({ label, value, onChange, step = 0.1, min = 0, max, suffix, testId }) {
  return (
    <label className="flex flex-col text-[9px] text-[#787f91] font-mono min-w-0">
      <span className="mb-0.5 truncate">{label}</span>
      <div className="flex items-center">
        <input
          data-testid={testId}
          type="number"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          style={{ backgroundColor: 'var(--bg-root)', borderColor: 'var(--border-subtle)' }}
          className="w-full border rounded px-1 py-0.5 text-white text-[10px] text-right outline-none focus:border-[#2563eb]"
        />
        {suffix && <span className="ml-0.5 text-[#60697b] text-[8.5px]">{suffix}</span>}
      </div>
    </label>
  );
}

/**
 * Interactive SVG Equity Curve with Monte Carlo 500-Run Fan Cloud Overlay & Gross vs Net Comparison
 */
function MonteCarloEquityChart({ fanChart = [], samplePaths = [], initialCapital = 10000 }) {
  if (!fanChart || fanChart.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-[#60697b] text-[10px] font-mono">
        Недостаточно сделок для построения веера Монте-Карло
      </div>
    );
  }

  const width = 580;
  const height = 148;
  const padL = 46;
  const padR = 12;
  const padT = 10;
  const padB = 18;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allVals = [initialCapital];
  fanChart.forEach((pt) => {
    allVals.push(pt.p5, pt.p95, pt.actual, pt.gross || pt.actual);
  });
  samplePaths.forEach((path) => {
    path.forEach((v) => allVals.push(v));
  });

  const minVal = Math.min(...allVals) * 0.996;
  const maxVal = Math.max(...allVals) * 1.004;
  const valRange = Math.max(1, maxVal - minVal);
  const nPts = fanChart.length;

  const toX = (idx) => padL + (idx / Math.max(1, nPts - 1)) * plotW;
  const toY = (val) => padT + plotH - ((val - minVal) / valRange) * plotH;

  const buildLine = (key) =>
    fanChart
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(pt[key] ?? pt.actual).toFixed(1)}`)
      .join(' ');

  const buildBandPolygon = (upperKey, lowerKey) => {
    const topPts = fanChart.map((pt, i) => `${toX(i).toFixed(1)},${toY(pt[upperKey]).toFixed(1)}`);
    const botPts = [...fanChart]
      .reverse()
      .map((pt, revIdx) => {
        const i = nPts - 1 - revIdx;
        return `${toX(i).toFixed(1)},${toY(pt[lowerKey]).toFixed(1)}`;
      });
    return [...topPts, ...botPts].join(' ');
  };

  const yBase = toY(initialCapital);

  return (
    <svg
      data-testid="monte-carlo-svg"
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full select-none overflow-visible"
    >
      {/* Grid & Initial Capital Baseline */}
      <line
        x1={padL}
        y1={yBase}
        x2={width - padR}
        y2={yBase}
        stroke="#334155"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <text x={4} y={padT + 8} fill="#64748b" fontSize="8.5" fontFamily="monospace">
        ${Math.round(maxVal).toLocaleString()}
      </text>
      <text x={4} y={Math.min(height - 6, Math.max(padT + 18, yBase + 3))} fill="#94a3b8" fontSize="8.5" fontFamily="monospace">
        ${Math.round(initialCapital).toLocaleString()}
      </text>
      <text x={4} y={height - 4} fill="#64748b" fontSize="8.5" fontFamily="monospace">
        ${Math.round(minVal).toLocaleString()}
      </text>

      {/* Outer 5%-95% Monte Carlo Confidence Cloud */}
      <polygon
        points={buildBandPolygon('p95', 'p5')}
        fill="rgba(56, 189, 248, 0.11)"
        stroke="none"
      />

      {/* Inner 25%-75% Monte Carlo Quartile Cloud */}
      <polygon
        points={buildBandPolygon('p75', 'p25')}
        fill="rgba(56, 189, 248, 0.22)"
        stroke="none"
      />

      {/* Individual Monte Carlo Sample Fan Paths */}
      {samplePaths.map((path, sIdx) => {
        const d = path
          .map((v, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(v).toFixed(1)}`)
          .join(' ');
        return (
          <path
            key={sIdx}
            d={d}
            fill="none"
            stroke="rgba(148, 163, 184, 0.18)"
            strokeWidth="0.9"
          />
        );
      })}

      {/* P50 Median Monte Carlo Path */}
      <path
        d={buildLine('p50')}
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.2"
        strokeDasharray="4 2"
      />

      {/* Gross Equity Curve (Before Exchange Fees & Slippage) */}
      <path
        d={buildLine('gross')}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />

      {/* Actual Net Equity Curve (After Exchange Fees & Slippage) */}
      <path
        d={buildLine('actual')}
        fill="none"
        stroke="#26a69a"
        strokeWidth="2.2"
      />

      {/* Legend */}
      <g transform={`translate(${padL + 6}, ${padT + 2})`}>
        <rect x="0" y="0" width="8" height="4" fill="#26a69a" rx="1" />
        <text x="11" y="4.5" fill="#e2e8f0" fontSize="8" fontFamily="monospace">
          Чистый Equity
        </text>

        <rect x="82" y="0" width="8" height="4" fill="#f59e0b" rx="1" />
        <text x="93" y="4.5" fill="#cbd5e1" fontSize="8" fontFamily="monospace">
          До комиссий (Gross)
        </text>

        <rect x="192" y="0" width="8" height="4" fill="rgba(56,189,248,0.45)" rx="1" />
        <text x="203" y="4.5" fill="#38bdf8" fontSize="8" fontFamily="monospace">
          Облако Монте-Карло (P5–P95)
        </text>
      </g>
    </svg>
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
  onStrategyChange
}) {
  const [mode, setMode] = useState('single'); // 'single' | 'grid' (Genetic Optimizer) | 'ai'
  const [strategy, setStrategy] = useState('delta_absorption');
  const [timeframe, setTimeframe] = useState('5m');
  const [days, setDays] = useState(14);
  const [sl, setSl] = useState(0.8);
  const [tp, setTp] = useState(1.6);
  const [minWallK, setMinWallK] = useState(100);
  const [volMult, setVolMult] = useState(1.0);
  const [leverage, setLeverage] = useState(2);

  // ТАКТ 1: Realistic Execution Engine parameters
  const [makerFeePct, setMakerFeePct] = useState(0.02);
  const [takerFeePct, setTakerFeePct] = useState(0.05);
  const [slippageTicks, setSlippageTicks] = useState(2);
  const [useMultiTp, setUseMultiTp] = useState(true);

  // ТАКТ 2: Genetic Optimizer ranges (SL 0.2%-1.2%, TP 0.5%-3.0%, Min Wall $300k-$3M)
  const [slMin, setSlMin] = useState(0.2);
  const [slMax, setSlMax] = useState(1.2);
  const [tpMin, setTpMin] = useState(0.5);
  const [tpMax, setTpMax] = useState(3.0);
  const [wallMinK, setWallMinK] = useState(300);
  const [wallMaxK, setWallMaxK] = useState(3000);
  const [optProgress, setOptProgress] = useState(0);
  const [appliedFeedback, setAppliedFeedback] = useState(null);

  // Confluence Filter Suite states
  const [filterCvd, setFilterCvd] = useState(false);
  const [filterOi, setFilterOi] = useState(false);
  const [filterAtr, setFilterAtr] = useState(false);
  const [filterAtrSl, setFilterAtrSl] = useState(false);
  const [atrMultiplier, setAtrMultiplier] = useState(1.5);
  const [filterRsi, setFilterRsi] = useState(false);

  // Results view tab: 'equity' (Equity & Monte Carlo) | 'optimizer' (Before/After + Leaderboard) | 'trades' | 'matrix'
  const [viewTab, setViewTab] = useState('equity');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Real-time progress bar animation during genetic optimization
  useEffect(() => {
    if (!loading || mode !== 'grid') {
      return;
    }
    setOptProgress(12);
    const timer = setInterval(() => {
      setOptProgress((prev) => (prev < 92 ? prev + 16 : prev));
    }, 140);
    return () => clearInterval(timer);
  }, [loading, mode]);

  const runSingle = useCallback(
    async (overrideParams = null) => {
      setLoading(true);
      setError(null);
      const pSl = overrideParams?.sl ?? sl;
      const pTp = overrideParams?.tp ?? tp;
      const pWallK = overrideParams?.minWallK ?? minWallK;
      const pCvd = overrideParams?.useCvd ?? filterCvd;
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
              use_atr_filter: filterAtr,
              use_atr_sl: filterAtrSl,
              atr_multiplier: Number(atrMultiplier) || 1.5,
              use_cvd_filter: pCvd,
              use_oi_filter: filterOi,
              use_rsi_filter: filterRsi,
              maker_fee_pct: Number(makerFeePct) >= 0 ? Number(makerFeePct) : 0.02,
              taker_fee_pct: Number(takerFeePct) >= 0 ? Number(takerFeePct) : 0.05,
              slippage_ticks: Number(slippageTicks) >= 0 ? Number(slippageTicks) : 2,
              use_multi_tp: Boolean(useMultiTp)
            }
          })
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        onResult({ ...data, symbol, timeframe, mode: 'single' });
        setViewTab('equity');
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    },
    [
      symbol,
      timeframe,
      days,
      strategy,
      sl,
      tp,
      minWallK,
      volMult,
      leverage,
      filterAtr,
      filterAtrSl,
      atrMultiplier,
      filterCvd,
      filterOi,
      filterRsi,
      makerFeePct,
      takerFeePct,
      slippageTicks,
      useMultiTp,
      onResult
    ]
  );

  const applySetup = useCallback(
    (row) => {
      if (!row) return;
      const newSl = row.stop_loss_pct ?? sl;
      const newTp = row.take_profit_pct ?? tp;
      const newWallK = Math.round((row.min_density_usd ?? 300000) / 1000);
      const newCvd = row.use_cvd_filter != null ? Boolean(row.use_cvd_filter) : filterCvd;

      setSl(newSl);
      setTp(newTp);
      setMinWallK(newWallK);
      setFilterCvd(newCvd);
      setAppliedFeedback(
        `Лучший сетап применён: SL ${newSl}%, TP ${newTp}%, Стенка $${newWallK}k, CVD ${newCvd ? 'ON' : 'OFF'}`
      );
      setTimeout(() => setAppliedFeedback(null), 4000);

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
      runSingle({ sl: newSl, tp: newTp, minWallK: newWallK, useCvd: newCvd });
    },
    [sl, tp, filterCvd, strategy, leverage, volMult, onApplyStrategy, runSingle]
  );

  const runGeneticOptimizer = useCallback(async () => {
    setLoading(true);
    setOptProgress(15);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/backtest/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          days: Math.min(30, Math.max(1, Number(days) || 7)),
          strategy_type: strategy,
          optimizer_mode: 'genetic',
          sl_min: Number(slMin) || 0.2,
          sl_max: Number(slMax) || 1.2,
          tp_min: Number(tpMin) || 0.5,
          tp_max: Number(tpMax) || 3.0,
          wall_min_usd: (Number(wallMinK) || 300) * 1000,
          wall_max_usd: (Number(wallMaxK) || 3000) * 1000,
          volume_multiplier: Number(volMult) || 1.0,
          leverage: Math.max(1, Math.round(Number(leverage) || 1)),
          maker_fee_pct: Number(makerFeePct) >= 0 ? Number(makerFeePct) : 0.02,
          taker_fee_pct: Number(takerFeePct) >= 0 ? Number(takerFeePct) : 0.05,
          slippage_ticks: Number(slippageTicks) >= 0 ? Number(slippageTicks) : 2,
          use_multi_tp: Boolean(useMultiTp),
          current_sl_pct: Number(sl) || 0.8,
          current_tp_pct: Number(tp) || 1.6,
          current_wall_usd: (Number(minWallK) || 300) * 1000,
          use_atr_filter: filterAtr,
          use_atr_sl: filterAtrSl,
          atr_multiplier: Number(atrMultiplier) || 1.5,
          use_cvd_filter: filterCvd,
          use_oi_filter: filterOi,
          use_rsi_filter: filterRsi,
          population_size: 14,
          generations: 5
        })
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
      setOptProgress(100);
      onResult({ ...data, symbol, timeframe, mode: 'grid' });
      setViewTab('optimizer');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [
    symbol,
    timeframe,
    days,
    strategy,
    slMin,
    slMax,
    tpMin,
    tpMax,
    wallMinK,
    wallMaxK,
    volMult,
    leverage,
    makerFeePct,
    takerFeePct,
    slippageTicks,
    useMultiTp,
    sl,
    tp,
    minWallK,
    filterAtr,
    filterAtrSl,
    atrMultiplier,
    filterCvd,
    filterOi,
    filterRsi,
    onResult
  ]);

  // AI Strategy Copilot State & Handlers
  const [aiPrompt, setAiPrompt] = useState(
    'Сделай консервативный сетап для скальпинга BTC на 5m с низким риском'
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  const runAiCopilot = useCallback(
    async (customPrompt = null) => {
      setAiLoading(true);
      setError(null);
      const p = customPrompt || aiPrompt;
      try {
        const res = await fetch(`${API_BASE}/ai/optimize-strategy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: p,
            symbol,
            timeframe,
            days: Math.min(30, Math.max(1, Number(days) || 7)),
            initial_capital: 10000.0
          })
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        setAiResult(data);
        onResult({
          ...data,
          symbol: data.parsed_strategy.symbol,
          timeframe: data.parsed_strategy.timeframe,
          mode: 'ai'
        });
        setViewTab('equity');
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setAiLoading(false);
      }
    },
    [aiPrompt, symbol, timeframe, days, onResult]
  );

  const applyAiSetup = useCallback(() => {
    const aiData = aiResult || result;
    if (!aiData?.parsed_strategy) return;
    const { strategy_type: st, params: p } = aiData.parsed_strategy;
    if (st) {
      setStrategy(st);
      if (onStrategyChange) onStrategyChange(st);
    }
    if (p.stop_loss_pct != null) setSl(p.stop_loss_pct);
    if (p.take_profit_pct != null) setTp(p.take_profit_pct);
    if (p.min_density_usd != null) setMinWallK(Math.round(p.min_density_usd / 1000));
    if (p.leverage != null) setLeverage(p.leverage);
    if (p.volume_multiplier != null) setVolMult(p.volume_multiplier);
    if (p.use_atr_filter != null) setFilterAtr(p.use_atr_filter);
    if (p.use_atr_sl != null) setFilterAtrSl(p.use_atr_sl);
    if (p.atr_multiplier != null) setAtrMultiplier(p.atr_multiplier);
    if (p.use_cvd_filter != null) setFilterCvd(p.use_cvd_filter);
    if (p.use_oi_filter != null) setFilterOi(p.use_oi_filter);
    if (p.use_rsi_filter != null) setFilterRsi(p.use_rsi_filter);

    setAppliedFeedback(
      `AI параметры применены: ${st} • SL ${p.stop_loss_pct}% • TP ${p.take_profit_pct}% • Плечо ${p.leverage}x`
    );
    setTimeout(() => setAppliedFeedback(null), 4000);

    if (onApplyStrategy) {
      onApplyStrategy({
        strategy: st,
        sl: p.stop_loss_pct,
        tp: p.take_profit_pct,
        minWallK: Math.round(p.min_density_usd / 1000),
        leverage: p.leverage,
        volMult: p.volume_multiplier
      });
    }
  }, [aiResult, result, onStrategyChange, onApplyStrategy]);

  const applyConfluenceSetup = useCallback(
    (item) => {
      const rec = item.recommended_filters || {};
      setFilterCvd(!!rec.use_cvd_filter);
      setFilterOi(!!rec.use_oi_filter);
      setFilterAtr(!!rec.use_atr_filter);
      const newWallK = rec.min_density_usd ? Math.round(rec.min_density_usd / 1000) : minWallK;
      const newVolMult = rec.volume_multiplier || volMult;
      setMinWallK(newWallK);
      setVolMult(newVolMult);
      setAppliedFeedback(`Связка "${item.condition_name}" применена к стратегии!`);
      setTimeout(() => setAppliedFeedback(null), 3500);

      if (onApplyStrategy) {
        onApplyStrategy({
          strategy,
          sl,
          tp,
          minWallK: newWallK,
          volMult: newVolMult,
          leverage,
          useCvd: !!rec.use_cvd_filter,
          useOi: !!rec.use_oi_filter,
          useAtr: !!rec.use_atr_filter
        });
      }

      setViewTab('trades');
      runSingle({ minWallK: newWallK });
    },
    [strategy, sl, tp, minWallK, volMult, leverage, onApplyStrategy, runSingle]
  );

  if (!isOpen) return null;

  const s = result?.summary;
  const mc = result?.monte_carlo;
  const beforeOpt = result?.before_optimization;
  const afterOpt = result?.after_optimization;
  const pnlTone = s ? (s.total_pnl_pct > 0 ? 'pos' : s.total_pnl_pct < 0 ? 'neg' : null) : null;
  const lastTrades = result?.trades ? [...result.trades].slice(-20).reverse() : [];
  const gridRows = result?.grid_results || [];
  const confluenceMatrix = result?.confluence_matrix || [];

  return (
    <div
      data-testid="backtest-panel"
      style={{ height: 345, backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
      className="absolute left-0 right-0 bottom-0 z-40 border-t shadow-[0_-8px_24px_rgba(0,0,0,0.65)] text-xs flex flex-col"
    >
      {/* Header */}
      <div
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-3 py-1 border-b shrink-0"
      >
        <div className="flex items-center space-x-2 font-bold text-white text-[11px] min-w-0">
          <BarChart3 size={13} className="text-[#38bdf8] shrink-0" />
          <span className="truncate">Квант-движок Бэктеста & Монте-Карло</span>
          <span className="font-mono text-[#38bdf8] bg-[#14171f] border border-[#1f2430] rounded px-1.5 shrink-0">
            {symbol}
          </span>

          {/* Mode Switcher */}
          <div className="flex items-center bg-[#08090c] p-0.5 rounded border border-[#1f2430] font-mono text-[9.5px] ml-2 shrink-0">
            <button
              data-testid="bt-mode-single"
              onClick={() => setMode('single')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition cursor-pointer ${
                mode === 'single' ? 'bg-[#2563eb] text-white font-bold' : 'text-[#787f91] hover:text-white'
              }`}
            >
              <Sliders size={10} />
              <span>Одиночный</span>
            </button>
            <button
              data-testid="bt-mode-optimizer"
              onClick={() => setMode('grid')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition cursor-pointer ${
                mode === 'grid' ? 'bg-[#a855f7] text-white font-bold' : 'text-[#787f91] hover:text-white'
              }`}
            >
              <Dna size={10} />
              <span>⚡ Оптимизатор параметров</span>
            </button>
            <button
              data-testid="bt-mode-ai"
              onClick={() => setMode('ai')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition cursor-pointer ${
                mode === 'ai' ? 'bg-[#06b6d4] text-black font-bold' : 'text-[#787f91] hover:text-white'
              }`}
            >
              <Sparkles size={10} />
              <span>AI Копилот</span>
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
              {result.meta.combinations_tested
                ? ` • Итераций генетики: ${result.meta.combinations_tested} (${result.meta.elapsed_ms || 320} мс)`
                : ''}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-[#60697b] hover:text-white shrink-0 cursor-pointer" title="Закрыть (B)">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Left Settings Column */}
        <div
          style={{ borderColor: 'var(--border-subtle)' }}
          className="w-[320px] shrink-0 p-2 border-r space-y-1.5 overflow-y-auto"
        >
          {mode === 'ai' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#06b6d4] uppercase tracking-wider flex items-center gap-1">
                  <Sparkles size={11} /> AI Ассистент стратегий
                </span>
                <span className="text-[9px] text-[#60697b] font-mono">NLP v2</span>
              </div>

              <label className="flex flex-col text-[9px] text-[#787f91] font-mono">
                <span className="mb-1 text-[#cbd5e1]">Опишите торговый сетап:</span>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="например: Консервативный сетап для скальпинга BTC на 5m с низким риском..."
                  rows={3}
                  className="w-full bg-[#08090c] border border-[#1f2430] focus:border-[#06b6d4] rounded p-1.5 text-white text-[10px] font-mono outline-none resize-none leading-relaxed"
                />
              </label>

              <div className="space-y-1">
                <div className="text-[8.5px] uppercase tracking-wider text-[#60697b] font-bold">Быстрые пресеты:</div>
                <div className="flex flex-col space-y-1">
                  {PRESET_CHIPS.map((chip) => (
                    <button
                      key={chip.text}
                      type="button"
                      onClick={() => {
                        setAiPrompt(chip.text);
                        runAiCopilot(chip.text);
                      }}
                      className="text-left text-[9px] bg-[#0c0e14] hover:bg-[#161a24] border border-[#1f2430] hover:border-[#06b6d460] text-[#94a3b8] hover:text-white rounded px-2 py-1 font-mono transition truncate cursor-pointer"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => runAiCopilot()}
                disabled={aiLoading}
                className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded disabled:opacity-60 text-black font-bold text-[11px] bg-[#06b6d4] hover:bg-[#22d3ee] transition shadow-xs cursor-pointer"
              >
                {aiLoading ? <Loader2 size={13} className="animate-spin text-black" /> : <Sparkles size={12} />}
                <span>{aiLoading ? 'AI анализирует и тестирует…' : '✨ Сгенерировать и протестировать'}</span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex space-x-1">
                {STRATEGIES.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => {
                      setStrategy(st.id);
                      if (onStrategyChange) onStrategyChange(st.id);
                    }}
                    className={`flex-1 px-1 py-1 rounded text-[9px] font-mono truncate transition cursor-pointer ${
                      strategy === st.id
                        ? 'bg-[#2563eb] text-white font-bold'
                        : 'bg-[#08090c] text-[#787f91] hover:text-white'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center space-x-1">
                <span className="text-[9px] text-[#787f91] font-mono shrink-0">ТФ:</span>
                <div className="flex flex-1 space-x-0.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`flex-1 py-0.5 rounded text-[9px] font-mono transition cursor-pointer ${
                        timeframe === tf
                          ? 'bg-[#2563eb] text-white font-bold'
                          : 'bg-[#08090c] text-[#787f91] hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'single' ? (
                <div className="grid grid-cols-3 gap-1">
                  <NumField label="Период" value={days} onChange={setDays} step={1} min={1} max={30} suffix="дн" />
                  <NumField label="SL" value={sl} onChange={setSl} step={0.1} min={0.1} suffix="%" />
                  <NumField label="TP" value={tp} onChange={setTp} step={0.1} min={0.1} suffix="%" />
                  <NumField label="Стенка" value={minWallK} onChange={setMinWallK} step={50} min={0} suffix="$k" />
                  <NumField label="Объём ×" value={volMult} onChange={setVolMult} step={0.1} min={0.5} />
                  <NumField label="Плечо" value={leverage} onChange={setLeverage} step={1} min={1} max={125} suffix="x" />
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="grid grid-cols-2 gap-1">
                    <NumField label="SL диапазон от" value={slMin} onChange={setSlMin} step={0.1} min={0.1} suffix="%" />
                    <NumField label="SL до (0.2–1.2%)" value={slMax} onChange={setSlMax} step={0.1} min={0.2} suffix="%" />
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <NumField label="TP диапазон от" value={tpMin} onChange={setTpMin} step={0.2} min={0.2} suffix="%" />
                    <NumField label="TP до (0.5–3.0%)" value={tpMax} onChange={setTpMax} step={0.2} min={0.5} suffix="%" />
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <NumField label="Стенка от" value={wallMinK} onChange={setWallMinK} step={100} min={0} suffix="$k" />
                    <NumField label="Стенка до" value={wallMaxK} onChange={setWallMaxK} step={250} min={100} suffix="$k" />
                    <NumField label="Период" value={days} onChange={setDays} step={1} min={1} max={30} suffix="дн" />
                  </div>
                </div>
              )}

              {/* ТАКТ 1: Realistic Execution Engine (Fees, Slippage Ticks, Multi-TP Scaling Out) */}
              <div
                style={{ backgroundColor: 'var(--bg-root)', borderColor: 'var(--border-subtle)' }}
                className="border rounded p-1.5 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase font-bold text-[#ffb300] tracking-wider">
                    ⚙️ Реализм исполнения (Fees & Slippage)
                  </span>
                  <label className="flex items-center space-x-1 text-[8.5px] font-mono text-[#26a69a] cursor-pointer">
                    <input
                      data-testid="toggle-multi-tp"
                      type="checkbox"
                      checked={useMultiTp}
                      onChange={(e) => setUseMultiTp(e.target.checked)}
                      className="w-3 h-3 rounded cursor-pointer"
                    />
                    <span>Multi-TP (50% + Б/У)</span>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <NumField
                    testId="input-maker-fee"
                    label="Maker Fee"
                    value={makerFeePct}
                    onChange={setMakerFeePct}
                    step={0.01}
                    min={0}
                    max={0.5}
                    suffix="%"
                  />
                  <NumField
                    testId="input-taker-fee"
                    label="Taker Fee"
                    value={takerFeePct}
                    onChange={setTakerFeePct}
                    step={0.01}
                    min={0}
                    max={0.5}
                    suffix="%"
                  />
                  <NumField
                    testId="input-slippage-ticks"
                    label="Скольжение"
                    value={slippageTicks}
                    onChange={setSlippageTicks}
                    step={1}
                    min={0}
                    max={10}
                    suffix="тик"
                  />
                </div>
              </div>

              {/* Confluence Filter Suite */}
              <div
                style={{ backgroundColor: 'var(--bg-root)', borderColor: 'var(--border-subtle)' }}
                className="border rounded p-1.5 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[9px] uppercase font-bold text-[#38bdf8] tracking-wider flex items-center gap-1">
                    <Sliders size={10} /> Фильтры Confluence
                  </span>
                  <span className="text-[8.5px] text-[#60697b] font-mono">
                    {[filterCvd, filterOi, filterAtr, filterRsi].filter(Boolean).length}/4
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1 text-[8.5px] font-mono">
                  {[
                    { label: 'CVD', active: filterCvd, toggle: () => setFilterCvd(!filterCvd) },
                    { label: 'OI', active: filterOi, toggle: () => setFilterOi(!filterOi) },
                    { label: 'ATR', active: filterAtr, toggle: () => setFilterAtr(!filterAtr) },
                    { label: 'RSI', active: filterRsi, toggle: () => setFilterRsi(!filterRsi) }
                  ].map((f) => (
                    <button
                      key={f.label}
                      type="button"
                      onClick={f.toggle}
                      className={`py-0.5 px-1 rounded border text-center transition cursor-pointer ${
                        f.active
                          ? 'bg-[#2563eb25] text-[#38bdf8] border-[#2563eb60] font-bold'
                          : 'bg-[#08090c] text-[#787f91] border-transparent hover:text-white'
                      }`}
                    >
                      {f.label}: {f.active ? 'ON' : 'OFF'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Run Button + Real-Time Genetic Progress Bar */}
              {mode === 'grid' ? (
                <div className="space-y-1">
                  <button
                    data-testid="btn-run-genetic"
                    onClick={runGeneticOptimizer}
                    disabled={loading}
                    className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded disabled:opacity-60 text-white font-bold text-[10.5px] bg-[#9333ea] hover:bg-[#7e22ce] transition shadow-xs cursor-pointer"
                  >
                    {loading ? <Loader2 size={13} className="animate-spin" /> : <Dna size={12} />}
                    <span>
                      {loading
                        ? `Генетический отбор (${optProgress}%)…`
                        : '🧬 Запустить генетический подбор лучшего сетапа'}
                    </span>
                  </button>
                  {(loading || optProgress === 100) && (
                    <div
                      data-testid="genetic-progress-bar"
                      className="w-full h-1.5 bg-[#090b10] rounded overflow-hidden border border-[#1f2430]"
                    >
                      <div
                        style={{ width: `${optProgress}%` }}
                        className="h-full bg-gradient-to-r from-[#9333ea] to-[#38bdf8] transition-all duration-150"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <button
                  data-testid="btn-run-single"
                  onClick={() => runSingle()}
                  disabled={loading}
                  className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded disabled:opacity-60 text-white font-bold text-[10.5px] bg-[#2563eb] hover:bg-[#1d4ed8] transition shadow-xs cursor-pointer"
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
                  <span>{loading ? 'Расчёт бэктеста и Монте-Карло…' : 'Запустить тест'}</span>
                </button>
              )}
            </>
          )}

          {error && (
            <div className="flex items-start space-x-1 text-[10px] text-[#ef5350] bg-[#ef535014] border border-[#ef535040] rounded p-1.5 font-mono">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </div>

        {/* Right Results Column */}
        <div className="flex-1 min-w-0 p-2 flex flex-col space-y-1.5 overflow-hidden">
          {!s && !loading && !aiLoading && (
            <div className="flex-1 flex items-center justify-center text-[#60697b] text-[11px] font-mono">
              {mode === 'ai'
                ? 'Опишите торговую стратегию и нажмите «✨ Сгенерировать и протестировать»'
                : mode === 'grid'
                ? 'Нажмите «🧬 Запустить генетический подбор лучшего сетапа» (50–100 итераций < 3 сек)'
                : 'Настройте комиссии, скольжение и параметры и нажмите «Запустить тест»'}
            </div>
          )}

          {(loading || aiLoading) && (
            <div className="flex-1 flex flex-col items-center justify-center text-[#38bdf8] text-[11px] font-mono space-y-2">
              <div className="flex items-center">
                <Loader2 size={16} className="animate-spin mr-2" />
                <span>
                  {aiLoading
                    ? '🤖 AI парсит требования, подбирает фильтры Order Flow и проводит бэктест…'
                    : mode === 'grid'
                    ? '🧬 Эволюционный отбор геномов (Sharpe/Sortino, штраф за Max DD > 5%) + 500 симуляций Монте-Карло…'
                    : 'Загрузка истории Binance, расчёт комиссий Maker/Taker и 500 прогонов Монте-Карло…'}
                </span>
              </div>
            </div>
          )}

          {s && !loading && !aiLoading && (
            <>
              {/* Top Summary Metrics Row: Чистый PnL, WinRate, Profit Factor, Recovery Factor, Комиссии биржи */}
              <div className="flex space-x-1.5 min-w-0 shrink-0">
                <Card
                  testId="metric-net-pnl"
                  label="Чистый PnL (с уч. ком.)"
                  value={`${s.total_pnl_pct > 0 ? '+' : ''}${s.total_pnl_pct}% ($${s.net_pnl_usd ?? result?.net_pnl ?? 0})`}
                  tone={pnlTone}
                  sub={`До комиссий: $${s.gross_pnl_usd ?? s.net_pnl_usd ?? 0} (${s.gross_pnl_pct ?? s.total_pnl_pct}%)`}
                />
                <Card
                  testId="metric-winrate"
                  label="Win Rate"
                  value={`${s.win_rate_pct}%`}
                  tone={s.win_rate_pct >= 50 ? 'pos' : null}
                  sub={`${s.winning_trades}W / ${s.losing_trades}L (${s.total_trades} сд.)`}
                />
                <Card
                  testId="metric-pf"
                  label="Profit Factor"
                  value={s.profit_factor >= 999 ? '∞' : s.profit_factor}
                  tone={s.profit_factor >= 1 ? 'pos' : 'neg'}
                  sub={`Sharpe ${s.sharpe_ratio} • Sortino ${s.sortino_ratio ?? 0}`}
                />
                <Card
                  testId="metric-recovery-factor"
                  label="Recovery Factor"
                  value={s.recovery_factor ?? result?.recovery_factor ?? 0}
                  tone={(s.recovery_factor ?? 0) >= 1.0 ? 'pos' : null}
                  sub={`Max DD: -${s.max_drawdown_pct}%`}
                />
                <Card
                  testId="metric-fees-paid"
                  label="Уплачено бирже ($)"
                  value={`$${(s.total_exchange_cost_usd ?? s.total_fees_usd ?? 0).toFixed(2)}`}
                  tone="warn"
                  sub={`Комиссии: $${(s.total_fees_usd ?? 0).toFixed(2)} • Слип: $${(s.total_slippage_usd ?? 0).toFixed(2)}`}
                />
                <button
                  onClick={onToggleSignals}
                  className={`flex flex-col items-center justify-center px-2 rounded border text-[10px] font-mono shrink-0 transition cursor-pointer ${
                    showSignals
                      ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]'
                      : 'text-[#60697b] border-[#1f2430] hover:text-white'
                  }`}
                  title="Показать / скрыть сигналы на графике"
                >
                  {showSignals ? <Eye size={13} /> : <EyeOff size={13} />}
                  <span>{showSignals ? 'Сигналы' : 'Скрыты'}</span>
                </button>
              </div>

              {/* Sub-navigation Tabs: Equity & Monte Carlo | Genetic Optimizer Before/After | Trades | Confluence Matrix */}
              <div className="flex items-center justify-between py-0.5 border-b border-[#1f2430] shrink-0">
                <div className="flex items-center space-x-1 font-mono text-[9.5px]">
                  <button
                    data-testid="tab-equity-mc"
                    onClick={() => setViewTab('equity')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                      viewTab === 'equity'
                        ? 'bg-[#2563eb] text-white font-bold'
                        : 'text-[#787f91] hover:text-white bg-[#08090c]'
                    }`}
                  >
                    <TrendingUp size={10} />
                    <span>📈 Эквити & Монте-Карло (500)</span>
                  </button>

                  {(beforeOpt || gridRows.length > 0) && (
                    <button
                      data-testid="tab-optimizer-results"
                      onClick={() => setViewTab('optimizer')}
                      className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                        viewTab === 'optimizer'
                          ? 'bg-[#a855f7] text-white font-bold'
                          : 'text-[#787f91] hover:text-white bg-[#08090c]'
                      }`}
                    >
                      <Dna size={10} />
                      <span>🧬 До / После & Топ сетапов ({gridRows.length})</span>
                    </button>
                  )}

                  <button
                    data-testid="tab-trades"
                    onClick={() => setViewTab('trades')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      viewTab === 'trades'
                        ? 'bg-[#2563eb] text-white font-bold'
                        : 'text-[#787f91] hover:text-white bg-[#08090c]'
                    }`}
                  >
                    📋 Сделки ({lastTrades.length})
                  </button>

                  <button
                    data-testid="tab-matrix"
                    onClick={() => setViewTab('matrix')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                      viewTab === 'matrix'
                        ? 'bg-[#26a69a] text-black font-bold'
                        : 'text-[#787f91] hover:text-white bg-[#08090c]'
                    }`}
                  >
                    <span>🧩 Матрица связок ({confluenceMatrix.length})</span>
                  </button>
                </div>

                {/* Monte Carlo Verdict Badge Always Visible in Bar */}
                {mc && (
                  <span
                    data-testid="mc-verdict-badge"
                    className={`px-2 py-0.5 rounded font-mono font-bold text-[9.5px] border ${
                      mc.verdict === 'ROBUST'
                        ? 'bg-[#052e16] text-[#4ade80] border-[#22c55e60]'
                        : 'bg-[#422006] text-[#fbbf24] border-[#f59e0b60]'
                    }`}
                    title={mc.reason}
                  >
                    {mc.badge_text} (Score: {mc.robustness_score}/100)
                  </span>
                )}
              </div>

              {/* View Body */}
              <div
                style={{ borderColor: 'var(--border-subtle)' }}
                className="flex-1 min-h-0 overflow-y-auto border rounded bg-[#080a0f]"
              >
                {viewTab === 'equity' && (
                  <div className="h-full flex gap-2 p-2 min-h-0">
                    {/* Left: Interactive SVG Equity Curve + Monte Carlo Fan Cloud */}
                    <div className="flex-1 h-full border border-[#161a26] rounded bg-[#06080d] p-1 min-w-0">
                      <MonteCarloEquityChart
                        fanChart={mc?.fan_chart || []}
                        samplePaths={mc?.sample_paths || []}
                        initialCapital={result?.meta?.initial_capital || 10000}
                      />
                    </div>

                    {/* Right: Monte Carlo Stress-Test Scenarios & Robustness Verdict */}
                    {mc && (
                      <div
                        data-testid="monte-carlo-report"
                        className="w-[295px] shrink-0 flex flex-col justify-between border border-[#161a26] rounded bg-[#0b0e17] p-2 font-mono text-[10px]"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between border-b border-[#191f2e] pb-1">
                            <span className="font-bold text-white flex items-center gap-1">
                              <ShieldCheck size={12} className="text-[#38bdf8]" />
                              Стресс-тест Монте-Карло ({mc.simulations_count})
                            </span>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-[#94a3b8]">Вероятность просадки &gt; 10%:</span>
                            <b
                              data-testid="mc-prob-dd10"
                              className={mc.prob_drawdown_gt_10_pct > 25 ? 'text-[#ef5350]' : 'text-[#26a69a]'}
                            >
                              {mc.prob_drawdown_gt_10_pct}%
                            </b>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-[#94a3b8]">Ожидаемый худший DD (95%):</span>
                            <b data-testid="mc-worst-dd" className="text-[#ef5350]">
                              -{mc.worst_case_dd_pct}%
                            </b>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-[#94a3b8]">Медианный PnL:</span>
                            <b
                              data-testid="mc-median-pnl"
                              className={mc.median_pnl_pct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}
                            >
                              {mc.median_pnl_pct >= 0 ? '+' : ''}
                              {mc.median_pnl_pct}% (${mc.median_pnl_usd})
                            </b>
                          </div>

                          <div className="flex justify-between py-0.5">
                            <span className="text-[#94a3b8]">Диапазон PnL (P5 .. P95):</span>
                            <span className="text-[#cbd5e1]">
                              {mc.p5_pnl_pct}% .. +{mc.p95_pnl_pct}%
                            </span>
                          </div>
                        </div>

                        <div className="text-[9px] text-[#94a3b8] bg-[#07090e] p-1.5 rounded border border-[#161a26] leading-snug">
                          {mc.reason}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {viewTab === 'optimizer' && (
                  <div className="p-2 space-y-2">
                    {/* Cards: До оптимизации vs После оптимизации */}
                    {beforeOpt && afterOpt && (
                      <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                        <div
                          data-testid="card-before-opt"
                          className="border border-[#1f2430] rounded bg-[#0c0f17] p-2 space-y-1"
                        >
                          <div className="flex items-center justify-between border-b border-[#191f2e] pb-1">
                            <span className="text-[#94a3b8] font-bold uppercase text-[9px]">
                              До оптимизации (Базовый сетап)
                            </span>
                            <span className="text-[#64748b] text-[9px]">
                              SL {beforeOpt.stop_loss_pct}% • TP {beforeOpt.take_profit_pct}% • Стенка $
                              {Math.round(beforeOpt.min_density_usd / 1000)}k
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1 pt-0.5">
                            <div>
                              <div className="text-[8.5px] text-[#64748b]">Чистый PnL</div>
                              <div
                                className={`font-bold ${
                                  beforeOpt.total_pnl_pct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                                }`}
                              >
                                {beforeOpt.total_pnl_pct >= 0 ? '+' : ''}
                                {beforeOpt.total_pnl_pct}%
                              </div>
                            </div>
                            <div>
                              <div className="text-[8.5px] text-[#64748b]">WinRate</div>
                              <div className="text-white font-bold">{beforeOpt.win_rate_pct}%</div>
                            </div>
                            <div>
                              <div className="text-[8.5px] text-[#64748b]">Sharpe / PF</div>
                              <div className="text-white font-bold">
                                {beforeOpt.sharpe_ratio} / {beforeOpt.profit_factor}
                              </div>
                            </div>
                            <div>
                              <div className="text-[8.5px] text-[#64748b]">Max DD</div>
                              <div className="text-[#ef5350] font-bold">-{beforeOpt.max_drawdown_pct}%</div>
                            </div>
                          </div>
                        </div>

                        <div
                          data-testid="card-after-opt"
                          className="border border-[#a855f780] rounded bg-[#150d24] p-2 space-y-1"
                        >
                          <div className="flex items-center justify-between border-b border-[#2e1a47] pb-1">
                            <span className="text-[#e9d5ff] font-bold uppercase text-[9px] flex items-center gap-1">
                              <Dna size={11} className="text-[#c084fc]" />
                              После генетической оптимизации
                            </span>
                            <button
                              data-testid="btn-apply-best-setup"
                              onClick={() => applySetup(afterOpt)}
                              className="px-2 py-0.5 rounded bg-[#9333ea] hover:bg-[#7e22ce] text-white font-bold text-[9px] transition cursor-pointer"
                            >
                              Применить лучший
                            </button>
                          </div>
                          <div className="grid grid-cols-4 gap-1 pt-0.5">
                            <div>
                              <div className="text-[8.5px] text-[#c084fc]">Чистый PnL</div>
                              <div
                                className={`font-bold ${
                                  afterOpt.total_pnl_pct >= 0 ? 'text-[#4ade80]' : 'text-[#ef5350]'
                                }`}
                              >
                                {afterOpt.total_pnl_pct >= 0 ? '+' : ''}
                                {afterOpt.total_pnl_pct}%
                              </div>
                            </div>
                            <div>
                              <div className="text-[8.5px] text-[#c084fc]">WinRate</div>
                              <div className="text-white font-bold">{afterOpt.win_rate_pct}%</div>
                            </div>
                            <div>
                              <div className="text-[8.5px] text-[#c084fc]">Sharpe / Sortino</div>
                              <div className="text-[#38bdf8] font-bold">
                                {afterOpt.sharpe_ratio} / {afterOpt.sortino_ratio ?? 0}
                              </div>
                            </div>
                            <div>
                              <div className="text-[8.5px] text-[#c084fc]">Max DD</div>
                              <div className="text-[#fbbf24] font-bold">-{afterOpt.max_drawdown_pct}%</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Genetic Leaderboard Table */}
                    {gridRows.length > 0 && (
                      <table className="w-full text-[10px] font-mono-numbers">
                        <thead
                          style={{ backgroundColor: 'var(--bg-panel)' }}
                          className="sticky top-0 text-[#60697b] text-[8.5px] uppercase"
                        >
                          <tr>
                            <th className="text-left px-2 py-1">#</th>
                            <th className="text-right px-2">SL %</th>
                            <th className="text-right px-2">TP %</th>
                            <th className="text-right px-2">Wall $</th>
                            <th className="text-center px-2">CVD / ATR</th>
                            <th className="text-right px-2">WinRate</th>
                            <th className="text-right px-2">Чистый PnL</th>
                            <th className="text-right px-2">Max DD</th>
                            <th className="text-right px-2">Sharpe</th>
                            <th className="text-center px-2">Действие</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#13161f]">
                          {gridRows.slice(0, 15).map((row) => (
                            <tr
                              key={row.rank}
                              className={`hover:bg-[#161922] ${row.rank === 1 ? 'bg-[#9333ea18]' : ''}`}
                            >
                              <td className="px-2 py-1 font-bold text-[#a855f7]">#{row.rank}</td>
                              <td className="px-2 text-right text-white font-mono">{row.stop_loss_pct}%</td>
                              <td className="px-2 text-right text-[#cbd5e1] font-mono">{row.take_profit_pct}%</td>
                              <td className="px-2 text-right text-[#ffb300] font-mono">
                                ${(row.min_density_usd / 1000).toFixed(0)}k
                              </td>
                              <td className="px-2 text-center text-[#94a3b8] font-mono">
                                {row.use_cvd_filter ? 'CVD:ON' : 'CVD:OFF'} • ATR({row.atr_period || 14})
                              </td>
                              <td className="px-2 text-right text-[#d1d4dc] font-mono">{row.win_rate_pct}%</td>
                              <td
                                className={`px-2 text-right font-bold font-mono ${
                                  row.total_pnl_pct >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                                }`}
                              >
                                {row.total_pnl_pct >= 0 ? '+' : ''}
                                {row.total_pnl_pct}%
                              </td>
                              <td className="px-2 text-right text-[#ef5350] font-mono">-{row.max_drawdown_pct}%</td>
                              <td className="px-2 text-right font-bold text-[#38bdf8] font-mono">
                                {row.sharpe_ratio}
                              </td>
                              <td className="px-2 text-center">
                                <button
                                  onClick={() => applySetup(row)}
                                  className="px-2 py-0.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-[9px] transition cursor-pointer"
                                >
                                  Применить
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {viewTab === 'trades' && (
                  <table className="w-full text-[10px] font-mono-numbers">
                    <thead
                      style={{ backgroundColor: 'var(--bg-panel)' }}
                      className="sticky top-0 text-[#60697b] text-[8.5px] uppercase"
                    >
                      <tr>
                        <th className="text-left px-2 py-1">#</th>
                        <th className="text-left px-2">Тип</th>
                        <th className="text-left px-2">Вход</th>
                        <th className="text-right px-2">Цена вх.</th>
                        <th className="text-right px-2">Цена вых.</th>
                        <th className="text-right px-2">Gross $</th>
                        <th className="text-right px-2">Комиссия+Слип</th>
                        <th className="text-right px-2">Чистый PnL</th>
                        <th className="text-left px-2">Выход</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#13161f]">
                      {lastTrades.map((t) => (
                        <tr key={t.id} className="hover:bg-[#161922]">
                          <td className="px-2 py-0.5 text-[#60697b]">{t.id}</td>
                          <td
                            className={`px-2 font-bold ${
                              t.type === 'BUY' ? 'text-[#26a69a]' : 'text-[#ef5350]'
                            }`}
                          >
                            {t.type}
                          </td>
                          <td className="px-2 text-[#787f91]">{fmtTime(t.entry_time)}</td>
                          <td className="px-2 text-right text-white">{fmtPrice(t.entry_price)}</td>
                          <td className="px-2 text-right text-[#787f91]">{fmtPrice(t.exit_price)}</td>
                          <td className="px-2 text-right text-[#cbd5e1]">
                            ${(t.gross_pnl_usd ?? t.pnl_usd).toFixed(2)}
                          </td>
                          <td className="px-2 text-right text-[#ffb300]">
                            -${((t.fee_paid_usd || 0) + (t.slippage_cost_usd || 0)).toFixed(2)}
                          </td>
                          <td
                            className={`px-2 text-right font-bold ${
                              t.pnl_usd >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                            }`}
                          >
                            {t.pnl_usd >= 0 ? '+' : ''}${t.pnl_usd} ({t.pnl_pct >= 0 ? '+' : ''}
                            {t.pnl_pct}%)
                          </td>
                          <td className="px-2 text-[#94a3b8]">{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {viewTab === 'matrix' && (
                  <table className="w-full text-[10px] font-mono-numbers">
                    <thead
                      style={{ backgroundColor: 'var(--bg-panel)' }}
                      className="sticky top-0 text-[#60697b] text-[8.5px] uppercase z-10"
                    >
                      <tr>
                        <th className="text-left px-2 py-1">Условие / Связка факторов</th>
                        <th className="text-right px-2">Сделок</th>
                        <th className="text-right px-2">WinRate</th>
                        <th className="text-right px-2">PF</th>
                        <th className="text-right px-2">Ср. PnL</th>
                        <th className="text-center px-2">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#13161f]">
                      {confluenceMatrix.map((item, idx) => (
                        <tr key={idx} className="hover:bg-[#161922]">
                          <td className="px-2 py-1 font-bold text-white truncate max-w-[260px]">
                            {item.condition_name}
                          </td>
                          <td className="px-2 text-right text-[#cbd5e1]">{item.total_trades}</td>
                          <td className="px-2 text-right font-bold text-[#26a69a]">{item.win_rate_pct}%</td>
                          <td className="px-2 text-right text-white">{item.profit_factor}</td>
                          <td className="px-2 text-right text-[#38bdf8]">{item.avg_pnl_pct}%</td>
                          <td className="px-2 text-center">
                            <button
                              onClick={() => applyConfluenceSetup(item)}
                              className="px-2 py-0.5 rounded bg-[#26a69a] hover:bg-[#2dd4bf] text-black font-bold text-[9px] transition cursor-pointer"
                            >
                              Включить
                            </button>
                          </td>
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
