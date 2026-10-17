import React, { useState, useEffect, useRef, useCallback } from 'react';
import Chart from './components/Chart';
import OrderBookDOM from './components/OrderBookDOM';
import Tape from './components/Tape';
import SignalsFeed from './components/SignalsFeed';
import SettingsModal, {
  loadLocalUiConfig,
  applyUiConfigToDOM
} from './components/SettingsModal';
import BacktestPanel from './components/BacktestPanel';
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
  X,
  Bell
} from 'lucide-react';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '45m', '1h', '4h', '6h'];
const POPULAR_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT', 'SUIUSDT', 'NEARUSDT'];
const THEME_CYCLE = ['tealstreet', 'tiger', 'bloomberg'];
const THEME_BADGE = {
  tealstreet: '🌙 TEAL',
  tiger: '🐯 TIGER',
  bloomberg: '⚡ BBG'
};

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

  // Backtest panel state: result (signals/trades/metrics) lives here so both charts can draw markers
  const [showBacktest, setShowBacktest] = useState(false);
  const [btResult, setBtResult] = useState(null);
  const [showBtSignals, setShowBtSignals] = useState(true);
  const [activeStrategyProfile, setActiveStrategyProfile] = useState('density_bounce');
  const [strategyLevels, setStrategyLevels] = useState([]);
  const [toasts, setToasts] = useState([]);
  const seenSignalIdsRef = useRef(new Set());

  useEffect(() => {
    setBtResult(null);
  }, [symbol]);

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
    setToasts((prev) => prev.filter((t) => t.id !== id));
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

  // Project Strategy Entry Levels on DOM-стакан and Chart (ТАКТ 1)
  useEffect(() => {
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
          label: 'BUY ZONE: Wall $1.2M',
          reason: 'Density Bounce'
        });
        levels.push({
          price: Number((baseP * 1.0025).toFixed(1)),
          type: 'SELL',
          label: 'SHORT: Wall $1.8M',
          reason: 'Density Bounce'
        });
      } else {
        levels.push({
          price: Number((baseP * 0.999).toFixed(1)),
          type: 'BUY',
          label: 'BUY ZONE: Delta Absorb',
          reason: 'Delta Absorption'
        });
        levels.push({
          price: Number((baseP * 1.0018).toFixed(1)),
          type: 'SELL',
          label: 'SHORT: Delta Div',
          reason: 'Delta Divergence'
        });
      }
    }
    setStrategyLevels(levels);
  }, [btResult, activeStrategyProfile, symbol]);

  const handleApplyStrategy = useCallback((params) => {
    if (params.strategy) setActiveStrategyProfile(params.strategy);
    pushToast({
      symbol,
      direction: 'ALERT',
      price: symbol.includes('BTC') ? 81450 : 2600,
      description: `Применены параметры: SL ${params.sl}%, TP ${params.tp}%, Стенка $${params.minWallK}k`
    });
  }, [symbol, pushToast]);

  // Dual-Pane Workspace state (HTF 15m + LTF 1m, 50/50 split)
  const [isDualPane, setIsDualPane] = useState(() => {
    const saved = localStorage.getItem('panel_dual_chart');
    return saved !== null ? saved === 'true' : true;
  });
  const [secondaryTimeframe, setSecondaryTimeframe] = useState(() => {
    return localStorage.getItem('secondary_tf') || '1m';
  });

  // Panel layout state persisted in localStorage
  const [showOrderBook, setShowOrderBook] = useState(() => {
    const saved = localStorage.getItem('panel_orderbook');
    return saved !== null ? saved === 'true' : true;
  });
  const [showTape, setShowTape] = useState(() => {
    const saved = localStorage.getItem('panel_tape');
    return saved !== null ? saved === 'true' : true;
  });
  const [showSignals, setShowSignals] = useState(() => {
    const saved = localStorage.getItem('panel_signals');
    return saved !== null ? saved === 'true' : true;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showHotkeyHelp, setShowHotkeyHelp] = useState(false);
  const [isMuted, setIsMuted] = useState(() => soundManager.isMuted);

  useEffect(() => {
    localStorage.setItem('panel_dual_chart', isDualPane ? 'true' : 'false');
  }, [isDualPane]);

  useEffect(() => {
    localStorage.setItem('secondary_tf', secondaryTimeframe);
  }, [secondaryTimeframe]);

  useEffect(() => {
    localStorage.setItem('panel_tape', showTape ? 'true' : 'false');
  }, [showTape]);

  useEffect(() => {
    localStorage.setItem('panel_orderbook', showOrderBook ? 'true' : 'false');
  }, [showOrderBook]);

  useEffect(() => {
    localStorage.setItem('panel_signals', showSignals ? 'true' : 'false');
  }, [showSignals]);

  // Resizable sidebar state (default 500px to fit 4-column DOM + Tape comfortably, auto-clamped on 1366x768)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('terminal_sidebar_width');
    return saved ? Math.min(760, Math.max(320, parseInt(saved, 10))) : 500;
  });
  const isDraggingRef = useRef(false);

  const [searchInput, setSearchInput] = useState('');
  const [activeProximityAlert, setActiveProximityAlert] = useState(null);
  const proximityTimeoutRef = useRef(null);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const maxAllowed = Math.min(760, Math.floor(window.innerWidth * 0.48));
      const newWidth = Math.max(300, Math.min(maxAllowed, window.innerWidth - moveEvent.clientX));
      setSidebarWidth(newWidth);
      localStorage.setItem('terminal_sidebar_width', newWidth.toString());
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
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

  const anyRightPanelOpen = showOrderBook || showTape || showSignals;
  const toggleAllRightPanels = () => {
    if (anyRightPanelOpen) {
      setShowOrderBook(false);
      setShowTape(false);
      setShowSignals(false);
    } else {
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

      {/* Main Responsive Workspace Layout */}
      <main className="flex-1 flex overflow-hidden relative min-w-0">
        {/* Central Workspace: Dual-Pane 50/50 CSS Grid KLineCharts */}
        <section
          style={{ backgroundColor: 'var(--bg-root)' }}
          className="flex-1 h-full min-w-0 p-1 overflow-hidden relative flex flex-col"
        >
          <div
            className={`flex-1 min-h-0 min-w-0 grid gap-1 ${
              isDualPane ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {/* Left Chart (HTF Senior Timeframe) */}
            <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
              <Chart
                chartId="primary"
                symbol={symbol}
                timeframe={timeframe}
                userId={userId}
                titlePrefix="HTF"
                backtestSignals={btResult}
                showBacktestSignals={showBtSignals}
                strategyLevels={strategyLevels}
                uiConfig={uiConfig}
              />
            </div>

            {/* Right Chart (LTF Junior Microstructure Timeframe, strict 50/50 split) */}
            {isDualPane && (
              <div className="h-full w-full min-w-0 min-h-0 overflow-hidden">
                <Chart
                  chartId="secondary"
                  symbol={symbol}
                  timeframe={secondaryTimeframe}
                  onTimeframeChange={setSecondaryTimeframe}
                  userId={userId}
                  titlePrefix="LTF"
                  backtestSignals={btResult}
                  showBacktestSignals={showBtSignals}
                  strategyLevels={strategyLevels}
                  uiConfig={uiConfig}
                />
              </div>
            )}
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
          />
        </section>

        {/* Resizable Splitter Handle */}
        {anyRightPanelOpen && (
          <div
            onMouseDown={handleMouseDown}
            style={{ backgroundColor: 'var(--bg-root)' }}
            className="w-1.5 hover:bg-[#38bdf880] cursor-col-resize transition-colors flex items-center justify-center relative group z-10 shrink-0"
            title="Потяните для изменения ширины бокового дока"
          >
            <div
              style={{ backgroundColor: 'var(--border-subtle)' }}
              className="w-[1px] h-full group-hover:bg-[#38bdf8]"
            />
          </div>
        )}

        {/* Right Pane: Responsive Resizable Sidebar (DOM OrderBook, Tape, Signals) */}
        {anyRightPanelOpen && (
          <aside
            style={{
              width: `${sidebarWidth}px`,
              maxWidth: '43vw'
            }}
            className="h-full flex flex-col p-1 pl-0 space-y-1 overflow-hidden shrink-0 min-w-[290px]"
          >
            {(showOrderBook || showTape) && (
              <div
                className={`${
                  showSignals ? 'h-[62%]' : 'h-full'
                } w-full flex space-x-1 min-h-0 transition-all duration-150`}
              >
                {showOrderBook && (
                  <div className={`${showTape ? 'w-[64%]' : 'w-full'} h-full min-w-0 transition-all`}>
                    <OrderBookDOM
                      symbol={symbol}
                      onProximityAlert={handleProximityAlert}
                      uiConfig={uiConfig}
                      strategyLevels={strategyLevels}
                    />
                  </div>
                )}
                {showTape && (
                  <div className={`${showOrderBook ? 'w-[36%]' : 'w-full'} h-full min-w-0 transition-all`}>
                    <Tape symbol={symbol} uiConfig={uiConfig} />
                  </div>
                )}
              </div>
            )}

            {showSignals && (
              <div
                className={`${
                  showOrderBook || showTape ? 'h-[38%]' : 'h-full'
                } w-full min-h-0 transition-all duration-150`}
              >
                <SignalsFeed onSelectSignal={handleSelectSignal} />
              </div>
            )}
          </aside>
        )}
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
    </div>
  );
}
