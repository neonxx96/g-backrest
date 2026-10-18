import React, { useState, useEffect, useMemo } from 'react';
import { useMarketDataStore } from '../../stores/marketDataStore';
import { useColorLinksStore, COLOR_CHANNELS } from '../../stores/colorLinksStore';
import ChannelSelector from './ChannelSelector';
import { Search, ArrowUpDown, TrendingUp, TrendingDown, Radio } from 'lucide-react';

const formatVolume = (usd) => {
  if (!usd || usd <= 0) return '$0';
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(0)}K`;
  return `$${Math.round(usd)}`;
};

export default function WatchlistWidget({ panelId = 'watchlist_main' }) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('volume'); // 'volume' | 'gainers' | 'losers'
  const isConnected = useMarketDataStore((s) => s.isConnected);
  const tickersList = useMarketDataStore((s) => s.tickersList);
  const initStream = useMarketDataStore((s) => s.initMiniTickerStream);

  const boundChannel = useColorLinksStore((s) => s.panelBindings[panelId] || null);
  const activeChannelSymbol = useColorLinksStore((s) =>
    boundChannel ? s.channels[boundChannel] : null
  );
  const dispatchSymbolChange = useColorLinksStore((s) => s.dispatchSymbolChange);

  // Initialize single aggregate miniTicker stream on mount
  useEffect(() => {
    initStream();
  }, [initStream]);

  // Filter and sort items
  const sortedTickers = useMemo(() => {
    let list = tickersList;
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
    }
    return copy.slice(0, 80);
  }, [tickersList, search, sortBy]);

  const channelConfig = COLOR_CHANNELS.find((c) => c.id === boundChannel);

  return (
    <div
      data-testid="watchlist-widget"
      className="h-full flex flex-col font-sans select-none text-xs bg-[#0b0e14] text-[#d1d4dc] border-r border-[#1a1f2c]"
    >
      {/* Header bar: Search, Channel Selector, WS stream indicator */}
      <div className="px-2.5 py-1.5 border-b border-[#1f2638] bg-[#0f1420] flex items-center justify-between gap-1.5 shrink-0">
        <div className="flex items-center space-x-1.5 min-w-0">
          <div className="flex items-center space-x-1">
            <Radio
              size={11}
              className={isConnected ? 'text-[#10b981] animate-pulse' : 'text-[#64748b]'}
              title={
                isConnected
                  ? 'Binance Futures WS: !miniTicker@arr (Единый поток по всем парам)'
                  : 'Подключение к WebSocket...'
              }
            />
            <span className="font-bold text-[11px] text-white tracking-wide">Рынки</span>
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

      {/* Filter and sorting tabs */}
      <div className="px-2 py-1 border-b border-[#1b2130] bg-[#0d111b] flex items-center gap-1 shrink-0">
        <div className="relative flex-1">
          <Search size={11} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[#64748b]" />
          <input
            data-testid="watchlist-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск..."
            className="w-full pl-5 pr-2 py-0.5 rounded bg-[#07090f] border border-[#1e2536] text-[10px] text-white placeholder-[#64748b] outline-none focus:border-[#3b82f6]"
          />
        </div>

        {/* Sort modes */}
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
            title="Топ роста 24ч"
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
            title="Топ падения 24ч"
            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono flex items-center gap-0.5 transition cursor-pointer ${
              sortBy === 'losers' ? 'bg-[#ef444425] text-[#ef4444] font-bold' : 'text-[#64748b] hover:text-[#94a3b8]'
            }`}
          >
            <TrendingDown size={10} />
            <span>%</span>
          </button>
        </div>
      </div>

      {/* Table header */}
      <div className="px-2 py-1 bg-[#090c13] text-[#64748b] text-[9.5px] font-mono flex items-center justify-between border-b border-[#171c28] shrink-0">
        <span className="w-[84px]">ТИКЕР</span>
        <span className="w-[68px] text-right">ЦЕНА</span>
        <span className="w-[58px] text-right">24H %</span>
        <span className="w-[60px] text-right">ОБЪЕМ</span>
      </div>

      {/* Tickers list */}
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

            return (
              <div
                key={t.symbol}
                data-testid={`watchlist-row-${t.symbol}`}
                onClick={() => dispatchSymbolChange(panelId, t.symbol)}
                className={`px-2 py-1.5 flex items-center justify-between hover:bg-[#131926] cursor-pointer transition text-[10px] font-mono ${
                  isSelected ? 'bg-[#182338] border-l-2' : ''
                }`}
                style={{
                  borderLeftColor: isSelected ? (channelConfig?.color || '#3b82f6') : 'transparent'
                }}
              >
                {/* Ticker Name */}
                <div className="w-[84px] flex items-center space-x-1 truncate">
                  <span className="font-bold text-white text-[10.5px]">{baseName}</span>
                  <span className="text-[9px] text-[#64748b]">/USDT</span>
                </div>

                {/* Last Price */}
                <div className="w-[68px] text-right text-white font-medium">
                  {t.price >= 1000
                    ? t.price.toFixed(1)
                    : t.price >= 1
                    ? t.price.toFixed(2)
                    : t.price.toFixed(4)}
                </div>

                {/* 24h Change % */}
                <div
                  className={`w-[58px] text-right font-bold ${
                    isPos ? 'text-[#10b981]' : 'text-[#ef4444]'
                  }`}
                >
                  {sign}
                  {t.change24hPct?.toFixed(2)}%
                </div>

                {/* 24h Volume Usd */}
                <div className="w-[60px] text-right text-[#94a3b8] text-[9.5px]">
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
