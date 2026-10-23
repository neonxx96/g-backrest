import React, { useEffect, useRef, useState, useCallback } from 'react';
import { init, dispose } from 'klinecharts';
import './chart/registerCustomElements.js';
import { useChartOverlays } from './chart/useChartOverlays.js';
import { useChartLifecycle } from './chart/useChartLifecycle.js';
import { useChartAnnotations } from './chart/useChartAnnotations.js';
import { buildChartStyles } from './chart/chartStyles.js';
import PositionSetupHUD from './chart/PositionSetupHUD.jsx';
import { 
  X,
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
  const [isConeActive, setIsConeActive] = useState(false);
  const [localPositionSetup, setLocalPositionSetup] = useState(null);
  const [klinesVersion, setKlinesVersion] = useState(0);
  const [btTooltip, setBtTooltip] = useState(null);

  // Market Regime: Toxic Volatility state


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

  // Жизненный цикл графика (init/dispose/ResizeObserver/dual-source свечи/WS) — логика в chart/useChartLifecycle.js (слайс 6.4l)
  useChartLifecycle({
    chartContainerRef, chartRef, chartId, uiConfig, wsRef,
    chartReady, setChartReady, setChartInstance,
    symbol, timeframe, currentKlines, setStatusMsg, setErrorDetails, setKlinesVersion,
    loadDrawings, updateVwapOverlay, loadLiquidations, loadHeatmap, loadFootprint, loadTpoProfile,
  });

  const effectivePositionSetup = activePositionSetup || localPositionSetup;

  // Аннотации/сигнальные оверлеи (bt/paper/live/whale/AI-уровни/конус/positionSetupBox/strategyLevels/toxic) — логика в chart/useChartAnnotations.js (слайс 6.4m)
  const {
    isToxicRegime, isToxicDismissed, setIsToxicDismissed,
  } = useChartAnnotations({
    chartRef, chartContainerRef, currentKlines, symbol, timeframe,
    chartReady, klinesVersion, setStatusMsg, setBtTooltip, setIsConeActive,
    effectiveBacktestSignals, effectiveShowBtSignals, strategyLevels,
    liveSignals, showLiveSignals, activePositionSetup, localPositionSetup,
    setLocalPositionSetup, effectivePositionSetup,
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
        <PositionSetupHUD
          effectivePositionSetup={effectivePositionSetup}
          handleQuickBacktestCurrentSetup={handleQuickBacktestCurrentSetup}
          isBacktesting={isBacktesting}
          handleAskSecondOpinion={handleAskSecondOpinion}
          isAskingOpinion={isAskingOpinion}
          setLocalPositionSetup={setLocalPositionSetup}
          secondOpinionData={secondOpinionData}
          setSecondOpinionData={setSecondOpinionData}
          symbol={symbol}
          timeframe={timeframe}
          handleDecisionFromOpinion={handleDecisionFromOpinion}
        />

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
