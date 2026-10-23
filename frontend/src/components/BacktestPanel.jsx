import React, { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { useBacktestStore } from '../stores/backtestStore';
import { buildResearchVerdict } from '../utils/researchVerdict';
import {
  BarChart3,
  Play,
  Loader2,
  Eye,
  EyeOff,
  X,
  AlertTriangle,
  Sliders,
  Sparkles,
  Check,
  TrendingUp,
  ShieldCheck,
  Dna,
  Download,
  FileCode2,
  ArrowUpDown,
  Zap
} from 'lucide-react';
import { LivePaperTradingControls, LivePaperTradingResults } from './LivePaperTradingView';
const PilotDialog = lazy(() => import('../features/pilot/PilotWorkspace.jsx'));
import BacktestTradeTimeline from './BacktestTradeTimeline';
import MonteCarloEquityChart from './backtest/MonteCarloEquityChart';
import BacktestTradesTable from './backtest/BacktestTradesTable';
import BacktestPresetsBar from './backtest/BacktestPresetsBar';
import BacktestParametersForm from './backtest/BacktestParametersForm';
import BacktestOptimizerView from './backtest/BacktestOptimizerView';
import { STRATEGIES, TIMEFRAMES } from './backtest/constants';
import { InfoTip } from './backtest/fields';

const API_BASE = '/api';

const PRESET_CHIPS = [
  { label: '🛡️ Консервативный BTC (5m)', text: 'Сделай консервативный сетап для скальпинга BTC на 5m с низким риском' },
  { label: '⚡ Агрессивный импульс CVD', text: 'Агрессивный лонг по поглощению дельты CVD с коротким стопом и плечом 5х' },
  { label: '🧱 Отскок от объёмного кластера (1m)', text: 'Скальпинг отскока от объёмного кластера на 1m со стопом 0.4% и тейком 1.2%' },
  { label: '🎯 Сбалансированный ETH (15m)', text: 'Сбалансированная стратегия на ETH 15m с ATR фильтром и RSI' }
];

// STRATEGIES / TIMEFRAMES вынесены в ./backtest/constants (модульный план, п.2)

function Card({ label, value, tone, sub, testId, isLarge = false }) {
  const color =
    tone === 'pos'
      ? 'text-[#34d399]'
      : tone === 'neg'
      ? 'text-[#f87171]'
      : tone === 'warn'
      ? 'text-[#fbbf24]'
      : 'text-neutral-100';
  return (
    <div
      data-testid={testId}
      className={`flex-1 min-w-[90px] border border-neutral-800/90 rounded-md px-2.5 py-1.5 bg-[#0e1217]/90 shadow-sm flex flex-col justify-between transition hover:border-neutral-700 ${
        isLarge ? 'bg-gradient-to-b from-[#141822] to-[#090c12] border-neutral-700/80 shadow-md ring-1 ring-white/5' : ''
      }`}
    >
      <div className="text-[8.5px] uppercase text-neutral-400 font-bold tracking-wider truncate flex items-center justify-between">
        <span>{label}</span>
      </div>
      <div className={`text-[15px] font-extrabold font-mono leading-snug tracking-tight my-0.5 ${color} truncate`}>
        {value}
      </div>
      {sub && <div className="text-[8px] text-neutral-500 font-mono truncate">{sub}</div>}
    </div>
  );
}

// InfoTip / NumField вынесены в ./backtest/fields (модульный план, п.2)

export function formatBacktestError(rawError) {
  if (!rawError) return null;
  let str = typeof rawError === 'object' && rawError.message ? rawError.message : String(rawError);

  // If it's a JSON string, try to parse Pydantic error details
  if (str.startsWith('{') || str.startsWith('[')) {
    try {
      const parsed = JSON.parse(str);
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.detail) ? parsed.detail : null);
      if (items && items.length > 0) {
        const msgs = items.map((it) => {
          const loc = Array.isArray(it.loc) ? it.loc.join('.') : '';
          const msg = it.msg || it.message || '';
          if (loc.includes('stop_loss') || loc.includes('sl')) {
            return 'Стоп-лосс (SL) должен быть больше 0% (рекомендуется от 0.1% до 15%)';
          }
          if (loc.includes('take_profit') || loc.includes('tp')) {
            return 'Тейк-профит (TP) должен быть больше 0% (рекомендуется от 0.2% до 30%)';
          }
          if (loc.includes('leverage')) {
            return 'Кредитное плечо должно быть в диапазоне от 1x до 125x';
          }
          if (loc.includes('days')) {
            return 'Период истории должен быть от 1 до 30 дней';
          }
          if (loc.includes('strategy_type') || loc.includes('strategy')) {
            return 'Выбранная стратегия не поддерживается для исторического бэктеста';
          }
          if (loc.includes('min_density_usd') || loc.includes('wall')) {
            return 'Минимальная плотность должна быть положительным числом';
          }
          return msg || loc;
        });
        return msgs.join('. ');
      } else if (parsed && typeof parsed.detail === 'string') {
        str = parsed.detail;
      }
    } catch (_) {
      // Not valid JSON, keep str
    }
  }

  if (str.includes('strategy_type must be one of')) {
    return 'Выбранная стратегия не поддерживается для исторического бэктеста. Выберите стратегию из списка поддерживаемых.';
  }
  if (str.includes('live_density_bounce') || str.includes('Только Live L2') || str.includes('L2 Live')) {
    return 'Стратегия «Плотность стакана L2 [Live]» работает исключительно в режиме реального времени. Выберите «Cluster Volume Bounce» или «Квант-Конфлюенс» для исторического бэктеста.';
  }
  if (str.includes('Input should be greater than 0') && (str.includes('stop_loss') || str.includes('sl'))) {
    return 'Стоп-лосс (SL) должен быть больше 0% (рекомендуется от 0.1% до 15%)';
  }
  if (str.includes('Input should be greater than 0') && (str.includes('take_profit') || str.includes('tp'))) {
    return 'Тейк-профит (TP) должен быть больше 0% (рекомендуется от 0.2% до 30%)';
  }
  if (str.includes('Input should be greater than or equal to 1') && str.includes('leverage')) {
    return 'Кредитное плечо должно быть в диапазоне от 1x до 125x';
  }
  if (str.includes('Failed to fetch') || str.includes('NetworkError')) {
    return 'Ошибка сетевого подключения к квант-серверу API.';
  }

  return str;
}

