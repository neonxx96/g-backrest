import React, { useEffect, useRef, useState, useCallback } from 'react';
import './chart/registerCustomElements.js';
import { useChartOverlays } from './chart/useChartOverlays.js';
import { useChartLifecycle } from './chart/useChartLifecycle.js';
import { useChartAnnotations } from './chart/useChartAnnotations.js';
import { useChartIndicators } from './chart/useChartIndicators.js';
import { useSecondOpinion } from './chart/useSecondOpinion.js';
import ToxicVolatilityOverlay from './chart/ToxicVolatilityOverlay.jsx';
import BtTooltipOverlay from './chart/BtTooltipOverlay.jsx';
import SaveTemplateModal from './chart/SaveTemplateModal.jsx';
import IndicatorsDock from './chart/IndicatorsDock.jsx';
import PositionSetupHUD from './chart/PositionSetupHUD.jsx';
import OnChartDOM from './chart/OnChartDOM.jsx';
import FootprintCanvasLayer from './chart/FootprintCanvasLayer.jsx';
import { X } from 'lucide-react';
import { DEFAULT_ACTIVE_INDICATORS } from '../config/indicatorsRegistry';
import { useLayoutStore } from '../stores/layoutStore';
import { useColorLinksStore } from '../stores/colorLinksStore';
import { useMarketDataStore } from '../stores/marketDataStore';
import { fetchKlinesDualSource, TF_MS } from '../services/marketDataFetcher';
import { useBacktestStore } from '../stores/backtestStore';
import { useTradesStore } from '../stores/tradesStore';
import { renderBacktestTrades, clearBacktestTrades, renderLiveSignals, clearLiveSignals, renderWhaleTrades, clearWhaleTrades } from '../utils/chartAnnotations';
import AssistantHUD from './AssistantHUD';
import DepthHeatmapGL from './DepthHeatmapGL';
import LiquidationHeatmapGL from './chart/LiquidationHeatmapGL';
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
  // Адаптер ChartEngine (изолирует klinecharts); chartRef остаётся нативным инстансом для legacy-хуков
  const engineRef = useRef(null);
  const [chartEngine, setChartEngine] = useState(null);
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
  // События ликвидаций для Alphfractal WebGL-heatmap
  const [liquidationEvents, setLiquidationEvents] = useState([]);

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
    setLiquidationEvents,
    showFootprint, showTpo, showWalls, densityMode,
  });

  // Жизненный цикл графика (init/dispose/ResizeObserver/dual-source свечи/WS) — логика в chart/useChartLifecycle.js (слайс 6.4l)
  useChartLifecycle({
    chartContainerRef, chartRef, chartId, uiConfig, wsRef,
    chartReady, setChartReady, setChartInstance,
    symbol, timeframe, currentKlines, setStatusMsg, setErrorDetails, setKlinesVersion,
    loadDrawings, updateVwapOverlay, loadLiquidations, loadHeatmap, loadFootprint, loadTpoProfile,
    engineRef, setEngine: setChartEngine,
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

  // Индикаторы (каталог/стек/синк с KLineCharts/uiConfig) — логика в chart/useChartIndicators.js (слайс 6.4n)
  const {
    handleAddIndicator, handleRemoveIndicator,
    handleToggleVisibility, handleSaveSettings,
  } = useChartIndicators({
    chartRef, chartId, uiConfig, symbol, chartReady, chartIndicators,
    activeIndicators, setActiveIndicators, setPanelIndicators,
    setStatusMsg, setShowVwap, setShowWalls, setShowLiquidations, setShowHeatmap,
  });

  // Stage 2: «Второе мнение AI» — логика в chart/useSecondOpinion.js (слайс 6.4n)
  const {
    secondOpinionData, setSecondOpinionData,
    isAskingOpinion, setIsAskingOpinion,
    handleAskSecondOpinion, handleDecisionFromOpinion,
  } = useSecondOpinion({
    symbol, timeframe, activePositionSetup, localPositionSetup, currentKlines,
  });

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
  const handleScrollToNow = useCallback(() => {
    if (chartRef.current) {
      try {
        chartRef.current.scrollToRealTime();
        setStatusMsg("Центрировано на текущей цене");
        setTimeout(() => setStatusMsg(""), 1200);
      } catch (_) {}
    }
  }, []);

  useEffect(() => {
    const handleRecenter = () => handleScrollToNow();
    window.addEventListener('recenter-market-price', handleRecenter);
    return () => window.removeEventListener('recenter-market-price', handleRecenter);
  }, [handleScrollToNow]);


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
        onScrollToNow={handleScrollToNow}
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

        {/* Liquidation Heatmap (Alphfractal style): непрерывное WebGL свечение зон ликвидаций (Magma / Sunset / Viridis) */}
        <LiquidationHeatmapGL
          chart={chartInstance}
          engine={chartEngine}
          liquidations={liquidationEvents}
          active={showLiquidations && Boolean(chartInstance || chartEngine)}
        />

        {/* On-Chart DOM: плотности L2 у шкалы цен (Canvas, через ChartEngine) + LiquidityWallStore */}
        {chartEngine && <OnChartDOM engine={chartEngine} symbol={symbol} />}

        {/* Footprint Canvas Layer: кластеры объёмов Bid x Ask, дельта, POC и Naked POC (Canvas 2D) */}
        {chartEngine && <FootprintCanvasLayer engine={chartEngine} symbol={symbol} timeframe={timeframe} />}

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

        {/* Market Regime: Toxic Volatility Warning Overlay — chart/ToxicVolatilityOverlay.jsx (слайс 6.4o) */}
        <ToxicVolatilityOverlay
          isToxicRegime={isToxicRegime}
          isToxicDismissed={isToxicDismissed}
          onDismiss={setIsToxicDismissed}
        />

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

        {/* Backtest marker & trade tooltip — chart/BtTooltipOverlay.jsx (слайс 6.4o) */}
        <BtTooltipOverlay btTooltip={btTooltip} chartContainerRef={chartContainerRef} />


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

        {/* Save Custom Template Modal — chart/SaveTemplateModal.jsx (слайс 6.4o) */}
        <SaveTemplateModal
          showSaveTemplateModal={showSaveTemplateModal}
          setShowSaveTemplateModal={setShowSaveTemplateModal}
          newTemplateName={newTemplateName}
          setNewTemplateName={setNewTemplateName}
          activeTool={activeTool}
          activeDrawingStyle={activeDrawingStyle}
          handleSaveCurrentAsTemplate={handleSaveCurrentAsTemplate}
        />

        {/* Индикаторы: стек + каталог + настройки — chart/IndicatorsDock.jsx (слайс 6.4o) */}
        <IndicatorsDock
          activeIndicators={activeIndicators}
          settingsDialogIndId={settingsDialogIndId}
          setSettingsDialogIndId={setSettingsDialogIndId}
          isCatalogOpen={isCatalogOpen}
          setIsCatalogOpen={setIsCatalogOpen}
          handleToggleVisibility={handleToggleVisibility}
          handleRemoveIndicator={handleRemoveIndicator}
          handleAddIndicator={handleAddIndicator}
          handleSaveSettings={handleSaveSettings}
        />
      </div>
    </div>
  );
}
