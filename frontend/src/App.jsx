import React, { useState, useEffect, useRef, useCallback } from 'react';
import Chart from './components/Chart';
import OrderBookDOM from './components/OrderBookDOM';
import ScalperTradeDesk from './components/ScalperTradeDesk';
import Tape from './components/Tape';
import SignalsFeed from './components/SignalsFeed';
import TerminalDockview from './components/docking/TerminalDockview';
const UiKitShowcase = React.lazy(() => import('./components/UiKitShowcase'));
import { loadLocalUiConfig, applyUiConfigToDOM } from './components/SettingsModal';
import BacktestPanel from './components/BacktestPanel';
import { loadChartIndicators, saveChartIndicators } from './components/IndicatorsModal';
import AppTopBar from './components/app/AppTopBar';
import ModalsHost from './components/app/ModalsHost';
import { POPULAR_SYMBOLS } from './components/app/constants';
import { soundManager } from './utils/sound';
import { useColorLinksStore } from './stores/colorLinksStore';
import { useBacktestStore } from './stores/backtestStore';
import { X, Target } from 'lucide-react';
import { useLayoutStore } from './stores/layoutStore';
import { useAlertsStore } from './stores/alertsStore';
import LayerToolbar from './components/design-previews/LayerToolbar';
import LiqAnalyticsPanel from './components/design-previews/LiqAnalyticsPanel';
import QuantDecisionConsilium from './components/design-previews/QuantDecisionConsilium';
import { useQuantStore } from './stores/quantStore';
import { getUsableMarketPrice } from './services/marketTruth.js';
import { deriveBacktestStrategyLevels } from './services/backtestStrategyLevels.js';

const THEME_CYCLE = ['night', 'neon', 'mono', 'day'];

const DEFAULT_LAYOUT = {
  showHtfChart: true,
  showLtfChart: true,
  showTradeDesk: true,
  showOrderBook: true,
  showTape: true,
  showSignals: true,
  sidebarWidth: 500,
  chartSplitPct: 50,
  domWidthPct: 64,
  signalsHeightPct: 34
};

