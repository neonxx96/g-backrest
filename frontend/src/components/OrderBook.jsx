import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Layers, Clock, Settings2, Bell, AlertTriangle, Gauge } from 'lucide-react';
import { soundManager } from '../utils/sound';

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
  const [densityThresholdUsd, setDensityThresholdUsd] = useState(50000); // $50k
  const [densityColor, setDensityColor] = useState("gold");
  const [proximityPct, setProximityPct] = useState(0.15); // Alert within 0.15% distance
  const [refreshRateMs, setRefreshRateMs] = useState(100); // 100ms, 500ms, 1000ms
  const [showSettings, setShowSettings] = useState(false);
  const [spoofedList, setSpoofedList] = useState([]);

  // Refs for stateful tracking without React rerender lag
  const levelLifetimes = useRef(new Map());
  const prevActiveDensities = useRef(new Map()); // price -> { price, usd, side, seenAt }
  const spoofedLevels = useRef(new Map()); // price -> { price, usd, side, time }
  const lastSoundAlertTime = useRef(0);
  const wsRef = useRef(null);
  const throttleTimerRef = useRef(null);
  const latestRawDepth = useRef(null);
  const [, setTick] = useState(0);

  // Periodic 1-second ticker for lifetime display and spoof expiration cleanup
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => (t + 1) % 10000);

      // Prune spoofed levels older than 45 seconds
      const now = Date.now();
      let changed = false;
      for (const [p, s] of spoofedLevels.current.entries()) {
        if (now - s.time > 45000) {
          spoofedLevels.current.delete(p);
          changed = true;
        }
      }
      if (changed) {
        setSpoofedList(Array.from(spoofedLevels.current.values()));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const processDepth = useCallback((rawBids, rawAsks) => {
    const now = Date.now();
    const currentPrices = new Set();
    const currentDensities = new Map();

    const topBidPrice = rawBids && rawBids[0] ? parseFloat(rawBids[0][0]) : null;
    const topAskPrice = rawAsks && rawAsks[0] ? parseFloat(rawAsks[0][0]) : null;
    const midPrice = topBidPrice && topAskPrice ? (topBidPrice + topAskPrice) / 2 : (topBidPrice || topAskPrice || 0);

    // 1. Process asks (lowest ask closest to spread)
    let closestDensityDist = Infinity;
    let closestDensityInfo = null;

    const parsedAsks = (rawAsks || []).slice(0, 16).reverse().map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      const usd = price * qty;
      const isDensity = usd >= densityThresholdUsd;
      currentPrices.add(price);

      if (!levelLifetimes.current.has(price)) {
        levelLifetimes.current.set(price, now);
      }

      if (isDensity) {
        currentDensities.set(price, { price, usd, side: 'ask', seenAt: now });
        if (midPrice > 0) {
          const distPct = Math.abs(price - midPrice) / midPrice * 100;
          if (distPct < closestDensityDist) {
            closestDensityDist = distPct;
            closestDensityInfo = { price, usd, side: 'ask', distPct };
          }
        }
      }

      const firstSeen = levelLifetimes.current.get(price) || now;
      const lifetimeSec = Math.max(0, Math.floor((now - firstSeen) / 1000));
      const isNear = midPrice > 0 && Math.abs(price - midPrice) / midPrice * 100 <= proximityPct;

      return { price, qty, usd, isDensity, lifetimeSec, isNear };
    });

    // 2. Process bids
    const parsedBids = (rawBids || []).slice(0, 16).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      const usd = price * qty;
      const isDensity = usd >= densityThresholdUsd;
      currentPrices.add(price);

      if (!levelLifetimes.current.has(price)) {
        levelLifetimes.current.set(price, now);
      }

      if (isDensity) {
        currentDensities.set(price, { price, usd, side: 'bid', seenAt: now });
        if (midPrice > 0) {
          const distPct = Math.abs(price - midPrice) / midPrice * 100;
          if (distPct < closestDensityDist) {
            closestDensityDist = distPct;
            closestDensityInfo = { price, usd, side: 'bid', distPct };
          }
        }
      }

      const firstSeen = levelLifetimes.current.get(price) || now;
      const lifetimeSec = Math.max(0, Math.floor((now - firstSeen) / 1000));
      const isNear = midPrice > 0 && Math.abs(price - midPrice) / midPrice * 100 <= proximityPct;

      return { price, qty, usd, isDensity, lifetimeSec, isNear };
    });

    // 3. Spoofing Detector: Check if previous large density disappeared when price was approaching
    if (midPrice > 0 && prevActiveDensities.current.size > 0) {
      for (const [prevP, prevInfo] of prevActiveDensities.current.entries()) {
        if (!currentDensities.has(prevP)) {
          // Density disappeared! Was price within spoof reach (e.g. <= 0.35%)?
          const distWhenPulled = Math.abs(prevP - midPrice) / midPrice * 100;
          if (distWhenPulled <= 0.35) {
            // High probability spoof: wall removed right before hit!
            spoofedLevels.current.set(prevP, {
              price: prevP,
              usd: prevInfo.usd,
              side: prevInfo.side,
              distPct: distWhenPulled,
              time: now
            });
            setSpoofedList(Array.from(spoofedLevels.current.values()));
            soundManager.playSpoofAlert();
          }
        }
      }
    }
    prevActiveDensities.current = currentDensities;

    // 4. Proximity alert sound & visual callback
    if (closestDensityInfo && closestDensityInfo.distPct <= proximityPct) {
      if (now - lastSoundAlertTime.current > 8000) {
        lastSoundAlertTime.current = now;
        soundManager.playProximityAlert();
      }
      if (onProximityAlert) {
        onProximityAlert({
          symbol,
          price: closestDensityInfo.price,
          usd: closestDensityInfo.usd,
          side: closestDensityInfo.side,
          distPct: closestDensityInfo.distPct
        });
      }
    }

    // Prune stale price cache if too large
    if (levelLifetimes.current.size > 200) {
      for (const key of levelLifetimes.current.keys()) {
        if (!currentPrices.has(key)) {
          levelLifetimes.current.delete(key);
        }
      }
    }

    setAsks(parsedAsks);
    setBids(parsedBids);
  }, [densityThresholdUsd, proximityPct, symbol, onProximityAlert]);

  // Initial snapshot and WebSocket subscription with update throttling
  useEffect(() => {
    levelLifetimes.current.clear();
    prevActiveDensities.current.clear();
    spoofedLevels.current.clear();
    setSpoofedList([]);

    // 1. Initial REST snapshot
    fetch(`${API_BASE}/depth?symbol=${symbol}&limit=20`)
      .then(res => res.json())
      .then(data => {
        if (data.bids && data.asks) {
          processDepth(data.bids, data.asks);
        }
      })
      .catch(err => console.warn("Depth snapshot error:", err));

    // 2. WebSocket Depth connection with throttling
    const cleanSym = symbol.toLowerCase();
    const wsUrl = `wss://fstream.binance.com/ws/${cleanSym}@depth20@100ms`;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

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
      console.warn("OrderBook WS error:", e);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
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
        <div className="flex items-center space-x-1.5 font-bold text-white text-[11px]">
          <Layers size={13} className="text-[#38bdf8]" />
          <span>Стакан L2</span>
          {spoofedList.length > 0 && (
            <span className="px-1 py-0.2 rounded bg-[#f43f5e22] text-[#f43f5e] text-[9px] font-mono flex items-center">
              👻 {spoofedList.length}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1.5 font-mono">
          {/* Refresh rate toggle */}
          <button
            onClick={() => {
              const next = refreshRateMs === 100 ? 500 : (refreshRateMs === 500 ? 1000 : 100);
              setRefreshRateMs(next);
            }}
            className="px-1.5 py-0.5 rounded bg-[#161922] hover:bg-[#1f2430] text-[10px] text-[#787f91] hover:text-white transition"
            title="Частота обновления отрисовки стакана"
          >
            {refreshRateMs}ms
          </button>

          {/* Volume unit toggle */}
          <button
            onClick={() => setVolumeMode(v => v === "USDT" ? "COIN" : "USDT")}
            className="px-1.5 py-0.5 rounded bg-[#161922] hover:bg-[#1f2430] text-[10px] font-bold text-[#26a69a] hover:text-white transition"
            title="Переключить единицу объема (USDT / COIN)"
          >
            {volumeMode}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1 rounded transition ${showSettings ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'}`}
            title="Настройки плотностей и спуфинга"
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
            <span className="text-[#787f91]">Алерт сближения (%):</span>
            <input
              type="number"
              step="0.05"
              min="0.02"
              max="2.0"
              value={proximityPct}
              onChange={(e) => setProximityPct(Math.max(0.01, Number(e.target.value)))}
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
        </div>
      )}

      {/* Spoof Alerts Strip */}
      {spoofedList.length > 0 && (
        <div className="px-2 py-1 bg-[#1c0e12] border-b border-[#f43f5e30] flex items-center justify-between text-[10px] text-[#f43f5e] font-mono spoof-badge">
          <span className="flex items-center">
            <AlertTriangle size={11} className="mr-1 text-[#f43f5e] animate-pulse" />
            Спуф: ${formatPrice(spoofedList[0].price)} (${(spoofedList[0].usd / 1000).toFixed(0)}k сняли!)
          </span>
          <span className="text-[9px] opacity-70">
            {Math.floor((Date.now() - spoofedList[0].time) / 1000)}s назад
          </span>
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
        {/* Asks (Sells - Crimson/Red) */}
        <div className="flex flex-col">
          {asks.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);
            const isNearWall = item.isDensity && item.isNear;

            return (
              <div 
                key={`ask-${idx}`}
                className={`relative grid grid-cols-3 px-2.5 py-0.5 items-center hover:bg-[#161922] transition-colors ${isNearWall ? 'proximity-alert-pulse' : ''}`}
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : {}}
              >
                {/* Visual depth bar */}
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-[#ef535016] pointer-events-none"
                  style={{ width: `${barWidth}%` }}
                />
                
                <span className="text-[#ef5350] font-semibold z-10 font-mono-numbers">
                  {formatPrice(item.price)}
                </span>
                
                <span className="text-right text-[#d1d4dc] z-10 font-mono-numbers">
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
        <div className="py-0.5 px-2.5 bg-[#101217] flex items-center justify-between text-[11px] font-bold border-y border-[#161922]">
          <span className="text-[#26a69a] text-xs font-mono font-mono-numbers">
            {bids[0] ? formatPrice(bids[0].price) : "---"}
          </span>
          <span className="text-[10px] text-[#60697b] font-normal font-mono">
            Спред: {spreadPrice}
          </span>
        </div>

        {/* Bids (Buys - Teal/Green) */}
        <div>
          {bids.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);
            const isNearWall = item.isDensity && item.isNear;

            return (
              <div 
                key={`bid-${idx}`}
                className={`relative grid grid-cols-3 px-2.5 py-0.5 items-center hover:bg-[#161922] transition-colors ${isNearWall ? 'proximity-alert-pulse' : ''}`}
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : {}}
              >
                {/* Visual depth bar */}
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-[#26a69a16] pointer-events-none"
                  style={{ width: `${barWidth}%` }}
                />

                <span className="text-[#26a69a] font-semibold z-10 font-mono-numbers">
                  {formatPrice(item.price)}
                </span>

                <span className="text-right text-[#d1d4dc] z-10 font-mono-numbers">
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
