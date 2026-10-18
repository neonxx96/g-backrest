/**
 * Advanced Screener (Market Watchlist Upgrade)
 * Real-time institutional screener for 350+ Binance Futures USDT-M pairs.
 * Features 24-hour Sparklines, Volatility metrics, volume rankings, and Color-Channel Linking.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useMarketDataStore } from '../../stores/marketDataStore';
import { useColorLinksStore, COLOR_CHANNELS } from '../../stores/colorLinksStore';
import ChannelSelector from './ChannelSelector';
import {
  Search,
  TrendingUp,
  TrendingDown,
  Activity,
  Flame,
  Radio,
  BarChart2,
  SlidersHorizontal
} from 'lucide-react';

const formatVolume = (usd) => {
  if (!usd || usd <= 0) return '$0';
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${Math.round(usd)}`;
};

// Global Sparkline cache so symbols only fetch once across panels
const sparklineCache = new Map();
const pendingFetches = new Set();

/**
 * Lightweight SVG Sparkline Component
 * Vector path with zero DOM bloat, GPU-accelerated rendering.
 */
function Sparkline({ points = [], isPositive = true, width = 54, height = 18 }) {
  if (!points || points.length < 2) {
    return <div style={{ width, height }} className="opacity-20" />;
  }

  const padding = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const w = width - padding * 2;
  const h = height - padding * 2;

  const coords = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * w;
    const y = height - padding - ((p - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${coords.join(' L ')}`;
  const strokeColor = isPositive ? '#10b981' : '#ef4444';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible block shrink-0"
    >
      <path
        d={pathD}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ScreenerWidget({ panelId = 'watchlist_main' }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('volume'); // 'volume' | 'gainers' | 'losers' | 'volatility' | 'price'
  const [, setSparklineVersion] = useState(0);

  const isConnected = useMarketDataStore((s) => s.isConnected);
  const tickersList = useMarketDataStore((s) => s.tickersList);
  const initStream = useMarketDataStore((s) => s.initMiniTickerStream);

  const boundChannel = useColorLinksStore((s) => s.panelBindings[panelId] || null);
  const activeChannelSymbol = useColorLinksStore((s) =>
    boundChannel ? s.channels[boundChannel] : null
  );
  const dispatchSymbolChange = useColorLinksStore((s) => s.dispatchSymbolChange);

  // Initialize market data stream on mount
  useEffect(() => {
    initStream();
  }, [initStream]);

  // Generate or fetch 24h sparkline points
  const getSparklinePoints = (ticker) => {
    const sym = ticker.symbol;
    if (sparklineCache.has(sym)) {
      return sparklineCache.get(sym);
    }

    // 1. Synthesize smooth spline based on 24h metrics immediately
    const open = ticker.open24h || ticker.price;
    const high = ticker.high24h || ticker.price;
    const low = ticker.low24h || ticker.price;
    const close = ticker.price || 1;
    const isUp = close >= open;

    const synthetic = [
      open,
      open + (isUp ? (high - open) * 0.2 : (low - open) * 0.3),
      open + (isUp ? (high - open) * 0.5 : (low - open) * 0.6),
      isUp ? low + (high - low) * 0.3 : high - (high - low) * 0.3,
      isUp ? high * 0.99 : low * 1.01,
      close
    ];

    sparklineCache.set(sym, synthetic);

    // 2. Fetch real 24h mini klines asynchronously
    if (!pendingFetches.has(sym)) {
      pendingFetches.add(sym);
      fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1h&limit=24`, {
        signal: AbortSignal.timeout(3000)
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((klines) => {
          if (Array.isArray(klines) && klines.length >= 8) {
            const closes = klines.map((k) => parseFloat(k[4]));
            sparklineCache.set(sym, closes);
            setSparklineVersion((v) => v + 1);
          }
        })
        .catch(() => {})
        .finally(() => {
          pendingFetches.delete(sym);
        });
    }

    return synthetic;
  };

  // Filter and sort items with Volatility metric
  const sortedTickers = useMemo(() => {
    let list = tickersList.map((t) => {
      // Calculate 24h volatility: (high - low) / low * 100
      const low = t.low24h || t.price || 1;
      const high = t.high24h || t.price || 1;
      const volatilityPct = low > 0 ? ((high - low) / low) * 100 : 0;
      return {
        ...t,
        volatilityPct: Number(volatilityPct.toFixed(2))
      };
    });

    if (search.trim()) {
      const q = search.trim().toUpperCase();
      list = list.filter((t) => t.symbol.includes(q));
    }

    const copy = [...list];
    if (sortBy === 'volume') {
      copy.sort((a, b) => (b.volumeUsd || 0) - (a.volumeUsd || 0));
    } else if (sortBy === 'gainers') {
      copy.sort((a, b) => (b.change24hPct || 0) - (a.change24hPct || 0));
    } else if (sortBy === 'losers') {
      copy.sort((a, b) => (a.change24hPct || 0) - (b.change24hPct || 0));
    } else if (sortBy === 'volatility') {
      copy.sort((a, b) => (b.volatilityPct || 0) - (a.volatilityPct || 0));
    } else if (sortBy === 'price') {
      copy.sort((a, b) => (b.price || 0) - (a.price || 0));
    }

    return copy.slice(0, 100);
  }, [tickersList, search, sortBy]);

  const channelConfig = COLOR_CHANNELS.find((c) => c.id === boundChannel);

  return (
    <div
      data-testid="screener-widget"
      className="h-full flex flex-col font-sans select-none text-xs bg-[#0b0e14] text-[#d1d4dc] border-r border-[#1a1f2c] overflow-hidden"
    >
      {/* 1. Header toolbar: WS Status, Title, Channel Selector */}
      <div className="px-2.5 py-1.5 border-b border-[#1f2638] bg-[#0f1420] flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <div className="flex items-center space-x-1">
            <Radio
              size={11}
              className={isConnected ? 'text-[#10b981] animate-pulse' : 'text-[#64748b]'}
              title={
                isConnected
                  ? 'Binance Futures WS: !miniTicker@arr (Скринер 350+ инструментов)'
                  : 'Подключение к WebSocket...'
              }
            />
            <span className="font-bold text-[11px] text-white tracking-wide">Скринер рынка</span>
          </div>
          <span className="text-[9.5px] text-[#64748b] font-mono">
            ({sortedTickers.length})
          </span>
        </div>

        {/* Color linking pill */}
        <div className="flex items-center space-x-1 shrink-0">
          <ChannelSelector panelId={panelId} />
        </div>
      </div>

      {/* 2. Filter, Search & Sort Tabs */}
      <div className="px-2 py-1 border-b border-[#1b2130] bg-[#0d111b] flex items-center gap-1 shrink-0">
        {/* Search input */}
        <div className="relative flex-1">
          <Search size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#64748b]" />
          <input
            data-testid="screener-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск монеты..."
            className="w-full pl-5 pr-2 py-0.5 rounded bg-[#07090f] border border-[#1e2536] text-[10px] text-white placeholder-[#64748b] outline-none focus:border-[#38bdf8]"
          />
        </div>

        {/* Sort modes pills */}
        <div className="flex items-center rounded bg-[#07090f] border border-[#1e2536] p-0.5 shrink-0">
          <button
            type="button"
            data-testid="sort-volume"
            onClick={() => setSortBy('volume')}
            title="Сортировка по объему 24ч"
            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono transition cursor-pointer ${
              sortBy === 'volume' ? 'bg-[#1e283d] text-white font-bold' : 'text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            Объем
          </button>
          <button
            type="button"
            data-testid="sort-gainers"
            onClick={() => setSortBy('gainers')}
            title="Лидеры роста 24ч"
            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono flex items-center gap-0.5 transition cursor-pointer ${
              sortBy === 'gainers' ? 'bg-[#10b98125] text-[#10b981] font-bold' : 'text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            <TrendingUp size={10} />
            <span>%</span>
          </button>
          <button
            type="button"
            data-testid="sort-losers"
            onClick={() => setSortBy('losers')}
            title="Лидеры падения 24ч"
            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono flex items-center gap-0.5 transition cursor-pointer ${
              sortBy === 'losers' ? 'bg-[#ef444425] text-[#ef4444] font-bold' : 'text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            <TrendingDown size={10} />
            <span>%</span>
          </button>
          <button
            type="button"
            data-testid="sort-volatility"
            onClick={() => setSortBy('volatility')}
            title="Сортировка по 24ч волатильности (High/Low спред)"
            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono flex items-center gap-0.5 transition cursor-pointer ${
              sortBy === 'volatility' ? 'bg-[#f59e0b25] text-[#f59e0b] font-bold' : 'text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            <Activity size={10} />
            <span>Волат</span>
          </button>
        </div>
      </div>

      {/* 3. Table Column Headers */}
      <div className="px-2 py-1 bg-[#090c13] text-[#64748b] text-[9px] font-mono flex items-center justify-between border-b border-[#171c28] shrink-0">
        <span className="w-[74px]">ТИКЕР</span>
        <span className="w-[62px] text-right">ЦЕНА</span>
        <span className="w-[52px] text-right">24H %</span>
        <span className="w-[58px] text-center">СПАРК</span>
        <span className="w-[50px] text-right">ВОЛАТ</span>
        <span className="w-[56px] text-right">ОБЪЕМ</span>
      </div>

      {/* 4. Virtualized Tickers List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#131722] min-h-0">
        {sortedTickers.length === 0 ? (
          <div className="p-4 text-center text-[#64748b] text-[10px] font-mono">
            {isConnected ? 'Символы не найдены' : 'Подключение к !miniTicker@arr...'}
          </div>
        ) : (
          sortedTickers.map((t) => {
            const isSelected = activeChannelSymbol === t.symbol;
            const isPos = (t.change24hPct || 0) >= 0;
            const sign = isPos ? '+' : '';
            const baseName = t.symbol.replace('USDT', '');
            const sparkPoints = getSparklinePoints(t);

            return (
              <div
                key={t.symbol}
                data-testid={`screener-row-${t.symbol}`}
                onClick={() => dispatchSymbolChange(panelId, t.symbol)}
                className={`px-2 py-1.5 flex items-center justify-between hover:bg-[#131926] cursor-pointer transition text-[10px] font-mono ${
                  isSelected ? 'bg-[#182338] border-l-2' : ''
                }`}
                style={{
                  borderLeftColor: isSelected ? (channelConfig?.color || '#3b82f6') : 'transparent'
                }}
              >
                {/* 1. Ticker Name */}
                <div className="w-[74px] flex items-center space-x-1 truncate">
                  <span className="font-bold text-white text-[10.5px]">{baseName}</span>
                  <span className="text-[9px] text-[#64748b]">/USDT</span>
                </div>

                {/* 2. Last Price */}
                <div className="w-[62px] text-right text-white font-medium">
                  {t.price >= 1000
                    ? t.price.toFixed(1)
                    : t.price >= 1
                    ? t.price.toFixed(2)
                    : t.price.toFixed(4)}
                </div>

                {/* 3. 24h Change % */}
                <div
                  className={`w-[52px] text-right font-bold ${
                    isPos ? 'text-[#10b981]' : 'text-[#ef4444]'
                  }`}
                >
                  {sign}
                  {t.change24hPct?.toFixed(2)}%
                </div>

                {/* 4. Sparkline 24h mini-chart */}
                <div className="w-[58px] flex items-center justify-center">
                  <Sparkline points={sparkPoints} isPositive={isPos} width={50} height={16} />
                </div>

                {/* 5. Volatility % */}
                <div className="w-[50px] text-right text-[#f59e0b] font-medium text-[9.5px]">
                  {t.volatilityPct?.toFixed(1)}%
                </div>

                {/* 6. 24h Volume USD */}
                <div className="w-[56px] text-right text-[#94a3b8] text-[9.5px]">
                  {formatVolume(t.volumeUsd)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
