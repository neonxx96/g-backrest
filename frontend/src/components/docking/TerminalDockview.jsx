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
import { FootprintPlaceholderWidget, CvdPlaceholderWidget } from './Placeholders';
import { sanitizeDockviewLayout } from './layoutSanitizer';
import ChannelSelector from './ChannelSelector';
import PresetBar from './PresetBar';
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
  const [timeframe, setTimeframe] = React.useState('15m');

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

  const currentPrice = unifiedData?.snapshot?.price || 82000;

  const handleQuickBt = async () => {
    try {
      await runQuickBacktest({ symbol: currentSymbol, timeframe });
    } catch (err) {
      console.error("Backtest failed:", err);
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#0c0e12]">
      {/* Mini header toolbar with Channel Selector */}
      <div className="h-6 px-2 bg-[#0d1017] border-b border-[#1b2130] flex items-center justify-between text-[10px] shrink-0 font-mono">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-white text-[11px]">{currentSymbol}</span>
          <div className="flex items-center space-x-0.5 bg-[#07090f] rounded border border-[#1e2536] p-0.5">
            {['1m', '5m', '15m', '1h', '4h'].map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-1 rounded text-[9.5px] transition cursor-pointer ${
                  timeframe === tf ? 'bg-[#2563eb] text-white font-bold' : 'text-[#787f91] hover:text-white'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Quick Backtest 1-Click Trigger */}
          <div className="flex items-center space-x-1 pl-1">
            <button
              type="button"
              data-testid={`btn-quick-backtest-${panelId}`}
              onClick={handleQuickBt}
              disabled={isBacktesting}
              className={`px-1.5 py-0.5 rounded border transition cursor-pointer flex items-center gap-1 text-[9px] font-mono ${
                isCurrentSymbolResult
                  ? 'bg-[#0f2e22] text-[#34d399] border-[#10b98150] hover:bg-[#134431]'
                  : 'bg-[#161d2e] hover:bg-[#2563eb] text-[#38bdf8] hover:text-white border-[#2563eb40]'
              }`}
              title={`Запустить 1-click бэктест на истории ${currentSymbol} (${timeframe})`}
            >
              {isBacktesting ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Zap size={10} className={isCurrentSymbolResult ? 'text-[#34d399]' : 'text-yellow-400'} />
              )}
              <span>
                {isBacktesting
                  ? 'Счет...'
                  : activeSetup?.entry_price > 0
                  ? `⚡ Бэктест R:R (1:${activeSetup.rr_ratio || '?'})`
                  : '⚡ Бэктест'}
              </span>
            </button>

            {isCurrentSymbolResult && (
              <div className="flex items-center space-x-1 bg-[#10141e] border border-[#1e293b] px-1 py-0.5 rounded text-[8.5px]">
                <span className="text-[#34d399] font-bold">Win {activeBtResult.win_rate}%</span>
                <span className="text-[#64748b]">|</span>
                <span className={(activeBtResult.net_profit_usd ?? 0) >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}>
                  {(activeBtResult.net_profit_usd ?? 0) >= 0 ? '+' : ''}${activeBtResult.net_profit_usd}
                </span>
                <button
                  type="button"
                  onClick={() => setShowTradesOnChart(!showTradesOnChart)}
                  className="text-[#94a3b8] hover:text-white ml-0.5 cursor-pointer"
                  title={showTradesOnChart ? 'Скрыть сделки с графика' : 'Показать сделки на графике'}
                >
                  {showTradesOnChart ? <Eye size={10} className="text-[#38bdf8]" /> : <EyeOff size={10} />}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          {onOpenIndicators && (
            <button
              type="button"
              onClick={() => onOpenIndicators(panelId)}
              className="px-1.5 py-0.5 rounded bg-[#161d2e] hover:bg-[#2563eb] text-[#38bdf8] hover:text-white border border-[#2563eb40] transition cursor-pointer flex items-center gap-1 text-[9px]"
              title="Каталог индикаторов (расчет на сервере)"
            >
              <SlidersHorizontal size={10} />
              <span>Индикаторы</span>
            </button>
          )}
          <ChannelSelector panelId={panelId} />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative" ref={containerRef}>
        <Chart
          chartId={panelId}
          symbol={currentSymbol}
          timeframe={timeframe}
          userId="0"
          strategyLevels={strategyLevels || []}
          activePositionSetup={activePositionSetup}
          backtestSignals={btResult}
          showBacktestSignals={showBtSignals}
          uiConfig={uiConfig}
          onOpenIndicators={onOpenIndicators}
        />
        {showLiqLayers && dimensions.width > 0 && dimensions.height > 0 && (
          <ChartCanvasOverlay
            width={dimensions.width}
            height={dimensions.height}
            currentPrice={currentPrice}
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

  const currentPrice = unifiedData?.snapshot?.price || 82000;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-[#0c0e12]">
      <div className="h-6 px-2 bg-[#0d1017] border-b border-[#1b2130] flex items-center justify-between text-[10px] shrink-0 font-mono">
        <div className="flex items-center space-x-1.5">
          <span className="font-bold text-white text-[11px]">Ликвидации & Карантин</span>
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
          <span className="font-bold text-white text-[11px]">Стакан DOM</span>
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
          <span className="font-bold text-white text-[11px]">Лента сигналов</span>
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
                  <span className="font-bold text-white text-[10.5px]">{sig.symbol}</span>
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
  signalsSharedProps = {}
}) {
  const dockviewApiRef = useRef(null);

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
      footprint_placeholder: FootprintPlaceholderWidget,
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
        title: 'График LTF (1m)'
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
        title: 'Watchlist'
      });

      const chartPanel = api.addPanel({
        id: 'chart_main',
        component: 'chart',
        title: 'График (HTF)',
        position: { referencePanel: watchlistPanel, direction: 'right' }
      });

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

  // Hydrate layout into Dockview API
  const hydrateLayout = useCallback(
    (api, workspaceDetail) => {
      if (!api || !workspaceDetail) return;

      useLayoutStore.setState({ isLayoutLoaded: false });

      const layoutData = workspaceDetail.layout_data || {};
      const dockviewJson = layoutData.dockview;

      if (workspaceDetail.color_links) {
        importColorLinks(workspaceDetail.color_links);
      }

      if (dockviewJson && typeof dockviewJson === 'object' && dockviewJson.grid) {
        try {
          api.clear();
          const sanitizedLayout = sanitizeDockviewLayout(dockviewJson);
          if (!sanitizedLayout) {
            buildDefaultLayout(api, workspaceDetail.id);
            return;
          }
          api.fromJSON(sanitizedLayout);
          // Auto-migrate: If trades_main is not yet in the saved layout, add it tabbed within signals_main
          if (!api.getPanel('trades_main')) {
            const ref = api.getPanel('signals_main') || api.getPanel('orderbook_main') || api.getPanel('chart_main');
            if (ref) {
              api.addPanel({
                id: 'trades_main',
                component: 'trades',
                title: 'Лента сделок (Tape)',
                position: { referencePanel: ref, direction: 'within' }
              });
            }
          }
        } catch (err) {
          console.warn('Dockview fromJSON corrupted, rebuilding default layout:', err);
          buildDefaultLayout(api, workspaceDetail.id);
        }
      } else {
        buildDefaultLayout(api, workspaceDetail.id);
      }

      // Mark layout as ready so future user drag/resize events trigger autosave safely
      setTimeout(() => {
        markLayoutReady();
      }, 250);
    },
    [importColorLinks, buildDefaultLayout, markLayoutReady]
  );

  // Initialize Dockview API
  const onReady = useCallback(
    async (event) => {
      dockviewApiRef.current = event.api;

      // Provide shared props to panels via containerApi
      event.api.chartSharedProps = chartSharedProps;
      event.api.domSharedProps = domSharedProps;
      event.api.signalsSharedProps = signalsSharedProps;

      // Load presets and active workspace
      await loadPresets();
      const currentDetail = await loadWorkspaceDetail(activePresetId);
      hydrateLayout(event.api, currentDetail);

      // Listen to layout changes for debounced SQLite autosave
      event.api.onDidLayoutChange(() => {
        const json = event.api.toJSON();
        scheduleAutosave(json, useColorLinksStore.getState().channels);
      });
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
        component = 'footprint_placeholder';
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
      } else if (type === 'tradehistory' || type === 'trades_history') {
        title = 'История сделок & Прогнозы';
        component = 'tradehistory';
        const ref = signalsPanels[0] || tradesPanels[0] || domPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: 'within' };
        }
      } else if (type === 'papertrade' || type === 'paper_trading') {
        title = 'Бумажная торговля (Paper Trade)';
        component = 'papertrade';
        const ref = signalsPanels[0] || tradesPanels[0] || domPanels[0] || panels[0];
        if (ref) {
          position = { referencePanel: ref, direction: 'within' };
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
      className="h-full w-full flex flex-col overflow-hidden bg-[#0a0d14]"
    >
      {/* Top Presets bar */}
      <PresetBar
        onSwitchPreset={handleSwitchPreset}
        onNewPreset={handleNewPreset}
        onAddTradesPanel={handleAddTradesPanel}
      />

      {/* Dockview Container */}
      <div className="flex-1 w-full min-h-0 relative dockview-theme-dark">
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-dark h-full w-full"
        />
      </div>

      {/* Widget Hub Modal */}
      <WidgetHubModal />
    </div>
  );
}
