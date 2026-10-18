import React, { useState, useEffect, useRef, useCallback } from 'react';
import Chart from './components/Chart';
import OrderBookDOM from './components/OrderBookDOM';
import ScalperTradeDesk from './components/ScalperTradeDesk';
import Tape from './components/Tape';
import SignalsFeed from './components/SignalsFeed';
import TerminalDockview from './components/docking/TerminalDockview';
import SettingsModal, {
  loadLocalUiConfig,
  applyUiConfigToDOM
} from './components/SettingsModal';
import BacktestPanel from './components/BacktestPanel';
import AICopilotSidebar from './components/AICopilotSidebar';
import IndicatorsModal, {
  loadChartIndicators,
  saveChartIndicators
} from './components/IndicatorsModal';
import { soundManager } from './utils/sound';
import {
  Settings,
  Layers,
  Radio,
  Search,
  TrendingUp,
  Volume2,
  VolumeX,
  Keyboard,
  AlertTriangle,
  Columns,
  BarChart3,
  Zap,
  PanelRightClose,
  PanelRightOpen,
  Maximize2,
  Minimize2,
  X,
  Bell,
  Sparkles,
  Sliders,
  Plus,
  Check,
  RotateCcw,
  LayoutGrid
} from 'lucide-react';
import { useLayoutStore } from './stores/layoutStore';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '45m', '1h', '4h', '6h'];
const POPULAR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT', 'SUIUSDT', 'NEARUSDT'];
const THEME_CYCLE = ['tealstreet', 'tiger', 'bloomberg'];
const THEME_BADGE = {
  tealstreet: '🌙 TEAL',
  tiger: '🐯 TIGER',
  bloomberg: '⚡ BBG'
};

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
  const initialSymbol = (params.get('symbol') || 'BTCUSDT').toUpperCase();
  const initialTf = params.get('tf') || '15m';
  const initialUserId = params.get('user_id') || '0';

  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTf);
  const [userId] = useState(initialUserId);

  // Global UI & Orderflow Configuration (Theme, Font, Opacity, EMA, Subpanes, DOM/Tape thresholds)
  const [uiConfig, setUiConfig] = useState(() => {
    const initial = loadLocalUiConfig();
    applyUiConfigToDOM(initial);
    return initial;
  });

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

  // AI Copilot Sidebar & Indicators Catalog states
  const [showAICopilot, setShowAICopilot] = useState(false);
  const [showIndicatorsModal, setShowIndicatorsModal] = useState(false);
  const [indicatorsTargetChart, setIndicatorsTargetChart] = useState('primary');
  const [primaryIndicators, setPrimaryIndicators] = useState(() => loadChartIndicators('primary'));
  const [secondaryIndicators, setSecondaryIndicators] = useState(() => loadChartIndicators('secondary'));

  // Backtest panel state: result (signals/trades/metrics) lives here so both charts can draw markers
  const [showBacktest, setShowBacktest] = useState(false);
  const [btResult, setBtResult] = useState(null);
  const [showBtSignals, setShowBtSignals] = useState(true);
  const [activeStrategyProfile, setActiveStrategyProfile] = useState('density_bounce');
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
    const levels = [];
    if (btResult?.signals && btResult.signals.length > 0) {
      const seen = new Set();
      const recent = [...btResult.signals].reverse();
      for (const s of recent) {
        const p = Number(s.price);
        if (!p || seen.has(p)) continue;
        seen.add(p);
        const isBuy = s.type === 'BUY';
        levels.push({
          price: p,
          type: s.type,
          label: isBuy ? `BUY ZONE: Wall ${s.reason || '$1.2M'}` : `SHORT: ${s.reason || 'Delta Div'}`,
          reason: s.reason
        });
        if (levels.length >= 3) break;
      }
    } else {
      // Default active profile projection around current price
      const baseP = symbol.includes('BTC') ? 81450.0 : symbol.includes('ETH') ? 2600.0 : 160.0;
      if (activeStrategyProfile === 'density_bounce') {
        levels.push({
          price: Number((baseP * 0.9985).toFixed(1)),
          type: 'BUY',
          role: 'ENTRY',
          label: `[BUY LIMIT @ ${Number((baseP * 0.9985).toFixed(1))}]`,
          reason: 'Density Bounce'
        });
        levels.push({
          price: Number((baseP * 0.9957).toFixed(1)),
          type: 'SELL',
          role: 'SL',
          label: `[SL @ ${Number((baseP * 0.9957).toFixed(1))} (-0.28% | -$50)]`,
          reason: 'Stop-Loss'
        });
        levels.push({
          price: Number((baseP * 1.0028).toFixed(1)),
          type: 'SELL',
          role: 'TP1',
          label: `[TP1 @ ${Number((baseP * 1.0028).toFixed(1))} (+0.43%)]`,
          reason: 'TP1'
        });
        levels.push({
          price: Number((baseP * 1.0077).toFixed(1)),
          type: 'SELL',
          role: 'TP2',
          label: `[TP2 @ ${Number((baseP * 1.0077).toFixed(1))} (+0.92%)]`,
          reason: 'TP2'
        });
      } else {
        levels.push({
          price: Number((baseP * 0.999).toFixed(1)),
          type: 'BUY',
          role: 'ENTRY',
          label: `[BUY LIMIT @ ${Number((baseP * 0.999).toFixed(1))}]`,
          reason: 'Delta Absorption'
        });
        levels.push({
          price: Number((baseP * 1.0018).toFixed(1)),
          type: 'SELL',
          role: 'TP1',
          label: `[TP1 @ ${Number((baseP * 1.0018).toFixed(1))} (+0.43%)]`,
          reason: 'Delta Divergence'
        });
      }
    }
    setStrategyLevels(levels);
  }, [btResult, activeStrategyProfile, symbol, handleProjectPositionSetup]);

  const handleApplyStrategy = useCallback((params) => {
    if (params.strategy) setActiveStrategyProfile(params.strategy);
    pushToast({
      symbol,
      direction: 'ALERT',
      price: symbol.includes('BTC') ? 81450 : 2600,
      description: `Применены параметры: SL ${params.sl}%, TP ${params.tp}%, Стенка $${params.minWallK}k`
    });
  }, [symbol, pushToast]);

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

      // Timeframe via numbers
      if (e.key === '1') setTimeframe('1m');
      else if (e.key === '2') setTimeframe('5m');
      else if (e.key === '3') setTimeframe('15m');
      else if (e.key === '4') setTimeframe('30m');
      else if (e.key === '5') setTimeframe('1h');
      else if (e.key === '6') setTimeframe('4h');
      else if (e.key === '7') setTimeframe('6h');
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
      } else if (e.key === '?') {
        setShowHotkeyHelp((v) => !v);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectSignal = (newSymbol, newTf) => {
    setSymbol(newSymbol.toUpperCase());
    if (newTf) setTimeframe(newTf);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    let s = searchInput.trim().toUpperCase();
    if (!s.endsWith('USDT')) s += 'USDT';
    setSymbol(s);
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

  return (
    <div
      style={{ backgroundColor: 'var(--bg-root)', color: 'var(--text-main)' }}
      className="flex flex-col h-screen w-screen font-sans overflow-hidden select-none"
    >
      {/* Top Header Bar (Responsive, no horizontal overflow on 1366x768..4K) */}
      <header
        style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-2 h-[34px] border-b z-20 text-xs gap-1.5 min-w-0 shrink-0"
      >
        {/* Left: Brand, Active Coin, Watchlist pills */}
        <div className="flex items-center space-x-1.5 min-w-0 shrink-0">
          <div className="flex items-center space-x-1 font-bold text-white tracking-wider text-[11px] shrink-0">
            <TrendingUp size={13} className="text-[#38bdf8]" />
            <span>
              Signal<span className="text-[#38bdf8]">Script</span>
            </span>
          </div>

          <div className="h-3 w-px bg-[#1f2430] mx-0.5 shrink-0" />

          {/* Active Symbol & Search */}
          <div className="flex items-center space-x-1 font-mono min-w-0">
            <span className="text-[11px] font-bold text-white bg-[#14171f] px-1.5 py-0.5 rounded border border-[#1f2430] shrink-0">
              {symbol}
            </span>

            <form onSubmit={handleSearchSubmit} className="relative shrink-0">
              <input
                type="text"
                placeholder="Поиск..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-16 xl:w-20 focus:w-24 transition-all duration-150 bg-[#0c0e12] border border-[#161820] rounded px-1.5 py-0.5 text-[10.5px] text-white placeholder-[#4b5563] outline-none font-mono"
              />
              <Search size={10} className="absolute right-1.5 top-1.5 text-[#4b5563] pointer-events-none" />
            </form>

            {/* Quick Watchlist pills */}
            <div className="hidden xl:flex items-center space-x-0.5 pl-0.5">
              {POPULAR_SYMBOLS.map((sym) => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${
                    symbol === sym
                      ? 'bg-[#2563eb] text-white font-bold'
                      : 'text-[#787f91] hover:bg-[#161820] hover:text-white'
                  }`}
                >
                  {sym.replace('USDT', '')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Timeframe Selector (HTF Senior Chart) */}
        <div className="flex items-center space-x-0.5 bg-[#0c0e12] p-0.5 rounded border border-[#161820] font-mono shrink-0">
          <span className="hidden sm:inline text-[9.5px] text-[#787f91] px-1 font-semibold uppercase">HTF:</span>
          {TIMEFRAMES.map((tf, idx) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              title={`Клавиша ${idx + 1}`}
              className={`px-1.5 py-0.2 rounded text-[10px] transition ${
                timeframe === tf
                  ? 'bg-[#2563eb] text-white font-bold'
                  : 'text-[#787f91] hover:text-white hover:bg-[#161820]'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Right: Proximity Banner, Panel Toggles, Theme, Settings */}
        <div className="flex items-center space-x-1 shrink-0">
          {activeProximityAlert && (
            <div className="hidden 2xl:flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#ffb30018] border border-[#ffb30060] text-[#ffb300] text-[10px] font-mono animate-pulse">
              <AlertTriangle size={11} />
              <span>
                {activeProximityAlert.symbol}: ${activeProximityAlert.price} ({activeProximityAlert.distPct.toFixed(2)}%)
              </span>
            </div>
          )}

          <button
            onClick={toggleSound}
            className={`p-1 rounded transition ${
              isMuted ? 'text-[#ef5350] hover:bg-[#ef535018]' : 'text-[#26a69a] hover:bg-[#26a69a18]'
            }`}
            title={isMuted ? 'Звук отключен' : 'Звуковые алерты активны'}
          >
            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>

          <button
            onClick={() => setShowHotkeyHelp(!showHotkeyHelp)}
            className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#161820] transition"
            title="Горячие клавиши ('?')"
          >
            <Keyboard size={13} />
          </button>

          {/* Widget Hub Modal Trigger ('+ Виджеты') */}
          <div className="relative">
            <button
              data-testid="widgets-menu-button"
              onClick={() => useLayoutStore.getState().openWidgetHub()}
              className="px-2 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer bg-[#141720] text-[#38bdf8] border-[#38bdf850] hover:bg-[#1e293b] hover:border-[#38bdf8]"
              title="Каталог модулей: добавить График, DOM, Ленту, Скринер"
            >
              <Plus size={11} />
              <span>Виджеты</span>
            </button>

            {showWidgetsMenu && (
              <div
                data-testid="widgets-dropdown"
                onClick={(e) => e.stopPropagation()}
                style={{ backgroundColor: 'var(--bg-panel, #10131b)', borderColor: 'var(--border-subtle, #1f2430)' }}
                className="absolute right-0 top-7 z-50 w-64 rounded-lg border shadow-2xl p-2 space-y-1 font-sans text-xs animate-fadeIn"
              >
                <div className="flex items-center justify-between px-1.5 py-1 border-b border-[#1f2430] text-[10.5px] font-bold text-white">
                  <span className="flex items-center space-x-1.5">
                    <LayoutGrid size={12} className="text-[#38bdf8]" />
                    <span>Управление виджетами</span>
                  </span>
                  <button
                    onClick={() => setShowWidgetsMenu(false)}
                    className="text-[#60697b] hover:text-white p-0.5 cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>

                {[
                  {
                    id: 'htf',
                    label: 'График HTF (Старший ТФ)',
                    active: showHtfChart,
                    toggle: () => setShowHtfChart((v) => !v)
                  },
                  {
                    id: 'ltf',
                    label: 'График LTF (Младший ТФ)',
                    active: showLtfChart,
                    toggle: () => setShowLtfChart((v) => !v)
                  },
                  {
                    id: 'trade_desk',
                    label: 'Scalper Trade Desk (Риск / Ввод)',
                    active: showTradeDesk,
                    toggle: () => setShowTradeDesk((v) => !v)
                  },
                  {
                    id: 'dom',
                    label: 'Биржевой стакан (DOM)',
                    active: showOrderBook,
                    toggle: () => setShowOrderBook((v) => !v)
                  },
                  {
                    id: 'tape',
                    label: 'Лента сделок (Time & Sales)',
                    active: showTape,
                    toggle: () => setShowTape((v) => !v)
                  },
                  {
                    id: 'signals',
                    label: 'Лента сигналов',
                    active: showSignals,
                    toggle: () => setShowSignals((v) => !v)
                  },
                  {
                    id: 'backtest_ai',
                    label: 'Панель бэктеста / AI',
                    active: showBacktest || showAICopilot,
                    toggle: () => {
                      if (showBacktest || showAICopilot) {
                        setShowBacktest(false);
                        setShowAICopilot(false);
                      } else {
                        setShowBacktest(true);
                        setShowAICopilot(true);
                      }
                    }
                  }
                ].map((item) => (
                  <button
                    key={item.id}
                    data-testid={`widget-toggle-${item.id}`}
                    onClick={item.toggle}
                    className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-[#191f2e] transition cursor-pointer text-left"
                  >
                    <span className={item.active ? 'text-white font-medium text-[11px]' : 'text-[#787f91] text-[11px]'}>
                      {item.label}
                    </span>
                    <span
                      className={`w-4 h-4 rounded flex items-center justify-center border ${
                        item.active
                          ? 'bg-[#2563eb] border-[#38bdf8] text-white'
                          : 'border-[#333d52] bg-[#090b10]'
                      }`}
                    >
                      {item.active && <Check size={11} strokeWidth={3} />}
                    </span>
                  </button>
                ))}

                <div className="pt-1 border-t border-[#1f2430]">
                  <button
                    onClick={() => {
                      resetLayoutToDefaults();
                      setShowWidgetsMenu(false);
                    }}
                    className="w-full py-1 px-2 rounded bg-[#161a26] hover:bg-[#2563eb] text-[#94a3b8] hover:text-white text-[10.5px] font-mono flex items-center justify-center space-x-1 transition cursor-pointer"
                  >
                    <RotateCcw size={11} />
                    <span>Восстановить раскладку</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Workspace Toggle: Dual-Pane 50/50 */}
          <button
            onClick={() => setIsDualPane((v) => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
              isDualPane
                ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]'
                : 'text-[#60697b] border-transparent hover:bg-[#141720]'
            }`}
            title="Переключить 1 / 2 графика 50/50 (Клавиша 'D')"
          >
            <Columns size={11} />
            <span>{isDualPane ? '2 Граф [D]' : '1 Граф [D]'}</span>
          </button>

          {/* Clean Focus / Zen Mode Toggle */}
          <button
            onClick={toggleFocusMode}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
              isFocusMode
                ? 'bg-[#052e16] text-[#4ade80] border-[#22c55e60] font-bold'
                : 'text-[#60697b] border-transparent hover:bg-[#141720] hover:text-white'
            }`}
            title="Фокус на графике (100% экран без лишних панелей, Клавиша 'F')"
          >
            {isFocusMode ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            <span>{isFocusMode ? 'Выйти [F]' : 'Фокус [F]'}</span>
          </button>

          {/* AI Copilot Sidebar Toggle */}
          <button
            onClick={() => setShowAICopilot((v) => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer ${
              showAICopilot
                ? 'bg-[#1e1b4b] text-[#818cf8] border-[#818cf860] font-bold'
                : 'text-[#60697b] border-transparent hover:bg-[#141720] hover:text-[#818cf8]'
            }`}
            title="AI Торговый Ассистент & Order Flow (Клавиша 'A')"
          >
            <Sparkles size={11} className={showAICopilot ? 'animate-pulse text-[#818cf8]' : ''} />
            <span>AI Ассистент [A]</span>
          </button>

          {/* Backtest drawer toggle */}
          <button
            onClick={() => setShowBacktest((v) => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
              showBacktest
                ? 'bg-[#141720] text-[#a78bfa] border-[#a78bfa40]'
                : 'text-[#60697b] border-transparent hover:bg-[#141720]'
            }`}
            title="Бэктест и Grid Search (Клавиша 'B')"
          >
            <BarChart3 size={11} />
            <span>Бэктест [B]</span>
          </button>

          {/* Panel Toggle: DOM OrderBook */}
          <button
            onClick={() => setShowOrderBook((v) => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
              showOrderBook
                ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]'
                : 'text-[#60697b] border-transparent hover:bg-[#141720]'
            }`}
            title="Переключить скальперский DOM стакан (Клавиша 'O')"
          >
            <Layers size={11} />
            <span>DOM [O]</span>
          </button>

          {/* Panel Toggle: Tape */}
          <button
            onClick={() => setShowTape((v) => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
              showTape
                ? 'bg-[#141720] text-[#f59e0b] border-[#f59e0b40]'
                : 'text-[#60697b] border-transparent hover:bg-[#141720]'
            }`}
            title="Переключить ленту сделок Time & Sales (Клавиша 'T')"
          >
            <Zap size={11} />
            <span>Лента [T]</span>
          </button>

          {/* Panel Toggle: Signals */}
          <button
            onClick={() => setShowSignals((v) => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
              showSignals
                ? 'bg-[#141720] text-[#26a69a] border-[#26a69a40]'
                : 'text-[#60697b] border-transparent hover:bg-[#141720]'
            }`}
            title="Переключить сигналы (Клавиша 'S')"
          >
            <Radio size={11} />
            <span>Сигн [S]</span>
          </button>

          {/* Collapse/Expand entire right dock */}
          <button
            onClick={toggleAllRightPanels}
            className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#161820] transition"
            title={anyRightPanelOpen ? 'Свернуть боковой док (отдать 100% экрану графикам)' : 'Развернуть боковой док'}
          >
            {anyRightPanelOpen ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
          </button>

          {/* Theme Switcher Button (Tealstreet Pro / Tiger Deep Dark / Bloomberg) */}
          <button
            onClick={cycleTheme}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${
              uiConfig.theme === 'bloomberg'
                ? 'bg-[#ff9800] text-black font-bold border-[#ff9800]'
                : uiConfig.theme === 'tiger'
                ? 'bg-[#0a192f] text-[#00f5d4] font-bold border-[#00e5ff60]'
                : 'text-[#787f91] border-[#1f2430] hover:text-white bg-[#101217]'
            }`}
            title="Переключить цветовую тему (Tealstreet Pro / Tiger Deep Dark / Bloomberg)"
          >
            <span>{THEME_BADGE[uiConfig.theme] || '🌙 TEAL'}</span>
          </button>

          {/* Settings Modal (Gear Icon & ',' hotkey) */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1 rounded text-[#787f91] hover:text-[#38bdf8] hover:bg-[#161820] transition"
            title="Центр настроек терминала (Клавиша ',')"
          >
            <Settings size={13} />
          </button>
        </div>
      </header>

      {/* Main Responsive Workspace Layout with Dockview (dockview-react) */}
      <main className="flex-1 flex overflow-hidden relative min-w-0">
        <div className="flex-1 h-full min-w-0 overflow-hidden relative flex flex-col">
          <TerminalDockview
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
      </main>

      {/* Real-time Push Toast Notifications (Top Right) */}
      <div className="fixed top-11 right-3 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full font-mono">
        {toasts.map((t) => {
          const isBuy = t.direction === 'BULLISH' || t.direction === 'BUY';
          const isSell = t.direction === 'BEARISH' || t.direction === 'SELL';
          const toneBorder = isBuy
            ? 'border-[#26a69a] shadow-[0_4px_16px_rgba(38,166,154,0.35)]'
            : isSell
            ? 'border-[#ef5350] shadow-[0_4px_16px_rgba(239,83,80,0.35)]'
            : 'border-[#ffb300] shadow-[0_4px_16px_rgba(255,179,0,0.35)]';
          const badgeBg = isBuy ? 'bg-[#26a69a]' : isSell ? 'bg-[#ef5350]' : 'bg-[#ffb300] text-black';

          return (
            <div
              key={t.id}
              onClick={() => {
                if (t.symbol) setSymbol(t.symbol);
                removeToast(t.id);
              }}
              className={`pointer-events-auto cursor-pointer p-2.5 rounded bg-[#0d1017]/95 border backdrop-blur-md transition-all duration-200 transform translate-y-0 opacity-100 ${toneBorder}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold text-white uppercase ${badgeBg}`}>
                    {isBuy ? 'BUY' : isSell ? 'SELL' : 'ALERT'}
                  </span>
                  <span className="font-bold text-white text-[11px]">#{t.symbol}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <span className="text-[11px] font-bold text-white">${t.price}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeToast(t.id);
                    }}
                    className="text-[#787f91] hover:text-white p-0.5"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-[#cbd5e1] mt-1 truncate">
                {t.description}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modular Settings Center Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        userId={userId}
        uiConfig={uiConfig}
        onUiConfigChange={setUiConfig}
      />

      {/* Hotkeys Quick Reference Modal */}
      {showHotkeyHelp && (
        <div
          onClick={() => setShowHotkeyHelp(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)' }}
            className="border rounded-lg p-4 w-full max-w-sm text-xs space-y-3 shadow-2xl text-[#d1d4dc]"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#161820]">
              <span className="font-bold text-white text-sm flex items-center">
                <Keyboard size={14} className="mr-1.5 text-[#38bdf8]" />
                Горячие клавиши терминала
              </span>
              <button onClick={() => setShowHotkeyHelp(false)} className="text-[#60697b] hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Центр настроек:</span>
                <span className="text-white font-bold">, (Запятая)</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Таймфреймы HTF:</span>
                <span className="text-white font-bold">1=1m, 2=5m, 3=15m, 4=30m, 5=1h, 6=4h, 7=6h</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Смена монеты:</span>
                <span className="text-white font-bold">Стрелка Вверх / Вниз</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">1 / 2 Графика (50/50):</span>
                <span className="text-white font-bold">D</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Бэктест & Grid Search:</span>
                <span className="text-white font-bold">B</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">AI Торговый Ассистент:</span>
                <span className="text-[#818cf8] font-bold">A</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Каталог индикаторов:</span>
                <span className="text-[#38bdf8] font-bold">I</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Скальперский DOM стакан:</span>
                <span className="text-white font-bold">O</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Лента сделок (Tape):</span>
                <span className="text-white font-bold">T</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Лента сигналов:</span>
                <span className="text-white font-bold">S</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Центрировать цену и спред:</span>
                <span className="text-white font-bold">Space (Пробел)</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[#787f91]">Отменить фигуру:</span>
                <span className="text-white font-bold">Ctrl + Z</span>
              </div>
            </div>

            <button
              onClick={() => setShowHotkeyHelp(false)}
              className="w-full py-1 rounded bg-[#1f2430] hover:bg-[#2563eb] text-white font-medium transition text-xs"
            >
              Понятно
            </button>
          </div>
        </div>
      )}

      {/* AI Copilot Assistant Sidebar */}
      <AICopilotSidebar
        isOpen={showAICopilot}
        onClose={() => setShowAICopilot(false)}
        symbol={symbol}
        timeframe={timeframe}
        onProjectPositionSetup={handleProjectPositionSetup}
        onApplyLevels={(levels) => {
          setStrategyLevels(levels);
          pushToast({
            symbol,
            direction: 'ALERT',
            price: levels[0]?.price || 81450,
            description: `Нанесено ${levels.length} уровней AI Ассистента на график и в стакан`
          });
        }}
      />

      {/* Indicators Catalog Modal */}
      <IndicatorsModal
        isOpen={showIndicatorsModal}
        onClose={() => setShowIndicatorsModal(false)}
        targetChartId={indicatorsTargetChart}
        onTargetChartChange={setIndicatorsTargetChart}
        activeIndicators={indicatorsTargetChart === 'primary' ? primaryIndicators : secondaryIndicators}
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
      />
    </div>
  );
}
