import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Layers, Clock, Settings2 } from 'lucide-react';

const DENSITY_PALETTES = {
  gold: { bg: '#ffb30033', border: '#ffb300', text: '#ffb300' },
  cyan: { bg: '#00e5ff33', border: '#00e5ff', text: '#00e5ff' },
  orange: { bg: '#ff6d0033', border: '#ff6d00', text: '#ff6d00' },
  purple: { bg: '#d500f933', border: '#d500f9', text: '#d500f9' }
};

export default function OrderBook({ symbol = "BTCUSDT" }) {
  const [bids, setBids] = useState([]);
  const [asks, setAsks] = useState([]);
  const [volumeMode, setVolumeMode] = useState("USDT"); // "USDT" or "COIN"
  const [densityThresholdUsd, setDensityThresholdUsd] = useState(100000); // $100k
  const [densityColor, setDensityColor] = useState("gold");
  const [showSettings, setShowSettings] = useState(false);

  // Lifetime map: priceLevel -> timestamp first seen
  const densityLifetimes = useRef(new Map());
  const wsRef = useRef(null);

  useEffect(() => {
    densityLifetimes.current.clear();
    const cleanSym = symbol.toLowerCase();
    const wsUrl = `wss://fstream.binance.com/ws/${cleanSym}@depth20@100ms`;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const rawBids = data.b || [];
        const rawAsks = data.a || [];

        const now = Date.now();

        // Process asks (descending so closest to price is at bottom of ask ladder)
        const parsedAsks = rawAsks.slice(0, 15).reverse().map(([p, q]) => {
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
        const parsedBids = rawBids.slice(0, 15).map(([p, q]) => {
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
      } catch (err) {
        // ignore parsing errors
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol, densityThresholdUsd]);

  // Max volume for depth visualization
  const maxVolume = useMemo(() => {
    let max = 1;
    [...bids, ...asks].forEach(item => {
      const v = volumeMode === "USDT" ? item.usd : item.qty;
      if (v > max) max = v;
    });
    return max;
  }, [bids, asks, volumeMode]);

  const formatLifetime = (seconds) => {
    if (!seconds || seconds <= 0) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const activePalette = DENSITY_PALETTES[densityColor] || DENSITY_PALETTES.gold;

  return (
    <div className="flex flex-col h-full bg-[#131722] text-[#d1d4dc] border border-[#1e222d] rounded-lg overflow-hidden text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1e222d] border-b border-[#2a2e39]">
        <div className="flex items-center space-x-1.5 font-semibold text-[#e0e3eb]">
          <Layers size={14} className="text-[#2962ff]" />
          <span>Стакан (Depth L2)</span>
        </div>

        <div className="flex items-center space-x-2">
          {/* Volume unit toggle */}
          <button
            onClick={() => setVolumeMode(v => v === "USDT" ? "COIN" : "USDT")}
            className="px-1.5 py-0.5 rounded bg-[#2a2e39] hover:bg-[#363a45] text-[10px] font-mono text-[#089981]"
            title="Переключить единицу объема"
          >
            {volumeMode}
          </button>

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 rounded hover:bg-[#2a2e39] text-[#787b86]"
            title="Настройки плотностей"
          >
            <Settings2 size={13} />
          </button>
        </div>
      </div>

      {/* Density settings panel */}
      {showSettings && (
        <div className="p-2.5 bg-[#181c27] border-b border-[#2a2e39] space-y-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-[#787b86]">Порог плотности ($):</span>
            <input
              type="number"
              step="10000"
              value={densityThresholdUsd}
              onChange={(e) => setDensityThresholdUsd(Number(e.target.value))}
              className="w-24 bg-[#1e222d] border border-[#2a2e39] rounded px-1.5 py-0.5 text-right font-mono text-white"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#787b86]">Цвет подсветки:</span>
            <div className="flex space-x-1.5">
              {Object.keys(DENSITY_PALETTES).map(color => (
                <button
                  key={color}
                  onClick={() => setDensityColor(color)}
                  style={{ backgroundColor: DENSITY_PALETTES[color].border }}
                  className={`w-3.5 h-3.5 rounded-full ${densityColor === color ? 'ring-2 ring-white' : 'opacity-60'}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-3 py-1 text-[10px] text-[#787b86] font-semibold uppercase border-b border-[#1e222d] bg-[#161a25]">
        <span>Цена</span>
        <span className="text-right">Объем ({volumeMode})</span>
        <span className="text-right">Жизнь</span>
      </div>

      {/* Ladder Container */}
      <div className="flex-1 overflow-y-auto font-mono text-[11px] divide-y divide-[#1e222d]/40">
        {/* Asks (Sells - Red) */}
        <div className="flex flex-col-reverse">
          {asks.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);

            return (
              <div 
                key={`ask-${idx}`}
                className="relative grid grid-cols-3 px-3 py-0.5 items-center hover:bg-[#1e222d]"
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : {}}
              >
                {/* Depth visual bar */}
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-[#f2364515] pointer-events-none"
                  style={{ width: `${barWidth}%` }}
                />
                <span className="text-[#f23645] font-semibold z-10">{item.price.toFixed(item.price < 1 ? 4 : 2)}</span>
                <span className="text-right text-[#d1d4dc] z-10">
                  {volumeMode === "USDT" ? `$${(item.usd / 1000).toFixed(1)}k` : item.qty.toFixed(2)}
                </span>
                <span className="text-right text-[10px] z-10" style={item.isDensity ? { color: activePalette.text } : { color: '#787b86' }}>
                  {item.isDensity && item.lifetimeSec > 0 ? (
                    <span className="flex items-center justify-end space-x-0.5">
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
        <div className="py-1 px-3 bg-[#1e222d] text-center text-[#2962ff] font-bold text-[11px] tracking-wider">
          {bids[0] ? bids[0].price.toFixed(bids[0].price < 1 ? 4 : 2) : "---"}
        </div>

        {/* Bids (Buys - Green) */}
        <div>
          {bids.map((item, idx) => {
            const vol = volumeMode === "USDT" ? item.usd : item.qty;
            const barWidth = Math.min(100, (vol / maxVolume) * 100);

            return (
              <div 
                key={`bid-${idx}`}
                className="relative grid grid-cols-3 px-3 py-0.5 items-center hover:bg-[#1e222d]"
                style={item.isDensity ? { backgroundColor: activePalette.bg, borderRight: `3px solid ${activePalette.border}` } : {}}
              >
                {/* Depth visual bar */}
                <div 
                  className="absolute right-0 top-0 bottom-0 bg-[#08998115] pointer-events-none"
                  style={{ width: `${barWidth}%` }}
                />
                <span className="text-[#089981] font-semibold z-10">{item.price.toFixed(item.price < 1 ? 4 : 2)}</span>
                <span className="text-right text-[#d1d4dc] z-10">
                  {volumeMode === "USDT" ? `$${(item.usd / 1000).toFixed(1)}k` : item.qty.toFixed(2)}
                </span>
                <span className="text-right text-[10px] z-10" style={item.isDensity ? { color: activePalette.text } : { color: '#787b86' }}>
                  {item.isDensity && item.lifetimeSec > 0 ? (
                    <span className="flex items-center justify-end space-x-0.5">
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
