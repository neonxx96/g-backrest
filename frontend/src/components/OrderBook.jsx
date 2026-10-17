import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Layers, Clock, Settings2, Bell, AlertTriangle, CheckCircle, Gauge } from 'lucide-react';
import { soundManager } from '../utils/sound';
import { aggregateDepth, detectSpoofOrFill, evaluateProximityAlert } from '../utils/orderbookLogic';

const API_BASE = "/api";

const DENSITY_PALETTES = {
  gold: { bg: 'rgba(255, 179, 0, 0.18)', border: '#ffb300', text: '#ffb300' },
  cyan: { bg: 'rgba(0, 229, 255, 0.18)', border: '#00e5ff', text: '#00e5ff' },
  orange: { bg: 'rgba(255, 109, 0, 0.18)', border: '#ff6d00', text: '#ff6d00' },
  purple: { bg: 'rgba(213, 0, 249, 0.18)', border: '#d500f9', text: '#d500f9' }
};

export default function OrderBook({ symbol = "BTCUSDT", onProximityAlert }) {
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [volumeMode, setVolumeMode] = useState("USDT"); // "USDT" or "COIN"
  const [densityThresholdUsd, setDensityThresholdUsd] = useState(50000); // $50k default
  const [densityColor, setDensityColor] = useState("gold");
  const [tickMultiplier, setTickMultiplier] = useState(1); // 1, 2, 5, 10, 50, 100
  const [levelCount, setLevelCount] = useState(20); // 15, 20, 30, 50
  const [displayMode, setDisplayMode] = useState("both"); // "both", "numbers", "bars", "heatmap"
  
  // Proximity Settings
  const [minDistanceBps, setMinDistanceBps] = useState(5); // min 5 bps = 0.05%
  const [maxProximityBps, setMaxProximityBps] = useState(25); // max 25 bps = 0.25%
  const [cooldownSec, setCooldownSec] = useState(15); // 15s cooldown per wall
  
  const [refreshRateMs, setRefreshRateMs] = useState(100); // 100ms, 500ms, 1000ms
  const [showSettings, setShowSettings] = useState(false);
  const [recentOrderflowEvents, setRecentOrderflowEvents] = useState([]);

  // Recenter spread ref
  const spreadRef = useRef(null);

  // Stateful tracking refs
  const levelLifetimes = useRef(new Map());
  const prevActiveDensities = useRef(new Map()); // price -> { price, usd, side }
  const alertLatchState = useRef(new Map()); // price -> { time, distBps }
  const tradeVolumeMap = useRef(new Map()); // price -> cumulative usd in last 15s
  const tradeLog = useRef([]); // [{ price, usd, time }]
  
  const depthWsRef = useRef(null);
  const tradeWsRef = useRef(null);
  const throttleTimerRef = useRef(null);
  const latestRawDepth = useRef(null);
  const [, setTick] = useState(0);

  // Derive base tick size for symbol
  const baseTick = useMemo(() => {
    if (symbol.includes("BTC")) return 0.1;
    if (symbol.includes("ETH")) return 0.01;
    if (symbol.includes("SOL") || symbol.includes("BNB")) return 0.01;
    return 0.001;
  }, [symbol]);

  // Periodic 1-second ticker for lifetimes and event expiration
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => (t + 1) % 10000);

      const now = Date.now();
      // Prune trades older than 15s
      while (tradeLog.current.length > 0 && now - tradeLog.current[0].time > 15000) {
        const oldTrade = tradeLog.current.shift();
        const currentVol = tradeVolumeMap.current.get(oldTrade.price) || 0;
        if (currentVol <= oldTrade.usd) {
          tradeVolumeMap.current.delete(oldTrade.price);
        } else {
          tradeVolumeMap.current.set(oldTrade.price, currentVol - oldTrade.usd);
        }
      }

      // Prune spoof/filled events older than 40s
      setRecentOrderflowEvents(prev => prev.filter(e => now - e.time < 40000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const processDepth = useCallback((rawBids, rawAsks) => {
    const now = Date.now();

    // 1. Price Tick Aggregation (Task 5: x1 / x10 / x100)
    const aggregated = aggregateDepth(rawBids, rawAsks, tickMultiplier, baseTick);

    const currentPrices = new Set();
    const currentDensities = new Map();
    const activeDensityList = [];

    const topBidPrice = aggregated.bids && aggregated.bids[0] ? aggregated.bids[0][0] : null;
    const topAskPrice = aggregated.asks && aggregated.asks[0] ? aggregated.asks[0][0] : null;
    const midPrice = topBidPrice && topAskPrice ? (topBidPrice + topAskPrice) / 2 : (topBidPrice || topAskPrice || 0);

    // 2. Process Asks (sorted descending so highest is at top, lowest ask right above spread)
    const parsedAsks = aggregated.asks.reverse().map(([price, qty]) => {
      const usd = price * qty;
      const isDensity = usd >= densityThresholdUsd;
      currentPrices.add(price);

      if (!levelLifetimes.current.has(price)) {
        levelLifetimes.current.set(price, now);
      }

      if (isDensity) {
        currentDensities.set(price, { price, usd, side: 'ask' });
        activeDensityList.push({ price, usd, side: 'ask' });
      }

      const firstSeen = levelLifetimes.current.get(price) || now;
      const lifetimeSec = Math.max(0, Math.floor((now - firstSeen) / 1000));

      const distBps = midPrice > 0 ? (Math.abs(price - midPrice) / midPrice * 10000) : 9999;
      const isNear = distBps >= minDistanceBps && distBps <= maxProximityBps && isDensity;

      return { price, qty, usd, isDensity, lifetimeSec, isNear, distBps };
    });

    // 3. Process Bids (sorted descending, highest bid right below spread)
    const parsedBids = aggregated.bids.map(([price, qty]) => {
      const usd = price * qty;
      const isDensity = usd >= densityThresholdUsd;
      currentPrices.add(price);

      if (!levelLifetimes.current.has(price)) {
        levelLifetimes.current.set(price, now);
      }

      if (isDensity) {
        currentDensities.set(price, { price, usd, side: 'bid' });
        activeDensityList.push({ price, usd, side: 'bid' });
      }

      const firstSeen = levelLifetimes.current.get(price) || now;
      const lifetimeSec = Math.max(0, Math.floor((now - firstSeen) / 1000));

      const distBps = midPrice > 0 ? (Math.abs(price - midPrice) / midPrice * 10000) : 9999;
      const isNear = distBps >= minDistanceBps && distBps <= maxProximityBps && isDensity;

      return { price, qty, usd, isDensity, lifetimeSec, isNear, distBps };
    });

    // 4. Spoof Detector: Distinguish «Снята (Спуф)» vs «Исполнена (Съели сделками)» (Task 4)
    const newEvents = detectSpoofOrFill({
      prevDensities: prevActiveDensities.current,
      currentDensities,
      midPrice,
      tradeVolumeMap: tradeVolumeMap.current,
      densityThresholdUsd,
      spoofDistancePct: 0.35,
      fillRatio: 0.5
    });

    if (newEvents.length > 0) {
      setRecentOrderflowEvents(prev => [...newEvents, ...prev].slice(0, 5));
      // Play sound only for actual PULLED spoof walls
      if (newEvents.some(e => e.type === 'PULLED')) {
        soundManager.playSpoofAlert();
      }
    }
    prevActiveDensities.current = currentDensities;

    // 5. Proximity Alert with Min-Distance Filter & Latching (Task 3)
    const alertResult = evaluateProximityAlert({
      activeDensities: activeDensityList,
      midPrice,
      minDistanceBps,
      maxProximityBps,
      densityThresholdUsd,
      alertLatchState: alertLatchState.current,
      now,
      cooldownMs: cooldownSec * 1000
    });

    if (alertResult) {
      soundManager.playProximityAlert();
      if (onProximityAlert) {
        onProximityAlert({
          symbol,
          price: alertResult.price,
          usd: alertResult.usd,
          side: alertResult.side,
          distPct: alertResult.distPct,
          distBps: alertResult.distBps
        });
      }
    }

    // Prune stale lifetimes map
    if (levelLifetimes.current.size > 200) {
      for (const k of levelLifetimes.current.keys()) {
        if (!currentPrices.has(k)) levelLifetimes.current.delete(k);
      }
    }

    setAsks(parsedAsks.slice(-levelCount));
    setBids(parsedBids.slice(0, levelCount));
  }, [
    densityThresholdUsd,
    tickMultiplier,
    levelCount,
    baseTick,
    minDistanceBps,
    maxProximityBps,
    cooldownSec,
    symbol,
    onProximityAlert
  ]);

  // Center spread on Space hotkey
  useEffect(() => {
    const handleRecenter = () => {
      if (spreadRef.current) {
        spreadRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    window.addEventListener('recenter-market-price', handleRecenter);
    return () => window.removeEventListener('recenter-market-price', handleRecenter);
  }, []);

  // Initial snapshot and WebSocket subscriptions (Depth + AggTrade)
  useEffect(() => {
    levelLifetimes.current.clear();
    prevActiveDensities.current.clear();
    alertLatchState.current.clear();
    tradeVolumeMap.current.clear();
    tradeLog.current = [];
    setRecentOrderflowEvents([]);

    // 1. Initial REST snapshot
    fetch(`${API_BASE}/depth?symbol=${symbol}&limit=20`)
      .then(res => res.json())
      .then(data => {
        if (data.bids && data.asks) {
          processDepth(data.bids, data.asks);
        }
      })
      .catch(err => console.warn("Depth snapshot error:", err));

    const cleanSym = symbol.toLowerCase();

    // 2. Depth WebSocket connection
    const depthWsUrl = `wss://fstream.binance.com/ws/${cleanSym}@depth20@100ms`;
    if (depthWsRef.current) depthWsRef.current.close();
    try {
      const ws = new WebSocket(depthWsUrl);
      depthWsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (!data.b || !data.a) return;
          latestRawDepth.current = { b: data.b, a: data.a };

          if (refreshRateMs <= 100) {
            processDepth(data.b, data.a);
          } else if (!throttleTimerRef.current) {
            throttleTimerRef.current = setTimeout(() => {
              throttleTimerRef.current = null;
              if (latestRawDepth.current) {
                processDepth(latestRawDepth.current.b, latestRawDepth.current.a);
              }
            }, refreshRateMs);
          }
        } catch (_) {}
      };
    } catch (e) {
      console.warn("Depth WS error:", e);
    }

    // 3. AggTrade WebSocket connection (tracks market trades for fill detection)
    const tradeWsUrl = `wss://fstream.binance.com/ws/${cleanSym}@aggTrade`;
    if (tradeWsRef.current) tradeWsRef.current.close();
    try {
      const tws = new WebSocket(tradeWsUrl);
      tradeWsRef.current = tws;
      tws.onmessage = (event) => {
        try {
          const t = JSON.parse(event.data);
          if (!t.p || !t.q) return;
          const price = parseFloat(t.p);
          const qty = parseFloat(t.q);
          const usd = price * qty;
          const time = Number(t.T) || Date.now();

          tradeLog.current.push({ price, usd, time });
          tradeVolumeMap.current.set(price, (tradeVolumeMap.current.get(price) || 0) + usd);
        } catch (_) {}
      };
    } catch (e) {
      console.warn("Trade WS error:", e);
    }

    return () => {
      if (depthWsRef.current) depthWsRef.current.close();
      if (tradeWsRef.current) tradeWsRef.current.close();
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [symbol, refreshRateMs, processDepth]);

  // Max volume for depth bar percentage calculation
  const maxVolume = useMemo(() => {
    let max = 1;
    [...bids, ...asks].forEach(item => {
      const v = volumeMode === "USDT" ? item.usd : item.qty;
      if (v > max) max = v;
    });
    return max;
  }, [bids, asks, volumeMode]);

  const formatPrice = (price) => {
    if (price >= 1000) return price.toFixed(1);
    if (price >= 1) return price.toFixed(2);
    if (price >= 0.01) return price.toFixed(4);
    return price.toFixed(6);
  };

  const formatLifetime = (seconds) => {
    if (seconds <= 0) return "<1s";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const activePalette = DENSITY_PALETTES[densityColor] || DENSITY_PALETTES.gold;
  const spreadPrice = bids[0] && asks[asks.length - 1] ? Math.abs(asks[asks.length - 1].price - bids[0].price).toFixed(2) : "0.00";

  return (
    <div className="flex flex-col h-full bg-[#0c0e12] text-[#d1d4dc] border border-[#161922] overflow-hidden text-xs select-none relative font-sans">
      {/* Header bar (Tealstreet style: clean, flat, high contrast) */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-[#101217] border-b border-[#161922]">
        <div className="flex items-center space-x-1 font-bold text-white text-[11px]">
          <Layers size={13} className="text-[#38bdf8]" />
          <span>Стакан L2</span>
        </div>

        {/* Middle: Tick Aggregator (Task 5: x1, x10, x100) */}
        <div className="flex items-center bg-[#08090c] p-0.5 rounded border border-[#161820] space-x-0.5 font-mono text-[9px]">
          {[1, 10, 100].map((mult) => (
            <button
              key={mult}
              onClick={() => setTickMultiplier(mult)}
              className={`px-1.5 py-0.2 rounded transition ${tickMultiplier === mult ? 'bg-[#2563eb] text-white font-bold' : 'text-[#787f91] hover:text-white'}`}
              title={`Агрегация шага цены x${mult}`}
            >
              x{mult}
            </button>
          ))}
        </div>

        {/* Right: Controls */}
        <div className="flex items-center space-x-1 font-mono">
          {/* Refresh rate toggle */}
          <button
            onClick={() => {
              const next = refreshRateMs === 100 ? 500 : (refreshRateMs === 500 ? 1000 : 100);
              setRefreshRateMs(next);
            }}
            className="px-1 py-0.5 rounded bg-[#161922] hover:bg-[#1f2430] text-[9px] text-[#787f91] hover:text-white transition"
            title="Частота обновления отрисовки стакана"
          >
            {refreshRateMs}ms
          </button>

          {/* Volume unit toggle */}
          <button
            onClick={() => setVolumeMode(v => v === "USDT" ? "COIN" : "USDT")}
            className="px-1 py-0.5 rounded bg-[#161922] hover:bg-[#1f2430] text-[9px] font-bold text-[#26a69a] hover:text-white transition"
            title="Переключить единицу объема (USDT / COIN)"
          >
            {volumeMode}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded transition ${showSettings ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
            title="Настройки плотностей, сближения и спуфинга"
          >
            <Settings2 size={12} />
          </button>
        </div>
      </div>

      {/* Density & Proximity Settings Panel */}
      {showSettings && (
        <div className="p-2.5 bg-[#101217] border-b border-[#161922] space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Порог плотности ($):</span>
            <input
              type="number"
              step="10000"
              value={densityThresholdUsd}
              onChange={(e) => setDensityThresholdUsd(Math.max(1000, Number(e.target.value)))}
              className="w-20 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Мин. дистанция (bps):</span>
            <input
              type="number"
              step="1"
              min="1"
              max="50"
              value={minDistanceBps}
              onChange={(e) => setMinDistanceBps(Math.max(1, Number(e.target.value)))}
              className="w-20 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
              title="Фильтрует алерт прямо на спреде (5 bps = 0.05%)"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Макс. сближение (bps):</span>
            <input
              type="number"
              step="5"
              min="5"
              max="100"
              value={maxProximityBps}
              onChange={(e) => setMaxProximityBps(Math.max(5, Number(e.target.value)))}
              className="w-20 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
              title="Дистанция срабатывания алерта (25 bps = 0.25%)"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Кулдаун алерта (сек):</span>
            <input
              type="number"
              step="5"
              min="5"
              max="120"
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Math.max(3, Number(e.target.value)))}
              className="w-20 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right font-mono text-white text-xs"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Цвет плотностей:</span>
            <div className="flex space-x-1.5">
              {Object.keys(DENSITY_PALETTES).map(color => (
                <button
                  key={color}
                  onClick={() => setDensityColor(color)}
                  style={{ backgroundColor: DENSITY_PALETTES[color].border }}
                  className={`w-3.5 h-3.5 rounded-full transition ${densityColor === color ? 'ring-2 ring-white scale-110' : 'opacity-50'}`}
                />
              ))}
            </div>
          </div>

          {/* TigerTrade Step 6 Controls */}
          <div className="pt-1 border-t border-[#1b212f] space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[#787f91]">Сжатие тиков:</span>
              <div className="flex space-x-1">
                {[1, 2, 5, 10, 50, 100].map(mult => (
                  <button
                    key={mult}
                    onClick={() => setTickMultiplier(mult)}
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${tickMultiplier === mult ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'}`}
                  >
                    x{mult}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#787f91]">Уровней стакана:</span>
              <div className="flex space-x-1">
                {[15, 20, 30, 50].map(cnt => (
                  <button
                    key={cnt}
                    onClick={() => setLevelCount(cnt)}
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${levelCount === cnt ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'}`}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#787f91]">Режим отображения:</span>
              <div className="flex space-x-1">
                {[
                  { id: 'both', label: 'Все' },
                  { id: 'numbers', label: 'Числа' },
                  { id: 'bars', label: 'Бары' },
                  { id: 'heatmap', label: 'Тепло' },
                ].map(m => (
                  <button
                    key={m.id}
                    onClick={() => setDisplayMode(m.id)}
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono transition ${displayMode === m.id ? 'bg-[#ff9800] text-black font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Orderflow Status Strip: «Снята (Спуф)» vs «Исполнена (Съели сделками)» (Task 4) */}
      {recentOrderflowEvents.length > 0 && (
        <div className="px-2 py-0.5 bg-[#090b0f] border-b border-[#161922] space-y-0.5 font-mono text-[10px]">
          {recentOrderflowEvents.slice(0, 2).map((ev, idx) => {
            const isFilled = ev.type === 'FILLED';
            return (
              <div 
                key={idx}
                className={`flex items-center justify-between px-1.5 py-0.2 rounded ${isFilled ? 'bg-[#26a69a14] text-[#26a69a]' : 'bg-[#ef535014] text-[#ef5350]'}`}
              >
                <span className="flex items-center">
                  {isFilled ? (
                    <CheckCircle size={10} className="mr-1 text-[#26a69a]" />
                  ) : (
                    <AlertTriangle size={10} className="mr-1 text-[#ef5350] animate-pulse" />
                  )}
                  {isFilled ? (
                    <span>Исполнена: ${formatPrice(ev.price)} (${(ev.usd / 1000).toFixed(0)}k съели)</span>
                  ) : (
                    <span>Снята: ${formatPrice(ev.price)} (${(ev.usd / 1000).toFixed(0)}k спуф)</span>
                  )}
                </span>
                <span className="text-[9px] opacity-70">
                  {Math.max(1, Math.floor((Date.now() - ev.time) / 1000))}s
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-2.5 py-1 text-[10px] text-[#60697b] font-semibold uppercase border-b border-[#161922] bg-[#090b0f] font-mono">
        <span>Цена</span>
        <span className="text-right">Объем ({volumeMode})</span>
        <span className="text-right">Жизнь</span>
      </div>

      {/* Order Ladder */}
      <div className="flex-1 overflow-y-auto font-mono text-[11px] divide-y divide-[#13161f]">
        {/* Asks (Sells - Crimson/Red, highest price at top, best ask at bottom) */}
        <div className="flex flex-col">
          {asks.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);

            return (
              <div 
                key={`ask-${idx}`}
                className={`relative grid grid-cols-3 px-2.5 py-0.5 items-center hover:bg-[#161922] transition-colors ${item.isNear ? 'proximity-alert-pulse' : ''}`}
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : (displayMode === 'heatmap' ? { backgroundColor: `rgba(239, 83, 80, ${Math.min(0.65, 0.05 + (vol / maxVolume) * 0.6)})` } : {})}
              >
                {/* Visual depth bar */}
                {(displayMode === 'both' || displayMode === 'bars') && (
                  <div 
                    className="absolute right-0 top-0 bottom-0 bg-[#ef535016] pointer-events-none"
                    style={{ width: `${barWidth}%` }}
                  />
                )}
                
                <span className="text-[#ef5350] font-semibold z-10 font-mono-numbers">
                  {formatPrice(item.price)}
                </span>
                
                <span className={`text-right text-[#d1d4dc] z-10 font-mono-numbers ${displayMode === 'bars' ? 'opacity-0' : ''}`}>
                  {volumeMode === "USDT" ? `$${(item.usd / 1000).toFixed(1)}k` : item.qty.toFixed(2)}
                </span>
                
                <span className="text-right text-[10px] z-10" style={item.isDensity ? { color: activePalette.text } : { color: '#60697b' }}>
                  {item.isDensity ? (
                    <span className="flex items-center justify-end space-x-0.5 font-bold font-mono">
                      <Clock size={10} className="inline mr-0.5" />
                      {formatLifetime(item.lifetimeSec)}
                      {item.lifetimeSec >= 60 && (
                        <span className="ml-1 text-[8px] px-1 rounded bg-[#ffb30030] text-[#ffb300]">СТЕНА</span>
                      )}
                    </span>
                  ) : (
                    <span className="font-mono text-[#60697b]">
                      {formatLifetime(item.lifetimeSec)}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* Current Mid Spread Divider */}
        <div ref={spreadRef} className="py-0.5 px-2.5 bg-[#101217] flex items-center justify-between text-[11px] font-bold border-y border-[#161922]">
          <span className="text-[#26a69a] text-xs font-mono font-mono-numbers">
            {bids[0] ? formatPrice(bids[0].price) : "---"}
          </span>
          <span className="text-[10px] text-[#60697b] font-normal font-mono">
            Спред: {spreadPrice}
          </span>
        </div>

        {/* Bids (Buys - Teal/Green, best bid at top, lowest at bottom) */}
        <div>
          {bids.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);

            return (
              <div 
                key={`bid-${idx}`}
                className={`relative grid grid-cols-3 px-2.5 py-0.5 items-center hover:bg-[#161922] transition-colors ${item.isNear ? 'proximity-alert-pulse' : ''}`}
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : (displayMode === 'heatmap' ? { backgroundColor: `rgba(38, 166, 154, ${Math.min(0.65, 0.05 + (vol / maxVolume) * 0.6)})` } : {})}
              >
                {/* Visual depth bar */}
                {(displayMode === 'both' || displayMode === 'bars') && (
                  <div 
                    className="absolute right-0 top-0 bottom-0 bg-[#26a69a16] pointer-events-none"
                    style={{ width: `${barWidth}%` }}
                  />
                )}

                <span className="text-[#26a69a] font-semibold z-10 font-mono-numbers">
                  {formatPrice(item.price)}
                </span>

                <span className={`text-right text-[#d1d4dc] z-10 font-mono-numbers ${displayMode === 'bars' ? 'opacity-0' : ''}`}>
                  {volumeMode === "USDT" ? `$${(item.usd / 1000).toFixed(1)}k` : item.qty.toFixed(2)}
                </span>

                <span className="text-right text-[10px] z-10" style={item.isDensity ? { color: activePalette.text } : { color: '#60697b' }}>
                  {item.isDensity ? (
                    <span className="flex items-center justify-end space-x-0.5 font-bold font-mono">
                      <Clock size={10} className="inline mr-0.5" />
                      {formatLifetime(item.lifetimeSec)}
                      {item.lifetimeSec >= 60 && (
                        <span className="ml-1 text-[8px] px-1 rounded bg-[#ffb30030] text-[#ffb300]">СТЕНА</span>
                      )}
                    </span>
                  ) : (
                    <span className="font-mono text-[#60697b]">
                      {formatLifetime(item.lifetimeSec)}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