function loadTerminalLayout() {
  try {
    const raw = localStorage.getItem('terminal_layout_v1');
    if (raw) {
      return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
    }
  } catch (_) {}
  return { ...DEFAULT_LAYOUT };
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const paramSymbol = params.get('symbol');
  const paramTf = params.get('tf');
  const savedSymbol = typeof localStorage !== 'undefined' ? localStorage.getItem('signalscript_active_symbol') : null;
  const savedTf = typeof localStorage !== 'undefined' ? localStorage.getItem('signalscript_active_tf') : null;

  const initialSymbol = (paramSymbol || savedSymbol || 'BTCUSDT').toUpperCase();
  const initialTf = paramTf || savedTf || '15m';
  const initialUserId = params.get('user_id') || '0';

  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTf);
  const [userId] = useState(initialUserId);
  const [denomination, setDenomination] = useState('USDT');
  const [isAddWidgetDropdownOpen, setIsAddWidgetDropdownOpen] = useState(false);

  // Quant Analytics, Spot Walls & Liquidation Store
  const showLiqLayers = useQuantStore((s) => s.showLiqLayers);
  const showLiqPanel = useQuantStore((s) => s.showLiqPanel);
  const toggleLiqLayers = useQuantStore((s) => s.toggleLiqLayers);
  const toggleLiqPanel = useQuantStore((s) => s.toggleLiqPanel);
  const setShowLiqPanel = useQuantStore((s) => s.setShowLiqPanel);
  const layers = useQuantStore((s) => s.layers);
  const toggleLayer = useQuantStore((s) => s.toggleLayer);
  const leverages = useQuantStore((s) => s.leverages);
  const toggleLeverage = useQuantStore((s) => s.toggleLeverage);
  const minWallMultiplier = useQuantStore((s) => s.minWallMultiplier);
  const setMinWallMultiplier = useQuantStore((s) => s.setMinWallMultiplier);
  const wallLineThickness = useQuantStore((s) => s.wallLineThickness);
  const setWallLineThickness = useQuantStore((s) => s.setWallLineThickness);
  const layerOpacity = useQuantStore((s) => s.layerOpacity);
  const setLayerOpacity = useQuantStore((s) => s.setLayerOpacity);
  const unifiedData = useQuantStore((s) => s.unifiedData);
  const core3Report = useQuantStore((s) => s.core3Report);
  const promptData = useQuantStore((s) => s.promptData);
  const isCommitting = useQuantStore((s) => s.isCommitting);
  const quarantineSaved = useQuantStore((s) => s.quarantineSaved);
  const commitQuarantine = useQuantStore((s) => s.commitQuarantine);
  const fetchMarketData = useQuantStore((s) => s.fetchMarketData);
  const loadingQuant = useQuantStore((s) => s.loading);

  useEffect(() => {
    useQuantStore.getState().setSymbol(symbol);
  }, [symbol]);

  // Synchronize App symbol with Channel 1 (c1) of Color Links
  const c1Symbol = useColorLinksStore((s) => s.channels.c1);
  const setChannelSymbol = useColorLinksStore((s) => s.setChannelSymbol);

  useEffect(() => {
    if (c1Symbol && c1Symbol !== symbol) {
      setSymbol(c1Symbol);
    }
  }, [c1Symbol]);

  useEffect(() => {
    window.__backtestStore = useBacktestStore;
  }, []);

  // Global UI & Orderflow Configuration (Theme, Font, Opacity, EMA, Subpanes, DOM/Tape thresholds)
  const [uiConfig, setUiConfig] = useState(() => {
    const initial = loadLocalUiConfig();
    applyUiConfigToDOM(initial);
    return initial;
  });
  const [activeAiModel, setActiveAiModel] = useState('');

  useEffect(() => {
    fetch('/api/ai/config').then((r) => r.ok ? r.json() : null).then((data) => setActiveAiModel(data?.selected_model || '')).catch(() => {});
  }, []);

  useEffect(() => {
    applyUiConfigToDOM(uiConfig);
  }, [uiConfig]);

  // Sync initial UI config from SQLite user_settings on mount
  useEffect(() => {
    fetch(`/api/settings?user_id=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.ui_config) {
          try {
            const parsed = JSON.parse(data.ui_config);
            if (parsed && Object.keys(parsed).length > 0) {
              setUiConfig((prev) => ({
                ...prev,
                ...parsed,
                theme: data.theme || parsed.theme || prev.theme
              }));
            }
          } catch (_) {}
        }
      })
      .catch(() => {});
  }, [userId]);

  // AI Copilot Sidebar, Decision Journal & Indicators Catalog states
  const [showAICopilot, setShowAICopilot] = useState(() => {
    try { return localStorage.getItem('signalscript_show_ai_copilot') === 'true'; } catch (_) { return false; }
  });
  const [showDecisionJournal, setShowDecisionJournal] = useState(() => {
    try { return localStorage.getItem('signalscript_show_journal') === 'true'; } catch (_) { return false; }
  });
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [indicatorsTargetChart, setIndicatorsTargetChart] = useState('primary');
  const [primaryIndicators, setPrimaryIndicators] = useState(() => loadChartIndicators('primary'));
  const [secondaryIndicators, setSecondaryIndicators] = useState(() => loadChartIndicators('secondary'));

  // Backtest panel state: result (signals/trades/metrics) lives here so both charts can draw markers
  const [showBacktest, setShowBacktest] = useState(() => {
    try { return localStorage.getItem('signalscript_show_backtest') === 'true'; } catch (_) { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('signalscript_show_backtest', showBacktest ? 'true' : 'false'); } catch (_) {}
  }, [showBacktest]);

  // Глобальная шина: виджеты (например, Trade History) могут открыть панель бэктеста/paper-торговли
  useEffect(() => {
    const openBacktest = () => setShowBacktest(true);
    window.addEventListener('signalscript:open-backtest', openBacktest);
    return () => window.removeEventListener('signalscript:open-backtest', openBacktest);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('signalscript_show_ai_copilot', showAICopilot ? 'true' : 'false'); } catch (_) {}
  }, [showAICopilot]);

  useEffect(() => {
    try { localStorage.setItem('signalscript_show_journal', showDecisionJournal ? 'true' : 'false'); } catch (_) {}
  }, [showDecisionJournal]);

  useEffect(() => {
    try { localStorage.setItem('signalscript_active_symbol', symbol); } catch (_) {}
  }, [symbol]);

  useEffect(() => {
    try { localStorage.setItem('signalscript_active_tf', timeframe); } catch (_) {}
  }, [timeframe]);
  const [btResult, setBtResult] = useState(null);
  const [showBtSignals, setShowBtSignals] = useState(true);
  const [, setActiveStrategyProfile] = useState('density_bounce');
  const [strategyLevels, setStrategyLevels] = useState([]);
  const [activePositionSetup, setActivePositionSetup] = useState(null);
  const [toasts, setToasts] = useState([]);
  const seenSignalIdsRef = useRef(new Set());

  useEffect(() => {
    setBtResult(null);
  }, [symbol]);

  useEffect(() => {
    const onClearSetup = () => setActivePositionSetup(null);
    window.addEventListener('clear-position-setup', onClearSetup);
    return () => window.removeEventListener('clear-position-setup', onClearSetup);
  }, []);

  const handleProjectPositionSetup = useCallback((setup) => {
    if (!setup || !setup.entry_price) return;
    setActivePositionSetup(setup);
    const isLong = (setup.direction || 'LONG') === 'LONG';
    const entryP = Number(setup.entry_price);
    const slP = Number(setup.sl_price ?? setup.stop_loss);
    const tp1P = Number(setup.tp1_price ?? setup.take_profit);
    const tp2P = Number(setup.tp2_price ?? 0);
    const slPct = setup.sl_pct ?? -0.28;
    const slRisk = setup.sl_risk_usd ?? 50;
    const tp1Pct = setup.tp1_pct ?? 0.43;
    const tp2Pct = setup.tp2_pct ?? 0.92;
    const orderType = setup.order_type || (isLong ? 'BUY LIMIT' : 'SELL LIMIT');

    const newLevels = [
      {
        price: entryP,
        type: isLong ? 'BUY' : 'SELL',
        role: 'ENTRY',
        label: `[${orderType} @ ${entryP}]`,
        reason: 'Entry'
      },
      {
        price: slP,
        type: isLong ? 'SELL' : 'BUY',
        role: 'SL',
        label: `[SL @ ${slP} (${slPct}% | -$${slRisk})]`,
        reason: 'Stop-Loss'
      },
      {
        price: tp1P,
        type: isLong ? 'SELL' : 'BUY',
        role: 'TP1',
        label: `[TP1 @ ${tp1P} (+${tp1Pct}%)]`,
        reason: 'TP1 (50% + Б/У)'
      }
    ];
    if (tp2P > 0) {
      newLevels.push({
        price: tp2P,
        type: isLong ? 'SELL' : 'BUY',
        role: 'TP2',
        label: `[TP2 @ ${tp2P} (+${tp2Pct}%)]`,
        reason: 'TP2 (50%)'
      });
    }
    setStrategyLevels(newLevels);
  }, []);

  // Push Toast Notification (Top Right)
  const pushToast = useCallback((toastData) => {
    const id = `${Date.now()}-${Math.random()}`;
    const newToast = { id, ...toastData };
    setToasts((prev) => [newToast, ...prev].slice(0, 5));
    soundManager.playSignalAlert(toastData.direction || 'BULLISH');
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 7000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.filterId !== id && t.id !== id));
  }, []);

  // Poll for incoming live signals in real-time and trigger push toast alerts + sound
  useEffect(() => {
    let isCancelled = false;
    const checkSignals = async () => {
      try {
        const res = await fetch('/api/signals?limit=15');
        if (!res.ok) return;
        const list = await res.json();
        if (isCancelled || !Array.isArray(list)) return;

        if (seenSignalIdsRef.current.size === 0) {
          list.forEach((s) => seenSignalIdsRef.current.add(s.id));
          return;
        }

        for (const sig of list) {
          if (!seenSignalIdsRef.current.has(sig.id)) {
            seenSignalIdsRef.current.add(sig.id);
            pushToast({
              symbol: sig.symbol,
              direction: sig.direction || 'ALERT',
              price: sig.price,
              description: sig.description || sig.condition_type
            });
          }
        }
      } catch (_) {}
    };

    checkSignals();
    const timer = setInterval(checkSignals, 3000);
    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, [pushToast]);

  // Project Strategy Entry Levels on DOM-стакан and Chart (ТАКТ 1 & ТАКТ 2)
  useEffect(() => {
    if (btResult?.active_position_setup) {
      handleProjectPositionSetup(btResult.active_position_setup);
      return;
    }
    setStrategyLevels(deriveBacktestStrategyLevels(btResult));
  }, [btResult, handleProjectPositionSetup]);

  const handleApplyStrategy = useCallback((params) => {
    if (params.strategy) setActiveStrategyProfile(params.strategy);
    pushToast({
      symbol,
      direction: 'ALERT',
      price: getUsableMarketPrice(unifiedData?.snapshot?.price),
      description: `Применены параметры: SL ${params.sl}%, TP ${params.tp}%, Стенка $${params.minWallK}k`
    });
  }, [symbol, unifiedData?.snapshot?.price, pushToast]);

  // Persistent Docking Layout v1 (saved in localStorage: terminal_layout_v1)
  const initialLayout = useRef(loadTerminalLayout());
  const [showHtfChart, setShowHtfChart] = useState(initialLayout.current.showHtfChart !== false);
  const [showLtfChart, setShowLtfChart] = useState(initialLayout.current.showLtfChart !== false);
  const [secondaryTimeframe, setSecondaryTimeframe] = useState(() => {
    return localStorage.getItem('secondary_tf') || '1m';
  });

  const [showTradeDesk, setShowTradeDesk] = useState(initialLayout.current.showTradeDesk !== false);
  const [showOrderBook, setShowOrderBook] = useState(initialLayout.current.showOrderBook !== false);
  const [showTape, setShowTape] = useState(initialLayout.current.showTape !== false);
  const [showSignals, setShowSignals] = useState(initialLayout.current.showSignals !== false);
  const [marketSummary, setMarketSummary] = useState(null);
  const [userLimitOrders, setUserLimitOrders] = useState([]);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    return Math.min(820, Math.max(290, Number(initialLayout.current.sidebarWidth) || 500));
  });
  const [chartSplitPct, setChartSplitPct] = useState(() => {
    return Math.min(80, Math.max(20, Number(initialLayout.current.chartSplitPct) || 50));
  });
  const [domWidthPct, setDomWidthPct] = useState(() => {
    return Math.min(80, Math.max(30, Number(initialLayout.current.domWidthPct) || 64));
  });
  const [signalsHeightPct, setSignalsHeightPct] = useState(() => {
    return Math.min(70, Math.max(18, Number(initialLayout.current.signalsHeightPct) || 34));
  });

  const [showWidgetsMenu, setShowWidgetsMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHotkeyHelp, setShowHotkeyHelp] = useState(false);
  const [isMuted, setIsMuted] = useState(() => soundManager.isMuted);

  const isDualPane = showHtfChart && showLtfChart;
  const setIsDualPane = useCallback((updater) => {
    setShowLtfChart((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : Boolean(updater);
      if (next) setShowHtfChart(true);
      return next;
    });
  }, []);

  // Persist layout to localStorage ('terminal_layout_v1' + backward-compatible keys)
  useEffect(() => {
    const layoutObj = {
      showHtfChart,
      showLtfChart,
      showTradeDesk,
      showOrderBook,
      showTape,
      showSignals,
      sidebarWidth,
      chartSplitPct,
      domWidthPct,
      signalsHeightPct
    };
    try {
      localStorage.setItem('terminal_layout_v1', JSON.stringify(layoutObj));
      localStorage.setItem('panel_dual_chart', (showHtfChart && showLtfChart) ? 'true' : 'false');
      localStorage.setItem('panel_orderbook', showOrderBook ? 'true' : 'false');
      localStorage.setItem('panel_tape', showTape ? 'true' : 'false');
      localStorage.setItem('panel_signals', showSignals ? 'true' : 'false');
      localStorage.setItem('terminal_sidebar_width', String(sidebarWidth));
    } catch (_) {}
  }, [
    showHtfChart,
    showLtfChart,
    showTradeDesk,
    showOrderBook,
    showTape,
    showSignals,
    sidebarWidth,
    chartSplitPct,
    domWidthPct,
    signalsHeightPct
  ]);

  useEffect(() => {
    localStorage.setItem('secondary_tf', secondaryTimeframe);
  }, [secondaryTimeframe]);

  const resetLayoutToDefaults = useCallback(() => {
    setShowHtfChart(DEFAULT_LAYOUT.showHtfChart);
    setShowLtfChart(DEFAULT_LAYOUT.showLtfChart);
    setShowTradeDesk(DEFAULT_LAYOUT.showTradeDesk);
    setShowOrderBook(DEFAULT_LAYOUT.showOrderBook);
    setShowTape(DEFAULT_LAYOUT.showTape);
    setShowSignals(DEFAULT_LAYOUT.showSignals);
    setSidebarWidth(DEFAULT_LAYOUT.sidebarWidth);
    setChartSplitPct(DEFAULT_LAYOUT.chartSplitPct);
    setDomWidthPct(DEFAULT_LAYOUT.domWidthPct);
    setSignalsHeightPct(DEFAULT_LAYOUT.signalsHeightPct);
  }, []);

  // Zen / Focus Mode: 100% chart without clutter
  const [isFocusMode, setIsFocusMode] = useState(false);
  const prevPanelsRef = useRef(null);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((prev) => {
      if (!prev) {
        prevPanelsRef.current = {
          htf: showHtfChart,
          ltf: showLtfChart,
          orderbook: showOrderBook,
          tape: showTape,
          signals: showSignals
        };
        setShowHtfChart(true);
        setShowLtfChart(false);
        setShowOrderBook(false);
        setShowTape(false);
        setShowSignals(false);
        return true;
      } else {
        if (prevPanelsRef.current) {
          setShowHtfChart(prevPanelsRef.current.htf);
          setShowLtfChart(prevPanelsRef.current.ltf);
          setShowOrderBook(prevPanelsRef.current.orderbook);
          setShowTape(prevPanelsRef.current.tape);
          setShowSignals(prevPanelsRef.current.signals);
        } else {
          setShowHtfChart(true);
          setShowLtfChart(true);
          setShowOrderBook(true);
          setShowTape(true);
        }
        return false;
      }
    });
  }, [showHtfChart, showLtfChart, showOrderBook, showTape, showSignals]);

  const chartsContainerRef = useRef(null);
  const rightDockRef = useRef(null);
  const domTapeRowRef = useRef(null);

  const [searchInput, setSearchInput] = useState('');
  const [activeProximityAlert, setActiveProximityAlert] = useState(null);
  const proximityTimeoutRef = useRef(null);

  // 1. Splitter: Main Right Dock Width (between Charts and DOM/Tape)
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (moveEvent) => {
      const maxAllowed = Math.min(820, Math.floor(window.innerWidth * 0.56));
      const newWidth = Math.max(290, Math.min(maxAllowed, window.innerWidth - moveEvent.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      document.body.style.cursor = 'default';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  // 2. Splitter: Between HTF Chart and LTF Chart
  const handleChartSplitterMouseDown = useCallback((e) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (moveEvent) => {
      const el = chartsContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 100) return;
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setChartSplitPct(Math.min(80, Math.max(20, Math.round(pct * 10) / 10)));
    };

    const onMouseUp = () => {
      document.body.style.cursor = 'default';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  // 3. Splitter: Between DOM OrderBook and Tape
  const handleDomTapeSplitterMouseDown = useCallback((e) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (moveEvent) => {
      const el = domTapeRowRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 100) return;
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setDomWidthPct(Math.min(80, Math.max(30, Math.round(pct * 10) / 10)));
    };

    const onMouseUp = () => {
      document.body.style.cursor = 'default';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  // 4. Splitter: Horizontal divider between (DOM+Tape) and SignalsFeed
  const handleSignalsSplitterMouseDown = useCallback((e) => {
    e.preventDefault();
    document.body.style.cursor = 'row-resize';

    const onMouseMove = (moveEvent) => {
      const el = rightDockRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 100) return;
      const topPct = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      const sigPct = 100 - topPct;
      setSignalsHeightPct(Math.min(70, Math.max(18, Math.round(sigPct * 10) / 10)));
    };

    const onMouseUp = () => {
      document.body.style.cursor = 'default';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  // Global Hotkeys
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      // Space hotkey: Recenter chart and DOM ladder on current spread
      if (e.code === 'Space') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('recenter-market-price'));
        return;
      }

      // Comma hotkey (',' or Russian 'б'): Open/Close Settings Modal (ТАКТ 2)
      if (e.key === ',' || e.key === '<' || (e.code === 'Comma' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setShowSettings((v) => !v);
        return;
      }

      // Shift + Key shortcuts for modules and alerts
      if (e.shiftKey) {
        const k = e.key.toUpperCase();
        if (k === 'A' || k === 'Ф') {
          e.preventDefault();
          useAlertsStore.getState().openAlertsModal({ symbol });
          return;
        } else if (k === 'C' || k === 'С') {
          e.preventDefault();
          useLayoutStore.getState().addWidgetPanel('chart');
          return;
        } else if (k === 'P' || k === 'З') {
          e.preventDefault();
          useLayoutStore.getState().addWidgetPanel('footprint');
          return;
        } else if (k === 'O' || k === 'Щ') {
          e.preventDefault();
          useLayoutStore.getState().addWidgetPanel('orderbook');
          return;
        } else if (k === 'D' || k === 'В') {
          e.preventDefault();
          useLayoutStore.getState().addWidgetPanel('dom');
          return;
        } else if (k === 'T' || k === 'Е') {
          e.preventDefault();
          useLayoutStore.getState().addWidgetPanel('trades');
          return;
        } else if (k === 'S' || k === 'Ы') {
          e.preventDefault();
          useLayoutStore.getState().addWidgetPanel('screener');
          return;
        }
      }

      // Timeframe via numbers (1m, 5m, 15m, 1h, 4h, 1D)
      if (e.key === '1') setTimeframe('1m');
      else if (e.key === '2') setTimeframe('5m');
      else if (e.key === '3') setTimeframe('15m');
      else if (e.key === '4') setTimeframe('1h');
      else if (e.key === '5') setTimeframe('4h');
      else if (e.key === '6') setTimeframe('1D');
      // Next / Previous symbol via Arrow keys
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSymbol((prev) => {
          const idx = POPULAR_SYMBOLS.indexOf(prev);
          const nextIdx = idx >= 0 ? (idx + 1) % POPULAR_SYMBOLS.length : 0;
          return POPULAR_SYMBOLS[nextIdx];
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSymbol((prev) => {
          const idx = POPULAR_SYMBOLS.indexOf(prev);
          const prevIdx = idx > 0 ? idx - 1 : POPULAR_SYMBOLS.length - 1;
          return POPULAR_SYMBOLS[prevIdx];
        });
      }
      // Ctrl+Z or Cmd+Z: Undo drawing
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('chart-undo-drawing'));
      }
      // Panel toggles
      else if (e.key.toLowerCase() === 'o' || e.key.toLowerCase() === 'щ') {
        setShowOrderBook((v) => !v);
      } else if (e.key.toLowerCase() === 't' || e.key.toLowerCase() === 'е') {
        setShowTape((v) => !v);
      } else if (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'ы') {
        setShowSignals((v) => !v);
      } else if (e.key.toLowerCase() === 'd' || e.key.toLowerCase() === 'в') {
        setIsDualPane((v) => !v);
      } else if (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'и') {
        setShowBacktest((v) => !v);
      } else if (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'ф') {
        setShowAICopilot((v) => !v);
      } else if (e.key.toLowerCase() === 'i' || e.key.toLowerCase() === 'ш') {
        setShowIndicatorsModal((v) => !v);
      } else if (e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'а') {
        toggleFocusMode();
      } else if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'й') {
        useQuantStore.getState().toggleLiqPanel();
      } else if (e.key.toLowerCase() === 'l' || e.key.toLowerCase() === 'д') {
        useQuantStore.getState().toggleLiqLayers();
      } else if (e.key === '?') {
        setShowHotkeyHelp((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectSignal = (newSymbol, newTf) => {
    const sym = newSymbol.toUpperCase();
    setSymbol(sym);
    setChannelSymbol('c1', sym);
    if (newTf) setTimeframe(newTf);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    let s = searchInput.trim().toUpperCase();
    if (!s.endsWith('USDT')) s += 'USDT';
    setSymbol(s);
    setChannelSymbol('c1', s);
    setSearchInput('');
  };

  const handleProximityAlert = useCallback((alertData) => {
    setActiveProximityAlert(alertData);
    if (proximityTimeoutRef.current) clearTimeout(proximityTimeoutRef.current);
    proximityTimeoutRef.current = setTimeout(() => {
      setActiveProximityAlert(null);
    }, 6000);
  }, []);

  const toggleSound = () => {
    const muted = soundManager.toggleMute();
    setIsMuted(muted);
  };

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(uiConfig.theme);
    const nextTheme = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    setUiConfig((prev) => ({ ...prev, theme: nextTheme }));
  };

  // Единый колбэк дропдауна «+ Add Widget» (логика перенесена из AppTopBar-пункта меню)
  const handleAddWidget = (id) => {
    if (id === 'chart') {
      setShowHtfChart(true);
      useLayoutStore.getState().addWidgetPanel('chart');
    } else if (id === 'tpo') {
      useLayoutStore.getState().addWidgetPanel('footprint');
    } else if (id === 'orderbook' || id === 'dom') {
      setShowOrderBook(true);
      useLayoutStore.getState().addWidgetPanel(id);
    } else if (id === 'trades') {
      setShowTape(true);
      useLayoutStore.getState().addWidgetPanel('trades');
    } else {
      useLayoutStore.getState().addWidgetPanel(id);
    }
  };

  const anyRightPanelOpen = showTradeDesk || showOrderBook || showTape || showSignals;
  const toggleAllRightPanels = () => {
    if (anyRightPanelOpen) {
      setShowTradeDesk(false);
      setShowOrderBook(false);
      setShowTape(false);
      setShowSignals(false);
    } else {
      setShowTradeDesk(true);
      setShowOrderBook(true);
      setShowTape(true);
      setShowSignals(true);
    }
  };

  const isUiKit = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('ui-kit') === '1';
  if (isUiKit) {
    return (
      <React.Suspense fallback={<div className="p-4 text-xs font-mono text-muted-foreground">Загрузка UI-Kit...</div>}>
        <UiKitShowcase />
      </React.Suspense>
    );
  }

  return (
    <div
      style={{ backgroundColor: 'var(--bg-root)', color: 'var(--text-main)' }}
      className="flex flex-col h-screen w-screen font-sans overflow-hidden select-none"
    >
      <AppTopBar
        symbol={symbol}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onSearchSubmit={handleSearchSubmit}
        denomination={denomination}
        onDenomination={setDenomination}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        activeProximityAlert={activeProximityAlert}
        activeAiModel={activeAiModel}
        isMuted={isMuted}
        onToggleSound={toggleSound}
        onToggleHotkeyHelp={() => setShowHotkeyHelp((v) => !v)}
        isAddWidgetDropdownOpen={isAddWidgetDropdownOpen}
        onToggleAddWidgetDropdown={setIsAddWidgetDropdownOpen}
        onAddWidget={handleAddWidget}
        isDualPane={isDualPane}
        onToggleDualPane={() => setIsDualPane((v) => !v)}
        isFocusMode={isFocusMode}
        onToggleFocusMode={toggleFocusMode}
        showAICopilot={showAICopilot}
        onToggleAICopilot={() => setShowAICopilot((v) => !v)}
        showDecisionJournal={showDecisionJournal}
        onOpenDecisionJournal={() => setShowDecisionJournal(true)}
        showReplay={showReplay}
        onOpenReplay={() => setShowReplay(true)}
        showBacktest={showBacktest}
        onToggleBacktest={() => setShowBacktest((v) => !v)}
        showOrderBook={showOrderBook}
        onToggleOrderBook={() => setShowOrderBook((v) => !v)}
        showTape={showTape}
        onToggleTape={() => setShowTape((v) => !v)}
        showSignals={showSignals}
        onToggleSignals={() => setShowSignals((v) => !v)}
        showLiqLayers={showLiqLayers}
        onToggleLiqLayers={toggleLiqLayers}
        showLiqPanel={showLiqPanel}
        onToggleLiqPanel={toggleLiqPanel}
        onSymbolChange={setSymbol}
        anyRightPanelOpen={anyRightPanelOpen}
        onToggleRightPanels={toggleAllRightPanels}
        theme={uiConfig.theme}
        onCycleTheme={cycleTheme}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Secondary Row: Merged inside PresetBar (maximum 2 bars at top) */}

      {/* Main Responsive Workspace Layout with Dockview (dockview-react) */}
      <main className="flex-1 flex overflow-hidden relative min-w-0">
        <div className="flex-1 h-full min-w-0 overflow-hidden relative flex flex-col">
          <TerminalDockview
            layersProps={{
              showLiqLayers,
              layers,
              onLayerToggle: toggleLayer,
              toggleLayer,
              leverages,
              onLeverageToggle: toggleLeverage,
              toggleLeverage,
              minWallMultiplier,
              onMinWallChange: setMinWallMultiplier,
              setMinWallMultiplier,
              wallLineThickness,
              onWallThicknessChange: setWallLineThickness,
              setWallLineThickness,
              layerOpacity,
              onOpacityChange: setLayerOpacity,
              setLayerOpacity,
            }}
            chartSharedProps={{
              uiConfig,
              strategyLevels,
              activePositionSetup,
              btResult,
              showBtSignals,
              onOpenIndicators: (cid) => {
                setIndicatorsTargetChart(cid);
                setShowIndicatorsModal(true);
              }
            }}
            domSharedProps={{
              uiConfig,
              strategyLevels,
              activePositionSetup,
              userLimitOrders,
              onMarketSummary: setMarketSummary,
              onProximityAlert: handleProximityAlert
            }}
            signalsSharedProps={{
              signals: []
            }}
          />
        </div>

        <BacktestPanel
          isOpen={showBacktest}
          onClose={() => setShowBacktest(false)}
          symbol={symbol}
          result={btResult}
          onResult={setBtResult}
          showSignals={showBtSignals}
          onToggleSignals={() => setShowBtSignals((v) => !v)}
          onApplyStrategy={handleApplyStrategy}
          onStrategyChange={setActiveStrategyProfile}
          onProjectPositionSetup={handleProjectPositionSetup}
        />

        {/* Liquidation Analytics & Quarantine Consilium Drawer */}
        {showLiqPanel && (
          <aside
            data-testid="panel-liq-analytics"
            className="w-[450px] max-w-full bg-[#0c0e12] border-l border-[#1b2130] flex flex-col shrink-0 z-30 font-sans shadow-2xl overflow-hidden transition-all duration-200"
          >
            <div className="h-9 px-3 border-b border-[#1b2130] flex items-center justify-between bg-[#0e121a] shrink-0 font-mono text-xs">
              <div className="flex items-center space-x-2">
                <Target size={14} className="text-[#e879f9]" />
                <span className="font-bold text-white text-xs">Ликвидации & Карантин</span>
                <span className="text-[#38bdf8] font-bold text-xs">{symbol}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowLiqPanel(false)}
                className="p-1 rounded text-[#64748b] hover:text-white hover:bg-[#1f293d] transition cursor-pointer"
                title="Закрыть панель (Клавиша 'Q')"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2.5 min-h-0">
              <QuantDecisionConsilium
                symbol={symbol}
                core3Report={core3Report}
                promptData={promptData}
                onCommitQuarantine={() => commitQuarantine(symbol)}
                isCommitting={isCommitting}
                quarantineSaved={quarantineSaved}
              />

              <div className="rounded border border-[#1b2130] overflow-hidden flex-1 min-h-[380px]">
                <LiqAnalyticsPanel
                  symbol={symbol}
                  currentPrice={getUsableMarketPrice(unifiedData?.snapshot?.price)}
                  liqData={unifiedData?.liq_estimates}
                  depthData={unifiedData?.orderbook_depth}
                  isLoading={loadingQuant}
                  onRefresh={() => fetchMarketData(symbol)}
                />
              </div>
            </div>
          </aside>
        )}
      </main>

      <ModalsHost
        toasts={toasts}
        onToastClick={setSymbol}
        onRemoveToast={removeToast}
        showSettings={showSettings}
        onCloseSettings={() => setShowSettings(false)}
        userId={userId}
        uiConfig={uiConfig}
        onUiConfigChange={setUiConfig}
        onAiConfigChange={(config) => setActiveAiModel(config?.selected_model || '')}
        showHotkeyHelp={showHotkeyHelp}
        onCloseHotkeyHelp={() => setShowHotkeyHelp(false)}
        showAICopilot={showAICopilot}
        onCloseAICopilot={() => setShowAICopilot(false)}
        symbol={symbol}
        timeframe={timeframe}
        onProjectPositionSetup={handleProjectPositionSetup}
        onApplyLevels={(levels) => {
          setStrategyLevels(levels);
          pushToast({
            symbol,
            direction: 'ALERT',
            price: getUsableMarketPrice(levels[0]?.price),
            description: `Нанесено ${levels.length} уровней AI Ассистента на график и в стакан`
          });
        }}
        showDecisionJournal={showDecisionJournal}
        onCloseDecisionJournal={() => setShowDecisionJournal(false)}
        activePositionSetup={activePositionSetup}
        showReplay={showReplay}
        onCloseReplay={() => setShowReplay(false)}
        showIndicatorsModal={showIndicatorsModal}
        onCloseIndicatorsModal={() => setShowIndicatorsModal(false)}
        indicatorsTargetChart={indicatorsTargetChart}
        onTargetChartChange={setIndicatorsTargetChart}
        primaryIndicators={primaryIndicators}
        secondaryIndicators={secondaryIndicators}
        onIndicatorsChange={(chartId, newConfig) => {
          if (chartId === 'primary') {
            setPrimaryIndicators(newConfig);
            saveChartIndicators('primary', newConfig);
          } else {
            setSecondaryIndicators(newConfig);
            saveChartIndicators('secondary', newConfig);
          }
        }}
        isDualPane={isDualPane}
        alertsCurrentPrice={getUsableMarketPrice(unifiedData?.snapshot?.price)}
      />
    </div>
  );
}
