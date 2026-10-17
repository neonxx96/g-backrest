import React, { useState, useEffect, useRef, useCallback } from 'react';
import Chart from './components/Chart';
import OrderBook from './components/OrderBook';
import SignalsFeed from './components/SignalsFeed';
import SettingsModal from './components/SettingsModal';
import { soundManager } from './utils/sound';
import { 
  Sliders, 
  Layers, 
  Radio, 
  Search, 
  TrendingUp,
  Volume2,
  VolumeX,
  Keyboard,
  AlertTriangle
} from 'lucide-react';

const TIMEFRAMES = ["1m", "5m", "15m", "30m", "45m", "1h", "4h", "6h"];
const POPULAR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "BNBUSDT", "SUIUSDT", "NEARUSDT"];

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const initialSymbol = (params.get('symbol') || "BTCUSDT").toUpperCase();
  const initialTf = params.get('tf') || "15m";
  const initialUserId = params.get('user_id') || "0";

  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTf);
  const [userId] = useState(initialUserId);

  // Panel layout state persisted in localStorage
  const [showOrderBook, setShowOrderBook] = useState(() => {
    const saved = localStorage.getItem('panel_orderbook');
    return saved !== null ? saved === 'true' : true;
  });
  const [showSignals, setShowSignals] = useState(() => {
    const saved = localStorage.getItem('panel_signals');
    return saved !== null ? saved === 'true' : true;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showHotkeyHelp, setShowHotkeyHelp] = useState(false);
  const [isMuted, setIsMuted] = useState(() => soundManager.isMuted);

  // Resizable sidebar state
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('terminal_sidebar_width');
    return saved ? Math.min(700, Math.max(300, parseInt(saved, 10))) : 440;
  });
  const isDraggingRef = useRef(false);

  const [searchInput, setSearchInput] = useState("");
  const [activeProximityAlert, setActiveProximityAlert] = useState(null);
  const proximityTimeoutRef = useRef(null);

  // Save panel visibility preferences
  useEffect(() => {
    localStorage.setItem('panel_orderbook', showOrderBook ? 'true' : 'false');
  }, [showOrderBook]);

  useEffect(() => {
    localStorage.setItem('panel_signals', showSignals ? 'true' : 'false');
  }, [showSignals]);

  // Resizable splitter drag handlers
  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';

    const onMouseMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX;
      if (newWidth >= 300 && newWidth <= 720) {
        setSidebarWidth(newWidth);
        localStorage.setItem('terminal_sidebar_width', newWidth.toString());
      }
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

  // Global Hotkeys (Task 5)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore hotkeys when typing in search or input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
        setSymbol(prev => {
          const idx = POPULAR_SYMBOLS.indexOf(prev);
          const nextIdx = idx >= 0 ? (idx + 1) % POPULAR_SYMBOLS.length : 0;
          return POPULAR_SYMBOLS[nextIdx];
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSymbol(prev => {
          const idx = POPULAR_SYMBOLS.indexOf(prev);
          const prevIdx = idx > 0 ? idx - 1 : POPULAR_SYMBOLS.length - 1;
          return POPULAR_SYMBOLS[prevIdx];
        });
      }

      // Panel toggles
      else if (e.key.toLowerCase() === 'o') {
        setShowOrderBook(v => !v);
      } else if (e.key.toLowerCase() === 's') {
        setShowSignals(v => !v);
      } else if (e.key === '?') {
        setShowHotkeyHelp(v => !v);
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
    if (!s.endsWith("USDT")) s += "USDT";
    setSymbol(s);
    setSearchInput("");
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

  return (
    <div className="flex flex-col h-screen w-screen bg-[#08090c] text-[#d1d4dc] font-sans overflow-hidden select-none">
      {/* Top Header Bar (Tealstreet style: 34px height, high density, dark matte finish) */}
      <header className="flex items-center justify-between px-2.5 h-[34px] bg-[#101217] border-b border-[#161820] z-20 text-xs">
        {/* Left: Brand, Active Coin, Watchlist pills */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1 font-bold text-white tracking-wider text-[11px]">
            <TrendingUp size={13} className="text-[#38bdf8]" />
            <span>Signal<span className="text-[#38bdf8]">Script</span></span>
          </div>

          <div className="h-3 w-px bg-[#1f2430] mx-0.5" />

          {/* Active Symbol & Search */}
          <div className="flex items-center space-x-1 font-mono">
            <span className="text-[11px] font-bold text-white bg-[#14171f] px-1.5 py-0.5 rounded border border-[#1f2430]">
              {symbol}
            </span>

            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                placeholder="Поиск..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-20 focus:w-28 transition-all duration-150 bg-[#0c0e12] border border-[#161820] rounded px-1.5 py-0.5 text-[11px] text-white placeholder-[#4b5563] outline-none font-mono"
              />
              <Search size={10} className="absolute right-1.5 top-1.5 text-[#4b5563] pointer-events-none" />
            </form>

            {/* Quick Watchlist pills */}
            <div className="hidden lg:flex items-center space-x-0.5 pl-1">
              {POPULAR_SYMBOLS.map(sym => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${symbol === sym ? 'bg-[#2563eb] text-white font-bold' : 'text-[#787f91] hover:bg-[#161820] hover:text-white'}`}
                >
                  {sym.replace("USDT", "")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center: Timeframe Selector */}
        <div className="flex items-center space-x-0.5 bg-[#0c0e12] p-0.5 rounded border border-[#161820] font-mono">
          {TIMEFRAMES.map((tf, idx) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              title={`Клавиша ${idx + 1}`}
              className={`px-1.5 py-0.2 rounded text-[10px] transition ${timeframe === tf ? 'bg-[#2563eb] text-white font-bold' : 'text-[#787f91] hover:text-white hover:bg-[#161820]'}`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Right: Proximity Banner, Panel Toggles, Mute, Settings */}
        <div className="flex items-center space-x-1.5">
          {/* Active Proximity Alert Banner */}
          {activeProximityAlert && (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded bg-[#ffb30018] border border-[#ffb30060] text-[#ffb300] text-[10px] font-mono animate-pulse">
              <AlertTriangle size={11} />
              <span>
                {activeProximityAlert.symbol}: ${activeProximityAlert.price} ({activeProximityAlert.distPct.toFixed(2)}%)
              </span>
            </div>
          )}

          {/* Sound Mute Toggle */}
          <button
            onClick={toggleSound}
            className={`p-1 rounded transition ${isMuted ? 'text-[#ef5350] hover:bg-[#ef535018]' : 'text-[#26a69a] hover:bg-[#26a69a18]'}`}
            title={isMuted ? "Звук отключен (нажмите, чтобы включить)" : "Звуковые алерты активны (нажмите для беззвучного режима)"}
          >
            {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>

          {/* Hotkey Help Dialog Button */}
          <button
            onClick={() => setShowHotkeyHelp(!showHotkeyHelp)}
            className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#161820] transition"
            title="Горячие клавиши (нажмите '?')"
          >
            <Keyboard size={13} />
          </button>

          {/* Panel Toggle: OrderBook */}
          <button
            onClick={() => setShowOrderBook(v => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${showOrderBook ? 'bg-[#141720] text-[#38bdf8] border-[#38bdf840]' : 'text-[#60697b] border-transparent hover:bg-[#141720]'}`}
            title="Переключить стакан (Клавиша 'O')"
          >
            <Layers size={11} />
            <span>Стакан [O]</span>
          </button>

          {/* Panel Toggle: Signals */}
          <button
            onClick={() => setShowSignals(v => !v)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition ${showSignals ? 'bg-[#141720] text-[#26a69a] border-[#26a69a40]' : 'text-[#60697b] border-transparent hover:bg-[#141720]'}`}
            title="Переключить сигналы (Клавиша 'S')"
          >
            <Radio size={11} />
            <span>Сигналы [S]</span>
          </button>

          {/* Settings Modal */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1 rounded text-[#787f91] hover:text-white hover:bg-[#161820] transition"
            title="Настройки фильтров"
          >
            <Sliders size={13} />
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Left Pane: Primary KLineChart (Flex-1) */}
        <section className="flex-1 h-full min-w-0 bg-[#08090c] p-1 overflow-hidden">
          <Chart 
            symbol={symbol} 
            timeframe={timeframe} 
            userId={userId} 
          />
        </section>

        {/* Resizable Splitter Handle (Task 6) */}
        {(showOrderBook || showSignals) && (
          <div
            onMouseDown={handleMouseDown}
            className="w-1.5 bg-[#08090c] hover:bg-[#38bdf880] cursor-col-resize transition-colors flex items-center justify-center relative group z-10"
            title="Потяните для изменения ширины панелей"
          >
            <div className="w-[1px] h-full bg-[#161820] group-hover:bg-[#38bdf8]" />
          </div>
        )}

        {/* Right Pane: Resizable Sidebar (OrderBook and/or Signals) */}
        {(showOrderBook || showSignals) && (
          <aside 
            style={{ width: `${sidebarWidth}px` }} 
            className="h-full flex flex-col p-1 pl-0 space-y-1 overflow-hidden shrink-0"
          >
            {/* OrderBook Panel */}
            {showOrderBook && (
              <div className={`${showSignals ? 'h-[58%]' : 'h-full'} w-full transition-all duration-150`}>
                <OrderBook 
                  symbol={symbol} 
                  onProximityAlert={handleProximityAlert}
                />
              </div>
            )}

            {/* Signals Feed Panel */}
            {showSignals && (
              <div className={`${showOrderBook ? 'h-[42%]' : 'h-full'} w-full transition-all duration-150`}>
                <SignalsFeed onSelectSignal={handleSelectSignal} />
              </div>
            )}
          </aside>
        )}
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        userId={userId}
      />

      {/* Hotkeys Quick Reference Modal */}
      {showHotkeyHelp && (
        <div 
          onClick={() => setShowHotkeyHelp(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0c0e12] border border-[#1f2430] rounded-lg p-4 w-full max-w-sm text-xs space-y-3 shadow-2xl text-[#d1d4dc]"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#161820]">
              <span className="font-bold text-white text-sm flex items-center">
                <Keyboard size={14} className="mr-1.5 text-[#38bdf8]" />
                Горячие клавиши терминала
              </span>
              <button onClick={() => setShowHotkeyHelp(false)} className="text-[#60697b] hover:text-white">✕</button>
            </div>

            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Таймфреймы:</span>
                <span className="text-white font-bold">1=1m, 2=5m, 3=15m, 4=30m, 5=1h, 6=4h, 7=6h</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Смена монеты:</span>
                <span className="text-white font-bold">Стрелка Вверх / Вниз</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Стакан L2:</span>
                <span className="text-white font-bold">O (вкл / выкл)</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Лента сигналов:</span>
                <span className="text-white font-bold">S (вкл / выкл)</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#13161f]">
                <span className="text-[#787f91]">Удалить рисунок:</span>
                <span className="text-white font-bold">Delete / Backspace</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[#787f91]">Сброс / Отмена:</span>
                <span className="text-white font-bold">Escape</span>
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
