import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Activity, Filter, ArrowUpRight, ArrowDownRight, Zap, X } from 'lucide-react';

const FILTER_PRESETS = [
  { label: 'Все', value: 0 },
  { label: '>$1k', value: 1000 },
  { label: '>$5k', value: 5000 },
  { label: '>$10k', value: 10000 },
  { label: '>$50k', value: 50000 },
  { label: '>$100k', value: 100000 },
];

export default function Tape({ symbol = "BTCUSDT", uiConfig = null, onClose = null }) {
  const [trades, setTrades] = useState([]);
  const [minUsd, setMinUsd] = useState(uiConfig?.tapeMinUsd ?? 5000); // Default filter: $5,000
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    if (uiConfig?.tapeMinUsd != null) {
      setMinUsd(Number(uiConfig.tapeMinUsd));
    }
  }, [uiConfig?.tapeMinUsd]);

  // Buffer incoming trades and throttle updates for high-speed performance (60fps)
  const incomingBuffer = useRef([]);
  const throttleTimer = useRef(null);

  useEffect(() => {
    setTrades([]);
    incomingBuffer.current = [];

    const cleanSym = symbol.toLowerCase();
    const upperSym = symbol.toUpperCase();

    // 1. Initial snapshot of recent trades from Binance REST
    fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${upperSym}&limit=60`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const parsed = data.map(t => {
            const price = parseFloat(t.p);
            const qty = parseFloat(t.q);
            return {
              id: t.a ?? `${t.T}-${t.p}-${t.q}`,
              time: Number(t.T) || Date.now(),
              price,
              qty,
              usd: price * qty,
              isBuy: !t.m
            };
          });
          setTrades(parsed.reverse());
        }
      })
      .catch(e => console.warn("Initial aggTrades fetch error:", e));

    // 2. Real-time WebSocket connection
    const wsUrl = `wss://fstream.binance.com/ws/${cleanSym}@aggTrade`;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const t = JSON.parse(event.data);
          if (!t.p || !t.q) return;

          const price = parseFloat(t.p);
          const qty = parseFloat(t.q);
          const usd = price * qty;
          const isBuy = !t.m; // m=false means buyer is maker? No, m is "isBuyerMaker". When true, buyer is maker -> taker sold (Sell). When false, buyer is taker (Buy).
          const time = Number(t.T) || Date.now();

          incomingBuffer.current.push({
            id: t.a ?? `${time}-${t.p}-${t.q}`,
            time,
            price,
            qty,
            usd,
            isBuy
          });
        } catch (_) {}
      };
    } catch (e) {
      console.warn("Tape WebSocket error:", e);
    }

    // Process buffer every 100ms
    throttleTimer.current = setInterval(() => {
      if (incomingBuffer.current.length > 0) {
        const batch = incomingBuffer.current;
        incomingBuffer.current = [];

        setTrades(prev => {
          // Prepend new trades (latest at top), keep last 80
          const updated = [...batch.reverse(), ...prev];
          return updated.slice(0, 80);
        });
      }
    }, 100);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (throttleTimer.current) {
        clearInterval(throttleTimer.current);
        throttleTimer.current = null;
      }
    };
  }, [symbol]);

  const filteredTrades = useMemo(() => {
    return trades.filter(t => t.usd >= minUsd);
  }, [trades, minUsd]);

  const formatPrice = (p) => {
    if (p >= 1000) return p.toFixed(1);
    if (p >= 1) return p.toFixed(2);
    if (p >= 0.01) return p.toFixed(4);
    return p.toFixed(6);
  };

  const formatTime = (ts) => {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  };

  const formatUsd = (usd) => {
    if (usd >= 1000000) return `$${(usd / 1000000).toFixed(2)}M`;
    if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
    return `$${usd.toFixed(0)}`;
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-main)',
        fontVariantNumeric: 'tabular-nums'
      }}
      className="flex flex-col h-full border overflow-hidden text-xs select-none relative font-sans"
    >
      {/* Header Bar (Tealstreet / Bloomberg compact style) */}
      <div
        style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-2 py-1 border-b"
      >
        <div className="flex items-center space-x-1 font-bold text-white text-[11px] truncate">
          <Zap size={12} className="text-[#f59e0b] shrink-0" />
          <span>Лента</span>
        </div>

        {/* Filter Threshold Pill & Menu + Close [×] */}
        <div className="flex items-center space-x-1 relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#08090c] hover:bg-[#161820] text-[#ff9800] border border-[#1f2430] font-mono text-[9px] transition cursor-pointer"
            title="Фильтр размера сделок"
          >
            <Filter size={9} />
            <span>{minUsd >= 1000 ? `≥$${minUsd / 1000}k` : 'Все'}</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-0.5 rounded text-[#60697b] hover:text-[#ef5350] hover:bg-[#ef535018] transition cursor-pointer"
              title="Скрыть виджет ленты сделок"
            >
              <X size={12} />
            </button>
          )}

          {showFilterMenu && (
            <div 
              className="absolute right-0 top-6 z-30 bg-[#101217] border border-[#1f2430] rounded shadow-2xl p-1 w-28 space-y-0.5 font-mono text-[10px]"
              onMouseLeave={() => setShowFilterMenu(false)}
            >
              <div className="px-1.5 py-0.5 text-[9px] text-[#60697b] uppercase font-semibold">
                Мин. объем ($)
              </div>
              {FILTER_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  onClick={() => {
                    setMinUsd(preset.value);
                    setShowFilterMenu(false);
                  }}
                  className={`w-full text-left px-1.5 py-0.5 rounded transition ${minUsd === preset.value ? 'bg-[#2563eb] text-white font-bold' : 'hover:bg-[#161820] text-[#d1d4dc]'}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-2 py-0.5 text-[9px] text-[#60697b] font-semibold uppercase border-b border-[#161922] bg-[#090b0f] font-mono">
        <span>Время</span>
        <span className="text-right">Цена</span>
        <span className="text-right">Объем $</span>
      </div>

      {/* Trades Stream Ladder */}
      <div className="flex-1 overflow-y-auto font-mono text-[10.5px] divide-y divide-[#13161f]">
        {filteredTrades.map(trade => {
          const isLarge = trade.usd >= 50000;
          const isWhale = trade.usd >= 250000;

          return (
            <div
              key={trade.id}
              className={`grid grid-cols-3 px-2 py-0.5 items-center hover:bg-[#161922] transition-colors relative ${
                isWhale 
                  ? (trade.isBuy ? 'bg-[#26a69a25] border-l-2 border-[#26a69a]' : 'bg-[#ef535025] border-l-2 border-[#ef5350]') 
                  : (isLarge ? (trade.isBuy ? 'bg-[#26a69a10]' : 'bg-[#ef535010]') : '')
              }`}
            >
              {/* Time */}
              <span className="text-[#60697b] text-[9.5px]">
                {formatTime(trade.time)}
              </span>

              {/* Price */}
              <span className={`text-right font-semibold font-mono-numbers ${trade.isBuy ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {formatPrice(trade.price)}
              </span>

              {/* Volume USD */}
              <span className={`text-right font-mono-numbers ${isLarge ? 'font-bold' : ''} ${trade.isBuy ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {formatUsd(trade.usd)}
              </span>
            </div>
          );
        })}

        {filteredTrades.length === 0 && (
          <div className="py-8 text-center text-[#60697b] text-[10px] font-mono">
            Ожидание сделок ≥ ${minUsd.toLocaleString()}...
          </div>
        )}
      </div>
    </div>
  );
}
