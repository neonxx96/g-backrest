import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose } from 'klinecharts';
import './chart/registerCustomElements.js';
import { useChartOverlays } from './chart/useChartOverlays.js';
import { 
  X,
  Loader2,
  Zap,
  AlertTriangle
} from 'lucide-react';
import { INDICATORS_REGISTRY, DEFAULT_ACTIVE_INDICATORS } from '../config/indicatorsRegistry';
import IndicatorsModal from './indicators/IndicatorsModal';
import IndicatorSettingsDialog from './indicators/IndicatorSettingsDialog';
import ActiveIndicatorStack from './indicators/ActiveIndicatorStack';
import { useLayoutStore } from '../stores/layoutStore';
import { useColorLinksStore } from '../stores/colorLinksStore';
import { useMarketDataStore } from '../stores/marketDataStore';
import { fetchKlinesDualSource, TF_MS } from '../services/marketDataFetcher';
import { useTradeOverlayStore, calculatePositionMetrics } from '../stores/tradeOverlayStore';
import { useBacktestStore } from '../stores/backtestStore';
import { useTradesStore } from '../stores/tradesStore';
import { renderBacktestTrades, clearBacktestTrades, renderLiveSignals, clearLiveSignals, renderWhaleTrades, clearWhaleTrades } from '../utils/chartAnnotations';
import AssistantHUD from './AssistantHUD';
import DepthHeatmapGL from './DepthHeatmapGL';
import ChartToolbar from './chart/ChartToolbar.jsx';
import ChartContextMenu, { useChartContextMenu } from './chart/ChartContextMenu.jsx';
import { useChartDrawings } from './chart/useChartDrawings.js';

const API_BASE = "/api";

// --- Шаг A: глубина истории ----------------------------------------------------
// Первая загрузка всегда передаёт startTime (одно окно в 1500 свечей = максимум
// Binance на запрос); скролл влево подгружает более старые окна через
// chart.loadMore до дневного пола истории (приёмка: 1m/1h >= 30д, 45m/6h >= 14д).
const INITIAL_HISTORY_BARS = 1500;
const LOAD_MORE_WINDOW_BARS = 1500;
const HISTORY_FLOOR_DAYS = {
  '1m': 30, '5m': 30, '15m': 45, '30m': 60,
  '45m': 30, '1h': 90, '4h': 180, '6h': 180
};


function hexToRgba(hex, alpha = 1) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildChartStyles(uiConfig = {}) {
  const theme = uiConfig.theme || 'tealstreet';
  const gridOpacity = uiConfig.gridOpacity ?? 0.22;
  const candleOpacity = uiConfig.candleOpacity ?? 1.0;
  const emaColors = uiConfig.emaColors || ['#38bdf8', '#f59e0b', '#a855f7'];
  const emaWidth = uiConfig.emaWidth ?? 1.5;

  const palette = theme === 'tiger'
    ? { bull: '#00f5d4', bear: '#ff2a6d', gridRgb: '0, 229, 255', axis: '#141c2b', tick: '#64748b' }
    : theme === 'bloomberg'
    ? { bull: '#00e676', bear: '#ff3d00', gridRgb: '255, 152, 0', axis: '#332400', tick: '#b45309' }
    : { bull: '#26a69a', bear: '#ef5350', gridRgb: '120, 135, 165', axis: '#161922', tick: '#60697b' };

  const gridColor = `rgba(${palette.gridRgb}, ${gridOpacity})`;
  const upCol = hexToRgba(palette.bull, candleOpacity);
  const dnCol = hexToRgba(palette.bear, candleOpacity);

  return {
    grid: {
      show: true,
      horizontal: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] },
      vertical: { color: gridColor, style: 'dash', size: 1, dashedValue: [2, 4] }
    },
    candle: {
      type: 'candle_solid',
      bar: {
        upColor: upCol,
        downColor: dnCol,
        noChangeColor: '#787f91',
        upBorderColor: palette.bull,
        downBorderColor: palette.bear,
        noChangeBorderColor: '#787f91',
        upWickColor: palette.bull,
        downWickColor: palette.bear,
        noChangeWickColor: '#787f91'
      },
      priceMark: {
        show: true,
        high: { show: true, color: palette.tick, textSize: 10 },
        low: { show: true, color: palette.tick, textSize: 10 },
        last: {
          show: true,
          upColor: palette.bull,
          downColor: palette.bear,
          noChangeColor: '#787f91',
          line: { show: true, style: 'dash', dashedValue: [3, 3], size: 1 },
          text: { show: true, color: '#ffffff', size: 11, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2 }
        }
      }
    },
    indicator: {
      bars: [{
        style: 'fill',
        borderStyle: 'solid',
        borderSize: 1,
        upColor: hexToRgba(palette.bull, 0.28),
        downColor: hexToRgba(palette.bear, 0.28),
        noChangeColor: 'rgba(120, 127, 145, 0.25)'
      }],
      lines: [
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[0] || '#38bdf8', dashedValue: [2, 2] },
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[1] || '#f59e0b', dashedValue: [2, 2] },
        { style: 'solid', smooth: false, size: emaWidth, color: emaColors[2] || '#a855f7', dashedValue: [2, 2] }
      ]
    },
    xAxis: {
      axisLine: { show: true, color: palette.axis },
      tickLine: { show: true, color: palette.axis },
      tickText: { color: palette.tick, size: 10, family: 'var(--font-mono)' }
    },
    yAxis: {
      axisLine: { show: true, color: palette.axis },
      tickLine: { show: true, color: palette.axis },
      tickText: { color: palette.tick, size: 10, family: 'var(--font-mono)' }
    },
    crosshair: {
      show: true,
      horizontal: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } },
      vertical: { show: true, line: { color: '#2a3142', style: 'dash', dashedValue: [3, 3] }, text: { color: '#ffffff', backgroundColor: '#181c26' } }
    }
  };
}

