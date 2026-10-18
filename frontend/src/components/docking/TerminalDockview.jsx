import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { DockviewReact } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';

import { useLayoutStore } from '../../stores/layoutStore';
import { useColorLinksStore } from '../../stores/colorLinksStore';

import Chart from '../Chart';
import OrderBookDOM from '../OrderBookDOM';
import WatchlistWidget from './WatchlistWidget';
import { FootprintPlaceholderWidget, CvdPlaceholderWidget } from './Placeholders';
import ChannelSelector from './ChannelSelector';
import PresetBar from './PresetBar';
import { Radio, SlidersHorizontal, Sparkles } from 'lucide-react';

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

      <div className="flex-1 min-h-0 relative">
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
      watchlist: WatchlistWidget,
      signals: SignalsDockPanel,
      footprint_placeholder: FootprintPlaceholderWidget,
      cvd_placeholder: CvdPlaceholderWidget
    }),
    []
  );

  // Helper to build default layout programmatically if no json saved
  const buildDefaultLayout = useCallback((api, presetId) => {
    api.clear();

    if (presetId === 'default_orderflow') {
      // Preset 2: Order Flow Scalper
      // Left: LTF Chart, Center: DOM, Right: Tab group of Footprint / CVD / Signals
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

      api.addPanel({
        id: 'cvd_placeholder',
        component: 'cvd_placeholder',
        title: 'CVD Дельта',
        position: { referencePanel: footprintPanel, direction: 'within' }
      });

      api.addPanel({
        id: 'signals_main',
        component: 'signals',
        title: 'Лента сигналов',
        position: { referencePanel: footprintPanel, direction: 'below' }
      });
    } else {
      // Preset 1: Classic Trader (Default)
      // Left: Watchlist (width ~260px), Center: Chart, Right: DOM (top) + Signals (bottom)
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

      api.addPanel({
        id: 'signals_main',
        component: 'signals',
        title: 'Лента сигналов',
        position: { referencePanel: domPanel, direction: 'below' }
      });
    }
  }, []);

  // Hydrate layout into Dockview API
  const hydrateLayout = useCallback(
    (api, workspaceDetail) => {
      if (!api || !workspaceDetail) return;

      const layoutData = workspaceDetail.layout_data || {};
      const dockviewJson = layoutData.dockview;

      if (workspaceDetail.color_links) {
        importColorLinks(workspaceDetail.color_links);
      }

      if (dockviewJson && typeof dockviewJson === 'object' && dockviewJson.grid) {
        try {
          api.clear();
          api.fromJSON(dockviewJson);
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
      }, 150);
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

  return (
    <div
      data-testid="terminal-dockview-container"
      className="h-full w-full flex flex-col overflow-hidden bg-[#0a0d14]"
    >
      {/* Top Presets bar */}
      <PresetBar
        onSwitchPreset={handleSwitchPreset}
        onNewPreset={handleNewPreset}
      />

      {/* Dockview Container */}
      <div className="flex-1 w-full min-h-0 relative dockview-theme-dark">
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-dark h-full w-full"
        />
      </div>
    </div>
  );
}
