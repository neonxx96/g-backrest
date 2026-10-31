import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { DockviewReact } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

import { useLayoutStore } from '../../stores/layoutStore';
import { useColorLinksStore } from '../../stores/colorLinksStore';

import Chart from '../Chart';
import OrderBookDOM from '../OrderBookDOM';
import WatchlistWidget from './WatchlistWidget';
import ScreenerWidget from './ScreenerWidget';
import TradesWidget from './TradesWidget';
import WidgetHubModal from './WidgetHubModal';
import TradeHistoryWidget from './TradeHistoryWidget';
import { CvdPlaceholderWidget } from './Placeholders';
import FootprintPanel from './FootprintPanel';
import { sanitizeDockviewLayout, hasNullSizes, collectSalvagePanels } from './layoutSanitizer';
import {
  readCachedDockviewLayout,
  resolveDockviewLayout,
  hasRenderableTerminalPanel,
  readChartPanelTimeframe,
  persistChartPanelTimeframe,
} from './layoutRecovery.js';
import { getUsableMarketPrice } from '../../services/marketTruth.js';
import ChannelSelector from './ChannelSelector';
import PresetBar from './PresetBar';
import WorkspaceScroller from './WorkspaceScroller';
import { readStoredVisibility } from '../settings/VisibilityTab';
import { Radio, SlidersHorizontal, Sparkles, Zap, Loader2, Eye, EyeOff } from 'lucide-react';
import { useBacktestStore } from '../../stores/backtestStore';
import { useTradeOverlayStore } from '../../stores/tradeOverlayStore';
import { useQuantStore } from '../../stores/quantStore';
import ChartCanvasOverlay from '../design-previews/ChartCanvasOverlay';
import LiqAnalyticsPanel from '../design-previews/LiqAnalyticsPanel';
import QuantDecisionConsilium from '../design-previews/QuantDecisionConsilium';

/**
 * Chart Panel Component for Dockview
 */
