import React, { useEffect, useState } from 'react';
import { useBacktestStore } from '../stores/backtestStore';
import {
  Zap,
  Play,
  Square,
  ShieldAlert,
  ShieldCheck,
  Activity,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Info,
  Clock,
  Sparkles,
  RefreshCw,
  Sliders,
  DollarSign
} from 'lucide-react';

/**
 * Interactive SVG Live Equity Curve
 */
export function LiveEquityChart({ points = [], initialCapital = 10000 }) {
  // Защита от нечисловых точек из API (null/string/NaN) — иначе .toFixed() валил весь рендер
  // приложения (React 19 размонтирует root при неперехваченной ошибке, 2026-10-24).
  initialCapital = Number(initialCapital);
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) initialCapital = 10000;
  points = (Array.isArray(points) ? points : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (points.length === 0) {
    points = [initialCapital];
  }

  const width = 640;
  const height = 150;
  const padTop = 15;
  const padBottom = 25;
  const padLeft = 60;
  const padRight = 20;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const minVal = Math.min(...points, initialCapital * 0.98);
  const maxVal = Math.max(...points, initialCapital * 1.02);
  const range = maxVal - minVal || 1;

  const currentEquity = points[points.length - 1];
  const isPos = currentEquity >= initialCapital;

  const coords = points.map((val, idx) => {
    const x = padLeft + (idx / Math.max(1, points.length - 1)) * chartW;
    const y = padTop + chartH - ((val - minVal) / range) * chartH;
    return { x, y, val };
  });

  const pathD = coords.reduce((acc, pt, idx) => {
    return `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
  }, '');

  const areaD = coords.length > 0
    ? `${pathD} L ${coords[coords.length - 1].x.toFixed(1)},${(padTop + chartH).toFixed(1)} L ${padLeft},${(padTop + chartH).toFixed(1)} Z`
    : '';

  const strokeColor = isPos ? '#10b981' : '#ef4444';
  const gradId = isPos ? 'equity-grad-pos' : 'equity-grad-neg';

  return (
    <div className="w-full bg-[#0a0d14] border border-[#1b2230] rounded-md p-2.5 shadow-inner">
      <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 mb-1 border-b border-neutral-800/60 pb-1">
        <span className="flex items-center gap-1.5 font-bold text-neutral-200">
          <Activity size={12} className={isPos ? 'text-emerald-400' : 'text-red-400'} />
          Live Equity Curve (В реальном времени)
        </span>
        <span className="flex items-center gap-2">
          <span>Старт: ${initialCapital.toLocaleString()}</span>
          <span className={`font-bold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
            Текущий: ${currentEquity.toFixed(2)}
          </span>
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 overflow-visible">
        <defs>
          <linearGradient id="equity-grad-pos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="equity-grad-neg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Y Axis Guide Lines */}
        <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="#1f293d" strokeDasharray="2,3" />
        <line x1={padLeft} y1={padTop + chartH / 2} x2={width - padRight} y2={padTop + chartH / 2} stroke="#1f293d" strokeDasharray="2,3" />
        <line x1={padLeft} y1={padTop + chartH} x2={width - padRight} y2={padTop + chartH} stroke="#1f293d" strokeDasharray="2,3" />

        {/* Y Labels */}
        <text x={padLeft - 6} y={padTop + 4} fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="end">
          ${maxVal.toFixed(0)}
        </text>
        <text x={padLeft - 6} y={padTop + chartH / 2 + 3} fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="end">
          ${((maxVal + minVal) / 2).toFixed(0)}
        </text>
        <text x={padLeft - 6} y={padTop + chartH} fill="#64748b" fontSize="8.5" fontFamily="monospace" textAnchor="end">
          ${minVal.toFixed(0)}
        </text>

        {/* Area fill */}
        {areaD && <path d={areaD} fill={`url(#${gradId})`} />}

        {/* Line */}
        {pathD && <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}

        {/* Last Point Marker */}
        {coords.length > 0 && (
          <circle
            cx={coords[coords.length - 1].x}
            cy={coords[coords.length - 1].y}
            r="3.5"
            fill={strokeColor}
            className="animate-pulse"
          />
        )}
      </svg>
    </div>
  );
}

/**
 * Left Settings Column for Live Paper Trading
 */
