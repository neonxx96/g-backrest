import React, { useState, useEffect } from 'react';
import Chart from './components/Chart';
import OrderBook from './components/OrderBook';
import SignalsFeed from './components/SignalsFeed';
import SettingsModal from './components/SettingsModal';
import RecorderModal from './components/RecorderModal';
import BacktestModal from './components/BacktestModal';
import FootprintClusters from './components/FootprintClusters';
import { 
  Sliders, 
  Layers, 
  Bell, 
  Search, 
  TrendingUp,
  HardDrive,
  BarChart3,
  Activity
} from 'lucide-react';

const TIMEFRAMES = ["1m", "15m", "30m", "45m", "1h", "4h", "6h"];
const POPULAR_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "BNBUSDT", "SUIUSDT", "NEARUSDT"];

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const initialSymbol = (params.get('symbol') || "BTCUSDT").toUpperCase();
  const initialTf = params.get('tf') || "15m";
  const initialUserId = params.get('user_id') || "0";

  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTf);
  const [userId, setUserId] = useState(initialUserId);

  const [showOrderBook, setShowOrderBook] = useState(true);
  const [showFootprint, setShowFootprint] = useState(false);
  const [showSignals, setShowSignals] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [storageQuickStats, setStorageQuickStats] = useState({ mb: 0, trades: 0, recording: true });

  useEffect(() => {
    const fetchStorage = () => {
      fetch('/api/recorder/status')
        .then(r => r.json())
        .then(d => {
          setStorageQuickStats({
            mb: d.used_storage_mb || 0,
            trades: d.total_trades_session || 0,
            recording: d.is_recording
          });
        })
        .catch(() => {});
    };
    fetchStorage();
    const t = setInterval(fetchStorage, 5000);
    return () => clearInterval(t);
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

  return (
    <div className="flex flex-col h-screen w-screen bg-[#080a0f] text-[#d1d4dc] font-sans overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-3 py-1.5 bg-[#0e1118] border-b border-[#1b212f] z-20">
        {/* Brand & Symbol Selector */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-black text-white text-sm tracking-wide">
            <span className="p-1 rounded bg-[#2563eb] text-white">
              <TrendingUp size={15} />
            </span>
            <span>Signal<span className="text-[#2563eb]">Script</span></span>
          </div>

          <div className="h-4 w-px bg-[#1f2937] mx-1" />

          {/* Active Symbol */}
          <div className="flex items-center space-x-1.5">
            <span className="text-xs font-black text-white font-mono bg-[#121620] px-2 py-0.5 rounded border border-[#1b212f]">
              {symbol}
            </span>

            <form onSubmit={handleSearchSubmit} className="relative">
              <input
                type="text"
                placeholder="Поиск монеты..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-28 focus:w-36 transition-all duration-200 bg-[#121620] border border-[#1b212f] rounded px-2 py-0.5 text-xs text-white placeholder-[#6b7280] outline-none font-mono"
              />
              <Search size={11} className="absolute right-2 top-1.5 text-[#6b7280] pointer-events-none" />
            </form>

            {/* Popular symbols */}
            <div className="hidden xl:flex items-center space-x-1 pl-1">
              {POPULAR_SYMBOLS.map(sym => (
                <button
                  key={sym}
                  onClick={() => setSymbol(sym)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition ${symbol === sym ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#121620] hover:bg-[#1a2130] text-[#848e9c]'}`}
                >
                  {sym.replace("USDT", "")}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Timeframe Buttons */}
        <div className="flex items-center space-x-1 bg-[#121620] p-0.5 rounded border border-[#1b212f]">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2 py-0.5 rounded text-xs font-mono font-medium transition ${timeframe === tf ? 'bg-[#2563eb] text-white' : 'text-[#848e9c] hover:text-white hover:bg-[#1a2130]'}`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Action Toggles */}
        <div className="flex items-center space-x-2">
          {/* 100GB Storage & Recorder Pill */}
          <button
            onClick={() => setShowRecorder(true)}
            className="px-2.5 py-1 rounded text-xs font-mono font-medium bg-[#121620] hover:bg-[#1a2130] border border-[#1b212f] text-gray-300 flex items-center space-x-1.5 transition"
            title="Квота хранилища 100 GB и настройки рекордера"
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${storageQuickStats.recording ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <HardDrive size={12} className="text-[#2563eb]" />
            <span className="hidden md:inline font-bold text-white">{storageQuickStats.mb} MB</span>
            <span className="text-[10px] text-gray-400">/ 100GB</span>
          </button>

          {/* Backtester Modal Trigger */}
          <button
            onClick={() => setShowBacktest(true)}
            className="px-2.5 py-1 rounded text-xs font-semibold bg-[#121620] hover:bg-[#1a2130] text-gray-200 border border-[#1b212f] flex items-center space-x-1 transition"
            title="Бэктестер Order Flow & Свечных Триггеров"
          >
            <BarChart3 size={13} className="text-purple-400" />
            <span className="hidden sm:inline">Бэктест</span>
          </button>

          {/* Footprint Clusters Toggle */}
          <button
            onClick={() => setShowFootprint(!showFootprint)}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition ${showFootprint ? 'bg-[#121620] text-white border border-[#2563eb]' : 'text-[#848e9c] hover:bg-[#121620]'}`}
            title="Переключить Footprint / Кластера"
          >
            <Activity size={13} className="text-emerald-400" />
            <span className="hidden sm:inline">Кластера</span>
          </button>

          <button
            onClick={() => setShowOrderBook(!showOrderBook)}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition ${showOrderBook ? 'bg-[#121620] text-white border border-[#1b212f]' : 'text-[#848e9c] hover:bg-[#121620]'}`}
            title="Переключить стакан"
          >
            <Layers size={13} className="text-[#2563eb]" />
            <span className="hidden sm:inline">Стакан</span>
          </button>

          <button
            onClick={() => setShowSignals(!showSignals)}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1 transition ${showSignals ? 'bg-[#121620] text-white border border-[#1b212f]' : 'text-[#848e9c] hover:bg-[#121620]'}`}
            title="Переключить ленту сигналов"
          >
            <Bell size={13} className="text-[#00c087]" />
            <span className="hidden sm:inline">Сигналы</span>
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="px-3 py-1 rounded text-xs font-semibold bg-[#2563eb] hover:bg-[#1d4ed8] text-white flex items-center space-x-1.5 transition"
          >
            <Sliders size={13} />
            <span>Настройки</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden p-1.5 gap-1.5">
        {/* Left: Chart Container */}
        <div className="flex-1 flex flex-col h-full min-w-0">
          <Chart symbol={symbol} timeframe={timeframe} userId={userId} />
        </div>

        {/* Footprint Clusters Column */}
        {showFootprint && (
          <div className="w-72 h-full flex flex-col shrink-0">
            <FootprintClusters symbol={symbol} />
          </div>
        )}

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

      {/* Modals */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        userId={userId}
      />

      <RecorderModal
        isOpen={showRecorder}
        onClose={() => setShowRecorder(false)}
        activeSymbol={symbol}
      />

      <BacktestModal
        isOpen={showBacktest}
        onClose={() => setShowBacktest(false)}
        currentSymbol={symbol}
        currentTimeframe={timeframe}
      />
    </div>
  );
}

