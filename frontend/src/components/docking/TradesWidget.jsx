/**
 * High-Performance Time & Sales (Trades Tape) Widget
 * Virtualized Canvas 2D engine capable of rendering 500+ prints/sec at 60 FPS without DOM lag.
 * Features institutional order flow visuals, mini volume bars, whale tracking, and color-channel linking.
 */

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Zap,
  Settings2,
  Volume2,
  VolumeX,
  Pause,
  Play,
  Trash2,
  ArrowDown,
  Filter,
  Radio
} from 'lucide-react';
import { useTradesStore, formatCompact, formatPrice } from '../../stores/tradesStore';
import { useColorLinksStore } from '../../stores/colorLinksStore';
import { useTradeAudioAlerts } from '../../hooks/useTradeAudioAlerts';
import ChannelSelector from './ChannelSelector';
import TradesSettings, { DEFAULT_TRADES_SETTINGS } from './TradesSettings';

const ROW_HEIGHT = 20;
const EMPTY_TRADES = [];

export default function TradesWidget(props) {
  const panelId = props?.api?.id || 'trades_main';
  const currentSymbol = useColorLinksStore((s) => s.getPanelSymbol(panelId, 'BTCUSDT'));

  // Settings from localStorage with fallback
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(`trades_settings_${panelId}`) || localStorage.getItem('trades_settings_default');
      if (saved) {
        return { ...DEFAULT_TRADES_SETTINGS, ...JSON.parse(saved) };
      }
    } catch (_) {}
    return DEFAULT_TRADES_SETTINGS;
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hoveredTrade, setHoveredTrade] = useState(null);

  // Canvas and scrolling refs
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const scrollOffsetRef = useRef(0); // 0 = newest at top
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const unreadCountRef = useRef(0);
  const unreadTimerRef = useRef(null);

  // Subscribe to symbol in trades store
  const subscribeSymbol = useTradesStore((s) => s.subscribeSymbol);
  const unsubscribeSymbol = useTradesStore((s) => s.unsubscribeSymbol);
  const clearTrades = useTradesStore((s) => s.clearTrades);
  const connectionStatus = useTradesStore((s) => s.connectionStatus[currentSymbol] || 'connecting');
  const allTrades = useTradesStore((s) => s.tradesBySymbol[currentSymbol] || EMPTY_TRADES);

  // Persist settings
  const handleUpdateSettings = (newSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem(`trades_settings_${panelId}`, JSON.stringify(newSettings));
      localStorage.setItem('trades_settings_default', JSON.stringify(newSettings));
    } catch (_) {}
  };

  // Audio Alerts (Whale Tracker)
  const { handleTradePrint, testSound } = useTradeAudioAlerts({
    enabled: settings.soundEnabled,
    thresholdL1: settings.soundLevel1Usd,
    thresholdL2: settings.soundLevel2Usd,
    thresholdL3: settings.soundLevel3Usd,
    maxSoundsPerSec: settings.maxSoundsPerSec
  });

  // Manage WebSocket subscription on symbol switch
  useEffect(() => {
    subscribeSymbol(currentSymbol, panelId);
    return () => {
      unsubscribeSymbol(currentSymbol, panelId);
    };
  }, [currentSymbol, panelId, subscribeSymbol, unsubscribeSymbol]);

  // Zero-latency raw listener for audio alerts
  useEffect(() => {
    const unsub = useTradesStore.getState().addTradeListener((trade) => {
      if (trade.symbol === currentSymbol) {
        handleTradePrint(trade);
        if (scrollOffsetRef.current > 0) {
          unreadCountRef.current = Math.min(999, unreadCountRef.current + 1);
          if (!unreadTimerRef.current) {
            unreadTimerRef.current = setTimeout(() => {
              unreadTimerRef.current = null;
              setUnreadCount(unreadCountRef.current);
            }, 250);
          }
        }
      }
    });
    return () => {
      unsub();
      if (unreadTimerRef.current) clearTimeout(unreadTimerRef.current);
    };
  }, [currentSymbol, handleTradePrint]);

  // Filter trades based on settings (memoized)
  const filteredTrades = useMemo(() => {
    if (!settings.minSizeUsd || settings.minSizeUsd <= 0) {
      return allTrades;
    }
    return allTrades.filter((t) => t.usd >= settings.minSizeUsd);
  }, [allTrades, settings.minSizeUsd]);

  // Frozen snapshot if paused
  const frozenTradesRef = useRef([]);
  useEffect(() => {
    if (!isPaused) {
      frozenTradesRef.current = filteredTrades;
    }
  }, [filteredTrades, isPaused]);

  const displayTrades = isPaused ? frozenTradesRef.current : filteredTrades;

  // Render Canvas 2D Loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.scale(dpr, dpr);

    const cssWidth = width / dpr;
    const cssHeight = height / dpr;

    // Clear background
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const trades = displayTrades;
    if (trades.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const msg = connectionStatus === 'connecting'
        ? 'Подключение к потоку сделок...'
        : settings.minSizeUsd > 0
          ? `Нет сделок ≥ $${formatCompact(settings.minSizeUsd)}`
          : 'Ожидание новых сделок...';
      ctx.fillText(msg, cssWidth / 2, cssHeight / 2);
      ctx.restore();
      return;
    }

    const startY = -scrollOffsetRef.current;
    const visibleRowCount = Math.ceil(cssHeight / ROW_HEIGHT) + 2;
    const startIndex = Math.max(0, Math.floor(scrollOffsetRef.current / ROW_HEIGHT));
    const endIndex = Math.min(trades.length, startIndex + visibleRowCount);

    // Dynamic column widths
    const timeColWidth = 58;
    const priceColWidth = 78;
    const sizeColWidth = cssWidth - timeColWidth - priceColWidth;

    // Determine max USD in visible slice for relative volume bar
    let maxVisibleUsd = 1000;
    for (let i = startIndex; i < endIndex; i++) {
      if (trades[i].usd > maxVisibleUsd) maxVisibleUsd = trades[i].usd;
    }

    // Draw rows
    for (let i = startIndex; i < endIndex; i++) {
      const trade = trades[i];
      const rowY = i * ROW_HEIGHT + startY;

      if (rowY + ROW_HEIGHT < 0 || rowY > cssHeight) continue;

      const isBuy = trade.side === 'BUY';
      const isMegaWhale = trade.usd >= settings.soundLevel3Usd;
      const isWhale = trade.usd >= settings.soundLevel2Usd;
      const isHighlighted = trade.usd >= settings.highlightThresholdUsd;

      // 1. Row background
      if (isMegaWhale) {
        ctx.fillStyle = isBuy ? 'rgba(234, 179, 8, 0.22)' : 'rgba(249, 115, 22, 0.22)';
      } else if (isWhale) {
        ctx.fillStyle = isBuy ? 'rgba(16, 185, 129, 0.24)' : 'rgba(239, 68, 68, 0.24)';
      } else if (isHighlighted) {
        ctx.fillStyle = isBuy ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)';
      } else {
        ctx.fillStyle = i % 2 === 0 ? '#0b0f17' : '#080a0f';
      }
      ctx.fillRect(0, rowY, cssWidth, ROW_HEIGHT);

      // 2. Mini volume bar in Size column (institutional tape visual)
      const barRatio = Math.min(1, trade.usd / Math.max(maxVisibleUsd, 10000));
      const barWidth = Math.max(2, (sizeColWidth - 10) * barRatio);
      ctx.fillStyle = isBuy ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)';
      ctx.fillRect(cssWidth - barWidth - 4, rowY + 2, barWidth, ROW_HEIGHT - 4);

      // Mega Whale left accent marker
      if (isMegaWhale) {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(0, rowY, 3, ROW_HEIGHT);
      } else if (isWhale) {
        ctx.fillStyle = isBuy ? '#10b981' : '#ef4444';
        ctx.fillRect(0, rowY, 2, ROW_HEIGHT);
      }

      // 3. Time Text
      const d = new Date(trade.time);
      const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(timeStr, 8, rowY + ROW_HEIGHT / 2);

      // 4. Price Text
      const priceStr = formatPrice(trade.price);
      ctx.fillStyle = isBuy ? '#10b981' : '#ef4444';
      ctx.font = isHighlighted || isWhale || isMegaWhale ? 'bold 10.5px monospace' : '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(priceStr, timeColWidth + priceColWidth - 8, rowY + ROW_HEIGHT / 2);

      // 5. Size Text
      let sizeStr = '';
      if (settings.sizeDisplayMode === 'COIN') {
        sizeStr = formatCompact(trade.size, 2);
      } else {
        sizeStr = `$${formatCompact(trade.usd, 1)}`;
      }

      if (isMegaWhale) {
        sizeStr += ' 🐋';
        ctx.fillStyle = '#f59e0b';
      } else if (isWhale) {
        ctx.fillStyle = isBuy ? '#34d399' : '#f87171';
      } else {
        ctx.fillStyle = isBuy ? '#a7f3d0' : '#fca5a5';
      }

      ctx.font = isHighlighted || isWhale || isMegaWhale ? 'bold 10.5px monospace' : '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(sizeStr, cssWidth - 8, rowY + ROW_HEIGHT / 2);

      // Subtle horizontal divider line
      ctx.fillStyle = '#141a26';
      ctx.fillRect(0, rowY + ROW_HEIGHT - 1, cssWidth, 1);
    }

    ctx.restore();
  }, [displayTrades, connectionStatus, settings]);

  // Resize canvas when container dimensions change
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      renderCanvas();
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);
    handleResize();

    return () => ro.disconnect();
  }, [renderCanvas]);

  // Rerender when trades update or settings change
  useEffect(() => {
    let animId = requestAnimationFrame(renderCanvas);
    return () => cancelAnimationFrame(animId);
  }, [renderCanvas]);

  // Handle Wheel Scrolling
  const handleWheel = (e) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const height = container.clientHeight;
    const maxScroll = Math.max(0, displayTrades.length * ROW_HEIGHT - height);
    const newOffset = Math.max(0, Math.min(maxScroll, scrollOffsetRef.current + e.deltaY));

    scrollOffsetRef.current = newOffset;
    const scrolled = newOffset > 10;
    setIsScrolledDown(scrolled);
    if (!scrolled) {
      setUnreadCount(0);
    }
    renderCanvas();
  };

  // Snap back to top (latest trades)
  const handleSnapToLatest = () => {
    scrollOffsetRef.current = 0;
    setIsScrolledDown(false);
    setUnreadCount(0);
    renderCanvas();
  };

  // Hover detection for status info
  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const index = Math.floor((mouseY + scrollOffsetRef.current) / ROW_HEIGHT);

    if (index >= 0 && index < displayTrades.length) {
      setHoveredTrade(displayTrades[index]);
    } else {
      setHoveredTrade(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredTrade(null);
  };

  return (
    <div
      data-testid="trades-widget"
      className="h-full w-full flex flex-col font-sans select-none bg-[#0a0d14] text-[#d1d4dc] border-r border-[#1a1f2c] overflow-hidden"
    >
      {/* 1. Header Toolbar */}
      <div className="h-6 px-2 bg-[#0d1017] border-b border-[#1b2130] flex items-center justify-between text-[10px] shrink-0 font-mono">
        <div className="flex items-center space-x-1.5">
          <Zap size={11} className="text-[#eab308]" />
          <span className="font-bold text-white text-[11px]">Лента сделок</span>
          <span className="text-[10px] text-[#38bdf8] font-bold">{currentSymbol}</span>

          {/* Connection status indicator */}
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus === 'connected'
                ? 'bg-[#10b981] shadow-[0_0_6px_#10b981]'
                : connectionStatus === 'connecting'
                  ? 'bg-[#f59e0b] animate-ping'
                  : 'bg-[#ef4444]'
            }`}
            title={`Статус: ${connectionStatus}`}
          />
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center space-x-1">
          {/* Quick Filter Pill */}
          {settings.minSizeUsd > 0 && (
            <span
              onClick={() => setIsSettingsOpen(true)}
              className="px-1.5 py-0.2 rounded bg-[#2563eb25] text-[#38bdf8] border border-[#2563eb50] text-[9px] cursor-pointer hover:bg-[#2563eb40]"
              title="Нажмите для изменения фильтра"
            >
              ≥ ${formatCompact(settings.minSizeUsd)}
            </span>
          )}

          {/* Sound Mute/Unmute Quick Toggle */}
          <button
            type="button"
            data-testid="btn-tape-toggle-sound"
            onClick={() => handleUpdateSettings({ ...settings, soundEnabled: !settings.soundEnabled })}
            className={`p-1 rounded transition cursor-pointer ${
              settings.soundEnabled
                ? 'text-[#10b981] hover:bg-[#10b98120]'
                : 'text-[#64748b] hover:bg-[#1e2536]'
            }`}
            title={settings.soundEnabled ? 'Whale Tracker: Звук включен' : 'Whale Tracker: Без звука'}
          >
            {settings.soundEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
          </button>

          {/* Pause / Resume tape */}
          <button
            type="button"
            data-testid="btn-tape-pause"
            onClick={() => setIsPaused(!isPaused)}
            className={`p-1 rounded transition cursor-pointer ${
              isPaused
                ? 'text-[#f59e0b] bg-[#f59e0b20] border border-[#f59e0b50]'
                : 'text-[#94a3b8] hover:text-white hover:bg-[#1e2536]'
            }`}
            title={isPaused ? 'Возобновить ленту' : 'Заморозить ленту (Пауза)'}
          >
            {isPaused ? <Play size={11} /> : <Pause size={11} />}
          </button>

          {/* Clear Tape */}
          <button
            type="button"
            data-testid="btn-tape-clear"
            onClick={() => clearTrades(currentSymbol)}
            className="p-1 rounded text-[#64748b] hover:text-[#ef4444] hover:bg-[#1e2536] transition cursor-pointer"
            title="Очистить историю ленты"
          >
            <Trash2 size={11} />
          </button>

          {/* Settings Modal Toggle */}
          <button
            type="button"
            data-testid="btn-tape-settings"
            onClick={() => setIsSettingsOpen(true)}
            className="p-1 rounded text-[#94a3b8] hover:text-white hover:bg-[#1e2536] transition cursor-pointer"
            title="Настройки фильтров и звука"
          >
            <Settings2 size={11} />
          </button>

          {/* Channel Selector */}
          <ChannelSelector panelId={panelId} />
        </div>
      </div>

      {/* 2. Column Headers */}
      <div className="h-5 px-2 bg-[#090b10] border-b border-[#141a26] flex items-center justify-between text-[9px] font-mono text-[#64748b] shrink-0">
        <span className="w-[58px]">Время</span>
        <span className="w-[78px] text-right">Цена</span>
        <span className="flex-1 text-right pr-2">
          {settings.sizeDisplayMode === 'COIN' ? 'Объем (COIN)' : 'Объем (USD)'}
        </span>
      </div>

      {/* 3. High-Performance Canvas Area */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="flex-1 min-h-0 relative w-full cursor-crosshair overflow-hidden"
      >
        <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />

        {/* Snap to latest floating pill when scrolled */}
        {isScrolledDown && (
          <button
            type="button"
            data-testid="btn-snap-latest-trades"
            onClick={handleSnapToLatest}
            className="absolute bottom-2 right-3 z-10 flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-lg text-[10px] font-mono cursor-pointer transition animate-bounce"
          >
            <ArrowDown size={10} />
            <span>Новые сделки</span>
            {unreadCount > 0 && (
              <span className="px-1 py-0.2 rounded-full bg-[#1e293b] text-[#38bdf8] text-[9px] font-bold">
                +{unreadCount}
              </span>
            )}
          </button>
        )}

        {/* Paused Overlay Banner */}
        {isPaused && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded bg-[#f59e0b] text-black font-bold text-[9.5px] font-mono shadow-md uppercase tracking-wider">
            Лента на паузе
          </div>
        )}
      </div>

      {/* 4. Mini Footer Status / Hover Inspector */}
      <div className="h-5 px-2 bg-[#080a0f] border-t border-[#141a26] flex items-center justify-between text-[9px] font-mono text-[#64748b] shrink-0">
        <div className="truncate">
          {hoveredTrade ? (
            <span className="space-x-2">
              <span className={hoveredTrade.side === 'BUY' ? 'text-[#10b981]' : 'text-[#ef4444]'}>
                {hoveredTrade.side}
              </span>
              <span className="text-white">${formatPrice(hoveredTrade.price)}</span>
              <span className="text-[#94a3b8]">{hoveredTrade.size} qty</span>
              <span className="text-[#eab308] font-bold">${Math.round(hoveredTrade.usd).toLocaleString()}</span>
            </span>
          ) : (
            <span>Сделок в буфере: {displayTrades.length}</span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span>{settings.soundEnabled ? '🔊 Звук вкл' : '🔇 Без звука'}</span>
        </div>
      </div>

      {/* 5. Settings Modal */}
      <TradesSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onTestSound={testSound}
      />
    </div>
  );
}