export function LivePaperTradingControls({ symbol = 'BTCUSDT' }) {
  const isRunning = useBacktestStore((s) => s.isLivePaperRunning);
  const config = useBacktestStore((s) => s.livePaperConfig);
  const setConfig = useBacktestStore((s) => s.setLivePaperConfig);
  const startLivePaper = useBacktestStore((s) => s.startLivePaper);
  const stopLivePaper = useBacktestStore((s) => s.stopLivePaper);
  const status = useBacktestStore((s) => s.livePaperStatus);

  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const handleStart = async () => {
    setErrorMsg(null);
    setStarting(true);
    try {
      await startLivePaper({ symbol });
    } catch (err) {
      setErrorMsg(err.message || 'Ошибка старта симулятора');
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopLivePaper();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-2.5 select-none font-mono text-[9px]">
      {/* Header Info Banner */}
      <div className="border border-amber-500/30 bg-amber-500/10 rounded-md p-2 text-amber-200">
        <div className="flex items-center justify-between font-bold text-[10px] mb-1">
          <span className="flex items-center gap-1.5 text-amber-300">
            <Zap size={12} className="text-amber-400" />
            Честный Live Paper Trading (L2 + Ликвидации)
          </span>
          <span className={`px-1.5 py-0.2 rounded text-[8px] uppercase font-bold ${isRunning ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-neutral-800 text-neutral-400'}`}>
            {isRunning ? '● АКТИВЕН' : '○ ОСТАНОВЛЕН'}
          </span>
        </div>
        <p className="text-[8.5px] text-neutral-300 font-sans leading-tight">
          Движок опрашивает реальный L2 стакан спота Binance и синтетическую карту ликвидаций. 
          Поиск сетапов перед крупными стенками и авто-исполнение ордеров без риска для реального депозита.
        </p>
      </div>

      {errorMsg && (
        <div className="border border-red-500/40 bg-red-950/40 text-red-300 rounded p-1.5 text-[8.5px]">
          {errorMsg}
        </div>
      )}

      {/* Balance & Risk Configuration */}
      <div className="border border-neutral-800 rounded-md p-2 bg-[#0e1217] space-y-2">
        <div className="text-[9px] font-bold text-neutral-200 uppercase tracking-wider flex items-center justify-between border-b border-neutral-800 pb-1">
          <span className="flex items-center gap-1">
            <DollarSign size={11} className="text-neutral-400" />
            Депозит & Риск-Менеджмент
          </span>
          <span className="text-[8px] text-neutral-500">CAPITAL</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label
            className="flex flex-col text-neutral-400"
            title="Виртуальный депозит симулятора. Реальные средства не используются — терминал строго консультативный."
          >
            <span className="mb-0.5 text-neutral-300">Стартовый баланс ($):</span>
            <input
              type="number"
              min={100}
              max={1000000}
              step={500}
              disabled={isRunning}
              value={config.initialCapital ?? 10000}
              onChange={(e) => setConfig({ initialCapital: Number(e.target.value) })}
              className="bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-neutral-100 text-[10px] text-right font-mono outline-none focus:border-neutral-500 disabled:opacity-50"
            />
          </label>

          <label
            className="flex flex-col text-neutral-400"
            title="Сколько процентов виртуального депозита теряется при срабатывании стопа. 1% — классический институциональный лимит; больше 2–3% — агрессивно."
          >
            <span className="mb-0.5 text-neutral-300">Риск на сделку (%):</span>
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              disabled={isRunning}
              value={config.riskPerTradePct ?? 1.0}
              onChange={(e) => setConfig({ riskPerTradePct: Number(e.target.value) })}
              className="bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-neutral-100 text-[10px] text-right font-mono outline-none focus:border-neutral-500 disabled:opacity-50"
            />
          </label>
        </div>
      </div>

      {/* Strategy & Order Book Filters */}
      <div className="border border-neutral-800 rounded-md p-2 bg-[#0e1217] space-y-2">
        <div className="text-[9px] font-bold text-neutral-200 uppercase tracking-wider flex items-center justify-between border-b border-neutral-800 pb-1">
          <span className="flex items-center gap-1">
            <Sliders size={11} className="text-neutral-400" />
            Стратегия & L2 Фильтры
          </span>
          <span className="text-[8px] text-neutral-500">L2 SENTINEL</span>
        </div>

        <div
          title="🧱 Вход перед стенкой — лимитный вход впереди крупной плотности стакана ($500k+). 🧬 Quant Confluence — вход только при совпадении трёх независимых факторов (стенка + ликвидации + дельта)."
        >
          <span className="text-neutral-400 block mb-0.5">Торговый сетап:</span>
          <select
            disabled={isRunning}
            value={config.strategyType ?? 'live_density_bounce'}
            onChange={(e) => setConfig({ strategyType: e.target.value })}
            className="w-full bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-neutral-200 text-[9.5px] outline-none disabled:opacity-50"
          >
            <option value="live_density_bounce">🧱 Вход перед крупной стенкой стакана L2 ($500k+)</option>
            <option value="quant_confluence">🧬 Quant Confluence 3 Ядра (Стенка + Ликвидации + Дельта)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label
            className="flex flex-col text-neutral-400"
            title="Минимальный размер лимитной плотности в стакане (в тысячах $), чтобы сигнал считался валидным. Больше = надёжнее, но реже сигналы."
          >
            <span className="mb-0.5 text-neutral-300">Мин. стенка ($k):</span>
            <input
              type="number"
              min={50}
              max={50000}
              step={50}
              disabled={isRunning}
              value={Math.round((config.minDensityUsd ?? 500000) / 1000)}
              onChange={(e) => setConfig({ minDensityUsd: Number(e.target.value) * 1000 })}
              className="bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-neutral-100 text-[10px] text-right font-mono outline-none focus:border-neutral-500 disabled:opacity-50"
            />
          </label>

          <label
            className="flex flex-col text-neutral-400"
            title="Кредитное плечо виртуальной позиции. Увеличивает требуемую маржу и размер позиции, но не отменяет лимит риска на сделку."
          >
            <span className="mb-0.5 text-neutral-300">Плечо:</span>
            <input
              type="number"
              min={1}
              max={50}
              disabled={isRunning}
              value={config.leverage ?? 2}
              onChange={(e) => setConfig({ leverage: Number(e.target.value) })}
              className="bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-neutral-100 text-[10px] text-right font-mono outline-none focus:border-neutral-500 disabled:opacity-50"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label
            className="flex flex-col text-neutral-400"
            title="Защитный стоп в % от цены входа. При срабатывании позиция закрывается по рынку с комиссией taker и проскальзыванием."
          >
            <span className="mb-0.5 text-neutral-300">Stop-Loss (%):</span>
            <input
              type="number"
              min={0.1}
              max={15}
              step={0.1}
              disabled={isRunning}
              value={config.stop_loss_pct ?? 0.8}
              onChange={(e) => setConfig({ stop_loss_pct: Number(e.target.value) })}
              className="bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-neutral-100 text-[10px] text-right font-mono outline-none focus:border-neutral-500 disabled:opacity-50"
            />
          </label>

          <label
            className="flex flex-col text-neutral-400"
            title="Цель фиксации прибыли в % от цены входа. Лимитный ордер — комиссия maker, без проскальзывания."
          >
            <span className="mb-0.5 text-neutral-300">Take-Profit (%):</span>
            <input
              type="number"
              min={0.2}
              max={30}
              step={0.1}
              disabled={isRunning}
              value={config.take_profit_pct ?? 1.6}
              onChange={(e) => setConfig({ take_profit_pct: Number(e.target.value) })}
              className="bg-neutral-950 border border-neutral-800 rounded px-1.5 py-1 text-neutral-100 text-[10px] text-right font-mono outline-none focus:border-neutral-500 disabled:opacity-50"
            />
          </label>
        </div>
      </div>

      {/* OpenRouter AI Risk Control Suite */}
      <div className="border border-purple-900/40 bg-purple-950/20 rounded-md p-2 space-y-1.5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(config.aiControl)}
            onChange={(e) => setConfig({ aiControl: e.target.checked })}
            className="mt-0.5 rounded border-neutral-700 text-purple-600 focus:ring-0 accent-purple-500 cursor-pointer"
          />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-neutral-200 text-[9.5px] flex items-center gap-1">
                <Sparkles size={11} className="text-purple-400" />
                AI Контроль сделок (OpenRouter)
              </span>
              <span className="text-[7.5px] text-purple-300 bg-purple-900/60 px-1 py-0.2 rounded border border-purple-700/50">
                Бесплатный пул
              </span>
            </div>
            <p className="text-[8px] text-neutral-400 font-sans mt-0.5 leading-snug">
              При обнаружении сетапа скрипт запрашивает оценку риска у нейросети (Llama-3.1-8B / Gemma-2-9B).
              При ответе <span className="text-red-400 font-bold">VETO: TRUE</span> виртуальная сделка отменяется.
            </p>
          </div>
        </label>
      </div>

      {/* Start / Stop Execution Button */}
      <div className="pt-1">
        {isRunning ? (
          <button
            type="button"
            data-testid="btn-stop-live-paper"
            onClick={handleStop}
            className="w-full py-2 px-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg transition"
          >
            <Square size={13} fill="currentColor" />
            <span>⏹ Остановить Live Paper Trading</span>
          </button>
        ) : (
          <button
            type="button"
            data-testid="btn-start-live-paper"
            disabled={starting}
            onClick={handleStart}
            className="w-full py-2 px-3 rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg transition disabled:opacity-50"
          >
            <Zap size={14} fill="currentColor" />
            <span>{starting ? 'Запуск симулятора…' : '⚡ Запустить Live Paper Trading'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Right Column: Real-time Metrics, SVG Equity Curve, Open Positions, Closed Trades & AI Veto Log
 */
export function LivePaperTradingResults({ symbol = 'BTCUSDT' }) {
  const isRunning = useBacktestStore((s) => s.isLivePaperRunning);
  const status = useBacktestStore((s) => s.livePaperStatus);
  const config = useBacktestStore((s) => s.livePaperConfig);
  const fetchStatus = useBacktestStore((s) => s.fetchLivePaperStatus);
  const depositLivePaper = useBacktestStore((s) => s.depositLivePaper);

  const [depositAmount, setDepositAmount] = useState('1000');
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMsg, setDepositMsg] = useState(null);

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDepositMsg('Сумма должна быть > 0');
      return;
    }
    setDepositBusy(true);
    setDepositMsg(null);
    try {
      const res = await depositLivePaper(amount, 'UI top-up');
      setDepositMsg(`+${res.deposited?.toFixed?.(2) ?? amount}$ пополнено`);
    } catch (err) {
      setDepositMsg(err.message || 'Ошибка пополнения');
    } finally {
      setDepositBusy(false);
    }
  };

  // Poll status every 2.5 seconds when active
  useEffect(() => {
    fetchStatus();
    const timer = setInterval(() => {
      fetchStatus();
    }, 2500);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const initialCapital = status?.initial_capital ?? config.initialCapital ?? 10000;
  const currentEquity = status?.current_equity ?? initialCapital;
  const balance = status?.balance ?? initialCapital;
  const availableMargin = status?.available_margin ?? balance;
  const usedMargin = status?.used_margin ?? 0;
  const fundingRate = status?.funding_rate ?? 0;
  const realizedPnl = status?.realized_pnl ?? 0.0;
  const unrealizedPnl = status?.unrealized_pnl ?? 0.0;
  const totalPnl = currentEquity - initialCapital;
  const totalPnlPct = (totalPnl / initialCapital) * 100.0;

  const openPositions = status?.open_positions || [];
  const closedTrades = status?.closed_trades || [];
  const logs = status?.logs || [];
  const equityPoints = status?.equity_curve || [initialCapital];

  const isPos = totalPnl >= 0;

  return (
    <div className="flex-1 flex flex-col space-y-2.5 overflow-y-auto pr-1">
      {/* Top Real-time KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col justify-between">
          <span className="text-[8px] text-neutral-400 font-mono uppercase font-bold">Баланс кошелька</span>
          <span className="text-[14px] font-mono font-extrabold text-neutral-100">
            ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[8px] text-neutral-500 font-mono">Доступный остаток (вирт.)</span>
        </div>

        {/* Пополнение виртуального кошелька (paper money) */}
        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col justify-between space-y-1">
          <span className="text-[8px] text-neutral-400 font-mono uppercase font-bold">Пополнить (вирт.)</span>
          <div className="flex items-center space-x-1">
            <input
              type="number"
              min="1"
              step="100"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              data-testid="live-deposit-amount"
              className="w-20 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-[10px] font-mono text-neutral-100"
            />
            <button
              type="button"
              onClick={handleDeposit}
              disabled={depositBusy}
              data-testid="live-deposit-btn"
              title="Пополнить виртуальный баланс (paper money, без реальных денег)"
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border transition cursor-pointer bg-emerald-900/40 text-emerald-300 border-emerald-800 hover:bg-emerald-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {depositBusy ? '…' : '+ $'}
            </button>
          </div>
          <span className="text-[8px] text-neutral-500 font-mono" data-testid="live-deposit-msg">
            {depositMsg || 'Paper money · не реальные деньги'}
          </span>
        </div>

        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col justify-between">
          <span className="text-[8px] text-neutral-400 font-mono uppercase font-bold">Equity (Капитал)</span>
          <span className={`text-[14px] font-mono font-extrabold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
            ${currentEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="text-[8px] text-neutral-500 font-mono">
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} ({totalPnlPct.toFixed(2)}%)
          </span>
        </div>

        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col justify-between">
          <span className="text-[8px] text-neutral-400 font-mono uppercase font-bold">Реал. PnL</span>
          <span className={`text-[13px] font-mono font-extrabold ${realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {realizedPnl >= 0 ? '+' : ''}${realizedPnl.toFixed(2)}
          </span>
          <span className="text-[8px] text-neutral-500 font-mono">Закрытые трейды</span>
        </div>

        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col justify-between">
          <span className="text-[8px] text-neutral-400 font-mono uppercase font-bold">Нереал. PnL</span>
          <span className={`text-[13px] font-mono font-extrabold ${unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
          </span>
          <span className="text-[8px] text-neutral-500 font-mono">Плавающий профит</span>
        </div>

        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col justify-between">
          <span className="text-[8px] text-neutral-400 font-mono uppercase font-bold">Открыто позиций</span>
          <span className="text-[13px] font-mono font-extrabold text-blue-400">
            {openPositions.length}
          </span>
          <span className="text-[8px] text-neutral-500 font-mono">{symbol}</span>
        </div>

        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col justify-between">
          <span className="text-[8px] text-neutral-400 font-mono uppercase font-bold">Всего сделок</span>
          <span className="text-[13px] font-mono font-extrabold text-neutral-300">
            {status?.closed_trades_count ?? closedTrades.length}
          </span>
          <span className="text-[8px] text-neutral-500 font-mono">Исполнено</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[8px] font-mono">
        <div className="border border-neutral-800 rounded-md px-2 py-1.5 bg-[#0d1117]"><span className="text-neutral-500 uppercase">Available margin</span><b className="ml-2 text-neutral-200">${Number(availableMargin).toFixed(2)}</b></div>
        <div className="border border-neutral-800 rounded-md px-2 py-1.5 bg-[#0d1117]"><span className="text-neutral-500 uppercase">Used margin</span><b className="ml-2 text-blue-300">${Number(usedMargin).toFixed(2)}</b></div>
        <div className="border border-neutral-800 rounded-md px-2 py-1.5 bg-[#0d1117]"><span className="text-neutral-500 uppercase">Funding rate</span><b className="ml-2 text-amber-200">{(Number(fundingRate) * 100).toFixed(4)}%</b></div>
        <div className="border border-neutral-800 rounded-md px-2 py-1.5 bg-[#0d1117]"><span className="text-neutral-500 uppercase">Data</span><b className={`ml-2 ${status?.data_status === 'connected' ? 'text-emerald-300' : 'text-amber-200'}`}>{status?.data_status || 'unknown'}</b></div>
      </div>

      {/* Real-time SVG Equity Curve */}
      <LiveEquityChart points={equityPoints} initialCapital={initialCapital} />

      {/* Split View: Positions & Trades on Left, AI Risk Consilium Logs on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 flex-1 min-h-[260px]">
        {/* Positions & Closed Trades Tables */}
        <div className="space-y-2 border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col">
          <div className="text-[9.5px] font-bold text-neutral-200 font-mono flex items-center justify-between border-b border-neutral-800 pb-1">
            <span className="flex items-center gap-1.5">
              <TrendingUp size={12} className="text-blue-400" />
              Открытые позиции ({openPositions.length})
            </span>
            <span className="text-[8px] text-neutral-500">REAL-TIME EXECUTION</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 max-h-[140px]">
            {openPositions.length === 0 ? (
              <div className="text-center py-5 text-neutral-600 font-mono text-[9px]">
                {isRunning ? 'Поиск сетапа у стенки стакана…' : 'Симулятор остановлен'}
              </div>
            ) : (
              openPositions.map((pos, idx) => {
                const uPnl = Number(pos.unrealized_pnl || 0);
                return (
                  <div key={idx} className="border border-neutral-800/80 bg-neutral-950/80 rounded p-1.5 font-mono text-[8.5px] flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1 rounded text-[7.5px] font-bold ${pos.side === 'LONG' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                          {pos.side}
                        </span>
                        <span className="font-bold text-neutral-200">{pos.symbol}</span>
                        <span className="text-neutral-500">Qty: {pos.qty}</span>
                      </div>
                      <div className="text-[8px] text-neutral-400 mt-0.5">
                        Вход: ${pos.avg_entry_price} | Маржа: ${pos.margin?.toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${uPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {uPnl >= 0 ? '+' : ''}${uPnl.toFixed(2)}
                      </div>
                      <div className="text-[7.5px] text-neutral-500">
                        Комиссия: ${pos.fees_paid?.toFixed(3)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Recent Closed Trades */}
          <div className="text-[9.5px] font-bold text-neutral-200 font-mono flex items-center justify-between border-b border-neutral-800 pt-1 pb-1">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-emerald-400" />
              Последние закрытые сделки
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 max-h-[140px]">
            {closedTrades.length === 0 ? (
              <div className="text-center py-4 text-neutral-600 font-mono text-[8.5px]">
                Закрытых сделок пока нет
              </div>
            ) : (
              closedTrades.slice(-8).reverse().map((t, idx) => {
                const isProf = (t.net_pnl || 0) >= 0;
                return (
                  <div key={idx} className="border border-neutral-800/60 bg-neutral-950/60 rounded px-1.5 py-1 font-mono text-[8px] flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1 rounded text-[7px] font-bold ${t.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.side}
                      </span>
                      <span className="text-neutral-300">${t.entry_price} → ${t.exit_price}</span>
                      <span className="text-neutral-500 text-[7.5px]">({t.exit_reason})</span>
                    </div>
                    <div className={`font-bold ${isProf ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isProf ? '+' : ''}${t.net_pnl?.toFixed(2)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* AI Decision Log & Order Flow Execution Feed */}
        <div className="border border-neutral-800 rounded-md p-2 bg-[#0d1117] flex flex-col">
          <div className="text-[9.5px] font-bold text-neutral-200 font-mono flex items-center justify-between border-b border-neutral-800 pb-1">
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-purple-400" />
              AI Риск-Офицер & Лента Сетапов
            </span>
            <span className="text-[8px] text-neutral-500">DECISION LOG</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 p-1 max-h-[300px]">
            {logs.length === 0 ? (
              <div className="text-center py-10 text-neutral-600 font-mono text-[9px]">
                {isRunning ? 'Ожидание событий стакана…' : 'Лента пуста. Запустите симулятор'}
              </div>
            ) : (
              logs.map((log, idx) => {
                const isVeto = log.event === 'AI_VETO';
                const isConfirm = log.event === 'AI_CONFIRM';
                const isEntry = log.event === 'TRADE_ENTRY';
                const isExit = log.event === 'TRADE_EXIT';

                let badgeColor = 'bg-neutral-800 text-neutral-400';
                if (isVeto) badgeColor = 'bg-red-500/20 text-red-300 border border-red-500/40';
                if (isConfirm) badgeColor = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
                if (isEntry) badgeColor = 'bg-blue-500/20 text-blue-300 border border-blue-500/40';
                if (isExit) badgeColor = 'bg-amber-500/20 text-amber-300 border border-amber-500/40';

                return (
                  <div key={idx} className="border border-neutral-800/80 bg-neutral-950/70 rounded p-1.5 font-mono text-[8px] space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className={`px-1 py-0.2 rounded font-bold text-[7.5px] ${badgeColor}`}>
                        [{log.event}]
                      </span>
                      <span className="text-neutral-500 text-[7.5px]">
                        {new Date(log.time).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-neutral-200 text-[8.5px] leading-snug">
                      {log.message}
                    </div>
                    {log.meta?.ai_eval && (
                      <div className="text-[7.5px] font-mono text-neutral-400 flex items-center justify-between pt-0.5 border-t border-neutral-800/40">
                        <span className="truncate">
                          Модель: <span className="text-purple-300 font-semibold">{log.meta.ai_eval.model}</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {log.meta.ai_eval.fallback ? (
                            <span className="text-amber-400 bg-amber-500/10 px-1 rounded border border-amber-500/30 font-bold" title={log.meta.ai_eval.fallback_reason || 'Fallback'}>
                              Fallback
                            </span>
                          ) : (
                            <span className="text-emerald-400 bg-emerald-500/10 px-1 rounded border border-emerald-500/30">
                              Primary
                            </span>
                          )}
                          {log.meta.ai_eval.latency_ms > 0 && (
                            <span className="text-neutral-500">{log.meta.ai_eval.latency_ms}ms</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
