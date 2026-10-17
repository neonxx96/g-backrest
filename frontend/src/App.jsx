import React, { useState, useEffect } from 'react';
import Chart from './components/Chart';
import OrderBook from './components/OrderBook';
import SignalsFeed from './components/SignalsFeed';
import SettingsModal from './components/SettingsModal';
import { 
  Sliders, 
  Layers, 
  Bell, 
  Search, 
  TrendingUp, 
  ExternalLink,
  ChevronDown
} from 'lucide-react';

const TIMEFRAMES = ["1m", "15m", "30m", "45m", "1h", "4h", "6h"];
const POPULAR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "BNBUSDT", "SUIUSDT", "NEARUSDT"];

export default function App() {
  // Parse query params from URL if opened from Telegram: ?symbol=BTCUSDT&tf=15m&user_id=123
  const params = new URLSearchParams(window.location.search);
  const initialSymbol = (params.get('symbol') || "BTCUSDT").toUpperCase();
  const initialTf = params.get('tf') || "15m";
  const initialUserId = params.get('user_id') || "0";

  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTf);
  const [userId, setUserId] = useState(initialUserId);

  const [showOrderBook, setShowOrderBook] = useState(true);
  const [showSignals, setShowSignals] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [searchInput, setSearchInput] = useState("");

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

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0d1117] text-[#d1d4dc] font-sans overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-[#131722] border-b border-[#1e222d] shadow-sm z-20">
        {/* Brand & Symbol Selector */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 font-black text-white text-base tracking-wide">
            <span className="p-1 rounded bg-[#2962ff] text-white">
              <TrendingUp size={16} />
            </span>
            <span>Signal<span className="text-[#2962ff]">Script</span></span>
          </div>

          <div className="h-5 w-px bg-[#2a2e39] mx-1" />

          {/* Active Symbol & Quick Selector */}
          <div className="flex items-center space-x-1.5">
            <span className="text-sm font-extrabold text-white font-mono bg-[#1e222d] px-2.5 py-1 rounded border border-[#2a2e39]">
              {symbol}
            </span>

            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                placeholder="Поиск..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-24 focus:w-36 transition-all duration-200 bg-[#1e222d] border border-[#2a2e39] rounded px-2 py-1 text-xs text-white placeholder-[#787b86] outline-none font-mono"
              />
              <Search size={11} className="absolute right-2 top-2 text-[#787b86] pointer-events-none" />
            </form>

            {/* Quick dropdown pills */}
            <div className="hidden lg:flex items-center space-x-1 pl-1">
              {POPULAR_SYMBOLS.slice(0, 4).map(sym => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${symbol === sym ? 'bg-[#2962ff] text-white font-bold' : 'bg-[#181c27] hover:bg-[#1e222d] text-[#787b86]'}`}
                >
                  {sym.replace("USDT", "")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Timeframe Buttons */}
        <div className="flex items-center space-x-1 bg-[#181c27] p-0.5 rounded border border-[#2a2e39]">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-1 rounded text-xs font-mono font-semibold transition ${timeframe === tf ? 'bg-[#2962ff] text-white' : 'text-[#787b86] hover:text-white hover:bg-[#1e222d]'}`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Actions & Toggles */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowOrderBook(!showOrderBook)}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1.5 transition ${showOrderBook ? 'bg-[#1e222d] text-white border border-[#2a2e39]' : 'text-[#787b86] hover:bg-[#1e222d]'}`}
            title="Переключить стакан"
          >
            <Layers size={13} className="text-[#2962ff]" />
            <span className="hidden sm:inline">Стакан</span>
          </button>

          <button
            onClick={() => setShowSignals(!showSignals)}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1.5 transition ${showSignals ? 'bg-[#1e222d] text-white border border-[#2a2e39]' : 'text-[#787b86] hover:bg-[#1e222d]'}`}
            title="Переключить ленту сигналов"
          >
            <Bell size={13} className="text-[#089981]" />
            <span className="hidden sm:inline">Сигналы</span>
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1 rounded text-xs font-semibold bg-[#2962ff] hover:bg-[#1e4bd8] text-white flex items-center space-x-1.5 shadow"
          >
            <Sliders size={13} />
            <span>Настройки</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden p-2 gap-2">
        {/* Left: Chart Container */}
        <div className="flex-1 flex flex-col h-full min-w-0">
          <Chart symbol={symbol} timeframe={timeframe} userId={userId} />
        </div>

        {/* Middle/Right: OrderBook */}
        {showOrderBook && (
          <div className="w-80 h-full flex flex-col shrink-0">
            <OrderBook symbol={symbol} />
          </div>
        )}

        {/* Far Right: Live Signals Feed */}
        {showSignals && (
          <div className="w-72 h-full flex flex-col shrink-0">
            <SignalsFeed onSelectSignal={handleSelectSignal} />
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        userId={userId}
      />
    </div>
  );
}
