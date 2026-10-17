import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Layers, Clock, Settings2 } from 'lucide-react';

const API_BASE = "/api";

const DENSITY_PALETTES = {
  gold: { bg: '#ffb30030', border: '#ffb300', text: '#ffb300' },
  cyan: { bg: '#00e5ff30', border: '#00e5ff', text: '#00e5ff' },
  orange: { bg: '#ff6d0030', border: '#ff6d00', text: '#ff6d00' },
  purple: { bg: '#d500f930', border: '#d500f9', text: '#d500f9' }
};

export default function OrderBook({ symbol = "BTCUSDT" }) {
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [volumeMode, setVolumeMode] = useState("USDT"); // "USDT" or "COIN"
  const [densityThresholdUsd, setDensityThresholdUsd] = useState(50000); // $50k
  const [densityColor, setDensityColor] = useState("gold");
  const [showSettings, setShowSettings] = useState(false);

  // Map of price -> timestamp when density was first spotted
  const densityLifetimes = useRef(new Map());
  const wsRef = useRef(null);

  const processDepth = (rawBids, rawAsks) => {
    const now = Date.now();

    // Process asks (sorted descending so lowest ask is near the spread)
    const parsedAsks = (rawAsks || []).slice(0, 16).reverse().map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      const usd = price * qty;
      const isDensity = usd >= densityThresholdUsd;

      if (isDensity && !densityLifetimes.current.has(price)) {
        densityLifetimes.current.set(price, now);
      } else if (!isDensity && densityLifetimes.current.has(price)) {
        densityLifetimes.current.delete(price);
      }

      const firstSeen = densityLifetimes.current.get(price);
      const lifetimeSec = firstSeen ? Math.floor((now - firstSeen) / 1000) : 0;

      return { price, qty, usd, isDensity, lifetimeSec };
    });

    // Process bids
    const parsedBids = (rawBids || []).slice(0, 16).map(([p, q]) => {
      const price = parseFloat(p);
      const qty = parseFloat(q);
      const usd = price * qty;
      const isDensity = usd >= densityThresholdUsd;

      if (isDensity && !densityLifetimes.current.has(price)) {
        densityLifetimes.current.set(price, now);
      } else if (!isDensity && densityLifetimes.current.has(price)) {
        densityLifetimes.current.delete(price);
      }

      const firstSeen = densityLifetimes.current.get(price);
      const lifetimeSec = firstSeen ? Math.floor((now - firstSeen) / 1000) : 0;

      return { price, qty, usd, isDensity, lifetimeSec };
    });

    setAsks(parsedAsks);
    setBids(parsedBids);
  };

  useEffect(() => {
    densityLifetimes.current.clear();

    // 1. Immediate REST Snapshot
    fetch(`${API_BASE}/depth?symbol=${symbol}&limit=20`)
      .then(res => res.json())
      .then(data => {
        if (data.bids && data.asks) {
          processDepth(data.bids, data.asks);
        }
      })
      .catch(err => console.warn("Depth snapshot error:", err));

    // 2. Real-time WebSocket connection
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
          processDepth(data.b, data.a);
        } catch (err) {
          // ignore
        }
      };
    } catch (e) {
      console.warn("OrderBook WS error:", e);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, densityThresholdUsd]);

  // Max volume for proportional depth bars
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
    if (!seconds || seconds <= 0) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const activePalette = DENSITY_PALETTES[densityColor] || DENSITY_PALETTES.gold;
  const spreadPrice = bids[0] && asks[asks.length - 1] ? Math.abs(asks[asks.length - 1].price - bids[0].price).toFixed(2) : "0.00";

  return (
    <div className="flex flex-col h-full bg-[#0e1118] text-[#d1d4dc] border border-[#1b212f] rounded-lg overflow-hidden text-xs shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#121620] border-b border-[#1b212f]">
        <div className="flex items-center space-x-1.5 font-bold text-white">
          <Layers size={14} className="text-[#2563eb]" />
          <span>Стакан (Depth L2)</span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Volume unit toggle */}
          <button
            onClick={() => setVolumeMode(v => v === "USDT" ? "COIN" : "USDT")}
            className="px-2 py-0.5 rounded bg-[#1a2130] hover:bg-[#2563eb] text-[10px] font-mono font-bold text-[#00c087] hover:text-white transition"
            title="Переключить единицу объема"
          >
            {volumeMode}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 rounded text-[#848e9c] hover:bg-[#1a2130] hover:text-white transition"
            title="Настройки плотностей"
          >
            <Settings2 size={13} />
          </button>
        </div>
      </div>

      {/* Density settings panel */}
      {showSettings && (
        <div className="p-3 bg-[#121620] border-b border-[#1b212f] space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-[#848e9c]">Порог плотности ($):</span>
            <input
              type="number"
              step="10000"
              value={densityThresholdUsd}
              onChange={(e) => setDensityThresholdUsd(Number(e.target.value))}
              className="w-24 bg-[#0e1118] border border-[#1f2937] rounded px-2 py-0.5 text-right font-mono text-white"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#848e9c]">Цвет подсветки:</span>
            <div className="flex space-x-2">
              {Object.keys(DENSITY_PALETTES).map(color => (
                <button
                  key={color}
                  onClick={() => setDensityColor(color)}
                  style={{ backgroundColor: DENSITY_PALETTES[color].border }}
                  className={`w-4 h-4 rounded-full transition ${densityColor === color ? 'ring-2 ring-white scale-110' : 'opacity-60'}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-3 py-1 text-[10px] text-[#6b7280] font-semibold uppercase border-b border-[#1b212f] bg-[#0b0e14]">
        <span>Цена</span>
        <span className="text-right">Объем ({volumeMode})</span>
        <span className="text-right">Жизнь</span>
      </div>

      {/* Ladder Container */}
      <div className="flex-1 overflow-y-auto font-mono text-[11px] divide-y divide-[#161b26]">
        {/* Asks (Sells - Red) */}
        <div className="flex flex-col-reverse">
          {asks.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);

            return (
              <div 
                key={`ask-${idx}`}
                className="relative grid grid-cols-3 px-3 py-0.5 items-center hover:bg-[#161b26] transition-colors"
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : {}}
              >
                {/* Depth bar */}
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-[#f6465d18] pointer-events-none"
                  style={{ width: `${barWidth}%` }}
                />
                <span className="text-[#f6465d] font-semibold z-10">{formatPrice(item.price)}</span>
                <span className="text-right text-[#e2e8f0] z-10">
                  {volumeMode === "USDT" ? `$${(item.usd / 1000).toFixed(1)}k` : item.qty.toFixed(2)}
                </span>
                <span className="text-right text-[10px] z-10" style={item.isDensity ? { color: activePalette.text } : { color: '#6b7280' }}>
                  {item.isDensity && item.lifetimeSec > 0 ? (
                    <span className="flex items-center justify-end space-x-0.5 font-bold">
                      <Clock size={10} className="inline mr-0.5" />
                      {formatLifetime(item.lifetimeSec)}
                    </span>
                  ) : "-"}
                </span>
              </div>
            );
          })}
        </div>

        {/* Current Mid Spread Divider */}
        <div className="py-1 px-3 bg-[#121620] flex items-center justify-between text-[11px] font-bold border-y border-[#1b212f]">
          <span className="text-[#00c087] text-xs font-mono">
            {bids[0] ? formatPrice(bids[0].price) : "---"}
          </span>
          <span className="text-[10px] text-[#6b7280] font-normal">
            Спред: {spreadPrice}
          </span>
        </div>

        {/* Bids (Buys - Green) */}
        <div>
          {bids.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);

            return (
              <div 
                key={`bid-${idx}`}
                className="relative grid grid-cols-3 px-3 py-0.5 items-center hover:bg-[#161b26] transition-colors"
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : {}}
              >
                {/* Depth bar */}
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-[#00c08718] pointer-events-none"
                  style={{ width: `${barWidth}%` }}
                />
                <span className="text-[#00c087] font-semibold z-10">{formatPrice(item.price)}</span>
                <span className="text-right text-[#e2e8f0] z-10">
                  {volumeMode === "USDT" ? `$${(item.usd / 1000).toFixed(1)}k` : item.qty.toFixed(2)}
                </span>
                <span className="text-right text-[10px] z-10" style={item.isDensity ? { color: activePalette.text } : { color: '#6b7280' }}>
                  {item.isDensity && item.lifetimeSec > 0 ? (
                    <span className="flex items-center justify-end space-x-0.5 font-bold">
                      <Clock size={10} className="inline mr-0.5" />
                      {formatLifetime(item.lifetimeSec)}
                    </span>
                  ) : "-"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