function ChartDockPanel(props) {
  const panelId = props.api.id;
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));
  const [timeframe, setTimeframe] = React.useState(() => readChartPanelTimeframe(props.api.id));
  const selectTimeframe = (nextTimeframe) => {
    setTimeframe(nextTimeframe);
    persistChartPanelTimeframe(panelId, nextTimeframe);
  };

  const {
    uiConfig,
    strategyLevels,
    activePositionSetup,
    btResult,
    showBtSignals,
    onOpenIndicators
  } = props.containerApi.chartSharedProps || {};

  const activeBtResult = useBacktestStore((s) => s.activeResult);
  const isBacktesting = useBacktestStore((s) => s.isRunning);
  const showTradesOnChart = useBacktestStore((s) => s.showTradesOnChart);
  const setShowTradesOnChart = useBacktestStore((s) => s.setShowTradesOnChart);
  const runQuickBacktest = useBacktestStore((s) => s.runQuickBacktest);
  const activeSetup = useTradeOverlayStore((s) => s.activeSetup);

  const isCurrentSymbolResult = activeBtResult && activeBtResult.symbol === currentSymbol.toUpperCase();

  // Quant Overlays & Live Data
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = React.useState({ width: 0, height: 0 });

  const showLiqLayers = useQuantStore((s) => s.showLiqLayers);
  const layers = useQuantStore((s) => s.layers);
  const leverages = useQuantStore((s) => s.leverages);
  const minWallMultiplier = useQuantStore((s) => s.minWallMultiplier);
  const wallLineThickness = useQuantStore((s) => s.wallLineThickness);
  const layerOpacity = useQuantStore((s) => s.layerOpacity);
  const liqPalette = useQuantStore((s) => s.liqPalette);
  const unifiedData = useQuantStore((s) => s.unifiedData);
  const fetchMarketData = useQuantStore((s) => s.fetchMarketData);

  useEffect(() => {
    fetchMarketData(currentSymbol);
  }, [currentSymbol, fetchMarketData]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width: Math.round(width), height: Math.round(height) });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const currentPrice = getUsableMarketPrice(unifiedData?.snapshot?.price);

  const handleQuickBt = async () => {
    try {
      await runQuickBacktest({ symbol: currentSymbol, timeframe });
    } catch (err) {
      console.error("Backtest failed:", err);
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-background">
      <div className="flex-1 min-h-0 relative" ref={containerRef}>
        <Chart
          chartId={panelId}
          symbol={currentSymbol}
          timeframe={timeframe}
          onTimeframeChange={selectTimeframe}
          userId="0"
          strategyLevels={strategyLevels || []}
          activePositionSetup={activePositionSetup}
          backtestSignals={btResult}
          showBacktestSignals={showBtSignals}
          uiConfig={uiConfig}
          onOpenIndicators={onOpenIndicators}
          handleQuickBt={handleQuickBt}
          isBacktesting={isBacktesting}
          activeBtResult={activeBtResult}
          isCurrentSymbolResult={isCurrentSymbolResult}
          showTradesOnChart={showTradesOnChart}
          setShowTradesOnChart={setShowTradesOnChart}
          activeSetup={activeSetup}
        />
        {showLiqLayers && currentPrice != null && dimensions.width > 0 && dimensions.height > 0 && (
          <ChartCanvasOverlay
            width={dimensions.width}
            height={dimensions.height}
            currentPrice={currentPrice}
            symbol={currentSymbol}
            liqData={unifiedData?.liq_estimates}
            depthData={unifiedData?.orderbook_depth}
            layers={layers}
            leverages={leverages}
            minWallMultiplier={minWallMultiplier}
            wallLineThickness={wallLineThickness}
            liqPalette={liqPalette}
            layerOpacity={layerOpacity / 100}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Liquidation Analytics & Quarantine Dock Panel Component for Dockview
 */
function LiqAnalyticsDockPanel(props) {
  const panelId = props.api.id;
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));
  const unifiedData = useQuantStore((s) => s.unifiedData);
  const core3Report = useQuantStore((s) => s.core3Report);
  const promptData = useQuantStore((s) => s.promptData);
  const isCommitting = useQuantStore((s) => s.isCommitting);
  const quarantineSaved = useQuantStore((s) => s.quarantineSaved);
  const commitQuarantine = useQuantStore((s) => s.commitQuarantine);
  const fetchMarketData = useQuantStore((s) => s.fetchMarketData);
  const loading = useQuantStore((s) => s.loading);

  React.useEffect(() => {
    fetchMarketData(currentSymbol);
  }, [currentSymbol, fetchMarketData]);

  const currentPrice = getUsableMarketPrice(unifiedData?.snapshot?.price);

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#0c0e12]">
      <div className="h-6 px-2 bg-[#0d1017] border-b border-[#1b2130] flex items-center justify-between text-[10px] shrink-0 font-mono">
        <div className="flex items-center space-x-1.5">
          <span className="font-bold text-foreground text-[11px]">Ликвидации & Карантин</span>
          <span className="text-[#38bdf8] font-bold">{currentSymbol}</span>
        </div>
        <ChannelSelector panelId={panelId} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
        <QuantDecisionConsilium
          symbol={currentSymbol}
          core3Report={core3Report}
          promptData={promptData}
          onCommitQuarantine={() => commitQuarantine(currentSymbol)}
          isCommitting={isCommitting}
          quarantineSaved={quarantineSaved}
        />
        <div className="rounded border border-[#1b2130] overflow-hidden">
          <LiqAnalyticsPanel
            symbol={currentSymbol}
            currentPrice={currentPrice}
            liqData={unifiedData?.liq_estimates}
            depthData={unifiedData?.orderbook_depth}
            isLoading={loading}
            onRefresh={() => fetchMarketData(currentSymbol)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * OrderBook DOM Panel Component for Dockview
 */
function OrderBookDockPanel(props) {
  const panelId = props.api.id;
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));

  const {
    uiConfig,
    strategyLevels,
    activePositionSetup,
    userLimitOrders,
    onMarketSummary,
    onProximityAlert
  } = props.containerApi.domSharedProps || {};

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#0c0e12]">
      <div className="h-6 px-2 bg-[#0d1017] border-b border-[#1b2130] flex items-center justify-between text-[10px] shrink-0 font-mono">
        <div className="flex items-center space-x-1.5">
          <span className="font-bold text-foreground text-[11px]">Стакан DOM</span>
          <span className="text-[#38bdf8] font-bold">{currentSymbol}</span>
        </div>
        <ChannelSelector panelId={panelId} />
      </div>

      <div className="flex-1 min-h-0 relative">
        <OrderBookDOM
          symbol={currentSymbol}
          uiConfig={uiConfig}
          strategyLevels={strategyLevels || []}
          activePositionSetup={activePositionSetup}
          userLimitOrders={userLimitOrders || []}
          onMarketSummary={onMarketSummary}
          onProximityAlert={onProximityAlert}
        />
      </div>
    </div>
  );
}

/**
 * Signals Tape Panel Component for Dockview
 */
function SignalsDockPanel(props) {
  const panelId = props.api.id;
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));
  const dispatchSymbolChange = useColorLinksStore((s) => s.dispatchSymbolChange);

  const { signals: propSignals = [] } = props.containerApi.signalsSharedProps || {};
  const [internalSignals, setInternalSignals] = React.useState([]);

  React.useEffect(() => {
    let active = true;
    const fetchSignals = async () => {
      try {
        const res = await fetch('/api/signals?limit=30');
        if (res.ok && active) {
          const list = await res.json();
          if (Array.isArray(list)) setInternalSignals(list);
        }
      } catch (_) {}
    };
    fetchSignals();
    const interval = setInterval(fetchSignals, 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const signals = propSignals.length > 0 ? propSignals : internalSignals;

  return (
    <div
      data-testid="signals-dock-panel"
      className="h-full w-full flex flex-col font-sans select-none text-xs bg-[#0b0e14] text-[#d1d4dc] border-r border-[#1a1f2c]"
    >
      <div className="h-6 px-2 bg-[#0f1420] border-b border-[#1f2638] flex items-center justify-between shrink-0 font-mono text-[10px]">
        <div className="flex items-center space-x-1.5">
          <Radio size={11} className="text-[#38bdf8] animate-pulse" />
          <span className="font-bold text-foreground text-[11px]">Лента сигналов</span>
          <span className="text-[9.5px] text-[#64748b]">({signals.length})</span>
        </div>
        <ChannelSelector panelId={panelId} />
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[#131722] min-h-0">
        {signals.length === 0 ? (
          <div className="p-4 text-center text-[#64748b] text-[10.5px] font-mono">
            Ожидание сигналов Order Flow & EMA...
          </div>
        ) : (
          signals.map((sig, i) => {
            const isBuy = sig.type === 'BUY' || (sig.direction || '').includes('BULL');
            const isCurrent = sig.symbol === currentSymbol;

            return (
              <div
                key={sig.id || i}
                onClick={() => dispatchSymbolChange(panelId, sig.symbol)}
                className={`p-2 hover:bg-[#131a26] cursor-pointer transition text-[10px] font-mono ${
                  isCurrent ? 'bg-[#182338]' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-foreground text-[10.5px]">{sig.symbol}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${
                      isBuy ? 'bg-[#10b98125] text-[#10b981]' : 'bg-[#ef444425] text-[#ef4444]'
                    }`}
                  >
                    {isBuy ? 'BUY ZONE' : 'SHORT'}
                  </span>
                </div>
                <div className="text-[#94a3b8] text-[9.5px] mt-0.5 truncate">
                  {sig.reason || sig.description || 'Плотность в стакане'}
                </div>
                <div className="flex items-center justify-between text-[#64748b] text-[9px] mt-0.5">
                  <span>Цена: ${Number(sig.price || 0).toFixed(1)}</span>
                  <span>{sig.timeframe || '15m'}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Main Terminal Dockview Component
 */
export default function TerminalDockview({
  chartSharedProps = {},
  domSharedProps = {},
  signalsSharedProps = {},
  layersProps = null
}) {
  const dockviewApiRef = useRef(null);
  const layoutChangeDisposableRef = useRef(null);
  const [dockviewApi, setDockviewApi] = React.useState(null);
  const [vis, setVis] = React.useState(() => readStoredVisibility());

  useEffect(() => {
    const onVis = (e) => setVis(e.detail);
    window.addEventListener('signalscript:visibility-changed', onVis);
    return () => window.removeEventListener('signalscript:visibility-changed', onVis);
  }, []);

  const presets = useLayoutStore((s) => s.presets);
  const activePresetId = useLayoutStore((s) => s.activePresetId);
  const loadPresets = useLayoutStore((s) => s.loadPresets);
  const loadWorkspaceDetail = useLayoutStore((s) => s.loadWorkspaceDetail);
  const markLayoutReady = useLayoutStore((s) => s.markLayoutReady);
  const scheduleAutosave = useLayoutStore((s) => s.scheduleAutosave);
  const createPreset = useLayoutStore((s) => s.createPreset);

  const channels = useColorLinksStore((s) => s.channels);
  const importColorLinks = useColorLinksStore((s) => s.importColorLinks);

  // Components registry for Dockview
  const components = useMemo(
    () => ({
      chart: ChartDockPanel,
      orderbook: OrderBookDockPanel,
      dom: OrderBookDockPanel,
      watchlist: ScreenerWidget,
      screener: ScreenerWidget,
      signals: SignalsDockPanel,
      trades: TradesWidget,
      footprint: FootprintPanel,
      footprint_placeholder: FootprintPanel, // обратная совместимость с сохранёнными раскладками
      cvd_placeholder: CvdPlaceholderWidget,
      papertrade: TradeHistoryWidget,
      tradehistory: TradeHistoryWidget,
      liq_analytics: LiqAnalyticsDockPanel,
      liquidations: LiqAnalyticsDockPanel
    }),
    []
  );

  // Helper to build default layout programmatically if no json saved
  const buildDefaultLayout = useCallback((api, presetId) => {
    api.clear();

    if (presetId === 'default_orderflow') {
      // Preset 2: Order Flow Scalper
      // Left: LTF Chart, Center: DOM, Right: Tab group of Footprint / CVD / Signals + Tape
      const chartPanel = api.addPanel({
        id: 'chart_ltf',
        component: 'chart',
        title: 'График LTF (1m)',
        minimumWidth: 320,
      });

      const domPanel = api.addPanel({
        id: 'orderbook_main',
        component: 'orderbook',
        title: 'Стакан DOM',
        position: { referencePanel: chartPanel, direction: 'right' }
      });

      const footprintPanel = api.addPanel({
        id: 'footprint_placeholder',
        component: 'footprint_placeholder',
        title: 'Футпринт / Кластеры',
        position: { referencePanel: domPanel, direction: 'right' }
      });

      const cvdPanel = api.addPanel({
        id: 'cvd_placeholder',
        component: 'cvd_placeholder',
        title: 'CVD Дельта',
        position: { referencePanel: footprintPanel, direction: 'below' }
      });

      const signalsPanel = api.addPanel({
        id: 'signals_main',
        component: 'signals',
        title: 'Лента сигналов',
        position: { referencePanel: domPanel, direction: 'below' }
      });

      api.addPanel({
        id: 'trades_main',
        component: 'trades',
        title: 'Лента сделок (Tape)',
        position: { referencePanel: signalsPanel, direction: 'within' }
      });

    } else {
      // Preset 1: Classic Trader (Default)
      // Left: Watchlist (width ~260px), Center: Chart, Right: DOM (top) + Signals / Trades (bottom)
      const watchlistPanel = api.addPanel({
        id: 'watchlist_main',
        component: 'watchlist',
        title: 'Список наблюдения'
      });

      const chartPanel = api.addPanel({
        id: 'chart_main',
        component: 'chart',
        title: 'График (HTF)',
        minimumWidth: 320,
        position: { referencePanel: watchlistPanel, direction: 'right' }
      });
      api.addPanel({ id: 'tradehistory_main', component: 'tradehistory', title: 'Демо-торговля & Сделки (20 пар)', position: { referencePanel: chartPanel, direction: 'below' } });

      const domPanel = api.addPanel({
        id: 'orderbook_main',
        component: 'orderbook',
        title: 'Стакан DOM',
        position: { referencePanel: chartPanel, direction: 'right' }
      });

      const signalsPanel = api.addPanel({
        id: 'signals_main',
        component: 'signals',
        title: 'Лента сигналов',
        position: { referencePanel: domPanel, direction: 'below' }
      });

      api.addPanel({
        id: 'trades_main',
        component: 'trades',
        title: 'Лента сделок (Tape)',
        position: { referencePanel: signalsPanel, direction: 'within' }
      });
    }
  }, []);

  /** Пересборка рабочего стола из набора панелей отравленного layout.
   *  addPanel даёт здоровое distribute-распределение (живые саши),
   *  чего fromJSON по деградировавшей сериализации дать не может. */
  const rebuildSalvagedLayout = useCallback(
    (api, layout, workspaceId) => {
      const items = collectSalvagePanels(layout);
      const pick = (comps) => items.find((i) => comps.includes(i.component));
      const chart = pick(['chart']);
      if (!chart) {
        buildDefaultLayout(api, workspaceId);
        return;
      }
      api.clear();
      const used = new Set();
      const add = (item, position, fallbackTitle) => {
        used.add(item.id);
        return api.addPanel({
          id: item.id,
          component: item.component,
          title: item.title || fallbackTitle || item.component,
          ...(position ? { position } : {}),
        });
      };
      const chartPanel = add(chart, null, 'График (HTF)');
      const watch = pick(['watchlist', 'screener']);
      if (watch) add(watch, { referencePanel: chartPanel, direction: 'left' });
      const th = pick(['tradehistory', 'papertrade']);
      if (th) add(th, { referencePanel: chartPanel, direction: 'below' });
      const dom = pick(['orderbook', 'dom']);
      const domPanel = dom ? add(dom, { referencePanel: chartPanel, direction: 'right' }) : null;
      const sig = pick(['signals']);
      const tabAnchor = sig
        ? add(sig, { referencePanel: domPanel || chartPanel, direction: 'below' })
        : (domPanel || chartPanel);
      for (const item of items) {
        if (used.has(item.id)) continue;
        add(item, { referencePanel: tabAnchor, direction: 'within' });
      }
    },
    [buildDefaultLayout]
  );

  // Hydrate layout into Dockview API
  const hydrateLayout = useCallback(
    (api, workspaceDetail) => {
      if (!api) return;

      useLayoutStore.setState({ isLayoutLoaded: false });

      const { layout: dockviewJson } = resolveDockviewLayout(workspaceDetail, readCachedDockviewLayout());

      if (workspaceDetail?.color_links) {
        importColorLinks(workspaceDetail.color_links);
      }

      if (dockviewJson) {
        try {
          api.clear();
          const sanitizedLayout = sanitizeDockviewLayout(dockviewJson);
          if (sanitizedLayout && hasRenderableTerminalPanel(sanitizedLayout)) {
            if (hasNullSizes(dockviewJson)) {
              // Отравленная сериализация (size:null — деградировавшие внутренние
              // размеры dockview): fromJSON даст нулевые группы и мёртвые саши.
              // Пересобираем стол через addPanel, сохранив набор панелей.
              rebuildSalvagedLayout(api, sanitizedLayout, workspaceDetail?.id || useLayoutStore.getState().activePresetId);
            } else {
              api.fromJSON(sanitizedLayout);
            }
            // Сеть безопасности: если dockview всё же отрендерил группы
            // нулевой ширины — пересобираем дефолтный layout.
            requestAnimationFrame(() => {
              const widths = Array.from(document.querySelectorAll('.dv-groupview'))
                .map((el) => el.getBoundingClientRect().width);
              const broken = widths.length > 0 && widths.filter((w) => w < 40).length > widths.length / 2;
              if (broken) {
                console.warn('Dockview rendered degenerate layout; rebuilding default.');
                buildDefaultLayout(api, workspaceDetail?.id || useLayoutStore.getState().activePresetId);
              }
            });
          } else {
            console.warn('Dockview preset is empty or malformed; rebuilding safe layout.');
            buildDefaultLayout(api, workspaceDetail.id);
          }
        } catch (err) {
          console.warn('Dockview fromJSON corrupted, rebuilding default layout:', err);
          buildDefaultLayout(api, workspaceDetail.id);
        }
      } else {
        buildDefaultLayout(api, workspaceDetail?.id || useLayoutStore.getState().activePresetId);
      }

      // Dockview's imperative mutations above are synchronous.  Releasing the
      // autosave gate here, rather than after an arbitrary timer, ensures a
      // transient empty grid can never overwrite a restored workspace.
      markLayoutReady();
    },
    [importColorLinks, buildDefaultLayout, rebuildSalvagedLayout, markLayoutReady]
  );

  // Initialize Dockview API
  const onReady = useCallback(
    async (event) => {
      dockviewApiRef.current = event.api;
      setDockviewApi(event.api);
      // Для live-проверок (scripts/verify_dock_drag_resize.py) и отладки в консоли.
      window.__dockviewApi = event.api;
      window.__sanitizeDockview = sanitizeDockviewLayout;

      // Provide shared props to panels via containerApi
      event.api.chartSharedProps = chartSharedProps;
      event.api.domSharedProps = domSharedProps;
      event.api.signalsSharedProps = signalsSharedProps;

      // Subscribe before any imperative layout operation.  The gate starts
      // closed, so initial Dockview events are observed but never persisted.
      layoutChangeDisposableRef.current?.dispose?.();
      layoutChangeDisposableRef.current = event.api.onDidLayoutChange(() => {
        const json = event.api.toJSON();
        // size:null — маркер деградировавших внутренних размеров dockview;
        // сохранять такое нельзя: травма layout'ом самоподдерживается.
        if (hasNullSizes(json)) {
          console.warn('Dockview autosave skipped: layout has null sizes (degenerate state).');
          return;
        }
        scheduleAutosave(json, useColorLinksStore.getState().channels);
      });

      // 1. Render cache/default synchronously. This also marks the layout
      // ready when no SQLite workspace exists or its request is slow.
      hydrateLayout(event.api, null);

      // 2. Replace only with a valid workspace returned by SQLite.  A failed
      // request deliberately leaves the already usable layout untouched.
      try {
        await loadPresets();
        const currentDetail = await loadWorkspaceDetail(activePresetId);
        if (currentDetail?.layout_data?.dockview) {
          hydrateLayout(event.api, currentDetail);
        }
      } catch (err) {
        console.debug('Background workspace sync:', err);
      }

    },
    [
      chartSharedProps,
      domSharedProps,
      signalsSharedProps,
      loadPresets,
      loadWorkspaceDetail,
      activePresetId,
      hydrateLayout,
      scheduleAutosave
    ]
  );

  useEffect(() => () => {
    layoutChangeDisposableRef.current?.dispose?.();
    layoutChangeDisposableRef.current = null;
  }, []);

  // Keep shared props updated
  useEffect(() => {
    if (dockviewApiRef.current) {
      dockviewApiRef.current.chartSharedProps = chartSharedProps;
      dockviewApiRef.current.domSharedProps = domSharedProps;
      dockviewApiRef.current.signalsSharedProps = signalsSharedProps;
    }
  }, [chartSharedProps, domSharedProps, signalsSharedProps]);

  // Handle preset switch from PresetBar
  const handleSwitchPreset = async (presetId) => {
    if (!dockviewApiRef.current) return;
    const detail = await loadWorkspaceDetail(presetId);
    hydrateLayout(dockviewApiRef.current, detail);
  };

  // Handle new preset creation
  const handleNewPreset = async (name) => {
    if (!dockviewApiRef.current) return;
    const currentJson = dockviewApiRef.current.toJSON();
    const currentColors = useColorLinksStore.getState().channels;
    const saved = await createPreset(name, currentJson, currentColors);
    handleSwitchPreset(saved.id);
  };

  // Handle dynamically adding a widget from Widget Hub
  const handleAddWidget = useCallback(
    (type, customOptions = {}) => {
      const api = dockviewApiRef.current;
      if (!api) return null;

      const timestamp = Date.now();
      let panelId = `${type}_${timestamp}`;
      let title = '';
      let component = type;
      let position = {};

      const panels = Array.isArray(api.panels)
        ? api.panels
        : api.panels && typeof api.panels.values === 'function'
        ? Array.from(api.panels.values())
        : [];
      const chartPanels = panels.filter((p) => p.id.startsWith('chart'));
      const domPanels = panels.filter((p) => p.id.startsWith('orderbook'));
      const tradesPanels = panels.filter((p) => p.id.startsWith('trades'));
      const screenerPanels = panels.filter(
        (p) => p.id.startsWith('watchlist') || p.id.startsWith('screener')
      );
      const signalsPanels = panels.filter((p) => p.id.startsWith('signals'));

      if (type === 'chart') {
        title = `График #${chartPanels.length + 1}`;
        component = 'chart';
        const ref = chartPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: 'within' };
        }
      } else if (type === 'orderbook' || type === 'dom') {
        title = `Стакан DOM #${domPanels.length + 1}`;
        component = 'orderbook';
        const ref = domPanels[0] || chartPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: domPanels[0] ? 'within' : 'right' };
        }
      } else if (type === 'trades') {
        title = `Лента сделок (Tape) #${tradesPanels.length + 1}`;
        component = 'trades';
        const ref = tradesPanels[0] || signalsPanels[0] || domPanels[0] || panels[0];
        if (ref) {
          position = {
            referencePanel: ref,
            direction: tradesPanels[0] || signalsPanels[0] ? 'within' : 'below'
          };
        }
      } else if (type === 'screener' || type === 'watchlist') {
        title = `Скринер рынка #${screenerPanels.length + 1}`;
        component = 'screener';
        const ref = screenerPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: screenerPanels[0] ? 'within' : 'left' };
        }
      } else if (type === 'signals') {
        title = `Лента сигналов #${signalsPanels.length + 1}`;
        component = 'signals';
        const ref = signalsPanels[0] || tradesPanels[0] || domPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: 'within' };
        }
      } else if (type === 'footprint') {
        title = 'Футпринт / Кластеры';
        component = 'footprint';
        const ref = domPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: 'right' };
        }
      } else if (type === 'cvd') {
        title = 'CVD Дельта';
        component = 'cvd_placeholder';
        const ref = domPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: 'below' };
        }
      } else if (type === 'tradehistory' || type === 'trades_history' || type === 'papertrade' || type === 'paper_trading') {
        const existing = api.getPanel('tradehistory_main') || (api.panels || []).find(p => p.component === 'tradehistory' || p.component === 'papertrade');
        if (existing) {
          existing.api?.setActive?.();
          return;
        }
        title = 'Демо-торговля & Сделки (20 пар)';
        component = 'tradehistory';
        const ref = chartPanels[0] || signalsPanels[0] || domPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: 'below' };
        }
      }

      // Connect to color channel c1
      useColorLinksStore.getState().setPanelChannel(panelId, 'c1');

      const panel = api.addPanel({
        id: panelId,
        component,
        title: customOptions.title || title,
        position: Object.keys(position).length > 0 ? position : undefined
      });

      if (panel) {
        panel.api.setActive();
      }

      const json = api.toJSON();
      scheduleAutosave(json, useColorLinksStore.getState().channels);
      return panel;
    },
    [scheduleAutosave]
  );

  useEffect(() => {
    useLayoutStore.getState().setAddWidgetHandler(handleAddWidget);
    return () => {
      useLayoutStore.getState().setAddWidgetHandler(null);
    };
  }, [handleAddWidget]);

  // Handle open / focus Trades Tape panel
  const handleAddTradesPanel = () => {
    if (!dockviewApiRef.current) return;
    const api = dockviewApiRef.current;
    const existing = api.getPanel('trades_main');
    if (existing) {
      existing.api.setActive();
      return;
    }
    const ref = api.getPanel('signals_main') || api.getPanel('orderbook_main') || api.getPanel('chart_main');
    if (ref) {
      api.addPanel({
        id: 'trades_main',
        component: 'trades',
        title: 'Лента сделок (Tape)',
        position: { referencePanel: ref, direction: 'within' }
      });
    }
  };

  return (
    <div
      data-testid="terminal-dockview-container"
      className="h-full w-full flex flex-col overflow-hidden bg-background"
    >
      {/* Top Presets bar (hidden in Zen mode or when disabled in visibility settings) */}
      {vis?.showPresetBar !== false && !vis?.zenMode && (
        <PresetBar
          layersProps={layersProps}
          onSwitchPreset={handleSwitchPreset}
          onNewPreset={handleNewPreset}
          onAddTradesPanel={handleAddTradesPanel}
        />
      )}

      {/* Dockview Container with dynamic height & smooth vertical scroll */}
      <WorkspaceScroller dockviewApi={dockviewApi || dockviewApiRef.current}>
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-dark h-full w-full"
        />
      </WorkspaceScroller>

      {/* Widget Hub Modal */}
      <WidgetHubModal />
    </div>
  );
}
