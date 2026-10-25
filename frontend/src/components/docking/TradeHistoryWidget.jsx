import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  History,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Zap,
  Clock,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
  Settings2,
  Search,
  Plus,
  X,
  ArrowUpDown,
  Target,
  Sparkles
} from 'lucide-react';
import { useBacktestStore } from '../../stores/backtestStore';
import { useColorLinksStore } from '../../stores/colorLinksStore';
import { collectMarathonPositions, collectMarathonTrades, mergePaperLists, hasMarathonData } from './marathonFeed';
import {
  collectPaperPairs,
  pairTotalPnl,
  sortPaperPairs,
  filterPaperPairs,
  collectCandidateSetups,
  POPULAR_COINS,
  AVAILABLE_STRATEGIES
} from './paperPairs';

const API_BASE = '/api';

export default function TradeHistoryWidget(props) {
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('trades'); // 'trades' | 'positions' | 'candidates' | 'pairs' | 'regimes'
  const [isResetting, setIsResetting] = useState(false);
  const [monitoringData, setMonitoringData] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [pilotStatus, setPilotStatus] = useState(null);

  // Сортировка и фильтрация для вкладки "По парам"
  const [sortField, setSortField] = useState('symbol');
  const [sortDir, setSortDir] = useState('asc');
  const [pairSearch, setPairSearch] = useState('');
  const [pairStatusFilter, setPairStatusFilter] = useState('all'); // 'all' | 'running' | 'active_positions'

  // Быстрое добавление пары / выбор стратегии
  const [showAddPair, setShowAddPair] = useState(false);
  const [newPairSymbol, setNewPairSymbol] = useState('');
  const [newPairStrategy, setNewPairStrategy] = useState('ema_trend');
  const [newPairTimeframe, setNewPairTimeframe] = useState('5m');

  // Fetch Paper Trading Status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/paper-trading/status`);
      if (!res.ok) throw new Error(`HTTP error: ${res.status}`);
      const data = await res.json();
      setSessionData(data);
      setError(null);
    } catch (err) {
      console.debug('Failed to fetch paper trading status:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Monitoring Regimes & Forecasts
  const fetchMonitoring = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/monitoring/state`);
      if (res.ok) {
        const data = await res.json();
        setMonitoringData(data);
      }
    } catch (err) {
      console.debug('Failed to fetch monitoring state:', err);
    }
  }, []);

  // Fetch Live Paper Runner status (активная стратегия, символ, плечо, AI-контроль)
  const fetchLiveStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/paper-trading/live/status`);
      if (res.ok) {
        const data = await res.json();
        setLiveStatus(data?.runner || null);
      }
    } catch (err) {
      console.debug('Failed to fetch live paper status:', err);
    }
  }, []);

  // Fetch Overnight Pilot (марафон) status — реальные paper-позиции/сделки по всем парам сессий
  const fetchPilotStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/overnight-pilot/status`);
      if (res.ok) {
        const data = await res.json();
        setPilotStatus(data);
      }
    } catch (err) {
      console.debug('Failed to fetch overnight pilot status:', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchMonitoring();
    fetchLiveStatus();
    fetchPilotStatus();
    const interval = setInterval(() => {
      fetchStatus();
      fetchMonitoring();
      fetchLiveStatus();
      fetchPilotStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchMonitoring, fetchLiveStatus, fetchPilotStatus]);

  // Handle Wallet Reset
  const handleResetWallet = async () => {
    if (!window.confirm('Сбросить виртуальный баланс обратно на $100.00 USD и очистить историю?')) {
      return;
    }
    setIsResetting(true);
    try {
      const res = await fetch(`${API_BASE}/paper-trading/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initial_balance: 100.0 })
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error('Failed to reset wallet:', err);
    } finally {
      setIsResetting(false);
    }
  };

  // Handle Kill Switch (Emergency Stop)
  const handleKillSwitch = async () => {
    if (!window.confirm('ВНИМАНИЕ: Активировать аварийную остановку (KILL SWITCH)? Все открытые позиции будут немедленно закрыты по рынку, а приём новых сигналов заблокирован.')) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/paper-trading/kill-switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Ручная аварийная остановка (UI Emergency Stop)' })
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error('Failed to trigger kill switch:', err);
    }
  };

  // Handle Resume Trading
  const handleResumeTrading = async () => {
    try {
      const res = await fetch(`${API_BASE}/paper-trading/resume`, {
        method: 'POST'
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error('Failed to resume trading:', err);
    }
  };

  // Позиции и сделки ночного марафона (Overnight Pilot) — единый список по всем сессиям
  const pilotOpen = useMemo(() => collectMarathonPositions(pilotStatus), [pilotStatus]);
  const pilotClosed = useMemo(() => collectMarathonTrades(pilotStatus), [pilotStatus]);
  const pilotAgg = pilotStatus?.aggregate?.paper;
  const hasPilotData = hasMarathonData(pilotStatus, pilotOpen, pilotClosed);

  // Live-раннер + марафон: показываем всё, что реально торговалось на paper (баланс тестовый — paper)
  const closedTrades = useMemo(
    () => mergePaperLists(sessionData?.closed_trades, pilotClosed),
    [sessionData, pilotClosed]
  );
  const openPositions = useMemo(
    () => mergePaperLists(sessionData?.positions, pilotOpen),
    [sessionData, pilotOpen]
  );

  // Единая сводка «по парам»: марафон + live-раннер (источник торговли, стратегия, PnL, статус)
  const paperPairs = useMemo(() => collectPaperPairs(pilotStatus, liveStatus), [pilotStatus, liveStatus]);

  // Претенденты и ожидающие заявки (working limit orders + сетапы по волатильностным конусам)
  const candidateSetups = useMemo(
    () => collectCandidateSetups(pilotStatus, monitoringData, sessionData),
    [pilotStatus, monitoringData, sessionData]
  );

  // Фильтрация и сортировка пар
  const processedPairs = useMemo(() => {
    const filtered = filterPaperPairs(paperPairs, {
      search: pairSearch,
      statusFilter: pairStatusFilter
    });
    return sortPaperPairs(filtered, sortField, sortDir);
  }, [paperPairs, pairSearch, pairStatusFilter, sortField, sortDir]);

  const handleSortClick = (field) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // Открыть рабочее место пары: переключить график (канал c1), режим бэктест-панели и поднять её
  const openPairWorkspace = (sym, mode) => {
    try { useColorLinksStore.getState().setChannelSymbol('c1', sym); } catch (_) {}
    try { useBacktestStore.getState().setMode(mode); } catch (_) {}
    window.dispatchEvent(new CustomEvent('signalscript:open-backtest'));
  };

  // Metrics calculation — торговая статистика по объединённым paper-системам (live-раннер + марафон)
  const metrics = useMemo(() => {
    if (!sessionData && closedTrades.length === 0 && openPositions.length === 0) {
      return {
        balance: 100.0,
        realizedPnl: 0.0,
        unrealizedPnl: 0.0,
        totalFees: 0.0,
        activePositions: 0,
        totalTrades: 0,
        winRate: 0,
        avgFee: 0,
        profitBleedPct: 0,
        uptimeStr: '00:00:00'
      };
    }

    const closed = closedTrades;
    const wins = closed.filter((t) => Number(t.net_pnl ?? 0) > 0);
    const wr = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const totalFeeDrag = closed.reduce((sum, trade) => sum + Number(trade.fee_drag ?? trade.fee ?? 0), 0);
    const bleedCount = closed.filter((trade) => trade.profit_bleed).length;

    const uptimeSec = sessionData?.uptime_seconds || 0;
    const hrs = Math.floor(uptimeSec / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;
    const uptimeStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // Профиль = live-раннер + все сессии марафона (общий тестовый баланс).
    const marathonSessions = Object.values(pilotStatus?.sessions || {});
    const marathonBalance = marathonSessions.reduce((sum, s) => sum + Number(s?.paper?.balance ?? 0), 0);
    const marathonRealized = marathonSessions.reduce((sum, s) => sum + Number(s?.paper?.realized_pnl ?? 0), 0);
    const marathonUnrealized = openPositions
      .filter((p) => p._source === 'marathon')
      .reduce((sum, p) => sum + Number(p.unrealized_pnl ?? 0), 0);
    const hasMarathon = marathonSessions.some((s) => s?.paper?.balance != null);
    const liveBalance = Number(sessionData?.balance ?? 0);
    const profileBalance = (hasMarathon ? marathonBalance : 0) + (sessionData ? liveBalance : 0);

    return {
      balance: profileBalance,
      realizedPnl: marathonRealized + Number(sessionData?.realized_pnl ?? 0),
      unrealizedPnl: marathonUnrealized + Number(sessionData?.unrealized_pnl ?? 0),
      totalFees: sessionData?.total_fees_paid ?? 0.0,
      activePositions: openPositions.length,
      totalTrades: closed.length,
      winRate: Math.round(wr),
      avgFee: closed.length > 0 ? totalFeeDrag / closed.length : 0,
      profitBleedPct: closed.length > 0 ? (bleedCount / closed.length) * 100 : 0,
      uptimeStr
    };
  }, [sessionData, closedTrades, openPositions, pilotStatus]);

  return (
    <div
      data-testid="trade-history-widget"
      className="h-full w-full flex flex-col overflow-hidden bg-[#0B0E11] text-neutral-200 select-none font-sans"
    >
      {/* Top Header & Stat Cards */}
      <div className="shrink-0 border-b border-neutral-800 bg-[#0E1217] px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-1 rounded bg-neutral-800 text-neutral-300">
              <History size={14} />
            </div>
            <div>
              <span className="font-semibold text-xs tracking-wide text-white">Trade History & Forecasts</span>
              <span className="ml-2 text-[10px] text-neutral-500 font-mono">Paper Trading $100.00</span>
              {hasPilotData && (
                <span
                  data-testid="marathon-summary-chip"
                  className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700"
                  title="Сводка ночного марафона (Overnight Pilot) — тестовый (paper) баланс, реальные деньги не используются"
                >
                  Марафон (тест): открыто {pilotOpen.length} · закрыто {pilotAgg?.closed_trades ?? pilotClosed.length} · Equity{' '}
                  {pilotAgg?.equity != null ? `$${Number(pilotAgg.equity).toFixed(2)}` : '—'}
                </span>
              )}
              {sessionData?.is_halted ? (
                <span data-testid="status-halted-badge" className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-700 animate-pulse">
                  HALTED
                </span>
              ) : (
                <span data-testid="status-active-badge" className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                  ACTIVE
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {sessionData?.is_halted ? (
              <button
                type="button"
                data-testid="btn-resume-trading"
                onClick={handleResumeTrading}
                className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-white border border-emerald-600 text-[10px] font-mono font-bold transition cursor-pointer shadow-sm"
                title="Возобновить прием сигналов и торговлю"
              >
                <span>▶ ВОЗОБНОВИТЬ</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="btn-kill-switch"
                onClick={handleKillSwitch}
                className="flex items-center space-x-1 px-2.5 py-0.5 rounded bg-rose-800 hover:bg-rose-700 text-white border border-rose-600 text-[10px] font-mono font-bold transition cursor-pointer shadow-sm"
                title="Аварийная остановка: отмена заявок, мгновенный выход по рынку, блокировка новых ордеров"
              >
                <AlertCircle size={10} />
                <span>EMERGENCY STOP</span>
              </button>
            )}
            <button
              type="button"
              onClick={fetchStatus}
              title="Обновить данные"
              className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition cursor-pointer"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={handleResetWallet}
              disabled={isResetting}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 hover:text-white text-[10px] font-mono transition cursor-pointer"
              title="Сбросить баланс обратно на $100.00 USD"
            >
              <RotateCcw size={10} />
              <span>{isResetting ? 'Сброс...' : 'Сброс $100'}</span>
            </button>
          </div>
        </div>

        {/* Активная стратегия live paper-раннера */}
        <div
          data-testid="active-strategy-row"
          className="flex items-center justify-between gap-2 rounded border border-cyan-900/60 bg-cyan-950/20 px-2 py-1"
        >
          <div className="flex items-center space-x-1.5 text-[10px] font-mono min-w-0">
            <Zap size={11} className="text-cyan-400 shrink-0" />
            {liveStatus ? (
              <>
                <span className="text-neutral-500 shrink-0">Стратегия:</span>
                <span className="text-cyan-200 font-bold truncate" title={liveStatus.strategy_type}>{liveStatus.strategy_type}</span>
                <span className="text-neutral-600 shrink-0">•</span>
                <span className="text-white font-bold shrink-0">{liveStatus.symbol}</span>
                <span className="text-neutral-600 shrink-0">•</span>
                <span className="text-neutral-300 shrink-0">{liveStatus.timeframe}</span>
                {liveStatus.leverage != null && (
                  <>
                    <span className="text-neutral-600 shrink-0">•</span>
                    <span className="text-neutral-300 shrink-0">плечо {liveStatus.leverage}x</span>
                  </>
                )}
                {liveStatus.ai_control && <span className="text-violet-300 shrink-0">• AI</span>}
                <span
                  className={`px-1 rounded text-[9px] font-bold border shrink-0 ${
                    liveStatus.is_running
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}
                >
                  {liveStatus.is_running ? 'RUNNING' : 'STOPPED'}
                </span>
              </>
            ) : (
              <span className="text-neutral-500">Live-раннер не запущен — стратегия не активна</span>
            )}
          </div>
          <button
            type="button"
            data-testid="btn-change-strategy"
            onClick={() => {
              try { useBacktestStore.getState().setMode('live_paper'); } catch (_) {}
              window.dispatchEvent(new CustomEvent('signalscript:open-backtest'));
            }}
            className="shrink-0 flex items-center space-x-1 px-2 py-0.5 rounded bg-cyan-900/60 hover:bg-cyan-800 border border-cyan-700 text-cyan-100 text-[10px] font-mono transition cursor-pointer"
            title="Открыть панель paper-торговли: выбрать монету, стратегию, депозит и риск"
          >
            <Settings2 size={10} />
            <span>Сменить стратегию</span>
          </button>
        </div>

        {sessionData?.is_halted && (
          <div
            data-testid="paper-trading-halted-banner"
            className="flex items-center justify-between px-2.5 py-1.5 rounded bg-rose-950/80 border border-rose-600/80 text-rose-200 text-[10px] font-mono"
          >
            <div className="flex items-center space-x-2">
              <AlertCircle size={12} className="text-rose-400 shrink-0" />
              <span>
                <strong>СИСТЕМА ОСТАНОВЛЕНА (HALTED):</strong> {sessionData.halt_reason || 'Аварийный стоп активен'}.
                Новые ордера заблокированы.
              </span>
            </div>
            <button
              type="button"
              onClick={handleResumeTrading}
              className="px-2 py-0.5 rounded bg-rose-800 hover:bg-rose-700 text-white text-[9px] font-bold cursor-pointer transition"
            >
              Снять блок
            </button>
          </div>
        )}

        {/* Institutional Metrics Grid */}
        <div className="grid grid-cols-6 gap-2 text-center text-[10px] font-mono">
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Баланс профиля</span>
            <span className="font-bold text-white text-[12px] tabular-nums">
              ${metrics.balance.toFixed(2)}
            </span>
          </div>
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Realized PnL</span>
            <span
              className={`font-bold text-[12px] tabular-nums ${
                metrics.realizedPnl > 0 ? 'text-[#10b981]' : metrics.realizedPnl < 0 ? 'text-[#ef4444]' : 'text-neutral-300'
              }`}
            >
              {metrics.realizedPnl > 0 ? '+' : ''}${metrics.realizedPnl.toFixed(2)}
            </span>
          </div>
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Unrealized PnL</span>
            <span
              className={`font-bold text-[12px] tabular-nums ${
                metrics.unrealizedPnl > 0 ? 'text-[#10b981]' : metrics.unrealizedPnl < 0 ? 'text-[#ef4444]' : 'text-neutral-300'
              }`}
            >
              {metrics.unrealizedPnl > 0 ? '+' : ''}${metrics.unrealizedPnl.toFixed(2)}
            </span>
          </div>
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Позиции</span>
            <span className="font-bold text-neutral-200 text-[12px] tabular-nums">
              {metrics.activePositions}
            </span>
          </div>
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Win Rate</span>
            <span className="font-bold text-neutral-200 text-[12px] tabular-nums">
              {metrics.winRate}% <span className="text-[9px] text-neutral-500">({metrics.totalTrades})</span>
            </span>
          </div>
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Avg Fee Drag</span>
            <span className="font-bold text-amber-300 text-[12px] tabular-nums">-${metrics.avgFee.toFixed(2)}</span>
          </div>
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Profit Bleed</span>
            <span className="font-bold text-rose-300 text-[12px] tabular-nums">{metrics.profitBleedPct.toFixed(0)}%</span>
          </div>
          <div className="p-1.5 rounded bg-[#12161E] border border-neutral-800/80 flex flex-col">
            <span className="text-neutral-500 uppercase text-[9px]">Аптайм</span>
            <span className="font-bold text-neutral-400 text-[11px] tabular-nums">
              {metrics.uptimeStr}
            </span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center space-x-1 border-t border-neutral-800/60 pt-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setActiveTab('trades')}
            className={`px-2.5 py-1 rounded text-xs font-mono transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'trades'
                ? 'bg-neutral-800 text-white font-medium border border-neutral-700'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
            }`}
          >
            <History size={12} />
            <span>Закрытые сделки ({closedTrades.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('positions')}
            className={`px-2.5 py-1 rounded text-xs font-mono transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'positions'
                ? 'bg-neutral-800 text-white font-medium border border-neutral-700'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
            }`}
          >
            <Layers size={12} />
            <span>Активные позиции ({openPositions.length})</span>
          </button>
          <button
            type="button"
            data-testid="tab-candidates"
            onClick={() => setActiveTab('candidates')}
            className={`px-2.5 py-1 rounded text-xs font-mono transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'candidates'
                ? 'bg-neutral-800 text-white font-medium border border-neutral-700'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
            }`}
          >
            <Target size={12} className={candidateSetups.length > 0 ? 'text-amber-400' : ''} />
            <span>Претенденты ({candidateSetups.length})</span>
          </button>
          <button
            type="button"
            data-testid="tab-paper-pairs"
            onClick={() => setActiveTab('pairs')}
            className={`px-2.5 py-1 rounded text-xs font-mono transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'pairs'
                ? 'bg-neutral-800 text-white font-medium border border-neutral-700'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
            }`}
          >
            <Settings2 size={12} />
            <span>По парам ({paperPairs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('regimes')}
            className={`px-2.5 py-1 rounded text-xs font-mono transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'regimes'
                ? 'bg-neutral-800 text-white font-medium border border-neutral-700'
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'
            }`}
          >
            <Zap size={12} />
            <span>Квант-режимы & Прогнозы</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'trades' && (
          <div className="min-w-full">
            {closedTrades.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-neutral-500 text-xs">
                <Clock size={24} className="mb-2 text-neutral-600" />
                <span>Нет закрытых сделок. Ожидание сигналов фокус-листа...</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-neutral-800 bg-[#0E1217] text-neutral-400 uppercase text-[9.5px]">
                    <th className="py-2 px-3">Время</th>
                    <th className="py-2 px-3">Монета</th>
                    <th className="py-2 px-3">Сторона</th>
                    <th className="py-2 px-3 text-right">Объем</th>
                    <th className="py-2 px-3 text-right">Вход</th>
                    <th className="py-2 px-3 text-right">Выход</th>
                    <th className="py-2 px-3 text-right">Net PnL</th>
                    <th className="py-2 px-3 text-right">Fee Drag</th>
                    <th className="py-2 px-3 text-right">MFE / MAE</th>
                    <th className="py-2 px-3">Причина входа / выхода</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {closedTrades.slice().reverse().map((trade, idx) => {
                    const gross = (trade.exit_price - trade.entry_price) * (trade.side === 'LONG' ? 1 : -1) * trade.qty;
                    const pnlPct = trade.entry_price > 0
                      ? ((trade.exit_price - trade.entry_price) / trade.entry_price) * 100 * (trade.side === 'LONG' ? 1 : -1)
                      : 0;
                    const netPnl = Number(trade.net_pnl ?? gross - Number(trade.fee_drag ?? trade.fee ?? 0));
                    const feeDrag = Number(trade.fee_drag ?? trade.fee ?? 0);
                    const isProfit = netPnl > 0;
                    const timeStr = trade.exit_ts ? new Date(trade.exit_ts).toLocaleTimeString() : '--:--:--';

                    return (
                      <tr key={idx} className="hover:bg-neutral-800/40 transition">
                        <td className="py-2 px-3 text-neutral-400">{timeStr}</td>
                        <td className="py-2 px-3 font-bold text-white flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-600 inline-block" />
                          <span>{trade.symbol}</span>
                          {trade._source === 'marathon' && (
                            <span
                              data-testid="marathon-trade-badge"
                              className="px-1 rounded text-[8px] font-bold bg-amber-950 text-amber-300 border border-amber-700"
                              title="Сделка ночного марафона на тестовом (paper) балансе"
                            >
                              МАРАФОН·ТЕСТ
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              trade.side === 'LONG'
                                ? 'bg-[#10b98120] text-[#10b981] border border-[#10b98140]'
                                : 'bg-[#ef444420] text-[#ef4444] border border-[#ef444440]'
                            }`}
                          >
                            {trade.side === 'LONG' ? <ArrowUpRight size={10} className="mr-0.5" /> : <ArrowDownRight size={10} className="mr-0.5" />}
                            {trade.side}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                          <div className="text-white">${((trade.qty ?? 0) * (trade.entry_price ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
                          <div className="text-[9px] text-neutral-500">{trade.qty?.toFixed(4)} {trade.symbol?.replace('USDT', '')}</div>
                        </td>
                        <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                          ${trade.entry_price?.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                          ${trade.exit_price?.toFixed(2)}
                        </td>
                        <td className={`py-2 px-3 text-right font-bold tabular-nums ${isProfit ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                          {isProfit ? '+' : ''}${netPnl.toFixed(2)} ({isProfit ? '+' : ''}{pnlPct.toFixed(2)}%)
                        </td>
                        <td className="py-2 px-3 text-right text-amber-300 tabular-nums">-${feeDrag.toFixed(2)}</td>
                        <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                          <span className="text-emerald-300">+{Number(trade.mfe ?? 0).toFixed(2)}</span> / <span className="text-rose-300">-{Number(trade.mae ?? 0).toFixed(2)}</span>
                        </td>
                        <td className="py-2 px-3 text-neutral-400 max-w-[280px]">
                          <div className="truncate text-emerald-200/70" title={trade.entry_reason || trade.reason || 'Signal'}>
                            Вход: {trade.entry_reason || trade.reason || 'Signal'}
                          </div>
                          <div className="truncate text-rose-200/70" title={trade.reason || trade.exit_reason || ''}>
                            Выход: {trade.reason || trade.exit_reason || '—'}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'positions' && (
          <div className="min-w-full">
            {openPositions.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-neutral-500 text-xs">
                <Layers size={24} className="mb-2 text-neutral-600" />
                <span>Нет открытых позиций в текущем режиме</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-neutral-800 bg-[#0E1217] text-neutral-400 uppercase text-[9.5px]">
                    <th className="py-2 px-3">Монета</th>
                    <th className="py-2 px-3">Сторона</th>
                    <th className="py-2 px-3 text-right">Объем</th>
                    <th className="py-2 px-3 text-right">Цена входа</th>
                    <th className="py-2 px-3 text-right">Текущая цена</th>
                    <th className="py-2 px-3 text-right">Target / Stop</th>
                    <th className="py-2 px-3 text-right">Unrealized PnL</th>
                    <th className="py-2 px-3">Причина сделки</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {openPositions.map((pos, idx) => {
                    const lastPx = pos.last_price || pos.avg_entry_price;
                    const uPnl = (pos.unrealized_pnl ?? 0);
                    const isProfit = uPnl >= 0;

                    return (
                      <tr key={idx} className="hover:bg-neutral-800/40 transition">
                        <td className="py-2 px-3 font-bold text-white">
                          <span className="flex items-center space-x-1">
                            <span>{pos.symbol}</span>
                            {pos._source === 'marathon' && (
                              <span
                                data-testid="marathon-position-badge"
                                className="px-1 rounded text-[8px] font-bold bg-amber-950 text-amber-300 border border-amber-700"
                                title="Позиция ночного марафона на тестовом (paper) балансе"
                              >
                                МАРАФОН·ТЕСТ
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              pos.side === 'LONG'
                                ? 'bg-[#10b98120] text-[#10b981] border border-[#10b98140]'
                                : 'bg-[#ef444420] text-[#ef4444] border border-[#ef444440]'
                            }`}
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                          <div className="font-medium text-white">
                            ${((pos.qty ?? 0) * (pos.avg_entry_price ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </div>
                          <div className="text-[9px] text-neutral-500">{pos.qty?.toFixed(4)} {pos.symbol?.replace('USDT', '')}</div>
                        </td>
                        <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                          ${pos.avg_entry_price?.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right text-white font-medium tabular-nums">
                          ${lastPx?.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right text-neutral-400 text-[10px] tabular-nums">
                          <span className="text-[#10b981]">${pos.target_price?.toFixed(2) || '-'}</span> /{' '}
                          <span className="text-[#ef4444]">${pos.stop_price?.toFixed(2) || '-'}</span>
                        </td>
                        <td className={`py-2 px-3 text-right font-bold tabular-nums ${isProfit ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                          <div>{isProfit ? '+' : ''}${uPnl.toFixed(2)}</div>
                          <div className="text-[9px] font-medium opacity-80">
                            {pos.avg_entry_price > 0
                              ? `${((lastPx - pos.avg_entry_price) / pos.avg_entry_price * 100 * (pos.side === 'LONG' ? 1 : -1)).toFixed(2)}%`
                              : '—'}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-neutral-400 max-w-[260px] truncate" title={pos.reason}>
                          {pos.reason || 'Confluence Signal'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'candidates' && (
          <div className="min-w-full p-2" data-testid="candidates-panel">
            <div className="mb-2 bg-[#0E1217] p-2 rounded border border-neutral-800 flex items-center justify-between text-[10.5px] font-mono">
              <div className="flex items-center space-x-2">
                <Target size={14} className="text-amber-400" />
                <span className="font-semibold text-white">Претенденты и ожидающие заявки</span>
                <span className="text-neutral-500 text-[9.5px]">Лимитные ордера в стакане и сетапы по волатильностным конусам</span>
              </div>
              <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800 font-bold">
                Всего: {candidateSetups.length}
              </span>
            </div>

            {candidateSetups.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-neutral-500 text-xs">
                <Target size={24} className="mb-2 text-neutral-600" />
                <span>Нет активных лимитных заявок или претендентов на вход.</span>
                <span className="text-[10px] text-neutral-600 mt-1">
                  Системы мониторят рынок на появление сигналов с положительным математическим ожиданием.
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto border border-neutral-800 rounded">
                <table className="w-full text-left border-collapse text-[11px] font-mono min-w-[760px]" data-testid="candidates-table">
                  <thead>
                    <tr className="border-b border-neutral-800 bg-[#0E1217] text-neutral-400 uppercase text-[9.5px]">
                      <th className="py-2 px-3 sticky left-0 bg-[#0E1217] z-20 min-w-[105px] border-r border-neutral-800">Монета</th>
                      <th className="py-2 px-3">Тип</th>
                      <th className="py-2 px-3">Стратегия / Причина</th>
                      <th className="py-2 px-3 text-right">Вход / Лимит</th>
                      <th className="py-2 px-3 text-right">Текущая цена</th>
                      <th className="py-2 px-3 text-right">Дистанция</th>
                      <th className="py-2 px-3 text-right">SL / TP / R:R</th>
                      <th className="py-2 px-3 text-center">Статус</th>
                      <th className="py-2 px-3 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {candidateSetups.map((cand) => {
                      const isLong = cand.side === 'LONG';
                      const isOrder = cand.type === 'ORDER';

                      return (
                        <tr key={cand.id} className="hover:bg-neutral-800/40 transition group">
                          <td className="py-2 px-3 font-bold text-white sticky left-0 bg-[#0E1217] group-hover:bg-[#161b22] z-10 min-w-[105px] border-r border-neutral-800">
                            <div className="flex items-center space-x-1.5">
                              <button
                                type="button"
                                className="hover:text-cyan-300 cursor-pointer"
                                title="Показать пару на графике"
                                onClick={() => openPairWorkspace(cand.symbol, 'single')}
                              >
                                {cand.symbol}
                              </button>
                              <span
                                className={`px-1 py-0.2 rounded text-[8.5px] font-bold border ${
                                  isLong
                                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700'
                                    : 'bg-rose-950/60 text-rose-300 border-rose-700'
                                }`}
                              >
                                {cand.side}
                              </span>
                            </div>
                          </td>

                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                                isOrder
                                  ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                                  : 'bg-amber-950 text-amber-300 border-amber-700'
                              }`}
                            >
                              {isOrder ? 'ЛИМИТ В СТАКАНЕ' : 'СЕТАП КОНУСА'}
                            </span>
                          </td>

                          <td className="py-2 px-3 text-neutral-300 max-w-[200px] truncate" title={cand.reason || cand.strategy}>
                            <div className="truncate text-white font-medium">{cand.strategy}</div>
                            {cand.reason && (
                              <div className="truncate text-[9.5px] text-neutral-500">{cand.reason}</div>
                            )}
                          </td>

                          <td className="py-2 px-3 text-right text-white font-bold tabular-nums">
                            {cand.targetPrice ? `$${cand.targetPrice.toFixed(2)}` : '—'}
                          </td>

                          <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                            {cand.currentPrice ? `$${cand.currentPrice.toFixed(2)}` : '—'}
                          </td>

                          <td className="py-2 px-3 text-right font-bold tabular-nums">
                            <span
                              className={
                                (cand.distancePct ?? 99) <= 0.3
                                  ? 'text-emerald-400 font-extrabold'
                                  : 'text-neutral-400'
                              }
                            >
                              {cand.distancePct != null ? `${cand.distancePct.toFixed(2)}%` : '—'}
                            </span>
                          </td>

                          <td className="py-2 px-3 text-right text-[10px] tabular-nums whitespace-nowrap">
                            <span className="text-[#ef4444]">${cand.sl ? cand.sl.toFixed(2) : '—'}</span> /{' '}
                            <span className="text-[#10b981]">${cand.tp ? cand.tp.toFixed(2) : '—'}</span>
                            {cand.expectedRr != null && (
                              <span className="text-amber-300 font-bold ml-1">
                                (1:{cand.expectedRr.toFixed(1)})
                              </span>
                            )}
                          </td>

                          <td className="py-2 px-3 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold border ${
                                (cand.distancePct ?? 99) <= 0.3
                                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700 animate-pulse'
                                  : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                            >
                              {cand.status}
                            </span>
                          </td>

                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openPairWorkspace(cand.symbol, 'single')}
                              className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[9px] font-mono cursor-pointer"
                              title="Показать пару на графике"
                            >
                              График
                            </button>{' '}
                            <button
                              type="button"
                              onClick={() => openPairWorkspace(cand.symbol, 'live_paper')}
                              className="px-1.5 py-0.5 rounded bg-cyan-900/60 hover:bg-cyan-800 border border-cyan-700 text-cyan-100 text-[9px] font-mono cursor-pointer"
                              title="Торговать сетап на paper"
                            >
                              Торговать
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 text-[9.5px] text-neutral-500 font-mono px-1">
              Претенденты обновляются в реальном времени. При подходе цены к лимиту или триггерной зоне система производит автоматический вход согласно правилам стратегии.
            </div>
          </div>
        )}

        {activeTab === 'pairs' && (
          <div className="min-w-full p-2">
            {/* Верхняя панель: Поиск, Фильтры, Кнопка добавления пары */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2 bg-[#0E1217] p-2 rounded border border-neutral-800">
              <div className="flex items-center space-x-2 flex-1 min-w-[200px]">
                <div className="relative flex-1 max-w-xs">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <input
                    type="text"
                    value={pairSearch}
                    onChange={(e) => setPairSearch(e.target.value)}
                    placeholder="Поиск по паре или стратегии..."
                    className="w-full pl-7 pr-7 py-1 rounded bg-[#12161E] border border-neutral-700/80 text-[10.5px] font-mono text-white placeholder-neutral-500 focus:outline-none focus:border-cyan-500"
                  />
                  {pairSearch && (
                    <button
                      type="button"
                      onClick={() => setPairSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>

                {/* Быстрые фильтры */}
                <div className="flex items-center space-x-1 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => setPairStatusFilter('all')}
                    className={`px-2 py-0.5 rounded cursor-pointer transition ${
                      pairStatusFilter === 'all'
                        ? 'bg-neutral-700 text-white font-bold'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    Все ({paperPairs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPairStatusFilter('running')}
                    className={`px-2 py-0.5 rounded cursor-pointer transition ${
                      pairStatusFilter === 'running'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    В работе ({paperPairs.filter((p) => p.running).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPairStatusFilter('active_positions')}
                    className={`px-2 py-0.5 rounded cursor-pointer transition ${
                      pairStatusFilter === 'active_positions'
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 font-bold'
                        : 'text-neutral-400 hover:text-white hover:bg-neutral-800'
                    }`}
                  >
                    С позициями ({paperPairs.filter((p) => (p.openCount || 0) > 0).length})
                  </button>
                </div>
              </div>

              <button
                type="button"
                data-testid="btn-toggle-add-pair"
                onClick={() => setShowAddPair((prev) => !prev)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[10px] font-mono font-bold transition cursor-pointer border ${
                  showAddPair
                    ? 'bg-cyan-900 text-white border-cyan-600'
                    : 'bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 border-cyan-800'
                }`}
              >
                <Plus size={11} />
                <span>+ Добавить пару для теста</span>
              </button>
            </div>

            {/* Раскрывающаяся форма добавления монеты */}
            {showAddPair && (
              <div
                data-testid="add-pair-panel"
                className="mb-2 p-2.5 rounded bg-[#12161E] border border-cyan-900/60 flex flex-col gap-2 font-mono text-[10.5px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white flex items-center space-x-1.5">
                    <Sparkles size={12} className="text-cyan-400" />
                    <span>Быстрое добавление пары / выбор стратегии для теста</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddPair(false)}
                    className="text-neutral-500 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>

                {/* Популярные монеты в 1 клик */}
                <div>
                  <div className="text-[9.5px] text-neutral-400 mb-1">Популярные монеты (кликните для выбора):</div>
                  <div className="flex flex-wrap gap-1">
                    {POPULAR_COINS.map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setNewPairSymbol(sym)}
                        className={`px-1.5 py-0.5 rounded text-[9.5px] border cursor-pointer transition ${
                          newPairSymbol === sym
                            ? 'bg-cyan-900 text-white border-cyan-500 font-bold'
                            : 'bg-neutral-800/80 text-neutral-300 border-neutral-700 hover:bg-neutral-700 hover:text-white'
                        }`}
                      >
                        {sym.replace('USDT', '')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Настройка: Символ, Стратегия, Таймфрейм и действия */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end pt-1 border-t border-neutral-800">
                  <div>
                    <label className="block text-[9px] text-neutral-500 mb-0.5">Тикер (USDT):</label>
                    <input
                      type="text"
                      value={newPairSymbol}
                      onChange={(e) => setNewPairSymbol(e.target.value.toUpperCase().trim())}
                      placeholder="e.g. BTCUSDT"
                      className="w-full px-2 py-1 rounded bg-[#0B0E11] border border-neutral-700 text-white font-bold uppercase focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] text-neutral-500 mb-0.5">Стратегия:</label>
                    <select
                      value={newPairStrategy}
                      onChange={(e) => setNewPairStrategy(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-[#0B0E11] border border-neutral-700 text-neutral-200 focus:outline-none focus:border-cyan-500"
                    >
                      {AVAILABLE_STRATEGIES.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[9px] text-neutral-500 mb-0.5">Таймфрейм:</label>
                    <select
                      value={newPairTimeframe}
                      onChange={(e) => setNewPairTimeframe(e.target.value)}
                      className="w-full px-2 py-1 rounded bg-[#0B0E11] border border-neutral-700 text-neutral-200 focus:outline-none focus:border-cyan-500"
                    >
                      <option value="1m">1m</option>
                      <option value="3m">3m</option>
                      <option value="5m">5m (рекомендуется)</option>
                      <option value="15m">15m</option>
                      <option value="1h">1h</option>
                      <option value="4h">4h</option>
                    </select>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      disabled={!newPairSymbol}
                      onClick={() => {
                        if (!newPairSymbol) return;
                        openPairWorkspace(newPairSymbol, 'single');
                      }}
                      className="flex-1 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 font-bold transition disabled:opacity-40 cursor-pointer text-center"
                      title="Открыть бэктест на графике"
                    >
                      Бэктест
                    </button>
                    <button
                      type="button"
                      disabled={!newPairSymbol}
                      onClick={() => {
                        if (!newPairSymbol) return;
                        openPairWorkspace(newPairSymbol, 'ai');
                      }}
                      className="flex-1 py-1 rounded bg-violet-950 hover:bg-violet-900 border border-violet-700 text-violet-200 font-bold transition disabled:opacity-40 cursor-pointer text-center"
                      title="AI-подбор параметров"
                    >
                      AI-подбор
                    </button>
                    <button
                      type="button"
                      disabled={!newPairSymbol}
                      onClick={() => {
                        if (!newPairSymbol) return;
                        openPairWorkspace(newPairSymbol, 'live_paper');
                      }}
                      className="flex-1 py-1 rounded bg-cyan-900/70 hover:bg-cyan-800 border border-cyan-600 text-white font-bold transition disabled:opacity-40 cursor-pointer text-center"
                      title="Настроить и запустить торговлю на paper"
                    >
                      Торговать
                    </button>
                  </div>
                </div>
              </div>
            )}

            {processedPairs.length === 0 ? (
              <div className="h-40 flex flex-col items-center justify-center text-neutral-500 text-xs">
                <Settings2 size={24} className="mb-2 text-neutral-600" />
                <span>
                  {paperPairs.length === 0
                    ? 'Нет активных paper-сессий. Выберите монету выше или запустите марафон.'
                    : 'Нет пар, соответствующих заданным фильтрам поиска.'}
                </span>
              </div>
            ) : (
              <div className="overflow-x-auto border border-neutral-800 rounded">
                <table className="w-full text-left border-collapse text-[11px] font-mono min-w-[760px]" data-testid="paper-pairs-table">
                  <thead>
                    <tr className="border-b border-neutral-800 bg-[#0E1217] text-neutral-400 uppercase text-[9.5px]">
                      <th
                        className="py-1.5 px-2.5 sticky left-0 bg-[#0E1217] z-20 min-w-[105px] border-r border-neutral-800 cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('symbol')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Пара</span>
                          {sortField === 'symbol' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th className="py-1.5 px-2">Источник</th>
                      <th
                        className="py-1.5 px-2 cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('strategy')}
                      >
                        <div className="flex items-center space-x-1">
                          <span>Стратегия</span>
                          {sortField === 'strategy' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-1.5 px-2 text-right cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('equity')}
                      >
                        <div className="flex items-center justify-end space-x-1">
                          <span>Equity</span>
                          {sortField === 'equity' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-1.5 px-2 text-right cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('pnl')}
                      >
                        <div className="flex items-center justify-end space-x-1">
                          <span>PnL</span>
                          {sortField === 'pnl' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-1.5 px-2 text-right cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('roi')}
                      >
                        <div className="flex items-center justify-end space-x-1">
                          <span>ROI</span>
                          {sortField === 'roi' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-1.5 px-2 text-center cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('trades')}
                      >
                        <div className="flex items-center justify-center space-x-1">
                          <span>Откр./Закр.</span>
                          {sortField === 'trades' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-1.5 px-2 text-center cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('winRate')}
                      >
                        <div className="flex items-center justify-center space-x-1">
                          <span>WinRate</span>
                          {sortField === 'winRate' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-1.5 px-2 text-center cursor-pointer hover:text-white select-none"
                        onClick={() => handleSortClick('status')}
                      >
                        <div className="flex items-center justify-center space-x-1">
                          <span>Статус</span>
                          {sortField === 'status' ? (
                            <span className="text-cyan-400">{sortDir === 'asc' ? '▲' : '▼'}</span>
                          ) : (
                            <ArrowUpDown size={10} className="text-neutral-600 opacity-60" />
                          )}
                        </div>
                      </th>
                      <th className="py-1.5 px-2 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/50">
                    {processedPairs.map((pair) => {
                      const totalPnl = pairTotalPnl(pair);
                      return (
                        <tr key={pair.symbol} className="hover:bg-neutral-800/40 transition group">
                          {/* Зафиксированная колонка: Пара */}
                          <td className="py-1.5 px-2.5 font-bold text-white sticky left-0 bg-[#0E1217] group-hover:bg-[#161b22] z-10 min-w-[105px] border-r border-neutral-800">
                            <button
                              type="button"
                              className="hover:text-cyan-300 cursor-pointer flex items-center space-x-1 text-left"
                              title="Показать пару на графике (канал c1)"
                              onClick={() => openPairWorkspace(pair.symbol, 'single')}
                            >
                              <span>{pair.symbol}</span>
                            </button>
                          </td>
                          <td className="py-1.5 px-2">
                            <span className="flex items-center space-x-1">
                              {pair.sources.includes('marathon') && (
                                <span className="px-1 rounded text-[8px] font-bold bg-amber-950 text-amber-300 border border-amber-700" title="Ночной марафон (тестовый paper-баланс)">МАРАФОН</span>
                              )}
                              {pair.sources.includes('live') && (
                                <span className="px-1 rounded text-[8px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700" title="Live paper-раннер (тестовый paper-баланс)">LIVE</span>
                              )}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-neutral-300 max-w-[160px] truncate" title={`${pair.strategy || '—'} · ${pair.timeframe || '—'} · плечо ${pair.leverage ?? '—'}x${pair.aiControl ? ' · AI' : ''}`}>
                            {pair.strategy || '—'}
                            <span className="text-neutral-600"> {pair.timeframe || ''}{pair.aiControl ? ' · AI' : ''}</span>
                          </td>
                          <td className="py-1.5 px-2 text-right text-neutral-200 tabular-nums">
                            {pair.equity != null ? `$${pair.equity.toFixed(2)}` : '—'}
                          </td>
                          <td className={`py-1.5 px-2 text-right font-bold tabular-nums ${totalPnl == null ? 'text-neutral-500' : totalPnl >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                            {totalPnl == null ? '—' : `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
                          </td>
                          <td className={`py-1.5 px-2 text-right tabular-nums ${(pair.roiPct ?? 0) >= 0 ? 'text-neutral-300' : 'text-rose-300'}`}>
                            {pair.roiPct != null ? `${pair.roiPct > 0 ? '+' : ''}${pair.roiPct.toFixed(2)}%` : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-center text-neutral-300 tabular-nums">
                            {pair.openCount} / {pair.closedCount}
                          </td>
                          <td className="py-1.5 px-2 text-center text-neutral-300 tabular-nums">
                            {pair.winRatePct != null ? `${pair.winRatePct}%` : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <span
                              className={`px-1 rounded text-[9px] font-bold border ${
                                pair.dataStatus === 'stale' || pair.dataStatus === 'disconnected'
                                  ? 'bg-rose-950 text-rose-300 border-rose-700'
                                  : pair.running
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                                    : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                              }`}
                              title={pair.dataStatus ? `данные: ${pair.dataStatus}` : undefined}
                            >
                              {pair.dataStatus === 'stale' || pair.dataStatus === 'disconnected'
                                ? 'DATA!'
                                : pair.running
                                  ? 'RUNNING'
                                  : 'STOPPED'}
                            </span>
                          </td>
                          <td className="py-1.5 px-2 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => openPairWorkspace(pair.symbol, 'single')}
                              className="px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[9px] font-mono cursor-pointer"
                              title="Бэктест стратегии на этой паре (график переключится на пару)"
                            >
                              Бэктест
                            </button>{' '}
                            <button
                              type="button"
                              onClick={() => openPairWorkspace(pair.symbol, 'ai')}
                              className="px-1.5 py-0.5 rounded bg-violet-950 hover:bg-violet-900 border border-violet-700 text-violet-200 text-[9px] font-mono cursor-pointer"
                              title="AI-подбор стратегии по данным бэктеста для этой пары"
                            >
                              AI-подбор
                            </button>{' '}
                            <button
                              type="button"
                              data-testid={`btn-pair-trade-${pair.symbol}`}
                              onClick={() => openPairWorkspace(pair.symbol, 'live_paper')}
                              className="px-1.5 py-0.5 rounded bg-cyan-900/60 hover:bg-cyan-800 border border-cyan-700 text-cyan-100 text-[9px] font-mono cursor-pointer"
                              title="Настроить и запустить paper-торговлю по этой паре"
                            >
                              Торговать
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 text-[9.5px] text-neutral-500 font-mono px-1">
              Единый paper-модуль: подбор стратегии (бэктест / AI) → запуск торговли по паре → позиции и сделки выше. Баланс везде тестовый (paper), реальные деньги не используются.
            </div>
          </div>
        )}

        {activeTab === 'regimes' && (
          <div className="p-3">
            <div className="mb-2 text-[10px] text-neutral-400 font-mono flex items-center justify-between">
              <span>Адаптивный классификатор режимов рынка (Walk-Forward Adaptive Brain):</span>
              <span className="text-[9.5px] text-neutral-500">In-Sample 72h • Auto-TP/SL</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px]">
              {Object.entries(monitoringData?.statuses || {}).map(([ticker, st]) => {
                const regime = st.regime || (st.state === 'toxic_halt' ? 'TOXIC_VOLATILITY' : 'FLAT_DENSE');
                const isToxic = regime === 'TOXIC_VOLATILITY' || st.is_trade_allowed === false;
                const isTrend = regime === 'TREND_IMPULSE';
                const isFlat = regime === 'FLAT_DENSE' && !isToxic;

                return (
                  <div
                    key={ticker}
                    className={`p-2.5 rounded border flex flex-col space-y-1.5 transition ${
                      isToxic
                        ? 'bg-rose-950/20 border-rose-500/40 shadow-xs shadow-rose-950/50'
                        : isTrend
                        ? 'bg-emerald-950/15 border-emerald-500/30'
                        : 'bg-[#12161E] border-neutral-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 font-bold text-white">
                        <span className="text-amber-400 font-mono text-[9px] bg-amber-400/10 px-1 rounded border border-amber-400/20">BINANCE</span>
                        <span>{ticker}</span>
                      </div>

                      {/* Regime Badge */}
                      {isToxic ? (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded font-bold bg-rose-500/15 text-rose-400 border border-rose-500/40 flex items-center space-x-1 animate-pulse">
                          <span>🔴 TOXIC (Входы заблокированы)</span>
                        </span>
                      ) : isTrend ? (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 flex items-center space-x-1">
                          <span>🟢 TREND_IMPULSE</span>
                        </span>
                      ) : (
                        <span className="text-[9.5px] px-1.5 py-0.5 rounded font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 flex items-center space-x-1">
                          <span>🟡 FLAT_DENSE</span>
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] text-neutral-400 flex items-center justify-between">
                      <span className="truncate">Стратегия: <span className="text-neutral-200">{st.regime_name || 'Adaptive Quant'}</span></span>
                      {st.regime_metrics && (
                        <span className="text-neutral-500 text-[9px] tabular-nums">
                          ATR: {(st.regime_metrics.norm_atr * 100).toFixed(2)}% • Плотность: {st.regime_metrics.rel_density}x
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10px] pt-1 border-t border-neutral-800/50">
                      <div>
                        <span className="text-neutral-500">7d PnL: </span>
                        <span className={`font-bold ${st.pnl_pct > 0 ? 'text-[#10b981]' : st.pnl_pct < 0 ? 'text-[#ef4444]' : 'text-neutral-300'}`}>
                          {st.pnl_pct ? `${st.pnl_pct > 0 ? '+' : ''}${st.pnl_pct.toFixed(1)}%` : '0.0%'}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Сигнал: </span>
                        <span className={`font-bold ${
                          isToxic
                            ? 'text-rose-400'
                            : st.signal === 'LONG'
                            ? 'text-[#10b981]'
                            : st.signal === 'SHORT'
                            ? 'text-[#ef4444]'
                            : 'text-neutral-400'
                        }`}>
                          {isToxic ? 'BLOCKED' : (st.signal || 'NEUTRAL')}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Тренд: </span>
                        <span className="text-neutral-200 font-bold">{st.forecast_trend || 'FLAT'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