export default function Chart({ 
  chartId = "primary", 
  symbol: propSymbol = "BTCUSDT", 
  timeframe = "15m", 
  userId = "0", 
  titlePrefix = "", 
  onTimeframeChange,
  backtestSignals = null,
  showBacktestSignals = true,
  strategyLevels = [],
  activePositionSetup = null,
  uiConfig = null,
  chartIndicators = null,
  onOpenIndicators = null,
  onCloseWidget = null
}) {
  const channelSymbol = useColorLinksStore((s) => chartId ? s.getPanelSymbol(chartId, propSymbol) : null);
  const symbol = (channelSymbol || propSymbol || "BTCUSDT").toUpperCase();

  const chartContainerRef = useRef(null);
  // Инстанс klinecharts в state — чтобы WebGL-heatmap (DepthHeatmapGL) реагировала на re-init
  const [chartInstance, setChartInstance] = useState(null);
  const chartRef = useRef(null);
  const wsRef = useRef(null);
  const btOverlayIds = useRef([]); // backtest signal overlays (never saved as drawings)
  const activeStrategyLevelOverlays = useRef([]); // strategy entry zones (never saved as drawings)
  const activeVolatilityConeOverlayId = useRef(null); // volatility cone overlay
  const [isConeActive, setIsConeActive] = useState(false);
  const activePositionOverlayId = useRef(null);
  const [localPositionSetup, setLocalPositionSetup] = useState(null);
  const lastScrolledResult = useRef(null);
  const [klinesVersion, setKlinesVersion] = useState(0);
  const [btTooltip, setBtTooltip] = useState(null);
  const [paperTrades, setPaperTrades] = useState([]);
  const paperOverlayIds = useRef([]);

  // Market Regime: Toxic Volatility state
  const [isToxicRegime, setIsToxicRegime] = useState(false);
  const [isToxicDismissed, setIsToxicDismissed] = useState(false);

  useEffect(() => {
    setIsToxicDismissed(false);
    let isSubscribed = true;
    const checkRegime = async () => {
      try {
        const res = await fetch('/api/monitoring/state');
        if (res.ok && isSubscribed) {
          const data = await res.json();
          const symKey = symbol ? symbol.toUpperCase() : '';
          const symStatus = data.statuses?.[symKey] || data.statuses?.[symbol];
          const isToxic = symStatus?.regime === 'TOXIC_VOLATILITY' || (symStatus?.is_trade_allowed === false && symStatus?.state === 'toxic_halt');
          setIsToxicRegime(!!isToxic);
        }
      } catch (e) {}
    };
    checkRegime();
    const interval = setInterval(checkRegime, 4000);
    return () => { isSubscribed = false; clearInterval(interval); };
  }, [symbol]);

  // Synchronize with quantitative Backtest Store
  const activeBtResult = useBacktestStore((s) => s.activeResult);
  const showTradesOnChart = useBacktestStore((s) => s.showTradesOnChart);
  const isBacktesting = useBacktestStore((s) => s.isRunning);
  const runQuickBacktest = useBacktestStore((s) => s.runQuickBacktest);

  const effectiveBacktestSignals = backtestSignals || (activeBtResult?.symbol === symbol.toUpperCase() ? activeBtResult : null);
  const effectiveShowBtSignals = showBacktestSignals && showTradesOnChart;

  // Real-time signal overlay state from marketDataStore (Requirement 3)
  const liveSignals = useMarketDataStore((s) => s.liveSignals);
  const showLiveSignals = useMarketDataStore((s) => s.showLiveSignals);
  const toggleLiveSignals = useMarketDataStore((s) => s.toggleLiveSignals);
  const liveSignalOverlayIds = useRef([]);

  // Paper trades share the same native overlay path as historical trades, with muted blue/violet colors.
  useEffect(() => {
    let active = true;
    const loadPaperTrades = async () => {
      try {
        const response = await fetch('/api/paper-trading/status');
        if (!response.ok) return;
        const payload = await response.json();
        if (active) setPaperTrades((payload.closed_trades || []).filter((trade) => trade.symbol === symbol.toUpperCase()));
      } catch (_) {
        if (active) setPaperTrades([]);
      }
    };
    loadPaperTrades();
    const interval = setInterval(loadPaperTrades, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [symbol]);

  const handleQuickBacktestCurrentSetup = useCallback(async () => {
    try {
      await runQuickBacktest({ symbol, timeframe });
    } catch (err) {
      console.error("Quick backtest failed:", err);
    }
  }, [runQuickBacktest, symbol, timeframe]);

  // Stage 2: Consultative AI Second Opinion ("Второе мнение AI")
  const [secondOpinionData, setSecondOpinionData] = useState(null);
  const [isAskingOpinion, setIsAskingOpinion] = useState(false);

  const handleAskSecondOpinion = useCallback(async () => {
    setIsAskingOpinion(true);
    try {
      const transient = useTradeOverlayStore.getState().transientSetup;
      const setup = transient || activePositionSetup || localPositionSetup;
      const lastCandlePrice = currentKlines.current.length > 0
        ? currentKlines.current[currentKlines.current.length - 1].close
        : 0;
      const entryP = Number(setup?.entryPrice || setup?.entry_price || lastCandlePrice || 0);
      const slP = Number(setup?.slPrice || setup?.sl_price || 0) || null;
      const tpP = Number(setup?.tpPrice || setup?.tp1_price || setup?.tp_price || 0) || null;
      const dir = setup?.direction || (tpP && entryP && tpP < entryP ? 'SHORT' : 'LONG');
      const slPct = Number(setup?.slPct || setup?.sl_pct) ? Math.abs(Number(setup?.slPct || setup?.sl_pct)) : 0.6;
      const tpPct = Number(setup?.tpPct || setup?.tp1_pct) ? Math.abs(Number(setup?.tpPct || setup?.tp1_pct)) : 1.5;

      const res = await fetch('/api/journal/second-opinion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          direction: dir,
          price: lastCandlePrice || entryP,
          entry_price: entryP || null,
          sl_price: slP,
          tp_price: tpP,
          stop_loss_pct: slPct,
          take_profit_pct: tpPct,
          strategy_type: 'density_bounce'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setSecondOpinionData(data);
        window.dispatchEvent(new CustomEvent('decision-journal-updated'));
      }
    } catch (err) {
      console.error('Second opinion error:', err);
      setSecondOpinionData({
        ai_available: false,
        verdict: 'AI НЕДОСТУПЕН',
        reason: 'AI недоступен, принимай решение сам',
        context: { symbol, timeframe },
        log: null
      });
    } finally {
      setIsAskingOpinion(false);
    }
  }, [symbol, timeframe, activePositionSetup, localPositionSetup]);

  const handleDecisionFromOpinion = useCallback(async (userDecision) => {
    if (!secondOpinionData?.log?.id) return;
    try {
      const res = await fetch(`/api/journal/log/${secondOpinionData.log.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_decision: userDecision })
      });
      if (res.ok) {
        const updated = await res.json();
        setSecondOpinionData((prev) => prev ? { ...prev, log: updated.log } : prev);
        window.dispatchEvent(new CustomEvent('decision-journal-updated'));
      }
    } catch (err) {
      console.error('Failed to record trader decision on second opinion:', err);
    }
  }, [secondOpinionData]);
  
  const prevSymbolRef = useRef(symbol);
  const prevTimeframeRef = useRef(timeframe);

  const [chartReady, setChartReady] = useState(0);
  const [isMouseDown, setIsMouseDown] = useState(false);
  const [magnetEnabled, setMagnetEnabled] = useState(false);
  const savedIndicators = useLayoutStore((s) => s.getPanelIndicators(chartId));
  const setPanelIndicators = useLayoutStore((s) => s.setPanelIndicators);

  const [activeIndicators, setActiveIndicators] = useState(() => {
    return Array.isArray(savedIndicators) && savedIndicators.length > 0
      ? savedIndicators
      : DEFAULT_ACTIVE_INDICATORS;
  });

  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [settingsDialogIndId, setSettingsDialogIndId] = useState(null);

  const [statusMsg, setStatusMsg] = useState("");
  const [errorDetails, setErrorDetails] = useState(null);

  // Stage 3: Heatmap (default OFF for clean chart), Liquidations, VWAP, Storage info
  const [showHeatmap, setShowHeatmap] = useState(() => localStorage.getItem('chart_heatmap') === 'true');
  // Footprint-слой внутри свечей (SRS M1.2b), default OFF
  const [showFootprint, setShowFootprint] = useState(() => localStorage.getItem('chart_footprint') === 'true');
  // TPO/Volume Profile слой (SRS M1.2a), default OFF
  const [showTpo, setShowTpo] = useState(() => localStorage.getItem('chart_tpo') === 'true');
  const [showLiquidations, setShowLiquidations] = useState(() => localStorage.getItem('chart_liquidations') !== 'false');
  const [showVwap, setShowVwap] = useState(() => localStorage.getItem('chart_vwap') === 'true');
  const [showWalls, setShowWalls] = useState(() => localStorage.getItem('chart_walls') !== 'false');
  const [densityMode, setDensityMode] = useState(() => localStorage.getItem('chart_density_mode') || 'auto');
  const [minLiqUsd, setMinLiqUsd] = useState(20000);
  const [heatmapMinUsd, setHeatmapMinUsd] = useState(50000);
  const [storageInfo, setStorageInfo] = useState({ earliest: '', usage: '' });
  const currentKlines = useRef([]);


  // Точки плотностей для WebGL-heatmap (задача 4.5); бюджетирование — densityHeatmapMath.selectDensityPoints
  const [densityPoints, setDensityPoints] = useState([]);

  // Context Menu & Level Inspector State (ТАКТ 3) — логика в chart/ChartContextMenu.jsx
  const {
    contextMenu, setContextMenu,
    levelInspectorData, setLevelInspectorData,
    inspectingLevel,
    handleInspectLevel, handleContextMenu, handleResetScale,
  } = useChartContextMenu({ chartContainerRef, chartRef, currentKlines, setStatusMsg, symbol, timeframe });

  // Рисование / SMC-шаблоны / undo — логика в chart/useChartDrawings.js (слайс 6.4j)
  const {
    activeTool,
    drawingTemplates, setDrawingTemplates,
    activeDrawingStyle, setActiveDrawingStyle,
    isTemplateMenuOpen, setIsTemplateMenuOpen,
    showSaveTemplateModal, setShowSaveTemplateModal,
    newTemplateName, setNewTemplateName,
    saveDrawingsFor, saveDrawings, loadDrawings,
    handleUndo, cancelActiveDrawing, handleSelectTool,
    applyTemplate, updateStyle, handleSaveCurrentAsTemplate, handleClearDrawings,
  } = useChartDrawings({
    chartRef, symbol, timeframe, userId, setStatusMsg, magnetEnabled,
    setContextMenu, setIsCatalogOpen, setSettingsDialogIndId,
  });

  // Системные оверлеи (VWAP/ликвидации/heatmap/footprint/TPO/стены) — логика в chart/useChartOverlays.js (слайс 6.4k)
  const {
    updateVwapOverlay, loadLiquidations, loadHeatmap, loadFootprint, loadTpoProfile,
    renderOrderBookWalls, loadOrderBookWalls,
    vwapLineOverlay, activeLiqOverlays, activeWallOverlays,
  } = useChartOverlays({
    chartRef, chartContainerRef, currentKlines, symbol,
    showVwap, showLiquidations, minLiqUsd,
    showHeatmap, heatmapMinUsd, setDensityPoints,
    showFootprint, showTpo, showWalls, densityMode,
  });

  // Synchronize indicators with external IndicatorsModal state
  useEffect(() => {
    if (!chartIndicators) return;
    if (typeof chartIndicators.ema === 'boolean') {
      setIndicators(prev => {
        if (prev.ema !== chartIndicators.ema) {
          if (chartRef.current) {
            if (chartIndicators.ema) {
              chartRef.current.createIndicator({
                name: 'EMA',
                calcParams: uiConfig?.emaPeriods || [9, 21, 50]
              }, true, { id: 'candle_pane' });
            } else {
              chartRef.current.removeIndicator('candle_pane', 'EMA');
            }
          }
          return { ...prev, ema: chartIndicators.ema };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.vol === 'boolean') {
      setIndicators(prev => {
        if (prev.vol !== chartIndicators.vol) {
          if (chartRef.current) {
            if (chartIndicators.vol) {
              chartRef.current.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
            } else {
              try { chartRef.current.removeIndicator('pane_vol', 'VOL'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'VOL' }); } catch (_) {}
            }
          }
          return { ...prev, vol: chartIndicators.vol };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.cvd === 'boolean') {
      setIndicators(prev => {
        if (prev.cvd !== chartIndicators.cvd) {
          if (chartRef.current) {
            if (chartIndicators.cvd) {
              chartRef.current.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
            } else {
              try { chartRef.current.removeIndicator('pane_cvd', 'CVD'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'CVD' }); } catch (_) {}
            }
          }
          return { ...prev, cvd: chartIndicators.cvd };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.rsi === 'boolean') {
      setIndicators(prev => {
        if (prev.rsi !== chartIndicators.rsi) {
          if (chartRef.current) {
            if (chartIndicators.rsi) {
              chartRef.current.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
            } else {
              try { chartRef.current.removeIndicator('pane_rsi', 'RSI'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'RSI' }); } catch (_) {}
            }
          }
          return { ...prev, rsi: chartIndicators.rsi };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.macd === 'boolean') {
      setIndicators(prev => {
        if (prev.macd !== chartIndicators.macd) {
          if (chartRef.current) {
            if (chartIndicators.macd) {
              chartRef.current.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
            } else {
              try { chartRef.current.removeIndicator('pane_macd', 'MACD'); } catch (_) {}
              try { chartRef.current.removeIndicator({ name: 'MACD' }); } catch (_) {}
            }
          }
          return { ...prev, macd: chartIndicators.macd };
        }
        return prev;
      });
    }
    if (typeof chartIndicators.atr === 'boolean') {
      if (chartRef.current) {
        if (chartIndicators.atr) {
          chartRef.current.createIndicator('ATR', false, { id: 'pane_atr', height: 70 });
        } else {
          try { chartRef.current.removeIndicator('pane_atr', 'ATR'); } catch (_) {}
          try { chartRef.current.removeIndicator({ name: 'ATR' }); } catch (_) {}
        }
      }
    }
    if (typeof chartIndicators.deltaBars === 'boolean') {
      if (chartRef.current) {
        if (chartIndicators.deltaBars) {
          chartRef.current.createIndicator('DeltaBars', false, { id: 'pane_deltabars', height: 70 });
        } else {
          try { chartRef.current.removeIndicator('pane_deltabars', 'DeltaBars'); } catch (_) {}
          try { chartRef.current.removeIndicator({ name: 'DeltaBars' }); } catch (_) {}
        }
      }
    }
    if (typeof chartIndicators.vwap === 'boolean') {
      setShowVwap(chartIndicators.vwap);
      setIndicators(prev => ({ ...prev, vwap: chartIndicators.vwap }));
    }
    if (typeof chartIndicators.walls === 'boolean') {
      setShowWalls(chartIndicators.walls);
    }
    if (typeof chartIndicators.liquidations === 'boolean') {
      setShowLiquidations(chartIndicators.liquidations);
    }
    if (typeof chartIndicators.heatmap === 'boolean') {
      setShowHeatmap(chartIndicators.heatmap);
    }
  }, [chartIndicators, uiConfig]);

  // AI Copilot strategy levels projection listener
  useEffect(() => {
    const handleAiLevels = (e) => {
      const { levels, symbol: targetSym } = e.detail || {};
      if (targetSym && targetSym !== symbol) return;
      if (Array.isArray(levels) && chartRef.current) {
        const klines = currentKlines.current;
        if (!klines || klines.length === 0) return;
        const anchorTs = klines[klines.length - 1].timestamp;

        activeStrategyLevelOverlays.current.forEach(id => {
          try { chartRef.current.removeOverlay({ id }); } catch (_) {}
        });
        activeStrategyLevelOverlays.current = [];

        levels.forEach(lvl => {
          const p = Number(lvl.price);
          if (!p || !Number.isFinite(p)) return;
          try {
            const id = chartRef.current.createOverlay({
              name: 'strategyLevelZone',
              lock: true,
              points: [{ timestamp: anchorTs, value: p }],
              extendData: {
                type: lvl.type || 'BUY',
                label: lvl.label || 'AI Level',
                price: p
              }
            });
            if (id) activeStrategyLevelOverlays.current.push(id);
          } catch (_) {}
        });
        setStatusMsg("Уровни AI Ассистента нанесены");
        setTimeout(() => setStatusMsg(""), 2000);
      }
    };
    window.addEventListener('apply-ai-strategy-levels', handleAiLevels);
    return () => window.removeEventListener('apply-ai-strategy-levels', handleAiLevels);
  }, [symbol]);

  // Listen for Volatility Cone projection (Stage 3 & Stage 5)
  useEffect(() => {
    const handleVolatilityCone = (ev) => {
      let cone = ev.detail?.cone;
      const sym = ev.detail?.symbol;
      const isToggle = Boolean(ev.detail?.toggle);
      if (!chartRef.current) return;
      if (sym && sym.toUpperCase() !== symbol.toUpperCase()) return;

      if (activeVolatilityConeOverlayId.current) {
        try { chartRef.current.removeOverlay({ id: activeVolatilityConeOverlayId.current }); } catch (_) {}
        activeVolatilityConeOverlayId.current = null;
        setIsConeActive(false);
        if (isToggle && !cone) {
          setStatusMsg("Конус волатильности скрыт");
          setTimeout(() => setStatusMsg(""), 1200);
          return;
        }
      }

      const klines = currentKlines.current;
      if (!cone && klines && klines.length >= 10) {
        // Calculate 14-period ATR from loaded klines
        const sampleCount = Math.min(14, klines.length - 1);
        let trSum = 0;
        for (let i = klines.length - sampleCount; i < klines.length; i++) {
          const bar = klines[i];
          const prevClose = klines[i - 1] ? klines[i - 1].close : bar.open;
          const tr = Math.max(
            bar.high - bar.low,
            Math.abs(bar.high - prevClose),
            Math.abs(bar.low - prevClose)
          );
          trSum += tr;
        }
        const atr = trSum / sampleCount;
        const lastBar = klines[klines.length - 1];
        const basePrice = lastBar.close;
        const anchorTs = lastBar.timestamp;
        const tfMs = TF_MS[timeframe] || 300000;

        const monStatus = useMarketDataStore.getState().monitoringStatuses[symbol.toUpperCase()];
        const trend = (monStatus?.forecast_trend || 'NEUTRAL').toUpperCase();
        const driftSign = trend === 'BULLISH' ? 1 : trend === 'BEARISH' ? -1 : 0;
        const expectedDriftPct = driftSign * 0.35;

        const fanPoints = [];
        for (let i = 1; i <= 16; i++) {
          const stepSigma = Math.sqrt(i) * Math.max(atr * 0.85, basePrice * 0.002);
          const drift = (basePrice * (expectedDriftPct / 100)) * (i / 16);
          const mid = Number((basePrice + drift).toFixed(2));
          fanPoints.push({
            bar_offset: i,
            timestamp: anchorTs + i * tfMs,
            price_mid: mid,
            upper_1s: Number((mid + stepSigma).toFixed(2)),
            lower_1s: Number((mid - stepSigma).toFixed(2)),
            upper_2s: Number((mid + stepSigma * 1.96).toFixed(2)),
            lower_2s: Number((mid - stepSigma * 1.96).toFixed(2)),
            upper_1sigma: Number((mid + stepSigma).toFixed(2)),
            lower_1sigma: Number((mid - stepSigma).toFixed(2)),
            upper_2sigma: Number((mid + stepSigma * 1.96).toFixed(2)),
            lower_2sigma: Number((mid - stepSigma * 1.96).toFixed(2)),
          });
        }

        cone = {
          base_price: basePrice,
          base_timestamp: anchorTs,
          fan_points: fanPoints,
          direction: trend === 'BULLISH' ? 'BULLISH' : trend === 'BEARISH' ? 'BEARISH' : 'NEUTRAL',
          trend,
          expected_drift_pct: expectedDriftPct,
          sigma_1s_pct: ((atr / basePrice) * 100).toFixed(2),
          ev_display: driftSign > 0 ? '+0.45R' : driftSign < 0 ? '-0.45R' : '0.00R'
        };
      }

      if (!cone || !cone.fan_points || cone.fan_points.length === 0) {
        setStatusMsg("Конус волатильности скрыт");
        setTimeout(() => setStatusMsg(""), 1200);
        setIsConeActive(false);
        return;
      }

      const anchorTs = cone.base_timestamp || (klines && klines.length ? klines[klines.length - 1].timestamp : Date.now());
      const endTs = cone.fan_points[cone.fan_points.length - 1].timestamp;

      try {
        const id = chartRef.current.createOverlay({
          name: 'volatilityCone',
          lock: true,
          points: [
            { timestamp: anchorTs, value: cone.base_price },
            { timestamp: endTs, value: cone.base_price }
          ],
          extendData: {
            ...cone,
            symbol: sym || symbol
          }
        });
        if (id) {
          activeVolatilityConeOverlayId.current = id;
          setIsConeActive(true);
          setStatusMsg("📐 Конус волатильности (±1σ / ±2σ) спроецирован на 16 баров");
          setTimeout(() => setStatusMsg(""), 2000);
          try {
            chartRef.current.scrollToTimestamp(endTs + 4 * 60000, 200);
          } catch (_) {}
        }
      } catch (err) {
        console.warn("Failed to create volatilityCone overlay:", err);
      }
    };

    const handleClearVolatilityCone = () => {
      if (activeVolatilityConeOverlayId.current && chartRef.current) {
        try { chartRef.current.removeOverlay({ id: activeVolatilityConeOverlayId.current }); } catch (_) {}
        activeVolatilityConeOverlayId.current = null;
      }
      setIsConeActive(false);
    };

    window.addEventListener('apply-volatility-cone', handleVolatilityCone);
    window.addEventListener('clear-volatility-cone', handleClearVolatilityCone);
    return () => {
      window.removeEventListener('apply-volatility-cone', handleVolatilityCone);
      window.removeEventListener('clear-volatility-cone', handleClearVolatilityCone);
      handleClearVolatilityCone();
    };
  }, [symbol, timeframe]);

  // Initialize KLineChart instance with ResizeObserver (ТАКТ 1)
  useEffect(() => {
    if (!chartContainerRef.current) return;
    
    try {
      dispose(chartContainerRef.current);
    } catch (_) {}

    const chart = init(chartContainerRef.current);
    chartRef.current = chart;
    setChartInstance(chart);
    window.__charts = window.__charts || {};
    window.__charts[chartId] = chart;
    if (chartId === 'primary' || !window.__chart) {
      window.__chart = chart;
    }

    // Explicitly enable scroll & zoom navigation
    chart.setScrollEnabled(true);
    chart.setZoomEnabled(true);
    try {
      chart.setPaneOptions({ id: 'candle_pane', dragEnabled: true, axisOptions: { scrollZoomEnabled: true } });
    } catch (_) {}

    // Apply initial theme styles
    chart.setStyles(buildChartStyles(uiConfig || {}));

    // Set timezone to Europe/Kyiv
    try {
      chart.setTimezone('Europe/Kyiv');
    } catch (e) {
      console.warn("Timezone set warning:", e);
    }

    // Default indicators based on initial uiConfig
    try {
      if (uiConfig?.emaEnabled !== false) {
        chart.createIndicator({
          name: 'EMA',
          calcParams: uiConfig?.emaPeriods || [9, 21, 50]
        }, true, { id: 'candle_pane' });
      }
      if (uiConfig?.subpanes?.vol !== false) {
        chart.createIndicator('VOL', false, { id: 'pane_vol', height: 70 });
      }
      if (uiConfig?.subpanes?.cvd) {
        chart.createIndicator('CVD', false, { id: 'pane_cvd', height: 75 });
      }
      if (uiConfig?.subpanes?.rsi) {
        chart.createIndicator('RSI', false, { id: 'pane_rsi', height: 70 });
      }
      if (uiConfig?.subpanes?.macd) {
        chart.createIndicator('MACD', false, { id: 'pane_macd', height: 75 });
      }
    } catch (e) {
      console.warn("Indicator init warning:", e);
    }

    // Crosshair Sync: subscribe to mouse crosshair movement
    chart.subscribeAction('onCrosshairChange', (data) => {
      const ts = data?.kLineData?.timestamp || null;
      window.dispatchEvent(new CustomEvent('crosshair-sync', {
        detail: { chartId, timestamp: ts }
      }));
    });

    // Zoom Clamping: clamp barSpace between 3px (max zoom out) and 60px (max zoom in)
    // Prevents canvas division by zero and overlay distortion during mouse wheel zoom
    try {
      chart.subscribeAction('onZoom', () => {
        try {
          const bs = chart.getBarSpace();
          if (typeof bs === 'number' && Number.isFinite(bs)) {
            if (bs < 3) {
              chart.setBarSpace(3);
            } else if (bs > 60) {
              chart.setBarSpace(60);
            }
          }
        } catch (_) {}
      });
    } catch (_) {}

    setChartReady(prev => prev + 1);

    let rafId = null;
    const handleResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (chartRef.current) {
          try {
            chartRef.current.resize();
            window.__chartResizeCounts = window.__chartResizeCounts || {};
            window.__chartResizeCounts[chartId] = (window.__chartResizeCounts[chartId] || 0) + 1;
          } catch (_) {}
        }
      });
    };

    window.addEventListener('resize', handleResize);

    // ResizeObserver for Dual-Pane 50/50 split and collapsible panels
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && chartContainerRef.current) {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(chartContainerRef.current);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
      if (ro) ro.disconnect();
      try {
        dispose(chartContainerRef.current);
      } catch (_) {}
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync modular indicators with KLineCharts instance
  const syncIndicatorsWithChart = useCallback((chart, indicatorsList) => {
    if (!chart) return;
    const activeMap = new Map((indicatorsList || []).map((item) => [item.id, item]));

    Object.values(INDICATORS_REGISTRY).forEach((def) => {
      const activeItem = activeMap.get(def.id);
      const isMain = def.pane === 'main';
      const paneId = isMain ? 'candle_pane' : `pane_${def.id}`;
      const klineName = def.klineName;

      if (!activeItem || activeItem.enabled === false) {
        try {
          if (isMain) {
            chart.removeIndicator(paneId, klineName);
          } else {
            chart.removeIndicator(paneId, klineName);
            chart.removeIndicator({ name: klineName });
          }
        } catch (_) {}
      } else {
        const calcParams = def.toCalcParams(activeItem.inputs || def.defaultInputs);
        const styles = def.toKlineStyles(activeItem.styles || def.defaultStyles);

        try {
          if (isMain) {
            chart.createIndicator({
              name: klineName,
              calcParams,
              styles
            }, true, { id: 'candle_pane' });
            chart.overrideIndicator({
              name: klineName,
              calcParams,
              styles
            }, 'candle_pane');
          } else {
            chart.createIndicator({
              name: klineName,
              calcParams,
              styles
            }, false, { id: paneId, height: def.height || 70 });
            chart.overrideIndicator({
              name: klineName,
              calcParams,
              styles
            }, paneId);
          }
        } catch (_) {
          try {
            chart.createIndicator(klineName, isMain, { id: paneId, height: def.height || 70 });
          } catch (_) {}
        }
      }
    });
  }, []);

  const activeIndicatorsRef = useRef(activeIndicators);
  useEffect(() => {
    activeIndicatorsRef.current = activeIndicators;
  }, [activeIndicators]);

  const handleAddIndicator = useCallback((indId) => {
    const def = INDICATORS_REGISTRY[indId];
    if (!def) return;
    const prev = activeIndicatorsRef.current || [];
    if (prev.some((i) => i.id === indId)) return;
    const next = [
      ...prev,
      {
        id: indId,
        enabled: true,
        inputs: { ...def.defaultInputs },
        styles: { ...def.defaultStyles }
      }
    ];
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
    setStatusMsg(`Добавлен: ${def.shortName}`);
    setTimeout(() => setStatusMsg(''), 1500);
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleRemoveIndicator = useCallback((indId) => {
    const def = INDICATORS_REGISTRY[indId];
    const prev = activeIndicatorsRef.current || [];
    const next = prev.filter((i) => i.id !== indId);
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      const isMain = def?.pane === 'main';
      const paneId = isMain ? 'candle_pane' : `pane_${indId}`;
      const klineName = def ? def.klineName : indId.toUpperCase();
      try {
        chartRef.current.removeIndicator(paneId, klineName);
        if (!isMain) chartRef.current.removeIndicator({ name: klineName });
      } catch (_) {}
      syncIndicatorsWithChart(chartRef.current, next);
    }
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleToggleVisibility = useCallback((indId) => {
    const prev = activeIndicatorsRef.current || [];
    const next = prev.map((item) =>
      item.id === indId ? { ...item, enabled: !item.enabled } : item
    );
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  const handleSaveSettings = useCallback((indId, newInputs, newStyles) => {
    const prev = activeIndicatorsRef.current || [];
    const next = prev.map((item) =>
      item.id === indId
        ? { ...item, inputs: { ...newInputs }, styles: { ...newStyles } }
        : item
    );
    activeIndicatorsRef.current = next;
    setActiveIndicators(next);
    setPanelIndicators(chartId, next);
    if (chartRef.current) {
      syncIndicatorsWithChart(chartRef.current, next);
    }
    setStatusMsg(`Настройки ${indId.toUpperCase()} сохранены`);
    setTimeout(() => setStatusMsg(''), 1500);
  }, [chartId, setPanelIndicators, syncIndicatorsWithChart]);

  // Dynamically apply uiConfig and indicators sync
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (uiConfig) {
      try {
        chart.setStyles(buildChartStyles(uiConfig));
      } catch (_) {}

      try {
        if (uiConfig.pricePrecision && uiConfig.pricePrecision !== 'auto') {
          chart.setPriceVolumePrecision(Number(uiConfig.pricePrecision), 2);
        } else {
          const p = symbol.includes('BTC') ? 1 : symbol.includes('ETH') || symbol.includes('SOL') ? 2 : 4;
          chart.setPriceVolumePrecision(p, 2);
        }
      } catch (_) {}
    }

    // Sync modular indicators with KLineCharts
    syncIndicatorsWithChart(chart, activeIndicators);
  }, [uiConfig, symbol, activeIndicators, syncIndicatorsWithChart, chartReady]);

  // Save drawings for a specific symbol/timeframe — в chart/useChartDrawings.js
  // Load drawings from backend — в chart/useChartDrawings.js

  // Undo last drawn figure (Ctrl+Z) — в chart/useChartDrawings.js
  // Cancel active drawing tool creation — в chart/useChartDrawings.js
  // Hotkey listener for Ctrl+Z (Undo), Delete/Backspace on active overlay & Escape — в chart/useChartDrawings.js

  // Global mouseup to reset isMouseDown dragging state
  useEffect(() => {
    const handleGlobalMouseUp = () => setIsMouseDown(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Global event listener for Undo — в chart/useChartDrawings.js

  // Crosshair synchronization listener from other chart in dual-pane
  useEffect(() => {
    const handleSync = (e) => {
      if (!chartRef.current) return;
      const { chartId: sourceId, timestamp } = e.detail || {};
      if (sourceId && sourceId !== chartId) {
        try {
          const syncId = 'sync_crosshair_marker';
          if (timestamp) {
            const existing = chartRef.current.getOverlayById(syncId);
            if (existing) {
              chartRef.current.overrideOverlay({
                id: syncId,
                points: [{ timestamp }]
              });
            } else {
              chartRef.current.createOverlay({
                name: 'verticalStraightLine',
                id: syncId,
                points: [{ timestamp }],
                lock: true,
                needDefaultPointFigure: false,
                needDefaultXAxisFigure: false,
                needDefaultYAxisFigure: false,
                styles: {
                  line: {
                    color: '#ff9800',
                    size: 1,
                    style: 'dashed'
                  }
                }
              });
            }
          } else {
            chartRef.current.removeOverlay({ id: syncId });
          }
        } catch (_) {}
      }
    };

    window.addEventListener('crosshair-sync', handleSync);
    return () => window.removeEventListener('crosshair-sync', handleSync);
  }, [chartId]);

  // Save current drawings before switching symbol/timeframe or on unmount
  useEffect(() => {
    if (prevSymbolRef.current !== symbol || prevTimeframeRef.current !== timeframe) {
      if (prevSymbolRef.current && prevTimeframeRef.current) {
        saveDrawingsFor(prevSymbolRef.current, prevTimeframeRef.current);
      }
      prevSymbolRef.current = symbol;
      prevTimeframeRef.current = timeframe;
    }
  }, [symbol, timeframe, saveDrawingsFor]);

  useEffect(() => {
    return () => {
      if (prevSymbolRef.current && prevTimeframeRef.current) {
        saveDrawingsFor(prevSymbolRef.current, prevTimeframeRef.current);
      }
    };
  }, [saveDrawingsFor]);

  // Recenter chart to real time on Space key
  useEffect(() => {
    const handleRecenter = () => {
      if (chartRef.current) {
        try {
          chartRef.current.scrollToRealTime();
          setStatusMsg("Центрировано на текущей цене");
          setTimeout(() => setStatusMsg(""), 1200);
        } catch (_) {}
      }
    };
    window.addEventListener('recenter-market-price', handleRecenter);
    return () => window.removeEventListener('recenter-market-price', handleRecenter);
  }, []);


  const toggleVolatilityCone = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('apply-volatility-cone', {
        detail: {
          symbol,
          timeframe,
          toggle: true
        }
      })
    );
  }, [symbol, timeframe]);


  // Fetch history candles & subscribe live WebSocket
  useEffect(() => {
    if (!chartRef.current || chartReady === 0) return;
    const chart = chartRef.current;
    let isCancelled = false;

    // Instantly wipe previous coin's candles so old ticker data never lingers
    try {
      chart.clearData();
    } catch (_) {}
    currentKlines.current = [];
    setStatusMsg(`Загрузка свечей ${symbol}...`);
    setErrorDetails(null);

    // Timeframe step in ms (window math for initial deep load and scroll-back)
    const tfMs = TF_MS[timeframe] || 900000;

    const fetchKlines = async () => {
      try {
        // Deep initial window: startTime is always passed (Шаг A);
        // the backend paginates server-side if the window exceeds one request.
        const { candles, source } = await fetchKlinesDualSource({
          symbol,
          timeframe,
          startTime: Date.now() - INITIAL_HISTORY_BARS * tfMs
        });

        if (isCancelled) return;

        if (Array.isArray(candles) && candles.length > 0) {
          currentKlines.current = candles;
          window.__historyOldestTs = candles[0]?.timestamp ?? null;
          window.__historyLoadedBars = candles.length;
          chart.applyNewData(candles, true);
          setStatusMsg("");
          setErrorDetails(null);

          // Restore saved drawings, vwap, liquidations, and heatmap
          loadDrawings();
          updateVwapOverlay(candles);
          loadLiquidations();
          loadHeatmap();
          loadFootprint();
          loadTpoProfile();
          setKlinesVersion((v) => v + 1);
        } else {
          setStatusMsg("Свечи отсутствуют");
        }
      } catch (err) {
        if (isCancelled) return;
        setStatusMsg("Ошибка загрузки");
        setErrorDetails(err.message || String(err));
      }
    };

    fetchKlines();

    // --- Шаг A: бесконечный скролл-назад (chart.loadMore) ----------------------
    // KLineCharts v9 вызывает колбэк с timestamp самой старой загруженной свечи,
    // когда пользователь доскроллил к левому краю. Догружаем более старое окно
    // через пагинированный dual-source конвейер и восстанавливаем вьюпорт,
    // пока не достигнут дневной пол истории или конец данных Binance.
    const floorTs = Date.now() - (HISTORY_FLOOR_DAYS[timeframe] ?? 30) * 86400000;
    let loadingOlder = false;
    let historyExhausted = false;

    try {
      chart.loadMore(async (oldestTs) => {
        if (isCancelled || loadingOlder || historyExhausted) return;
        if (oldestTs == null) return;
        if (oldestTs <= floorTs) { historyExhausted = true; return; }
        loadingOlder = true;
        try {
          const windowEnd = oldestTs - 1;
          const windowStart = Math.max(floorTs, windowEnd - LOAD_MORE_WINDOW_BARS * tfMs);
          const { candles } = await fetchKlinesDualSource({
            symbol,
            timeframe,
            startTime: windowStart,
            endTime: windowEnd
          });
          if (isCancelled) return;
          if (!Array.isArray(candles) || candles.length === 0) {
            historyExhausted = true;
            return;
          }
          // Слияние с ЖИВЫМ списком графика (WS мог дописать новые свечи).
          let existing = [];
          try { existing = chart.getDataList() || []; } catch (_) { existing = []; }
          const seen = new Set(existing.map(c => c && c.timestamp));
          const older = candles.filter(c => c && !seen.has(c.timestamp));
          if (older.length === 0) { historyExhausted = true; return; }
          const merged = [...older, ...existing]
            .filter(c => c && c.timestamp != null)
            .sort((a, b) => a.timestamp - b.timestamp);
          currentKlines.current = merged;
          window.__historyOldestTs = merged[0].timestamp;
          window.__historyLoadedBars = merged.length;
          const moreAvailable = merged[0].timestamp > floorTs;
          let restoreTs = null;
          try {
            const range = chart.getVisibleRange();
            restoreTs = range?.from?.timestamp ?? null;
          } catch (_) {}
          chart.applyNewData(merged, moreAvailable, () => {
            if (restoreTs != null) {
              try { chart.scrollToTimestamp(restoreTs, 0); } catch (_) {}
            }
          });
          setKlinesVersion(v => v + 1);
        } catch (err) {
          console.warn('Deep history window load failed:', err?.message || err);
          historyExhausted = true;
        } finally {
          loadingOlder = false;
        }
      });
    } catch (_) {}

    // Live Binance WebSocket Kline stream with instant connection, failover, and heartbeat fallback
    const binanceInterval = timeframe === '45m' ? '15m' : (timeframe === '6h' ? '1h' : timeframe);
    const cleanSym = symbol.toLowerCase();
    const wsEndpoints = [
      `wss://stream.binance.com:9443/ws/${cleanSym}@kline_${binanceInterval}`,
      `wss://fstream.binance.com/ws/${cleanSym}@kline_${binanceInterval}`
    ];
    let endpointIdx = 0;

    let reconnectTimer = null;
    let heartbeatTimer = null;
    let lastTickTime = Date.now();

    const connectWs = () => {
      if (isCancelled) return;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch (_) {}
        wsRef.current = null;
      }

      const activeUrl = wsEndpoints[endpointIdx % wsEndpoints.length];

      try {
        const ws = new WebSocket(activeUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (isCancelled || wsRef.current !== ws) return;
          lastTickTime = Date.now();
        };

        ws.onmessage = (event) => {
          if (isCancelled || wsRef.current !== ws) return;
          try {
            const payload = JSON.parse(event.data);
            const k = payload.k || payload;
            if (!k || !chartRef.current) return;
            lastTickTime = Date.now();

            let barTimestamp = Number(k.t);
            // Custom TF bucket alignment
            if (timeframe === '45m') {
              barTimestamp = Math.floor(barTimestamp / (45 * 60 * 1000)) * (45 * 60 * 1000);
            } else if (timeframe === '6h') {
              barTimestamp = Math.floor(barTimestamp / (6 * 3600 * 1000)) * (6 * 3600 * 1000);
            }

            const openP = parseFloat(k.o);
            const highP = parseFloat(k.h);
            const lowP = parseFloat(k.l);
            const closeP = parseFloat(k.c);
            const vol = parseFloat(k.v);
            const turnover = parseFloat(k.q || (closeP * vol));

            const bar = {
              timestamp: barTimestamp,
              open: openP,
              high: highP,
              low: lowP,
              close: closeP,
              volume: vol,
              turnover: turnover
            };

            // Keep currentKlines in sync with live tick: dynamically expand wicks and body on new highs/lows
            const klines = currentKlines.current;
            if (klines && klines.length > 0) {
              const lastBar = klines[klines.length - 1];
              if (lastBar.timestamp === barTimestamp) {
                bar.open = lastBar.open;
                bar.high = Math.max(lastBar.high, highP, closeP);
                bar.low = Math.min(lastBar.low, lowP, closeP);
                klines[klines.length - 1] = bar;
              } else if (barTimestamp > lastBar.timestamp) {
                klines.push(bar);
                if (klines.length > 500) klines.shift();
              }
            }

            chartRef.current.updateData(bar);
          } catch (e) {
            console.warn("WS candle error:", e);
          }
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          if (!isCancelled && wsRef.current === ws) {
            endpointIdx++;
            reconnectTimer = setTimeout(connectWs, 2000);
          }
        };
      } catch (e) {
        if (!isCancelled) {
          endpointIdx++;
          reconnectTimer = setTimeout(connectWs, 2500);
        }
      }
    };

    const handleNetworkOnline = () => {
      if (isCancelled) return;
      connectWs();
      fetchKlines();
    };
    window.addEventListener('online', handleNetworkOnline);

    connectWs();

    // Heartbeat fallback: checks every 3s; if no tick received for > 4.5s, polls REST endpoint
    heartbeatTimer = setInterval(async () => {
      if (isCancelled || !chartRef.current) return;
      if (Date.now() - lastTickTime > 4500) {
        try {
          const r = await fetch(`${API_BASE}/klines?symbol=${symbol}&timeframe=${timeframe}&limit=2`);
          if (r.ok && !isCancelled) {
            const data = await r.json();
            if (Array.isArray(data) && data.length > 0 && chartRef.current) {
              const latest = data[data.length - 1];
              const bar = {
                timestamp: Number(latest.timestamp),
                open: Number(latest.open),
                high: Number(latest.high),
                low: Number(latest.low),
                close: Number(latest.close),
                volume: Number(latest.volume),
                turnover: Number(latest.turnover || (latest.close * latest.volume))
              };
              chartRef.current.updateData(bar);
              lastTickTime = Date.now();
            }
          }
        } catch (_) {}

        if (!wsRef.current || (wsRef.current.readyState !== WebSocket.OPEN && wsRef.current.readyState !== WebSocket.CONNECTING)) {
          endpointIdx++;
          connectWs();
        }
      }
    }, 3000);

    return () => {
      isCancelled = true;
      window.removeEventListener('online', handleNetworkOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (wsRef.current) {
        try {
          wsRef.current.onopen = null;
          wsRef.current.onmessage = null;
          wsRef.current.onerror = null;
          wsRef.current.onclose = null;
          wsRef.current.close();
        } catch (_) {}
        wsRef.current = null;
      }
    };
  }, [symbol, timeframe, chartReady, loadDrawings]);

  // Backtest signals: draw BUY/SELL markers, clear on symbol change / re-run / hide
  const clearBacktestSignals = useCallback(() => {
    if (chartRef.current) {
      btOverlayIds.current.forEach(id => {
        try { chartRef.current.removeOverlay({ id }); } catch (_) {}
      });
    }
    btOverlayIds.current = [];
    setBtTooltip(null);
  }, []);

  useEffect(() => {
    clearBacktestSignals();
    const chart = chartRef.current;
    const klines = currentKlines.current;
    if (!chart || !effectiveShowBtSignals || !effectiveBacktestSignals) return;
    if (effectiveBacktestSignals.symbol && effectiveBacktestSignals.symbol !== symbol.toUpperCase()) return;
    if (!klines || klines.length === 0) return;

    const firstTs = klines[0].timestamp;
    const lastTs = klines[klines.length - 1].timestamp;
    const barMs = klines.length > 1 ? klines[1].timestamp - klines[0].timestamp : 60000;

    // Snap signal time to the candle that contains it (binary search for last bar <= time)
    const findBar = (t) => {
      if (!t || t < firstTs || t > lastTs + barMs) return null;
      let lo = 0, hi = klines.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (klines[mid].timestamp <= t) lo = mid; else hi = mid - 1;
      }
      return klines[lo];
    };

    const container = chartContainerRef.current;
    let lastBarTs = null;

    const tradesList = Array.isArray(effectiveBacktestSignals.trades) ? effectiveBacktestSignals.trades : [];
    const signalsList = Array.isArray(effectiveBacktestSignals.signals) ? effectiveBacktestSignals.signals : [];

    if (tradesList.length > 0) {
      tradesList.forEach((trade) => {
        const entryBar = findBar(trade.entry_time);
        const exitBar = findBar(trade.exit_time) || entryBar;
        if (!entryBar) return;
        lastBarTs = exitBar ? exitBar.timestamp : entryBar.timestamp;

        try {
          const id = chart.createOverlay({
            name: 'backtestTradeLine',
            lock: true,
            points: [
              { timestamp: entryBar.timestamp, value: Number(trade.entry_price) },
              { timestamp: exitBar.timestamp, value: Number(trade.exit_price) }
            ],
            extendData: trade,
            onMouseEnter: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, trade, isTrade: true });
              return true;
            },
            onClick: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, trade, isTrade: true });
              return true;
            },
            onMouseLeave: () => { setBtTooltip(null); return true; }
          });
          if (id) btOverlayIds.current.push(id);
        } catch (_) {}
      });
    } else if (signalsList.length > 0) {
      signalsList.forEach((sig) => {
        const bar = findBar(sig.time);
        if (!bar) return;
        lastBarTs = bar.timestamp;
        const isBuy = sig.type === 'BUY';
        try {
          const id = chart.createOverlay({
            name: 'btSignal',
            lock: true,
            points: [{ timestamp: bar.timestamp, value: isBuy ? bar.low : bar.high }],
            extendData: { type: sig.type, price: sig.price },
            onMouseEnter: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, sig, isTrade: false });
              return true;
            },
            onClick: (e) => {
              const rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
              const px = (e && e.pageX != null) ? e.pageX - rect.left - window.scrollX : (e?.x || 0);
              const py = (e && e.pageY != null) ? e.pageY - rect.top - window.scrollY : (e?.y || 0);
              setBtTooltip({ x: px, y: py, sig, isTrade: false });
              return true;
            },
            onMouseLeave: () => { setBtTooltip(null); return true; }
          });
          if (id) btOverlayIds.current.push(id);
        } catch (_) {}
      });
    }

    // Reveal the newest marker once per new result (not on every redraw)
    if (lastBarTs && lastScrolledResult.current !== effectiveBacktestSignals) {
      lastScrolledResult.current = effectiveBacktestSignals;
      try { chart.scrollToTimestamp(Math.min(lastBarTs + 14 * barMs, lastTs), 200); } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBacktestSignals, effectiveShowBtSignals, symbol, timeframe, klinesVersion, chartReady]);

  useEffect(() => {
    const focusTrade = (event) => {
      const trade = event.detail;
      if (!trade || !chartRef.current || !trade.entry_time) return;
      try { chartRef.current.scrollToTimestamp(trade.entry_time, 180); } catch (_) {}
      setBtTooltip({ x: 24, y: 42, trade, isTrade: true, source: 'backtest' });
    };
    window.addEventListener('focus-backtest-trade', focusTrade);
    return () => window.removeEventListener('focus-backtest-trade', focusTrade);
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const klines = currentKlines.current;
    paperOverlayIds.current.forEach((id) => { try { chart?.removeOverlay({ id }); } catch (_) {} });
    paperOverlayIds.current = [];
    if (!chart || !klines?.length || !paperTrades.length) return;

    const firstTs = klines[0].timestamp;
    const lastTs = klines[klines.length - 1].timestamp;
    const nearestBar = (timestamp) => {
      if (!timestamp || timestamp < firstTs || timestamp > lastTs) return null;
      return klines.reduce((nearest, bar) => (
        Math.abs(bar.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? bar : nearest
      ), klines[0]);
    };
    const container = chartContainerRef.current;
    paperTrades.forEach((rawTrade) => {
      const entryBar = nearestBar(rawTrade.entry_ts);
      const exitBar = nearestBar(rawTrade.exit_ts) || entryBar;
      if (!entryBar || !exitBar) return;
      const trade = {
        ...rawTrade,
        id: rawTrade.order_id || `paper-${rawTrade.entry_ts}`,
        direction: rawTrade.side,
        entry_time: rawTrade.entry_ts,
        exit_time: rawTrade.exit_ts,
        pnl_usd: rawTrade.net_pnl,
        pnl_pct: rawTrade.pnl_percent,
        fee_paid_usd: rawTrade.fee_drag,
        reason: rawTrade.entry_reason || rawTrade.reason,
      };
      try {
        const id = chart.createOverlay({
          name: 'backtestTradeLine',
          lock: true,
          points: [
            { timestamp: entryBar.timestamp, value: Number(rawTrade.entry_price) },
            { timestamp: exitBar.timestamp, value: Number(rawTrade.exit_price) },
          ],
          extendData: { ...trade, source: 'paper', entry_price: rawTrade.entry_price, exit_price: rawTrade.exit_price },
          onMouseEnter: (event) => {
            const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
            setBtTooltip({ x: (event?.pageX ?? event?.x ?? 0) - rect.left - window.scrollX, y: (event?.pageY ?? event?.y ?? 0) - rect.top - window.scrollY, trade, isTrade: true, source: 'paper' });
            return true;
          },
          onClick: (event) => {
            const rect = container?.getBoundingClientRect() || { left: 0, top: 0 };
            setBtTooltip({ x: (event?.pageX ?? event?.x ?? 0) - rect.left - window.scrollX, y: (event?.pageY ?? event?.y ?? 0) - rect.top - window.scrollY, trade, isTrade: true, source: 'paper' });
            return true;
          },
          onMouseLeave: () => { setBtTooltip(null); return true; },
        });
        if (id) paperOverlayIds.current.push(id);
      } catch (_) {}
    });
    return () => {
      paperOverlayIds.current.forEach((id) => { try { chart.removeOverlay({ id }); } catch (_) {} });
      paperOverlayIds.current = [];
    };
  }, [paperTrades, symbol, klinesVersion, chartReady]);

  // Real-time algorithmic signal overlay at the live edge of the chart (Requirement 3)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chartReady === 0) return;

    clearLiveSignals(chart, liveSignalOverlayIds.current);
    liveSignalOverlayIds.current = [];

    if (!showLiveSignals || !Array.isArray(liveSignals) || liveSignals.length === 0) {
      return;
    }

    const ids = renderLiveSignals(chart, liveSignals, symbol);
    liveSignalOverlayIds.current = ids;

    return () => {
      if (chartRef.current) {
        clearLiveSignals(chartRef.current, liveSignalOverlayIds.current);
        liveSignalOverlayIds.current = [];
      }
    };
  }, [liveSignals, showLiveSignals, symbol, chartReady]);

  // Real-time Whale Trade (large orders >= $500k) floating annotations on chart
  const whaleOverlayIds = useRef([]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chartReady === 0) return;

    clearWhaleTrades(chart, whaleOverlayIds.current);
    whaleOverlayIds.current = [];

    const unsub = useTradesStore.getState().addTradeListener((trade) => {
      if (trade.symbol === symbol.toUpperCase() && trade.usd >= 500000) {
        try {
          const ids = renderWhaleTrades(chart, [trade], symbol);
          if (ids && ids.length > 0) {
            whaleOverlayIds.current.push(...ids);
            if (whaleOverlayIds.current.length > 40) {
              const oldId = whaleOverlayIds.current.shift();
              clearWhaleTrades(chart, [oldId]);
            }
          }
        } catch (_) {}
      }
    });

    return () => {
      unsub();
      if (chartRef.current) {
        clearWhaleTrades(chartRef.current, whaleOverlayIds.current);
        whaleOverlayIds.current = [];
      }
    };
  }, [symbol, chartReady]);

  // Listen for custom position setup projection events
  useEffect(() => {
    const onPositionSetup = (ev) => {
      if (ev.detail?.setup) {
        setLocalPositionSetup(ev.detail.setup);
      }
    };
    window.addEventListener('apply-position-setup', onPositionSetup);
    return () => window.removeEventListener('apply-position-setup', onPositionSetup);
  }, []);

  const effectivePositionSetup = activePositionSetup || localPositionSetup;

  // Render full Position Setup Box (Entry / SL / TP1 / TP2 + Risk/Reward Shaded Zones)
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const klines = currentKlines.current;

    if (activePositionOverlayId.current) {
      try { chart.removeOverlay({ id: activePositionOverlayId.current }); } catch (_) {}
      activePositionOverlayId.current = null;
    }

    if (!effectivePositionSetup || !klines || klines.length === 0) {
      window.__chartActiveSetup = null;
      return;
    }

    const klen = klines.length;
    const anchorTs = klines[klen - 1].timestamp;
    const startTs = klines[Math.max(0, klen - 30)].timestamp;

    const entryP = Number(effectivePositionSetup.entry_price);
    const tpP = Number(effectivePositionSetup.tp1_price || effectivePositionSetup.tp2_price || (entryP * 1.015));
    const slP = Number(effectivePositionSetup.sl_price || (entryP * 0.99));

    try {
      const id = chart.createOverlay({
        name: 'positionSetupBox',
        lock: false,
        points: [
          { timestamp: startTs, value: entryP },
          { timestamp: anchorTs, value: tpP },
          { timestamp: anchorTs, value: slP }
        ],
        extendData: {
          ...effectivePositionSetup,
          entry_price: entryP,
          tp1_price: tpP,
          sl_price: slP
        }
      });
      if (id) activePositionOverlayId.current = id;
      const initialSetup = {
        overlayId: id,
        ...effectivePositionSetup,
        entry_price: entryP,
        tp1_price: tpP,
        sl_price: slP
      };
      window.__chartActiveSetup = initialSetup;
      useTradeOverlayStore.getState().setTransientSetup(initialSetup);
    } catch (_) {}
  }, [effectivePositionSetup, symbol, timeframe, klinesVersion, chartReady]);

  // Strategy Key Entry Levels (Semi-transparent Zones with Badges: BUY ZONE: Wall $1.2M / SHORT: Delta Div)
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const klines = currentKlines.current;

    activeStrategyLevelOverlays.current.forEach(id => {
      try { chart.removeOverlay({ id }); } catch (_) {}
    });
    activeStrategyLevelOverlays.current = [];

    if (!Array.isArray(strategyLevels) || strategyLevels.length === 0 || !klines || klines.length === 0) {
      return;
    }

    const anchorTs = klines[klines.length - 1].timestamp;

    strategyLevels.forEach(lvl => {
      const p = Number(lvl.price);
      if (!p || !Number.isFinite(p)) return;
      try {
        const id = chart.createOverlay({
          name: 'strategyLevelZone',
          lock: true,
          points: [{ timestamp: anchorTs, value: p }],
          extendData: {
            type: lvl.type || 'BUY',
            role: lvl.role || '',
            label: lvl.label || (lvl.type === 'BUY' ? 'BUY ZONE: Wall $1.2M' : 'SHORT: Delta Div'),
            price: p
          }
        });
        if (id) activeStrategyLevelOverlays.current.push(id);
      } catch (_) {}
    });
  }, [strategyLevels, symbol, timeframe, klinesVersion, chartReady]);

  // Drawing tool selection with style memory and SMC templates — в chart/useChartDrawings.js
  // applyTemplate / updateStyle / handleSaveCurrentAsTemplate / handleClearDrawings — в chart/useChartDrawings.js

  // Toggle indicator helper (synced with activeIndicators registry)
  const toggleIndicator = (name) => {
    if (name === 'vwap') {
      const nextVwap = !showVwap;
      setShowVwap(nextVwap);
      localStorage.setItem('chart_vwap', nextVwap ? 'true' : 'false');
      if (!nextVwap && vwapLineOverlay.current) {
        try { chartRef.current?.removeOverlay({ id: vwapLineOverlay.current }); } catch (_) {}
        vwapLineOverlay.current = null;
      } else {
        updateVwapOverlay();
      }
      return;
    }

    const indId = name.toLowerCase();
    const existing = activeIndicators.find((i) => i.id === indId);
    if (existing) {
      handleToggleVisibility(indId);
    } else {
      handleAddIndicator(indId);
    }
  };

  // Right-Click Context Menu handler (Task 6 & ТАКТ 3) — в chart/ChartContextMenu.jsx (useChartContextMenu)

  return (
    <div
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)', color: 'var(--text-main)' }}
      className="flex flex-col h-full w-full select-none border overflow-hidden relative font-sans"
    >
      {/* Top Drawing & Indicator Bar (Tealstreet/Tiger style: ultra compact, flat, responsive) */}
      <ChartToolbar
        titlePrefix={titlePrefix}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange}
        onCloseWidget={onCloseWidget}
        chartId={chartId}
        activeTool={activeTool}
        cancelActiveDrawing={cancelActiveDrawing}
        handleSelectTool={handleSelectTool}
        magnetEnabled={magnetEnabled}
        setMagnetEnabled={setMagnetEnabled}
        handleUndo={handleUndo}
        handleClearDrawings={handleClearDrawings}
        saveDrawings={saveDrawings}
        isTemplateMenuOpen={isTemplateMenuOpen}
        setIsTemplateMenuOpen={setIsTemplateMenuOpen}
        setShowSaveTemplateModal={setShowSaveTemplateModal}
        drawingTemplates={drawingTemplates}
        applyTemplate={applyTemplate}
        updateStyle={updateStyle}
        activeDrawingStyle={activeDrawingStyle}
        statusMsg={statusMsg}
        handleAskSecondOpinion={handleAskSecondOpinion}
        isAskingOpinion={isAskingOpinion}
        setIsCatalogOpen={setIsCatalogOpen}
        activeIndicators={activeIndicators}
        toggleLiveSignals={toggleLiveSignals}
        showLiveSignals={showLiveSignals}
        showHeatmap={showHeatmap}
        setShowHeatmap={setShowHeatmap}
        loadHeatmap={loadHeatmap}
        showFootprint={showFootprint}
        setShowFootprint={setShowFootprint}
        showTpo={showTpo}
        setShowTpo={setShowTpo}
        showLiquidations={showLiquidations}
        setShowLiquidations={setShowLiquidations}
        showWalls={showWalls}
        setShowWalls={setShowWalls}
        densityMode={densityMode}
        setDensityMode={setDensityMode}
        toggleVolatilityCone={toggleVolatilityCone}
        isConeActive={isConeActive}
        toggleIndicator={toggleIndicator}
        showVwap={showVwap}
      />

      {/* Chart Canvas Area */}
      <div 
        className={`flex-1 w-full h-full relative select-none ${
          activeTool ? 'cursor-crosshair' : isMouseDown ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onContextMenu={handleContextMenu}
        onMouseDown={(e) => {
          if (e.button === 0 && !activeTool) {
            setIsMouseDown(true);
          }
        }}
        onMouseUp={() => setIsMouseDown(false)}
        onMouseLeave={() => setIsMouseDown(false)}
      >
        <div
          ref={chartContainerRef}
          className="w-full h-full"
          style={{
            cursor: activeTool ? 'crosshair' : isMouseDown ? 'grabbing' : 'grab'
          }}
        />

        {/* Непрерывная WebGL-heatmap плотностей стакана (задача 4.5) */}
        <DepthHeatmapGL chart={chartInstance} points={densityPoints} active={showHeatmap && Boolean(chartInstance)} />

        {/* Tactical Assistant HUD: Floating Predictive & Market Regime Overlay (Stage 5) */}
        <AssistantHUD
          symbol={symbol}
          timeframe={timeframe}
          lastPrice={currentKlines.current?.length ? currentKlines.current[currentKlines.current.length - 1].close : 0}
          showWalls={showWalls}
          onToggleWalls={() => {
            const next = !showWalls;
            setShowWalls(next);
            localStorage.setItem('chart_walls', next ? 'true' : 'false');
          }}
          isConeActive={isConeActive}
          onToggleCone={toggleVolatilityCone}
        />

        {/* Market Regime: Toxic Volatility Warning Overlay */}
        {isToxicRegime && !isToxicDismissed && (
          <div
            data-testid="toxic-volatility-overlay"
            className="absolute inset-x-4 top-3 z-30 flex items-center justify-between p-3 rounded-lg bg-rose-950/85 border border-rose-500/50 backdrop-blur-xs text-rose-200 shadow-2xl animate-pulse select-none font-mono"
          >
            <div className="flex items-center space-x-2.5">
              <AlertTriangle className="text-rose-400 shrink-0" size={18} />
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-rose-300">
                  Рыночный режим изменен: Токсичная ликвидность. Торги приостановлены
                </div>
                <div className="text-[10px] text-rose-200/80">
                  Высокая волатильность при разреженном стакане (ATR% &gt; 1.8%, плотность &lt; 0.6). Входы в сделки заблокированы ядром.
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsToxicDismissed(true)}
              className="p-1 rounded hover:bg-rose-900/60 text-rose-300 hover:text-white transition cursor-pointer"
              title="Скрыть предупреждение"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ТАКТ 2.1: Interactive Position Setup HUD Overlay (Entry / SL / TP1 / TP2 / R:R) */}
        {effectivePositionSetup && Number(effectivePositionSetup.entry_price) > 0 && (
          <div
            data-testid="chart-position-hud"
            className="absolute top-2.5 left-3 z-20 pointer-events-auto flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#0a0e17]/90 border border-[#2563eb70] shadow-xl backdrop-blur-xs font-mono text-[10px]"
          >
            <span
              data-testid="chart-badge-entry"
              className="px-1.5 py-0.5 rounded bg-[#2563eb] text-white font-bold border border-[#60a5fa80]"
            >
              [{effectivePositionSetup.order_type || (effectivePositionSetup.direction === 'SHORT' ? 'SELL LIMIT' : 'BUY LIMIT')} @ {Number(effectivePositionSetup.entry_price).toFixed(Number(effectivePositionSetup.entry_price) >= 1000 ? 1 : 2)}]
            </span>

            <span
              data-testid="chart-badge-sl"
              className="px-1.5 py-0.5 rounded bg-[#dc2626] text-white font-bold border border-[#fca5a580]"
            >
              [SL @ {Number(effectivePositionSetup.sl_price).toFixed(Number(effectivePositionSetup.sl_price) >= 1000 ? 1 : 2)} ({Number(effectivePositionSetup.sl_pct ?? -0.28).toFixed(2)}% | -${Math.round(Number(effectivePositionSetup.sl_risk_usd ?? 50))})]
            </span>

            <span
              data-testid="chart-badge-tp1"
              className="px-1.5 py-0.5 rounded bg-[#059669] text-white font-bold border border-[#6ee7b780]"
            >
              [TP1 @ {Number(effectivePositionSetup.tp1_price).toFixed(Number(effectivePositionSetup.tp1_price) >= 1000 ? 1 : 2)} (+{Number(effectivePositionSetup.tp1_pct ?? 0.43).toFixed(2)}%)]
            </span>

            {effectivePositionSetup.tp2_price && (
              <span
                data-testid="chart-badge-tp2"
                className="px-1.5 py-0.5 rounded bg-[#047857] text-white font-bold border border-[#34d39980]"
              >
                [TP2 @ {Number(effectivePositionSetup.tp2_price).toFixed(Number(effectivePositionSetup.tp2_price) >= 1000 ? 1 : 2)} (+{Number(effectivePositionSetup.tp2_pct ?? 0.92).toFixed(2)}%)]
              </span>
            )}

            <span
              data-testid="chart-badge-rr"
              className="px-1.5 py-0.5 rounded bg-[#1e293b] text-[#38bdf8] font-bold border border-[#38bdf860]"
            >
              R:R {effectivePositionSetup.rr_label || `1:${Number(effectivePositionSetup.rr_ratio || 2.8).toFixed(1)}`}
            </span>

            {/* Quick 1-Click Backtest Button for current setup */}
            <button
              type="button"
              data-testid="btn-quick-backtest-setup"
              onClick={handleQuickBacktestCurrentSetup}
              disabled={isBacktesting}
              className="px-2 py-0.5 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold flex items-center space-x-1 transition cursor-pointer shadow-sm text-[9.5px]"
              title="Проверить этот сетап (Entry / TP / SL) на реальной истории Binance с комиссиями"
            >
              {isBacktesting ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} className="text-yellow-300" />}
              <span>{isBacktesting ? 'Расчет...' : 'Тест сетапа'}</span>
            </button>

            {/* Stage 2: Consultative AI Second Opinion Button right next to Risk/Reward setup */}
            <button
              type="button"
              data-testid="btn-ask-second-opinion"
              onClick={handleAskSecondOpinion}
              disabled={isAskingOpinion}
              className="px-2 py-0.5 rounded bg-[#6b21a8] hover:bg-[#7e22ce] text-white font-bold flex items-center space-x-1 transition cursor-pointer shadow-sm text-[9.5px] border border-[#c084fc80]"
              title="Консультативное второе мнение AI по этой позиции (только факты рынка, решение за вами)"
            >
              <span>🧠</span>
              <span>{isAskingOpinion ? 'Запрос AI...' : 'Спросить мнение по этой позиции'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setLocalPositionSetup(null);
                window.dispatchEvent(new CustomEvent('clear-position-setup'));
              }}
              className="ml-0.5 text-[#94a3b8] hover:text-white px-1 cursor-pointer"
              title="Скрыть разметку позиции"
            >
              ✕
            </button>
          </div>
        )}

        {/* Stage 2: Consultative Second Opinion Non-Blocking Overlay Card */}
        {secondOpinionData && (
          <div
            data-testid="second-opinion-card"
            className="absolute top-12 left-3 z-30 pointer-events-auto w-[390px] max-w-[92%] rounded-lg bg-[#0d121d]/95 border border-[#a855f770] shadow-2xl p-3 font-mono text-[10.5px] text-[#e2e8f0] backdrop-blur-md"
          >
            <div className="flex items-center justify-between border-b border-[#1e293b] pb-1.5 mb-2">
              <div className="flex items-center space-x-1.5">
                <span>🧠</span>
                <span className="font-bold text-white">Второе мнение AI ({secondOpinionData.context?.symbol || symbol} {secondOpinionData.context?.timeframe || timeframe})</span>
              </div>
              <button
                type="button"
                data-testid="btn-close-second-opinion"
                onClick={() => setSecondOpinionData(null)}
                className="text-[#94a3b8] hover:text-white px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Verdict & 1 Reason */}
            <div className="mb-2">
              <div className="flex items-center space-x-2 mb-1">
                <span
                  data-testid="second-opinion-verdict"
                  className={`px-2 py-0.5 rounded font-bold text-[10.5px] ${
                    secondOpinionData.verdict === 'ЗА'
                      ? 'bg-[#059669]/30 text-[#34d399] border border-[#34d39960]'
                      : secondOpinionData.verdict === 'ПРОТИВ'
                      ? 'bg-[#dc2626]/30 text-[#f87171] border border-[#f8717160]'
                      : !secondOpinionData.ai_available
                      ? 'bg-[#d97706]/30 text-[#fbbf24] border border-[#fbbf2460]'
                      : 'bg-[#334155]/50 text-[#cbd5e1] border border-[#64748b60]'
                  }`}
                >
                  {secondOpinionData.verdict}
                </span>
                {!secondOpinionData.ai_available && (
                  <span className="text-[9.5px] text-[#fbbf24]">Принимай решение сам по фактам ниже</span>
                )}
              </div>
              <div
                data-testid="second-opinion-reason"
                className="text-[11px] text-white bg-[#131b2e] border border-[#1e293b] rounded p-2 leading-snug"
              >
                {secondOpinionData.reason}
              </div>
              {secondOpinionData.model_used && (
                <div className="flex items-center justify-between text-[8.5px] text-[#94a3b8] mt-1 px-1">
                  <span>Модель: <span className="text-white font-mono">{secondOpinionData.model_used}</span></span>
                  {secondOpinionData.fallback ? (
                    <span className="text-amber-400 font-bold bg-amber-500/10 px-1 rounded border border-amber-500/30">[Fallback]</span>
                  ) : (
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded border border-emerald-500/30">[Primary]</span>
                  )}
                </div>
              )}
            </div>

            {/* Factual Market Snapshot Passed */}
            {secondOpinionData.context && (
              <div className="grid grid-cols-2 gap-1 text-[9.5px] text-[#94a3b8] bg-[#090d16] p-2 rounded border border-[#1e293b] mb-2">
                <div>Тренд: <span className="text-white">{secondOpinionData.context.trend || '—'}</span></div>
                <div>Дельта CVD: <span className="text-white">{secondOpinionData.context.cvd_bias || '—'}</span></div>
                <div>OI (24ч): <span className="text-white">{secondOpinionData.context.oi_change_24h_pct ?? 0}%</span></div>
                <div>
                  Ист. EV: <span className="text-white">${secondOpinionData.context.historical_ev_usd ?? 0} ({secondOpinionData.context.historical_trades_count ?? 0} сд.)</span>
                </div>
              </div>
            )}

            {/* Trader's Final Decision Recording */}
            <div className="flex items-center justify-between pt-1 border-t border-[#1e293b]">
              <span className="text-[9.5px] text-[#94a3b8]">
                {secondOpinionData.log?.user_decision && secondOpinionData.log.user_decision !== 'PENDING'
                  ? `В журнале: ${secondOpinionData.log.user_decision}`
                  : 'Записать моё решение в журнал:'}
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  data-testid="btn-opinion-mark-entered"
                  onClick={() => handleDecisionFromOpinion('ENTERED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'ENTERED'
                      ? 'bg-[#059669] text-white border-[#34d399]'
                      : 'bg-[#059669]/20 text-[#34d399] border-[#059669]/50 hover:bg-[#059669]/40'
                  }`}
                >
                  ✅ Вошёл
                </button>
                <button
                  type="button"
                  data-testid="btn-opinion-mark-skipped"
                  onClick={() => handleDecisionFromOpinion('SKIPPED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'SKIPPED'
                      ? 'bg-[#475569] text-white border-[#94a3b8]'
                      : 'bg-[#1e293b] text-[#cbd5e1] border-[#334155] hover:bg-[#334155]'
                  }`}
                >
                  ⏭ Пропустил
                </button>
                <button
                  type="button"
                  data-testid="btn-opinion-mark-exited"
                  onClick={() => handleDecisionFromOpinion('EXITED')}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold cursor-pointer border ${
                    secondOpinionData.log?.user_decision === 'EXITED'
                      ? 'bg-[#d97706] text-white border-[#fbbf24]'
                      : 'bg-[#d97706]/20 text-[#fbbf24] border-[#d97706]/50 hover:bg-[#d97706]/40'
                  }`}
                >
                  🏁 Вышел
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Backtest marker & trade tooltip: detailed financial metrics */}
        {btTooltip && (
          <div
            className="absolute z-30 pointer-events-none px-2.5 py-1.5 rounded border text-[10px] font-mono bg-[#0c1017f0] backdrop-blur-md shadow-2xl min-w-[190px]"
            style={{
              left: Math.min(btTooltip.x + 12, (chartContainerRef.current?.clientWidth || 600) - 210),
              top: Math.max(btTooltip.y - 70, 8),
              borderColor: (btTooltip.isTrade ? (btTooltip.trade.pnl_usd >= 0) : ((btTooltip.sig?.pnl_pct ?? 0) >= 0)) ? '#10b981' : '#ef4444'
            }}
          >
            {btTooltip.isTrade ? (
              <>
                <div className="flex items-center justify-between border-b border-[#1f293d] pb-1 mb-1">
                  <span className={btTooltip.trade.direction === 'LONG' || btTooltip.trade.type === 'BUY' ? 'text-[#34d399] font-bold' : 'text-[#f87171] font-bold'}>
                    {btTooltip.source === 'paper' ? 'PAPER' : 'BACKTEST'} · #{btTooltip.trade.id} · {btTooltip.trade.direction || btTooltip.trade.type}
                  </span>
                  <span className="text-[#94a3b8] text-[9px]">{btTooltip.trade.regime || 'Regime: No data'}</span>
                </div>
                <div className="text-[#cbd5e1] text-[9.5px] leading-tight">
                  <div>Вход: <span className="text-white">${btTooltip.trade.entry_price}</span> → Выход: <span className="text-white">${btTooltip.trade.exit_price}</span></div>
                  <div>Entry: <span className="text-white">{Array.isArray(btTooltip.trade.entry_reason || btTooltip.trade.reason) ? (btTooltip.trade.entry_reason || btTooltip.trade.reason).join(' · ') : (btTooltip.trade.entry_reason || btTooltip.trade.reason || 'No data')}</span></div>
                  <div>Exit: <span className="text-white">{btTooltip.trade.exit_reason || 'No data'}</span></div>
                </div>
                <div className={`font-bold mt-1 text-[11px] ${(btTooltip.trade.pnl_usd ?? 0) >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
                  Чистый PnL: {(btTooltip.trade.pnl_usd ?? 0) >= 0 ? '+' : ''}${btTooltip.trade.pnl_usd} ({(btTooltip.trade.pnl_pct ?? 0) >= 0 ? '+' : ''}{btTooltip.trade.pnl_pct}%)
                </div>
                <div className="text-[8.5px] text-[#64748b] mt-0.5 flex justify-between">
                  <span>Gross: {btTooltip.trade.gross_pnl_usd ?? 'No data'}</span>
                  <span>Комиссия: -${Number(btTooltip.trade.fee_paid_usd || 0).toFixed(2)}</span>
                  <span>Слиппейдж: -${Number(btTooltip.trade.slippage_cost_usd || 0).toFixed(2)}</span>
                </div>
                <div className="text-[8.5px] text-[#94a3b8] mt-0.5 flex justify-between">
                  <span>MFE: +{Number(btTooltip.trade.mfe || 0).toFixed(2)}%</span>
                  <span>MAE: {Number(btTooltip.trade.mae || 0).toFixed(2)}%</span>
                  <span>Fee Drag: {btTooltip.trade.fee_drag_pct != null ? `${Number(btTooltip.trade.fee_drag_pct).toFixed(2)}%` : 'No data'}</span>
                </div>
              </>
            ) : (
              <>
                <div className={btTooltip.sig.type === 'BUY' ? 'text-[#26a69a] font-bold' : 'text-[#ef5350] font-bold'}>
                  {btTooltip.sig.label} @ {btTooltip.sig.price}
                </div>
                <div className="text-[#d1d4dc]">Причина: {btTooltip.sig.reason || '—'}</div>
                <div className={(btTooltip.sig.pnl_pct ?? 0) >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                  PnL: {(btTooltip.sig.pnl_pct ?? 0) >= 0 ? '+' : ''}{btTooltip.sig.pnl_pct}% (${btTooltip.sig.pnl_usd})
                </div>
              </>
            )}
          </div>
        )}


        {/* Right-Click Context Menu + Level Inspector (ТАКТ 3) — chart/ChartContextMenu.jsx */}
        <ChartContextMenu
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          levelInspectorData={levelInspectorData}
          setLevelInspectorData={setLevelInspectorData}
          handleResetScale={handleResetScale}
          handleInspectLevel={handleInspectLevel}
          handleClearDrawings={handleClearDrawings}
          magnetEnabled={magnetEnabled}
          setMagnetEnabled={setMagnetEnabled}
          toggleIndicator={toggleIndicator}
          activeIndicators={activeIndicators}
        />


        {errorDetails && (
          <div className="absolute top-3 left-3 bg-[#181014] border border-[#ef535040] text-[#ef5350] px-3 py-2 rounded text-xs max-w-md shadow-xl backdrop-blur-md z-30">
            <div className="flex items-center justify-between font-bold mb-1">
              <span>Ошибка подключения Binance Futures</span>
              <button onClick={() => setErrorDetails(null)} className="text-[#848e9c] hover:text-white">
                <X size={12} />
              </button>
            </div>
            <div className="font-mono text-[10px] break-words opacity-90">{errorDetails}</div>
          </div>
        )}

        {/* Save Custom Template Modal */}
        {showSaveTemplateModal && (
          <div 
            data-testid="modal-save-template"
            className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 font-sans"
          >
            <div className="bg-[#0f1420] border border-[#253248] rounded-lg p-4 w-80 shadow-2xl font-mono text-xs text-[#d1d4dc]">
              <div className="flex items-center justify-between mb-3 border-b border-[#1f2738] pb-2">
                <span className="font-bold text-white text-sm">Сохранить как шаблон SMC</span>
                <button 
                  type="button"
                  onClick={() => setShowSaveTemplateModal(false)} 
                  className="text-[#64748b] hover:text-white cursor-pointer"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="mb-3">
                <label className="text-[10px] text-[#94a3b8] block mb-1">Название шаблона:</label>
                <input
                  data-testid="input-template-name"
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="например, Мой FVG H1"
                  className="w-full bg-[#070a10] border border-[#2a364f] rounded px-2 py-1 text-white text-xs outline-none focus:border-[#38bdf8]"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[#64748b] mb-4">
                <span>Инструмент: {activeTool || 'Линия'}</span>
                <div className="flex items-center space-x-1">
                  <span>Цвет:</span>
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: activeDrawingStyle.strokeColor }} />
                  <span>({activeDrawingStyle.lineWidth}px)</span>
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowSaveTemplateModal(false)}
                  className="px-2.5 py-1 rounded bg-[#1e2536] hover:bg-[#2a3449] text-[#94a3b8] text-xs cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  data-testid="btn-confirm-save-template"
                  type="button"
                  onClick={handleSaveCurrentAsTemplate}
                  disabled={!newTemplateName.trim()}
                  className="px-3 py-1 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-xs disabled:opacity-40 cursor-pointer"
                >
                  Сохранить
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Active Indicators Stack (Top-left below toolbar) */}
        <ActiveIndicatorStack
          activeIndicators={activeIndicators}
          onToggleVisibility={handleToggleVisibility}
          onOpenSettings={(id) => setSettingsDialogIndId(id)}
          onRemoveIndicator={handleRemoveIndicator}
          onOpenCatalog={() => setIsCatalogOpen(true)}
        />

        {/* Indicators Catalog Modal */}
        <IndicatorsModal
          isOpen={isCatalogOpen}
          onClose={() => setIsCatalogOpen(false)}
          activeIndicators={activeIndicators}
          onAddIndicator={handleAddIndicator}
          onRemoveIndicator={handleRemoveIndicator}
          onOpenSettings={(id) => setSettingsDialogIndId(id)}
        />

        {/* Indicator Settings Dialog */}
        <IndicatorSettingsDialog
          isOpen={Boolean(settingsDialogIndId)}
          indicatorId={settingsDialogIndId}
          currentInputs={activeIndicators.find((i) => i.id === settingsDialogIndId)?.inputs}
          currentStyles={activeIndicators.find((i) => i.id === settingsDialogIndId)?.styles}
          onClose={() => setSettingsDialogIndId(null)}
          onSave={handleSaveSettings}
        />
      </div>
    </div>
  );
}
