import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  ShieldAlert, 
  TrendingUp, 
  Activity, 
  Zap, 
  ChevronDown, 
  ChevronUp, 
  Layers, 
  Magnet, 
  Radio, 
  Compass, 
  AlertTriangle,
  CheckCircle2,
  Minimize2,
  Maximize2
} from 'lucide-react';

const API_BASE = '/api';

/**
 * Tactical Assistant HUD: Floating Predictive & Market Regime Overlay.
 * 
 * Features:
 * 1. Market Regime Indication (TREND, FLAT, TOXIC) with institutional recommendations.
 * 2. Active Position Hints (Live Reflexion): MFE/MAE excursions, breakeven triggers, early exit alerts.
 * 3. Quick Tactical Controls: Volatility Cone Projection (±1σ / ±2σ) and Depth20 Liquidity Magnet Walls.
 * 4. Compact / Expanded toggle to never obstruct chart controls.
 */
export default function AssistantHUD({
  symbol = 'BTCUSDT',
  timeframe = '5m',
  lastPrice = 0,
  showWalls = true,
  onToggleWalls = null,
  isConeActive = false,
  onToggleCone = null,
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [monitoringData, setMonitoringData] = useState(null);
  const [paperState, setPaperState] = useState(null);
  const [loading, setLoading] = useState(false);

  // Poll monitoring state and paper trading status every 2.5s
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/monitoring/state`);
      if (res.ok) {
        const data = await res.json();
        setMonitoringData(data);
        if (data.paper_trading) {
          setPaperState(data.paper_trading);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, [fetchStatus, symbol]);

  // Extract regime information for active coin
  const tickerStatus = useMemo(() => {
    if (!monitoringData || !monitoringData.statuses) return null;
    return monitoringData.statuses[symbol.toUpperCase()] || null;
  }, [monitoringData, symbol]);

  const regimeInfo = useMemo(() => {
    const raw = (tickerStatus?.regime || 'FLAT_DENSE').toUpperCase();
    if (raw.includes('TOXIC')) {
      return {
        key: 'TOXIC',
        badge: '🔴 TOXIC',
        title: 'Токсичный рынок',
        recommendation: 'Токсичный рынок. Спреды расширены. Входы заблокированы.',
        bg: 'bg-rose-950/90',
        border: 'border-rose-500/50',
        badgeBg: 'bg-rose-900/60 text-rose-300 border-rose-500/60',
        dot: 'bg-rose-500',
        isTradeAllowed: false,
      };
    }
    if (raw.includes('TREND')) {
      return {
        key: 'TREND',
        badge: '🟢 TREND',
        title: 'Трендовый режим',
        recommendation: 'Тренд. Рекомендация: Пробойные стратегии, широкие стопы.',
        bg: 'bg-emerald-950/85',
        border: 'border-emerald-500/50',
        badgeBg: 'bg-emerald-900/60 text-emerald-300 border-emerald-500/60',
        dot: 'bg-emerald-400',
        isTradeAllowed: true,
      };
    }
    return {
      key: 'FLAT',
      badge: '🟡 FLAT',
      title: 'Флэтовый режим',
      recommendation: 'Флэт. Рекомендация: Возврат к среднему, короткие тейки.',
      bg: 'bg-amber-950/85',
      border: 'border-amber-500/50',
      badgeBg: 'bg-amber-900/60 text-amber-300 border-amber-500/60',
      dot: 'bg-amber-400',
      isTradeAllowed: true,
    };
  }, [tickerStatus]);

  // Active paper position for current symbol
  const activePosition = useMemo(() => {
    if (!paperState || !Array.isArray(paperState.positions)) return null;
    return paperState.positions.find((p) => p.symbol === symbol.toUpperCase()) || null;
  }, [paperState, symbol]);

  // Dynamic alert / tactical hint based on position state and Early Exit Engine
  const positionAlert = useMemo(() => {
    if (!activePosition) return null;

    const side = activePosition.side === 'LONG' ? 'лонг' : 'шорт';
    const isLong = activePosition.side === 'LONG';
    const mfeR = Number(activePosition.mfe_r ?? 0);
    const pnlR = Number(activePosition.current_pnl_r ?? 0);
    const pnlUsd = Number(activePosition.unrealized_pnl ?? 0);
    const beTriggered = Boolean(activePosition.breakeven_triggered);
    const alerts = activePosition.active_alerts || [];

    if (beTriggered) {
      return {
        type: 'BE',
        severity: 'success',
        text: '🛡️ Сработал динамический безубыток. Риск сведен к нулю.',
        highlight: 'text-emerald-400 font-bold',
      };
    }

    if (alerts.some((a) => a.alert_type === 'MFE_Bleed') || (mfeR >= 0.5 && pnlR <= mfeR * 0.5)) {
      return {
        type: 'MFE_BLEED',
        severity: 'warning',
        text: `⚠️ Позиция в ${side}: MFE +${mfeR.toFixed(1)}R. Прибыль откатывает к +${pnlR.toFixed(1)}R, рассмотрите подтяжку стопа.`,
        highlight: 'text-amber-400 font-semibold',
      };
    }

    if (mfeR >= 0.4) {
      return {
        type: 'MFE_ALERT',
        severity: 'info',
        text: `Позиция в ${side}: MFE +${mfeR.toFixed(1)}R. Внимание: кумулятивная дельта падает, рассмотрите подтяжку стопа.`,
        highlight: 'text-sky-300',
      };
    }

    if (alerts.some((a) => a.alert_type === 'Time_Stop')) {
      return {
        type: 'TIME_STOP',
        severity: 'warning',
        text: '⏱️ Внимание: позиция удерживается >5 мин без импульса (< 0.2R). Потеря моментума.',
        highlight: 'text-amber-300',
      };
    }

    return {
      type: 'INFO',
      severity: 'neutral',
      text: `Позиция в ${side} (${activePosition.qty} ${symbol}) · PnL: ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)} (${pnlR >= 0 ? '+' : ''}${pnlR.toFixed(2)}R)`,
      highlight: pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400',
    };
  }, [activePosition, symbol]);

  // Trigger volatility cone projection
  const handleProjectCone = useCallback(() => {
    if (onToggleCone) {
      onToggleCone();
      return;
    }
    // Fallback: Dispatch custom event for Chart.jsx
    window.dispatchEvent(
      new CustomEvent('apply-volatility-cone', {
        detail: {
          symbol,
          timeframe,
        },
      })
    );
  }, [onToggleCone, symbol, timeframe]);

  return (
    <div
      data-testid="assistant-hud"
      className="absolute top-2.5 right-16 z-20 pointer-events-auto select-none font-mono transition-all duration-200"
    >
      {/* Minimized Pill Mode */}
      {!isExpanded ? (
        <div
          data-testid="assistant-hud-minimized"
          onClick={() => setIsExpanded(true)}
          className="flex items-center space-x-2 px-2.5 py-1 rounded-md bg-[#0b0e14]/90 border border-neutral-700/80 shadow-2xl backdrop-blur-md cursor-pointer hover:border-neutral-500 transition text-[10.5px]"
          title="Развернуть Live Tactical Assistant HUD"
        >
          <span className={`w-2 h-2 rounded-full ${regimeInfo.dot} animate-pulse`} />
          <span data-testid="assistant-regime-badge" className="font-bold text-white tracking-wide">
            {regimeInfo.badge}
          </span>
          {activePosition && (
            <span
              className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                activePosition.side === 'LONG' ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
              }`}
            >
              {activePosition.side} ({activePosition.current_pnl_r >= 0 ? '+' : ''}
              {activePosition.current_pnl_r ?? 0}R)
            </span>
          )}
          <ChevronDown size={13} className="text-neutral-400 hover:text-white" />
        </div>
      ) : (
        /* Expanded Tactical HUD Card */
        <div
          data-testid="assistant-hud-card"
          className="w-80 rounded-lg bg-[#0b0f17]/95 border border-neutral-800 shadow-2xl backdrop-blur-md p-2.5 text-neutral-200 text-[10.5px] font-mono animate-in fade-in zoom-in-95"
        >
          {/* Header with Title & Collapse */}
          <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800/80 mb-2">
            <div className="flex items-center space-x-1.5">
              <Compass size={13} className="text-sky-400" />
              <span className="font-bold text-white text-[11px] tracking-wide">
                Tactical Assistant · {symbol}
              </span>
            </div>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                data-testid="btn-collapse-assistant"
                onClick={() => setIsExpanded(false)}
                className="p-0.5 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition cursor-pointer"
                title="Свернуть панель ассистента"
              >
                <ChevronUp size={13} />
              </button>
            </div>
          </div>

          {/* 1.1 Market Regime Badge & Recommendation */}
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1">
              <span
                data-testid="assistant-regime-badge"
                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${regimeInfo.badgeBg} flex items-center space-x-1.5`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${regimeInfo.dot} animate-pulse`} />
                <span>{regimeInfo.badge}</span>
              </span>

              {tickerStatus?.regime_metrics && (
                <span className="text-[9.5px] text-neutral-400">
                  ATR: {(Number(tickerStatus.regime_metrics.norm_atr || 0) * 100).toFixed(2)}% · Плотн:{' '}
                  {Number(tickerStatus.regime_metrics.rel_density || 1).toFixed(2)}
                </span>
              )}
            </div>

            <div
              data-testid="assistant-regime-recommendation"
              className="p-1.5 rounded bg-[#131926]/90 border border-neutral-800/80 text-[10px] text-neutral-200 leading-tight"
            >
              {regimeInfo.recommendation}
            </div>
          </div>

          {/* 1.2 Live Reflexion: Active Position & Early Exit Alerts */}
          {activePosition ? (
            <div
              data-testid="assistant-position-box"
              className="mb-2 p-2 rounded bg-[#101624] border border-sky-500/30 text-[10px]"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-sky-300 uppercase tracking-wide flex items-center space-x-1">
                  <Activity size={11} className="text-sky-400" />
                  <span>Позиция: {activePosition.side}</span>
                </span>
                <span
                  className={`font-bold ${
                    (activePosition.unrealized_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {(activePosition.unrealized_pnl ?? 0) >= 0 ? '+' : ''}$
                  {Number(activePosition.unrealized_pnl ?? 0).toFixed(2)} (
                  {(activePosition.current_pnl_r ?? 0) >= 0 ? '+' : ''}
                  {activePosition.current_pnl_r ?? 0}R)
                </span>
              </div>

              {/* Excursion metrics MFE / MAE */}
              <div className="grid grid-cols-2 gap-1 text-[9px] text-neutral-400 bg-[#090d15] p-1 rounded border border-neutral-800/60 mb-1.5">
                <div>
                  MFE (макс. профит):{' '}
                  <span className="text-emerald-400 font-semibold">
                    +{Number(activePosition.mfe_r ?? 0).toFixed(2)}R
                  </span>
                </div>
                <div>
                  MAE (макс. просадка):{' '}
                  <span className="text-rose-400 font-semibold">
                    -{Number(activePosition.mae_r ?? 0).toFixed(2)}R
                  </span>
                </div>
              </div>

              {/* Dynamic Tactical Alert */}
              {positionAlert && (
                <div
                  data-testid="assistant-position-alert"
                  className={`text-[9.5px] leading-snug p-1 rounded bg-[#141b2b] border border-neutral-700/60 ${positionAlert.highlight}`}
                >
                  {positionAlert.text}
                </div>
              )}
            </div>
          ) : (
            <div
              data-testid="assistant-no-position"
              className="mb-2 p-1.5 rounded bg-[#10141e]/60 border border-neutral-800/60 text-[9.5px] text-neutral-400 text-center"
            >
              Нет открытой позиции по {symbol}. Ожидание сигнала алгоритма.
            </div>
          )}

          {/* Quick Tactical Controls: Volatility Cone & Magnet Walls */}
          <div className="grid grid-cols-2 gap-1.5 pt-1.5 border-t border-neutral-800/80">
            <button
              type="button"
              data-testid="btn-hud-toggle-cone"
              onClick={handleProjectCone}
              className={`py-1 px-1.5 rounded text-[9.5px] font-bold flex items-center justify-center space-x-1 transition cursor-pointer border ${
                isConeActive
                  ? 'bg-sky-600/30 text-sky-300 border-sky-500/60 shadow-xs'
                  : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
              }`}
              title="Спроецировать вероятностный конус волатильности (±1σ / ±2σ) на следующие 16 баров"
            >
              <Layers size={11} className={isConeActive ? 'text-sky-300' : 'text-neutral-400'} />
              <span>{isConeActive ? 'Конус [ВКЛ]' : '📐 Прогноз. конус'}</span>
            </button>

            <button
              type="button"
              data-testid="btn-hud-toggle-walls"
              onClick={onToggleWalls}
              className={`py-1 px-1.5 rounded text-[9.5px] font-bold flex items-center justify-center space-x-1 transition cursor-pointer border ${
                showWalls
                  ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/60 shadow-xs'
                  : 'bg-neutral-800/80 hover:bg-neutral-700 text-neutral-300 border-neutral-700'
              }`}
              title="Отобразить крупнейшие лимитные стенки стакана (depth20) как уровни-магниты"
            >
              <Magnet size={11} className={showWalls ? 'text-emerald-300' : 'text-neutral-400'} />
              <span>{showWalls ? 'Стенки [ВКЛ]' : '🧲 Стенки стакана'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