export default function BacktestPanel({
  isOpen,
  onClose,
  symbol,
  result: propResult,
  onResult,
  showSignals,
  onToggleSignals,
  onApplyStrategy,
  onStrategyChange,
  onProjectPositionSetup
}) {
  const storeResult = useBacktestStore((s) => s.activeResult);
  const getParamsForSymbol = useBacktestStore((s) => s.getParamsForSymbol);
  const setParamsForSymbol = useBacktestStore((s) => s.setParamsForSymbol);

  const result = (propResult?.symbol === symbol?.toUpperCase() ? propResult : null) || (storeResult?.symbol === symbol?.toUpperCase() ? storeResult : null) || propResult || storeResult;

  const handleSetResult = useCallback((data) => {
    if (onResult) onResult(data);
    useBacktestStore.setState({ activeResult: data });
  }, [onResult]);

  const updateSymbolParam = useCallback((partial) => {
    if (symbol && setParamsForSymbol) {
      setParamsForSymbol(symbol, partial);
    }
  }, [symbol, setParamsForSymbol]);

  const storeMode = useBacktestStore((s) => s.mode);
  const setStoreMode = useBacktestStore((s) => s.setMode);
  const [mode, setLocalMode] = useState(storeMode || 'single');
  const setMode = useCallback((m) => {
    setLocalMode(m);
    if (setStoreMode) setStoreMode(m);
  }, [setStoreMode]);

  useEffect(() => {
    if (storeMode && storeMode !== mode) {
      setLocalMode(storeMode);
    }
  }, [storeMode]);
  const [strategy, setStrategy] = useState('delta_absorption');
  const [timeframe, setTimeframe] = useState('5m');
  const [days, setDays] = useState(14);
  const [sl, setSl] = useState(0.8);
  const [tp, setTp] = useState(1.6);
  const [minWallK, setMinWallK] = useState(100);
  const [volMult, setVolMult] = useState(1.0);
  const [leverage, setLeverage] = useState(2);
  // M5.2: EMA-периоды для ema_trend (Quant Sweep apply); 20/50 — legacy-поведение движка
  const [fastEma, setFastEma] = useState(20);
  const [slowEma, setSlowEma] = useState(50);

  // Sync isolated parameters per symbol when symbol changes
  useEffect(() => {
    if (!symbol || !getParamsForSymbol) return;
    const p = getParamsForSymbol(symbol);
    if (p.strategy_type) setStrategy(p.strategy_type);
    if (p.timeframe && TIMEFRAMES.includes(p.timeframe)) setTimeframe(p.timeframe);
    if (p.days != null) setDays(Number(p.days));
    if (p.stop_loss_pct != null) setSl(Number(p.stop_loss_pct));
    if (p.take_profit_pct != null) setTp(Number(p.take_profit_pct));
    if (p.min_density_usd != null) setMinWallK(Math.round(Number(p.min_density_usd) / 1000));
    if (p.volume_multiplier != null) setVolMult(Number(p.volume_multiplier));
    if (p.leverage != null) setLeverage(Number(p.leverage));
    if (p.entryMode) setEntryMode(p.entryMode);
    if (p.slMode) setSlMode(p.slMode);
    if (p.wallSlOffsetTicks != null) setWallSlOffsetTicks(Number(p.wallSlOffsetTicks));
    if (p.tp1RrRatio != null) setTp1RrRatio(Number(p.tp1RrRatio));
    if (p.tp2Mode) setTp2Mode(p.tp2Mode);
    if (p.tp2RrRatio != null) setTp2RrRatio(Number(p.tp2RrRatio));
    if (p.minWallLifetimeSec != null) setMinWallLifetimeSec(Number(p.minWallLifetimeSec));
    if (p.use_atr_filter != null) setFilterAtr(Boolean(p.use_atr_filter));
    if (p.use_atr_sl != null) setFilterAtrSl(Boolean(p.use_atr_sl));
    if (p.atr_multiplier != null) setAtrMultiplier(Number(p.atr_multiplier));
    if (p.use_cvd_filter != null) setFilterCvd(Boolean(p.use_cvd_filter));
    if (p.use_oi_filter != null) setFilterOi(Boolean(p.use_oi_filter));
    if (p.use_rsi_filter != null) setFilterRsi(Boolean(p.use_rsi_filter));
    if (p.fast_period != null) setFastEma(Number(p.fast_period));
    if (p.slow_period != null) setSlowEma(Number(p.slow_period));
  }, [symbol, getParamsForSymbol]);

  // M5.2: 1-клик apply из Quant Sweep (AI Copilot sidebar → сюда)
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      if (!d.symbol || d.symbol.toUpperCase() !== (symbol || '').toUpperCase()) return;
      if (d.strategy_type) setStrategy(d.strategy_type);
      if (d.timeframe && TIMEFRAMES.includes(d.timeframe)) setTimeframe(d.timeframe);
      if (d.fast_period != null) {
        setFastEma(Number(d.fast_period));
        updateSymbolParam({ fast_period: Number(d.fast_period) });
      }
      if (d.slow_period != null) {
        setSlowEma(Number(d.slow_period));
        updateSymbolParam({ slow_period: Number(d.slow_period) });
      }
      setAppliedFeedback(
        `🏆 Sweep #${d.rank ?? '?'} применён: стратегия ${d.strategy_type || 'ema_trend'} • EMA ${d.fast_period}/${d.slow_period}`
      );
    };
    window.addEventListener('apply-sweep-strategy', handler);
    return () => window.removeEventListener('apply-sweep-strategy', handler);
  }, [symbol, updateSymbolParam]);

  // ТАКТ 1.2: Расширенные параметры стратегии (Entry Mode, Dynamic SL, Multi-TP, Wall Lifetime)
  const [entryMode, setEntryMode] = useState('limit_bounce'); // 'limit_bounce' | 'breakout' | 'cvd_absorption'
  const [slMode, setSlMode] = useState('behind_wall'); // 'fixed_pct' | 'behind_wall' | 'atr_volatility'
  const [wallSlOffsetTicks, setWallSlOffsetTicks] = useState(5);
  const [tp1RrRatio, setTp1RrRatio] = useState(1.5);
  const [tp2Mode, setTp2Mode] = useState('opposite_wall'); // 'opposite_wall' | 'trend_rr'
  const [tp2RrRatio, setTp2RrRatio] = useState(2.8);
  const [minWallLifetimeSec, setMinWallLifetimeSec] = useState(30);

  // ТАКТ 1: Realistic Execution Engine parameters
  const [makerFeePct, setMakerFeePct] = useState(0.02);
  const [takerFeePct, setTakerFeePct] = useState(0.05);
  const [slippageTicks, setSlippageTicks] = useState(2);
  const [useMultiTp, setUseMultiTp] = useState(true);
  const [currentRegime, setCurrentRegime] = useState('NO_DATA');

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

  // Handlers for isolated per-symbol parameter persistence
  const handleSlChange = useCallback((v) => {
    const n = Number(v);
    setSl(n);
    updateSymbolParam({ stop_loss_pct: n });
  }, [updateSymbolParam]);

  const handleTpChange = useCallback((v) => {
    const n = Number(v);
    setTp(n);
    updateSymbolParam({ take_profit_pct: n });
  }, [updateSymbolParam]);

  const handleLeverageChange = useCallback((v) => {
    const n = Number(v);
    setLeverage(n);
    updateSymbolParam({ leverage: n });
  }, [updateSymbolParam]);

  const handleMinWallChange = useCallback((v) => {
    const n = Number(v);
    setMinWallK(n);
    updateSymbolParam({ min_density_usd: n * 1000 });
  }, [updateSymbolParam]);

  const handleVolMultChange = useCallback((v) => {
    const n = Number(v);
    setVolMult(n);
    updateSymbolParam({ volume_multiplier: n });
  }, [updateSymbolParam]);

  const handleFastEmaChange = useCallback((v) => {
    const n = Number(v);
    setFastEma(n);
    updateSymbolParam({ fast_period: n });
  }, [updateSymbolParam]);

  const handleSlowEmaChange = useCallback((v) => {
    const n = Number(v);
    setSlowEma(n);
    updateSymbolParam({ slow_period: n });
  }, [updateSymbolParam]);

  const handleDaysChange = useCallback((v) => {
    const n = Number(v);
    setDays(n);
    updateSymbolParam({ days: n });
  }, [updateSymbolParam]);

  const handleTimeframeChange = useCallback((tf) => {
    setTimeframe(tf);
    updateSymbolParam({ timeframe: tf });
  }, [updateSymbolParam]);

  const handleStrategyChange = useCallback((st) => {
    setStrategy(st);
    updateSymbolParam({ strategy_type: st });
    if (onStrategyChange) onStrategyChange(st);
  }, [updateSymbolParam, onStrategyChange]);

  const handleEntryModeChange = useCallback((em) => {
    setEntryMode(em);
    updateSymbolParam({ entryMode: em });
  }, [updateSymbolParam]);

  const handleSlModeChange = useCallback((sm) => {
    setSlMode(sm);
    updateSymbolParam({ slMode: sm });
  }, [updateSymbolParam]);

  const handleWallSlOffsetChange = useCallback((v) => {
    const n = Number(v);
    setWallSlOffsetTicks(n);
    updateSymbolParam({ wallSlOffsetTicks: n });
  }, [updateSymbolParam]);

  const handleAtrMultiplierChange = useCallback((v) => {
    const n = Number(v);
    setAtrMultiplier(n);
    updateSymbolParam({ atrMultiplier: n });
  }, [updateSymbolParam]);

  const handleMultiTpChange = useCallback((checked) => {
    setUseMultiTp(checked);
    updateSymbolParam({ use_multi_tp: checked });
  }, [updateSymbolParam]);

  const handleTp1RrChange = useCallback((v) => {
    const n = Number(v);
    setTp1RrRatio(n);
    updateSymbolParam({ tp1RrRatio: n });
  }, [updateSymbolParam]);

  const handleTp2ModeChange = useCallback((m) => {
    setTp2Mode(m);
    updateSymbolParam({ tp2Mode: m });
  }, [updateSymbolParam]);

  const handleFilterCvdChange = useCallback((v) => {
    setFilterCvd(v);
    updateSymbolParam({ use_cvd_filter: v });
  }, [updateSymbolParam]);

  const handleFilterOiChange = useCallback((v) => {
    setFilterOi(v);
    updateSymbolParam({ use_oi_filter: v });
  }, [updateSymbolParam]);

  const handleFilterAtrChange = useCallback((v) => {
    setFilterAtr(v);
    updateSymbolParam({ use_atr_filter: v });
  }, [updateSymbolParam]);

  const handleFilterAtrSlChange = useCallback((v) => {
    setFilterAtrSl(v);
    updateSymbolParam({ use_atr_sl: v });
  }, [updateSymbolParam]);

  const handleFilterRsiChange = useCallback((v) => {
    setFilterRsi(v);
    updateSymbolParam({ use_rsi_filter: v });
  }, [updateSymbolParam]);

  // Results view tab: 'equity' (Equity & Monte Carlo) | 'optimizer' (Before/After + Leaderboard) | 'trades' | 'matrix'
  const [viewTab, setViewTab] = useState('equity');

  const [loading, setLoading] = useState(false);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [error, setError] = useState(null);

  const isLiveOnlyStrategy = strategy === 'live_density_bounce' || Boolean(STRATEGIES.find((st) => st.id === strategy)?.isLiveOnly);

  const paramValidation = useMemo(() => {
    const numSl = Number(sl);
    const numTp = Number(tp);
    const numLev = Number(leverage);
    const numDays = Number(days);

    const issues = [];
    if (isNaN(numSl) || numSl <= 0 || numSl > 50) {
      issues.push('Стоп-лосс (SL) должен быть от 0.1% до 50%');
    }
    if (isNaN(numTp) || numTp <= 0 || numTp > 200) {
      issues.push('Тейк-профит (TP) должен быть от 0.1% до 200%');
    }
    if (isNaN(numLev) || numLev < 1 || numLev > 125) {
      issues.push('Кредитное плечо должно быть в диапазоне от 1x до 125x');
    }
    if (isNaN(numDays) || numDays < 1 || numDays > 30) {
      issues.push('Период истории должен быть от 1 до 30 дней');
    }

    return {
      isValid: issues.length === 0,
      firstIssue: issues[0] || null,
      issues
    };
  }, [sl, tp, leverage, days]);

  const runForecast = useCallback(async () => {
    setForecastLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/ai/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          strategy_type: strategy,
          strategy_params: {
            stop_loss_pct: Number(sl),
            take_profit_pct: Number(tp),
            leverage: Number(leverage),
            min_density_usd: (Number(minWallK) || 0) * 1000,
            volume_multiplier: Number(volMult) || 1.0,
            use_atr_filter: Boolean(filterAtr),
            use_atr_sl: Boolean(filterAtrSl),
            atr_multiplier: Number(atrMultiplier) || 1.5,
            use_cvd_filter: Boolean(filterCvd),
            use_oi_filter: Boolean(filterOi),
            use_rsi_filter: Boolean(filterRsi),
            entry_mode: entryMode,
            sl_mode: slMode,
            tp1_rr_ratio: Number(tp1RrRatio) || 1.5,
            tp2_mode: tp2Mode,
            tp2_rr_ratio: Number(tp2RrRatio) || 2.8,
          },
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Ошибка расчёта прогноза (${res.status})`);
      }
      const data = await res.json();
      const cone = data.expected_move_cone;
      if (!cone || !cone.fan_points || cone.fan_points.length === 0) {
        throw new Error('Получен пустой вероятностный конус');
      }

      window.dispatchEvent(
        new CustomEvent('apply-volatility-cone', {
          detail: {
            cone,
            symbol,
            timeframe
          }
        })
      );
      setAppliedFeedback(`📐 Вероятностный конус (±1σ / ±2σ) спроецирован на график для ${symbol} (${timeframe})`);
      setTimeout(() => setAppliedFeedback(null), 4000);
    } catch (err) {
      console.warn('Forecast error:', err);
      setError(err.message || 'Ошибка построения прогноза');
    } finally {
      setForecastLoading(false);
    }
  }, [symbol, timeframe, strategy, sl, tp, leverage, minWallK, volMult, filterAtr, filterAtrSl, atrMultiplier, filterCvd, filterOi, filterRsi, entryMode, slMode, tp1RrRatio, tp2Mode, tp2RrRatio]);

  // Stage 3: Fast 1-Click Strategy Parameter Presets
  const [presets, setPresets] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [newPresetName, setNewPresetName] = useState('');
  const [showSavePresetInput, setShowSavePresetInput] = useState(false);
  const [showOvernightPilot, setShowOvernightPilot] = useState(false);

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/journal/presets`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.presets) ? data.presets : [];
        setPresets(list);
        if (list.length > 0 && !selectedPresetId) {
          setSelectedPresetId(String(list[0].id));
        }
      }
    } catch (err) {
      console.error('Failed to fetch strategy presets:', err);
    }
  }, [selectedPresetId]);

  useEffect(() => {
    if (isOpen) {
      fetchPresets();
    }
  }, [isOpen, fetchPresets]);

  const applyPresetByObj = useCallback((preset) => {
    if (!preset) return;
    const p = preset.params || {};
    if (preset.strategy_type) {
      setStrategy(preset.strategy_type);
      if (onStrategyChange) onStrategyChange(preset.strategy_type);
    }
    if (preset.timeframe && TIMEFRAMES.includes(preset.timeframe)) {
      setTimeframe(preset.timeframe);
    }
    if (p.stop_loss_pct != null) setSl(Number(p.stop_loss_pct));
    if (p.take_profit_pct != null) setTp(Number(p.take_profit_pct));
    if (p.leverage != null) setLeverage(Number(p.leverage));
    if (p.min_density_usd != null) setMinWallK(Math.round(Number(p.min_density_usd) / 1000));
    if (p.volume_multiplier != null) setVolMult(Number(p.volume_multiplier));
    if (p.entryMode) setEntryMode(p.entryMode);
    if (p.slMode) setSlMode(p.slMode);
    if (p.use_atr_filter != null) setFilterAtr(Boolean(p.use_atr_filter));
    if (p.use_atr_sl != null) setFilterAtrSl(Boolean(p.use_atr_sl));
    if (p.atr_multiplier != null) setAtrMultiplier(Number(p.atr_multiplier));
    if (p.use_cvd_filter != null) setFilterCvd(Boolean(p.use_cvd_filter));
    if (p.use_oi_filter != null) setFilterOi(Boolean(p.use_oi_filter));
    if (p.use_rsi_filter != null) setFilterRsi(Boolean(p.use_rsi_filter));

    // Sync to global backtestStore so 1-click chart backtest immediately uses the preset
    if (symbol && setParamsForSymbol) {
      setParamsForSymbol(symbol, {
        strategy_type: preset.strategy_type || strategy,
        timeframe: preset.timeframe || timeframe,
        stop_loss_pct: Number(p.stop_loss_pct ?? sl),
        take_profit_pct: Number(p.take_profit_pct ?? tp),
        leverage: Number(p.leverage ?? leverage),
        min_density_usd: Number(p.min_density_usd ?? minWallK * 1000),
        volume_multiplier: Number(p.volume_multiplier ?? volMult),
        entryMode: p.entryMode || entryMode,
        slMode: p.slMode || slMode,
        use_atr_filter: Boolean(p.use_atr_filter ?? filterAtr),
        use_atr_sl: Boolean(p.use_atr_sl ?? filterAtrSl),
        atr_multiplier: Number(p.atr_multiplier ?? atrMultiplier),
        use_cvd_filter: Boolean(p.use_cvd_filter ?? filterCvd),
        use_oi_filter: Boolean(p.use_oi_filter ?? filterOi),
        use_rsi_filter: Boolean(p.use_rsi_filter ?? filterRsi),
      });
    }

    useBacktestStore.setState({
      strategyType: preset.strategy_type || strategy,
      customParams: {
        stop_loss_pct: Number(p.stop_loss_pct ?? sl),
        take_profit_pct: Number(p.take_profit_pct ?? tp),
        leverage: Number(p.leverage ?? leverage),
        min_density_usd: Number(p.min_density_usd ?? minWallK * 1000),
        use_atr_filter: Boolean(p.use_atr_filter ?? filterAtr),
        use_cvd_filter: Boolean(p.use_cvd_filter ?? filterCvd),
        use_oi_filter: Boolean(p.use_oi_filter ?? filterOi),
        use_rsi_filter: Boolean(p.use_rsi_filter ?? filterRsi),
      }
    });

    if (onApplyStrategy) {
      onApplyStrategy({
        strategy: preset.strategy_type || strategy,
        sl: Number(p.stop_loss_pct ?? sl),
        tp: Number(p.take_profit_pct ?? tp),
        minWallK: Math.round(Number(p.min_density_usd ?? minWallK * 1000) / 1000),
        leverage: Number(p.leverage ?? leverage),
        volMult: Number(p.volume_multiplier ?? volMult)
      });
    }

    setAppliedFeedback(
      `⚡ Пресет "${preset.name}" применён (SL ${p.stop_loss_pct ?? sl}% / TP ${p.take_profit_pct ?? tp}% / Плечо ${p.leverage ?? leverage}x)`
    );
    setTimeout(() => setAppliedFeedback(null), 4000);
  }, [strategy, sl, tp, leverage, minWallK, volMult, filterAtr, filterCvd, filterOi, filterRsi, onStrategyChange, onApplyStrategy]);

  const handleSavePreset = async () => {
    const name = newPresetName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/journal/presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          symbol: symbol || 'ANY',
          timeframe,
          strategy_type: strategy,
          params: {
            stop_loss_pct: Number(sl),
            take_profit_pct: Number(tp),
            leverage: Number(leverage),
            min_density_usd: Number(minWallK) * 1000,
            volume_multiplier: Number(volMult),
            entryMode,
            slMode,
            use_atr_filter: Boolean(filterAtr),
            use_atr_sl: Boolean(filterAtrSl),
            atr_multiplier: Number(atrMultiplier),
            use_cvd_filter: Boolean(filterCvd),
            use_oi_filter: Boolean(filterOi),
            use_rsi_filter: Boolean(filterRsi),
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        await fetchPresets();
        if (data.preset?.id) {
          setSelectedPresetId(String(data.preset.id));
        }
        setNewPresetName('');
        setShowSavePresetInput(false);
        setAppliedFeedback(`💾 Пресет "${name}" сохранён и готов к вызову в 1 клик`);
        setTimeout(() => setAppliedFeedback(null), 3500);
      }
    } catch (err) {
      console.error('Failed to save preset:', err);
    }
  };

  const projectSetupOntoTerminal = useCallback(
    (setup) => {
      if (!setup || !setup.entry_price) return;
      if (onProjectPositionSetup) {
        onProjectPositionSetup(setup);
      }
      window.dispatchEvent(
        new CustomEvent('apply-position-setup', {
          detail: { setup, symbol }
        })
      );
      setAppliedFeedback(
        `Сетап нанесён на график и в стакан: ${setup.order_type || 'BUY LIMIT'} @ $${setup.entry_price} (R:R ${setup.rr_label || '1:2.8'})`
      );
      setTimeout(() => setAppliedFeedback(null), 4000);
    },
    [onProjectPositionSetup, symbol]
  );

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
      setError(null);

      if (isLiveOnlyStrategy) {
        setError(
          "Стратегия «Плотность стакана L2 [Live]» работает исключительно в режиме реального времени. Для тестирования на истории выберите «Cluster Volume Bounce» или «Квант-Конфлюенс»."
        );
        return;
      }

      const pSl = overrideParams?.sl ?? sl;
      const pTp = overrideParams?.tp ?? tp;
      const pWallK = overrideParams?.minWallK ?? minWallK;
      const pCvd = overrideParams?.useCvd ?? filterCvd;

      const numSl = Number(pSl);
      const numTp = Number(pTp);
      const numLev = Number(leverage);
      const numDays = Number(days);

      if (isNaN(numSl) || numSl <= 0 || numSl > 50) {
        setError('Параметр Stop-Loss (SL) должен быть больше 0% и не более 50%');
        return;
      }
      if (isNaN(numTp) || numTp <= 0 || numTp > 200) {
        setError('Параметр Take-Profit (TP) должен быть больше 0% и не более 200%');
        return;
      }
      if (isNaN(numLev) || numLev < 1 || numLev > 125) {
        setError('Кредитное плечо должно быть в диапазоне от 1x до 125x');
        return;
      }
      if (isNaN(numDays) || numDays < 1 || numDays > 30) {
        setError('Период истории должен быть от 1 до 30 дней');
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/backtest/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            symbol,
            timeframe,
            days: Math.min(30, Math.max(1, numDays)),
            strategy_type: strategy,
            params: {
              stop_loss_pct: Math.max(0.01, numSl),
              take_profit_pct: Math.max(0.01, numTp),
              min_density_usd: (Number(pWallK) || 0) * 1000,
              volume_multiplier: Math.max(0.5, Math.min(20, Number(volMult) || 1.0)),
              leverage: Math.max(1, Math.min(125, Math.round(numLev || 1))),
              use_atr_filter: filterAtr,
              use_atr_sl: slMode === 'atr_volatility' || filterAtrSl,
              atr_multiplier: Number(atrMultiplier) || 1.5,
              use_cvd_filter: pCvd,
              use_oi_filter: filterOi,
              use_rsi_filter: filterRsi,
              maker_fee_pct: Number(makerFeePct) >= 0 ? Number(makerFeePct) : 0.02,
              taker_fee_pct: Number(takerFeePct) >= 0 ? Number(takerFeePct) : 0.05,
              slippage_ticks: Number(slippageTicks) >= 0 ? Number(slippageTicks) : 2,
              use_multi_tp: Boolean(useMultiTp),
              entry_mode: entryMode,
              sl_mode: slMode,
              wall_sl_offset_ticks: Number(wallSlOffsetTicks) || 5,
              tp1_rr_ratio: Number(tp1RrRatio) || 1.5,
              tp2_mode: tp2Mode,
              tp2_rr_ratio: Number(tp2RrRatio) || 2.8,
              min_wall_lifetime_sec: Math.min(60, Math.max(10, Number(minWallLifetimeSec) || 30))
            }
          })
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        handleSetResult({ ...data, symbol, timeframe, mode: 'single' });
        if (symbol && setParamsForSymbol) {
          setParamsForSymbol(symbol, {
            stop_loss_pct: numSl,
            take_profit_pct: numTp,
            min_density_usd: (Number(pWallK) || 0) * 1000,
            volume_multiplier: Number(volMult) || 1.0,
            leverage: Math.max(1, Math.round(numLev || 1)),
            strategy_type: strategy,
            timeframe,
            days: numDays,
            use_atr_filter: filterAtr,
            use_atr_sl: slMode === 'atr_volatility' || filterAtrSl,
            atr_multiplier: Number(atrMultiplier) || 1.5,
            use_cvd_filter: pCvd,
            use_oi_filter: filterOi,
            use_rsi_filter: filterRsi,
            entry_mode: entryMode,
            sl_mode: slMode,
            wall_sl_offset_ticks: Number(wallSlOffsetTicks) || 5,
            tp1_rr_ratio: Number(tp1RrRatio) || 1.5,
            tp2_mode: tp2Mode,
            tp2_rr_ratio: Number(tp2RrRatio) || 2.8,
            min_wall_lifetime_sec: Math.min(60, Math.max(10, Number(minWallLifetimeSec) || 30))
          });
        }
        if (data.active_position_setup) {
          projectSetupOntoTerminal(data.active_position_setup);
        }
        setViewTab('equity');
      } catch (e) {
        setError(formatBacktestError(e));
      } finally {
        setLoading(false);
      }
    },
    [
      isLiveOnlyStrategy,
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
      entryMode,
      slMode,
      wallSlOffsetTicks,
      tp1RrRatio,
      tp2Mode,
      tp2RrRatio,
      minWallLifetimeSec,
      onResult,
      projectSetupOntoTerminal
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
    setError(null);
    if (isLiveOnlyStrategy) {
      setError(
        "Стратегия «Плотность стакана L2 [Live]» не поддерживает историческую оптимизацию. Выберите «Cluster Volume Bounce» или «Квант-Конфлюенс»."
      );
      return;
    }

    setLoading(true);
    setOptProgress(15);
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
          use_atr_sl: slMode === 'atr_volatility' || filterAtrSl,
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
      handleSetResult({ ...data, symbol, timeframe, mode: 'grid' });
      if (data.active_position_setup) {
        projectSetupOntoTerminal(data.active_position_setup);
      }
      setViewTab('optimizer');
    } catch (e) {
      setError(formatBacktestError(e));
    } finally {
      setLoading(false);
    }
  }, [
    isLiveOnlyStrategy,
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
    slMode,
    onResult,
    projectSetupOntoTerminal
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
        setError(formatBacktestError(e));
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

  const s = result?.summary;
  const mc = result?.monte_carlo;
  const beforeOpt = result?.before_optimization;
  const afterOpt = result?.after_optimization;
  const oosOpt = result?.oos;
  const pnlTone = s ? (s.total_pnl_pct > 0 ? 'pos' : s.total_pnl_pct < 0 ? 'neg' : null) : null;
  const gridRows = result?.grid_results || [];
  const confluenceMatrix = result?.confluence_matrix || [];
  const feeDragPct = s?.gross_pnl_usd ? Math.abs(Number(s.total_exchange_cost_usd || 0) / Number(s.gross_pnl_usd)) * 100 : 0;
  const profitBleedPct = result?.trades?.length
    ? (result.trades.filter((trade) => trade.profit_bleed).length / result.trades.length) * 100
    : 0;
  const hasL2History = result?.data_availability?.l2_history?.available === true;
  const verdict = s ? buildResearchVerdict({ netPnlUsd: s.net_pnl_usd, feeDragPct, profitBleedPct, regime: currentRegime, hasL2History }) : null;

  useEffect(() => {
    if (!result || !symbol) return undefined;
    let active = true;
    fetch(`${API_BASE}/adaptive/regime?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (active) setCurrentRegime(data?.regime || 'NO_DATA'); })
      .catch(() => { if (active) setCurrentRegime('NO_DATA'); });
    return () => { active = false; };
  }, [result, symbol, timeframe]);

  // Stage 2: Full Trades Log with Multi-column Sorting and CSV Export
  const [tradeSortField, setTradeSortField] = useState('id');
  const [tradeSortAsc, setTradeSortAsc] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState(null);

  const allTrades = useMemo(() => {
    if (!result?.trades || !Array.isArray(result.trades)) return [];
    const list = [...result.trades];
    list.sort((a, b) => {
      let va = a[tradeSortField];
      let vb = b[tradeSortField];
      if (va == null) va = 0;
      if (vb == null) vb = 0;
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return tradeSortAsc ? -1 : 1;
      if (va > vb) return tradeSortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [result?.trades, tradeSortField, tradeSortAsc]);

  const toggleSort = (field) => {
    if (tradeSortField === field) {
      setTradeSortAsc(!tradeSortAsc);
    } else {
      setTradeSortField(field);
      setTradeSortAsc(true);
    }
  };

  const focusTradeFromTimeline = useCallback((trade) => {
    if (!trade) return;
    setSelectedTradeId(trade.id);
    window.dispatchEvent(new CustomEvent('focus-backtest-trade', { detail: trade }));
  }, []);

  const handleExportCSV = useCallback(() => {
    if (!allTrades || allTrades.length === 0) return;
    const headers = [
      'ID', 'Type', 'Entry Time', 'Exit Time',
      'Entry Price', 'Exit Price', 'Gross PnL ($)',
      'Fees ($)', 'Slippage ($)', 'Net PnL ($)',
      'Net PnL (%)', 'Exit Reason'
    ];
    const rows = allTrades.map((t) => [
      t.id,
      t.type,
      new Date(t.entry_time).toISOString(),
      new Date(t.exit_time).toISOString(),
      t.entry_price,
      t.exit_price,
      t.gross_pnl_usd ?? t.pnl_usd,
      t.fee_paid_usd ?? 0,
      t.slippage_cost_usd ?? 0,
      t.pnl_usd,
      t.pnl_pct,
      `"${(t.reason || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_trades_${symbol}_${timeframe}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [allTrades, symbol, timeframe]);

  // Stage 2: PDF Report Export (задача 6.5) — серверный рендер из текущего result
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfExportError, setPdfExportError] = useState(null);

  const handleExportPDF = useCallback(async () => {
    if (!result) return;
    setPdfExporting(true);
    setPdfExportError(null);
    try {
      const res = await fetch(`${API_BASE}/backtest/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Ошибка сервера (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backtest_report_${result.symbol || symbol || 'UNKNOWN'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfExportError(err.message || 'Ошибка формирования PDF');
    } finally {
      setPdfExporting(false);
    }
  }, [result, symbol]);

  // HTML Report Export (задача 6.4) — серверный рендер, открывается в новой вкладке
  const [htmlExporting, setHtmlExporting] = useState(false);
  const [htmlExportError, setHtmlExportError] = useState(null);

  const handleExportHTML = useCallback(async () => {
    if (!result) return;
    setHtmlExporting(true);
    setHtmlExportError(null);
    let url = null;
    try {
      const res = await fetch(`${API_BASE}/backtest/report-html`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Ошибка сервера (${res.status})`);
      }
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setHtmlExportError(err.message || 'Ошибка формирования HTML-отчёта');
    } finally {
      if (url) URL.revokeObjectURL(url);
      setHtmlExporting(false);
    }
  }, [result]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="backtest-panel"
      style={{ height: 400 }}
      className="absolute left-0 right-0 bottom-0 z-40 border-t border-neutral-800 bg-[#0B0E11] shadow-[0_-8px_24px_rgba(0,0,0,0.7)] text-xs flex flex-col font-sans"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-950 shrink-0"
      >
        <div className="flex items-center space-x-2 font-bold text-white text-[11px] min-w-0">
          <BarChart3 size={13} className="text-neutral-300 shrink-0" />
          <span className="truncate text-neutral-200">Квант-движок Бэктеста & Монте-Карло</span>
          <span className="font-mono text-neutral-200 bg-neutral-900 border border-neutral-800 rounded px-1.5 shrink-0">
            {symbol}
          </span>

          {/* Mode Switcher */}
          <div className="flex items-center bg-neutral-950 p-0.5 rounded border border-neutral-800 font-mono text-[9.5px] ml-2 shrink-0">
            <button
              data-testid="bt-mode-paper"
              onClick={() => setMode('live_paper')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition cursor-pointer ${
                mode === 'live_paper' ? 'bg-amber-400 text-neutral-950 font-bold shadow-xs' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Zap size={10} className={mode === 'live_paper' ? 'text-black' : 'text-amber-400'} />
              <span>⚡ Симулятор (Paper)</span>
            </button>
            <button
              data-testid="bt-mode-single"
              onClick={() => setMode('single')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition cursor-pointer ${
                mode === 'single' ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Sliders size={10} />
              <span>Одиночный (OHLCV)</span>
            </button>
            <button
              data-testid="bt-mode-optimizer"
              onClick={() => setMode('grid')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition cursor-pointer ${
                mode === 'grid' ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Dna size={10} />
              <span>⚡ Оптимизатор параметров</span>
            </button>
            <button
              data-testid="bt-mode-ai"
              onClick={() => setMode('ai')}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded transition cursor-pointer ${
                mode === 'ai' ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs' : 'text-neutral-400 hover:text-white'
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
            <span className="hidden xl:inline font-mono text-[10px] text-neutral-500 font-normal truncate">
              {result.meta.candles} свечей {result.meta.timeframe}
              {result.meta.combinations_tested
                ? ` • Итераций генетики: ${result.meta.combinations_tested} (${result.meta.elapsed_ms || 320} мс)`
                : ''}
            </span>
          )}
            <button
              data-testid="btn-open-overnight-pilot"
              onClick={() => setShowOvernightPilot(true)}
              className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold text-amber-300 hover:bg-amber-400/20"
              title="Настроить монеты, стратегию, депозит и риск; проверить и запустить paper-сессии"
            >
              🌙 Мастер Night Pilot
            </button>
        </div>
        <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 shrink-0 cursor-pointer" title="Закрыть (B)">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Left Settings Column */}
        <div
          className="w-[450px] 2xl:w-[490px] shrink-0 p-2.5 border-r border-neutral-800 space-y-2 overflow-y-auto bg-neutral-950/60 select-none"
        >
          {mode === 'live_paper' ? (
            <div className="space-y-3 text-xs"><h2 className="font-semibold text-cyan-200">Настройка paper-торговли</h2><p className="text-neutral-400">Выберите монеты, стратегии, депозит и риск. Проверьте историю и прогноз перед запуском.</p><button className="rounded border border-cyan-700 bg-cyan-950 px-3 py-2 text-cyan-100" onClick={() => setShowOvernightPilot(true)}>Открыть мастер запуска</button><details><summary className="cursor-pointer text-neutral-500">Предыдущий одноинструментный симулятор</summary><LivePaperTradingControls symbol={symbol} /></details></div>
          ) : mode === 'ai' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-neutral-200 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles size={11} className="text-neutral-400" /> AI Ассистент стратегий
                </span>
                <span className="text-[9px] text-neutral-500 font-mono">NLP v2</span>
              </div>

              <label className="flex flex-col text-[9px] text-neutral-400 font-mono">
                <span className="mb-1 text-neutral-300">Опишите торговый сетап:</span>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="например: Консервативный сетап для скальпинга BTC на 5m с низким риском..."
                  rows={3}
                  className="w-full bg-neutral-950 border border-neutral-800 focus:border-neutral-500 focus:ring-1 focus:ring-neutral-500/30 rounded p-1.5 text-neutral-100 text-[10px] font-mono outline-none resize-none leading-relaxed"
                />
              </label>

              <div className="space-y-1">
                <div className="text-[8.5px] uppercase tracking-wider text-neutral-400 font-bold">Быстрые пресеты:</div>
                <div className="flex flex-col space-y-1">
                  {PRESET_CHIPS.map((chip) => (
                    <button
                      key={chip.text}
                      type="button"
                      onClick={() => {
                        setAiPrompt(chip.text);
                        runAiCopilot(chip.text);
                      }}
                      className="text-left text-[9px] bg-neutral-950 hover:bg-neutral-900 border border-neutral-800 hover:border-neutral-600 text-neutral-400 hover:text-white rounded px-2 py-1 font-mono transition truncate cursor-pointer"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => runAiCopilot()}
                disabled={aiLoading}
                className="w-full flex items-center justify-center space-x-1.5 py-2 rounded-md disabled:opacity-60 text-neutral-950 font-bold text-[11px] bg-neutral-200 hover:bg-white transition shadow-sm cursor-pointer"
              >
                {aiLoading ? <Loader2 size={13} className="animate-spin text-neutral-950" /> : <Sparkles size={12} />}
                <span>{aiLoading ? 'AI анализирует и тестирует…' : '✨ Сгенерировать и протестировать'}</span>
              </button>
            </div>
          ) : (
            <>
              {/* Presets Bar — UI вынесен в ./backtest/BacktestPresetsBar (модульный план, п.2); логика (apply/save/fetch) остаётся здесь */}
              <BacktestPresetsBar
                presets={presets}
                selectedPresetId={selectedPresetId}
                showSavePresetInput={showSavePresetInput}
                newPresetName={newPresetName}
                onToggleSaveInput={() => setShowSavePresetInput((v) => !v)}
                onNameChange={setNewPresetName}
                onSave={handleSavePreset}
                onSelectPreset={(id) => {
                  setSelectedPresetId(id);
                  const found = presets.find((p) => String(p.id) === String(id));
                  if (found) applyPresetByObj(found);
                }}
                onApplyPreset={() => {
                  const found = presets.find((p) => String(p.id) === String(selectedPresetId)) || presets[0];
                  if (found) applyPresetByObj(found);
                }}
              />

              {/* Форма параметров (секции A/B/C) вынесена в ./backtest/BacktestParametersForm (модульный план, п.2);
                  стейт и хендлеры (включая updateSymbolParam-врапперы) остаются здесь и прокидываются пропсами */}
              <BacktestParametersForm
                strategy={strategy}
                onStrategyChange={(v) => {
                  setStrategy(v);
                  if (onStrategyChange) onStrategyChange(v);
                }}
                isLiveOnlyStrategy={isLiveOnlyStrategy}
                onSwitchToClusterStrategy={() => {
                  setStrategy('cluster_volume_bounce');
                  if (onStrategyChange) onStrategyChange('cluster_volume_bounce');
                  setError(null);
                }}
                timeframe={timeframe}
                onTimeframeChange={handleTimeframeChange}
                days={days}
                onDaysChange={handleDaysChange}
                entryMode={entryMode}
                onEntryModeChange={handleEntryModeChange}
                mode={mode}
                sl={sl}
                onSlChange={handleSlChange}
                tp={tp}
                onTpChange={handleTpChange}
                leverage={leverage}
                onLeverageChange={handleLeverageChange}
                slMin={slMin}
                setSlMin={setSlMin}
                slMax={slMax}
                setSlMax={setSlMax}
                tpMin={tpMin}
                setTpMin={setTpMin}
                tpMax={tpMax}
                setTpMax={setTpMax}
                showEmaFields={strategy === 'ema_trend' && mode === 'single'}
                fastEma={fastEma}
                onFastEmaChange={handleFastEmaChange}
                slowEma={slowEma}
                onSlowEmaChange={handleSlowEmaChange}
                slMode={slMode}
                onSlModeChange={handleSlModeChange}
                wallSlOffsetTicks={wallSlOffsetTicks}
                onWallSlOffsetChange={handleWallSlOffsetChange}
                atrMultiplier={atrMultiplier}
                onAtrMultiplierChange={handleAtrMultiplierChange}
                useMultiTp={useMultiTp}
                onMultiTpChange={handleMultiTpChange}
                tp1RrRatio={tp1RrRatio}
                onTp1RrChange={handleTp1RrChange}
                tp2Mode={tp2Mode}
                onTp2ModeChange={handleTp2ModeChange}
                volMult={volMult}
                onVolMultChange={handleVolMultChange}
                filterCvd={filterCvd}
                onFilterCvdChange={handleFilterCvdChange}
                filterOi={filterOi}
                onFilterOiChange={handleFilterOiChange}
                filterAtr={filterAtr}
                onFilterAtrChange={handleFilterAtrChange}
                filterRsi={filterRsi}
                onFilterRsiChange={handleFilterRsiChange}
                makerFeePct={makerFeePct}
                setMakerFeePct={setMakerFeePct}
                takerFeePct={takerFeePct}
                setTakerFeePct={setTakerFeePct}
                slippageTicks={slippageTicks}
                setSlippageTicks={setSlippageTicks}
                onSwitchToLivePaper={() => setMode('live_paper')}
              />

              {/* ACTION AREA: Prominent Run Backtest & Forecast Buttons */}
              <div className="pt-1">
                {mode === 'grid' ? (
                  <div className="space-y-1">
                    <button
                      data-testid="btn-run-genetic"
                      onClick={runGeneticOptimizer}
                      disabled={loading || isLiveOnlyStrategy || !paramValidation.isValid}
                      className={`w-full flex items-center justify-center space-x-2 py-2.5 rounded-md font-extrabold text-[12px] transition shadow-md border ${
                        isLiveOnlyStrategy
                          ? 'opacity-40 bg-neutral-900 text-neutral-500 border-neutral-800 cursor-not-allowed'
                          : !paramValidation.isValid
                          ? 'opacity-50 bg-neutral-900 text-neutral-400 border-neutral-800 cursor-not-allowed'
                          : 'text-neutral-950 bg-white hover:bg-neutral-200 cursor-pointer border-neutral-200'
                      }`}
                      title={
                        isLiveOnlyStrategy
                          ? 'Оптимизация недоступна для L2 Live'
                          : !paramValidation.isValid
                          ? paramValidation.firstIssue
                          : 'Запустить генетический подбор лучшего сетапа'
                      }
                    >
                      {loading ? (
                        <Loader2 size={14} className="animate-spin text-neutral-950" />
                      ) : isLiveOnlyStrategy ? (
                        <AlertTriangle size={14} className="text-amber-500" />
                      ) : (
                        <Dna size={14} />
                      )}
                      <span>
                        {loading
                          ? `Генетический отбор (${optProgress}%)…`
                          : isLiveOnlyStrategy
                          ? 'Оптимизация недоступна (L2 Live)'
                          : !paramValidation.isValid
                          ? 'Параметры некорректны'
                          : '🧬 Запустить генетический подбор лучшего сетапа'}
                      </span>
                    </button>
                    {(loading || optProgress === 100) && (
                      <div
                        data-testid="genetic-progress-bar"
                        className="w-full h-1.5 bg-neutral-900 rounded overflow-hidden border border-neutral-800"
                      >
                        <div
                          style={{ width: `${optProgress}%` }}
                          className="h-full bg-neutral-200 transition-all duration-150"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      data-testid="btn-run-single"
                      onClick={() => runSingle()}
                      disabled={loading || isLiveOnlyStrategy || !paramValidation.isValid}
                      className={`flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-md font-extrabold text-[11.5px] transition shadow-md border ${
                        isLiveOnlyStrategy
                          ? 'opacity-40 bg-neutral-900 text-neutral-500 border-neutral-800 cursor-not-allowed'
                          : !paramValidation.isValid
                          ? 'opacity-50 bg-neutral-900 text-neutral-400 border-neutral-800 cursor-not-allowed'
                          : 'text-neutral-950 bg-white hover:bg-neutral-200 cursor-pointer border-neutral-200'
                      }`}
                      title={
                        isLiveOnlyStrategy
                          ? 'Исторический бэктест недоступен для L2 Live'
                          : !paramValidation.isValid
                          ? paramValidation.firstIssue
                          : 'Запустить квант-тест стратегии на истории'
                      }
                    >
                      {loading ? (
                        <Loader2 size={14} className="animate-spin text-neutral-950" />
                      ) : isLiveOnlyStrategy ? (
                        <AlertTriangle size={13} className="text-amber-500" />
                      ) : (
                        <Play size={13} className="fill-current" />
                      )}
                      <span>
                        {loading
                          ? 'Расчёт…'
                          : isLiveOnlyStrategy
                          ? 'Бэктест недоступен (L2 Live)'
                          : !paramValidation.isValid
                          ? 'Параметры некорректны'
                          : 'Запустить бэктест'}
                      </span>
                    </button>
                    <button
                      data-testid="btn-run-forecast"
                      type="button"
                      onClick={runForecast}
                      disabled={forecastLoading}
                      className="flex items-center justify-center space-x-1.5 py-2.5 px-3 rounded-md disabled:opacity-60 text-neutral-100 font-bold text-[11.5px] bg-neutral-800 hover:bg-neutral-700 hover:text-white transition shadow-sm cursor-pointer border border-neutral-700"
                      title="Спроецировать интрадей прогнозный конус волатильности (±1σ / ±2σ) на график"
                    >
                      {forecastLoading ? (
                        <Loader2 size={14} className="animate-spin text-neutral-300" />
                      ) : (
                        <TrendingUp size={14} className="text-emerald-400" />
                      )}
                      <span>{forecastLoading ? 'Проекция…' : 'Прогноз (Forecast)'}</span>
                    </button>
                  </div>
                )}
                {!paramValidation.isValid && (
                  <div
                    data-testid="param-validation-warning"
                    className="mt-1.5 text-[8.5px] font-mono text-amber-400 bg-amber-950/30 border border-amber-800/50 rounded px-2 py-1 flex items-center space-x-1"
                  >
                    <AlertTriangle size={11} className="shrink-0 text-amber-400" />
                    <span>{paramValidation.firstIssue}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {error && (
            <div
              data-testid="backtest-error-banner"
              className="flex items-start space-x-1.5 text-[10px] text-red-400 bg-red-950/40 border border-red-700/50 rounded-md p-2 font-mono"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-400" />
              <div className="flex-1 min-w-0">
                <span className="break-words font-medium">{error}</span>
              </div>
              <button
                type="button"
                onClick={() => setError(null)}
                className="text-neutral-500 hover:text-neutral-300 text-[10px] ml-1 px-1 cursor-pointer"
                title="Закрыть"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Right Results Column */}
        <div className="flex-1 min-w-0 p-2 flex flex-col space-y-1.5 overflow-hidden">
          {mode === 'live_paper' ? (
            <LivePaperTradingResults symbol={symbol} />
          ) : (
            <>
          {/* ТАКТ 1.1: Блок «Источники и метрики» (Data Feed Context) */}
          <div
            data-testid="data-feed-context-card"
            className="grid grid-cols-4 gap-1.5 px-2 py-1 rounded border border-[#1f2430] bg-[#0b0e17] font-mono text-[9px] shrink-0"
          >
            <div className="truncate">
              <span className="text-[#64748b] uppercase block text-[8px]">Стакан & Плотности</span>
              <span className="text-white font-bold">
                {hasL2History ? 'Available' : 'No data (OHLCV only)'}
              </span>{' '}
              <span className="text-[#26a69a]">
                • Historical L2 unavailable
              </span>
            </div>

            <div className="truncate">
              <span className="text-[#64748b] uppercase block text-[8px]">Дельта & Кластеры (CVD)</span>
              <span className="text-[#38bdf8] font-bold">
                CVD: {result?.data_feed_context?.cvd_footprint?.cvd_current ?? 'No data'} (EMA14:{' '}
                {result?.data_feed_context?.cvd_footprint?.cvd_ema14 ?? 'No data'})
              </span>{' '}
              <span className="text-[#cbd5e1]">
                • {result?.data_feed_context?.cvd_footprint?.divergence_status || 'No data'}
              </span>
            </div>

            <div className="truncate">
              <span className="text-[#64748b] uppercase block text-[8px]">Open Interest (1ч)</span>
              <span className="text-[#4ade80] font-bold">
                {result?.data_feed_context?.open_interest?.oi_change_1h_pct != null
                  ? `${result.data_feed_context.open_interest.oi_change_1h_pct >= 0 ? '+' : ''}${result.data_feed_context.open_interest.oi_change_1h_pct}%`
                  : 'No data'}
              </span>{' '}
              <span className="text-[#cbd5e1]">
                • {result?.data_feed_context?.open_interest?.flow_status || 'No data'}
              </span>
            </div>

            <div className="flex items-center justify-between truncate">
              <div className="truncate">
                <span className="text-[#64748b] uppercase block text-[8px]">Волатильность ATR(14)</span>
                <span className="text-[#fbbf24] font-bold">
                  ${result?.data_feed_context?.volatility_atr?.atr_14_usd ?? 'No data'} (
                  {result?.data_feed_context?.volatility_atr?.atr_14_ticks ?? 'No data'} тик)
                </span>
              </div>
              {result?.active_position_setup && (
                <button
                  type="button"
                  data-testid="btn-project-setup-chart"
                  onClick={() => projectSetupOntoTerminal(result.active_position_setup)}
                  className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 font-bold text-[8.5px] shrink-0 cursor-pointer transition-colors"
                  title="Отрисовать Entry / SL / TP1 / TP2 на графике и в стакане"
                >
                  🎯 На график
                </button>
              )}
            </div>
          </div>

          {!s && !loading && !aiLoading && (
            <div className="flex-1 flex items-center justify-center text-neutral-500 text-[11px] font-mono">
              {mode === 'ai'
                ? 'Опишите торговую стратегию и нажмите «✨ Сгенерировать и протестировать»'
                : mode === 'grid'
                ? 'Нажмите «🧬 Запустить генетический подбор лучшего сетапа» (50–100 итераций < 3 сек)'
                : 'Настройте комиссии, скольжение и параметры и нажмите «Запустить тест»'}
            </div>
          )}

          {(loading || aiLoading) && (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-300 text-[11px] font-mono space-y-2">
              <div className="flex items-center">
                <Loader2 size={16} className="animate-spin mr-2 text-neutral-300" />
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
              {/* Institutional Context & State Header (Stage 5) */}
              <div
                data-testid="backtest-result-context-badge"
                className="flex items-center justify-between px-2.5 py-1 rounded bg-[#0e131f] border border-[#1e293b] font-mono text-[9px] text-neutral-300 shrink-0"
              >
                <div className="flex items-center space-x-2">
                  <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-sky-400 font-bold border border-sky-500/30">
                    HISTORICAL BACKTEST
                  </span>
                  <span
                    className="px-1.5 py-0.2 rounded bg-sky-950/40 text-sky-300 border border-sky-700/40"
                    title="Результат рассчитан на исторических свечах OHLCV; это не поток реального времени"
                  >
                    SOURCE: OHLCV
                  </span>
                  <span className="font-bold text-white tracking-wide">
                    {result?.symbol || symbol}
                  </span>
                  <span className="text-neutral-500">•</span>
                  <span className="text-neutral-300">
                    {result?.timeframe || timeframe}
                  </span>
                  <span className="text-neutral-500">•</span>
                  <span className="text-emerald-400">
                    {STRATEGIES.find((st) => st.id === (result?.meta?.strategy_type || strategy))?.name || result?.meta?.strategy_type || strategy}
                  </span>
                </div>
                <div className="flex items-center space-x-2 text-neutral-500">
                  <span>Свечей: {result?.meta?.candles || 0} ({result?.meta?.requested_days || days}д)</span>
                  <span>•</span>
                  <span>{new Date(result?.meta?.to_time || Date.now()).toLocaleTimeString()} UTC</span>
                </div>
              </div>

              {verdict && (
                <div data-testid="research-verdict" className={`flex items-center justify-between px-2.5 py-1 rounded border font-mono text-[9px] ${
                  verdict.level === 'READY' ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-300' : verdict.level === 'BLOCK' ? 'bg-red-950/30 border-red-700/50 text-red-300' : 'bg-amber-950/30 border-amber-700/50 text-amber-300'
                }`}>
                  <span className="font-bold">{verdict.label}</span>
                  <span>Regime: {currentRegime} · Fee Drag: {feeDragPct.toFixed(2)}% · {verdict.l2Label}</span>
                </div>
              )}

              {/* Top Summary Metrics Row: Large Stat Cards for Top 4 Metrics */}
              <div className="flex space-x-2 min-w-0 shrink-0">
                <Card
                  isLarge={true}
                  testId="metric-net-pnl"
                  label="Чистый PnL (Net)"
                  value={`${s.total_pnl_pct > 0 ? '+' : ''}${s.total_pnl_pct}% ($${s.net_pnl_usd ?? result?.net_pnl ?? 0})`}
                  tone={pnlTone}
                  sub={`До ком.: $${s.gross_pnl_usd ?? s.net_pnl_usd ?? 0} (${s.gross_pnl_pct ?? s.total_pnl_pct}%)`}
                />
                <Card
                  isLarge={true}
                  testId="metric-winrate"
                  label="Win Rate"
                  value={`${s.win_rate_pct}%`}
                  tone={s.win_rate_pct >= 50 ? 'pos' : null}
                  sub={`${s.winning_trades}W / ${s.losing_trades}L (${s.total_trades} сд.)`}
                />
                <Card
                  isLarge={true}
                  testId="metric-pf"
                  label="Profit Factor"
                  value={s.profit_factor >= 999 ? '∞' : s.profit_factor}
                  tone={s.profit_factor >= 1 ? 'pos' : 'neg'}
                  sub={`Sharpe ${s.sharpe_ratio} • Sortino ${s.sortino_ratio ?? 0}`}
                />
                <Card
                  isLarge={true}
                  testId="metric-recovery-factor"
                  label="Max Drawdown"
                  value={`-${s.max_drawdown_pct}%`}
                  tone={s.max_drawdown_pct <= 5 ? 'pos' : 'neg'}
                  sub={`Recovery: ${s.recovery_factor ?? result?.recovery_factor ?? 0}`}
                />
                <Card
                  testId="metric-fees-paid"
                  label="Уплачено бирже"
                  value={`$${(s.total_exchange_cost_usd ?? s.total_fees_usd ?? 0).toFixed(2)}`}
                  tone="warn"
                  sub={`Ком.: $${(s.total_fees_usd ?? 0).toFixed(2)} • Слип: $${(s.total_slippage_usd ?? 0).toFixed(2)}`}
                />
                <button
                  onClick={onToggleSignals}
                  className={`flex flex-col items-center justify-center px-2.5 rounded-md border text-[10px] font-mono shrink-0 transition cursor-pointer ${
                    showSignals
                      ? 'bg-neutral-800 text-neutral-200 border-neutral-600'
                      : 'text-neutral-500 border-neutral-800 hover:text-white'
                  }`}
                  title="Показать / скрыть сигналы на графике"
                >
                  {showSignals ? <Eye size={13} /> : <EyeOff size={13} />}
                  <span>{showSignals ? 'Сигналы' : 'Скрыты'}</span>
                </button>
              </div>

              {/* Sub-navigation Tabs: Equity & Monte Carlo | Genetic Optimizer Before/After | Trades | Confluence Matrix */}
              <div className="flex items-center justify-between py-0.5 border-b border-neutral-800 shrink-0">
                <div className="flex items-center space-x-1 font-mono text-[9.5px]">
                  <button
                    data-testid="tab-equity-mc"
                    onClick={() => setViewTab('equity')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                      viewTab === 'equity'
                        ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs'
                        : 'text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800/80'
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
                          ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs'
                          : 'text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800/80'
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
                        ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs'
                        : 'text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800/80'
                    }`}
                  >
                    📋 Сделки ({allTrades.length})
                  </button>

                  <button
                    data-testid="tab-matrix"
                    onClick={() => setViewTab('matrix')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer flex items-center gap-1 ${
                      viewTab === 'matrix'
                        ? 'bg-neutral-200 text-neutral-950 font-bold shadow-xs'
                        : 'text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800/80'
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

                {/* PDF Report Export (6.5): всегда видна рядом с вердиктом MC */}
                {result && (
                  <button
                    type="button"
                    data-testid="btn-export-pdf"
                    onClick={handleExportPDF}
                    disabled={pdfExporting}
                    title="Скачать PDF-отчёт: сводка, Монте-Карло, тепловая карта по дням/часам"
                    className="px-2 py-0.5 rounded font-mono font-bold text-[9.5px] border transition cursor-pointer bg-neutral-900 text-neutral-300 border-neutral-700 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {pdfExporting ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                    <span>PDF отчёт</span>
                  </button>
                )}
                {result && (
                  <button
                    type="button"
                    data-testid="btn-export-html"
                    onClick={handleExportHTML}
                    disabled={htmlExporting}
                    title="Открыть HTML-отчёт в новой вкладке: сводка, equity, Монте-Карло, тепловая карта"
                    className="px-2 py-0.5 rounded font-mono font-bold text-[9.5px] border transition cursor-pointer bg-neutral-900 text-neutral-300 border-neutral-700 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    {htmlExporting ? <Loader2 size={10} className="animate-spin" /> : <FileCode2 size={10} />}
                    <span>HTML отчёт</span>
                  </button>
                )}
                {(pdfExportError || htmlExportError) && (
                  <span data-testid="pdf-export-error" className="text-[9.5px] text-[#ef5350] font-mono">
                    {pdfExportError || htmlExportError}
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

                {/* Optimizer (До/После + OOS + лидерборд) и матрица конфлюенса вынесены
                    в ./backtest/BacktestOptimizerView (модульный план, п.2); applySetup/applyConfluenceSetup остались здесь */}
                <BacktestOptimizerView
                  viewTab={viewTab}
                  beforeOpt={beforeOpt}
                  afterOpt={afterOpt}
                  oosOpt={oosOpt}
                  gridRows={gridRows}
                  confluenceMatrix={confluenceMatrix}
                  onApplySetup={applySetup}
                  onApplyConfluenceSetup={applyConfluenceSetup}
                />

                {viewTab === 'trades' && (
                  <div className="flex flex-col h-full">
                    {/* Action Toolbar for Trades Log */}
                    <div className="flex items-center justify-between px-2 py-1 bg-neutral-950 border-b border-neutral-800 text-[9px] shrink-0 font-mono">
                      <div className="flex items-center space-x-2">
                        <span className="text-[#34d399] font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
                          Historical Flow & Volume Engine
                        </span>
                        <span className="text-neutral-600">|</span>
                        <span className="text-neutral-400">Сделок: {allTrades.length}</span>
                        <span className="text-neutral-600">|</span>
                        <span className="text-neutral-500">Maker 0.02% / Taker 0.05%</span>
                      </div>

                      <button
                        type="button"
                        data-testid="btn-export-csv"
                        onClick={handleExportCSV}
                        disabled={allTrades.length === 0}
                        className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 flex items-center gap-1 transition cursor-pointer text-[9px]"
                        title="Экспортировать весь журнал сделок в CSV"
                      >
                        <Download size={10} />
                        <span>Экспорт CSV</span>
                      </button>
                    </div>

                    <BacktestTradeTimeline
                      trades={allTrades}
                      selectedId={selectedTradeId}
                      onSelect={focusTradeFromTimeline}
                    />

                    <BacktestTradesTable
                      trades={allTrades}
                      sortField={tradeSortField}
                      sortAsc={tradeSortAsc}
                      onSort={toggleSort}
                      selectedId={selectedTradeId}
                      onSelect={focusTradeFromTimeline}
                    />
                  </div>
                )}

              </div>
            </>
          )}
            </>
          )}
        </div>
      </div>
      {showOvernightPilot && <Suspense fallback={<div role="status" className="absolute inset-0 z-50 bg-neutral-950 p-4 text-cyan-200">Загрузка Night Pilot…</div>}><PilotDialog onClose={() => setShowOvernightPilot(false)} /></Suspense>}
    </div>
  );
}
