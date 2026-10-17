import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ShieldAlert,
  DollarSign,
  Crosshair,
  Zap,
  XCircle,
  TrendingUp,
  TrendingDown,
  Layers,
  X
} from 'lucide-react';
import { soundManager } from '../utils/sound';

const VOLUME_PRESETS = [500, 1000, 5000, 10000];
const RISK_PRESETS = [10, 20, 50, 100];

const fmtUsd = (val, decimals = 2) => {
  if (val == null || Number.isNaN(Number(val))) return '$0.00';
  const num = Number(val);
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
};

export default function ScalperTradeDesk({
  symbol = 'BTCUSDT',
  marketSummary = null,
  onOrdersChange = null,
  onClose = null
}) {
  // Sizing mode: 'fixed_volume' ("Фиксированный объем ($)") | 'fixed_risk' ("Фиксированный риск ($ на стоп)")
  const [sizingMode, setSizingMode] = useState('fixed_volume');
  const [fixedVolumeUsd, setFixedVolumeUsd] = useState(1000);
  const [riskPerStopUsd, setRiskPerStopUsd] = useState(20);
  const [slSidePreference, setSlSidePreference] = useState('BID'); // 'BID' (for Long SL) | 'ASK' (for Short SL)

  // Paper Trading state: active open position & active working limit orders
  const [position, setPosition] = useState(null); // { symbol, side: 'LONG'|'SHORT', entryPrice, sizeUsd, qty, stopPrice, openedAt }
  const [limitOrders, setLimitOrders] = useState([]); // [{ id, symbol, side: 'BUY'|'SELL', price, sizeUsd, qty, wallPrice, createdAt }]
  const [realizedPnlUsd, setRealizedPnlUsd] = useState(0);

  // Price override for deterministic testing / tick simulation + live market feed
  const [simulatedTickPrice, setSimulatedTickPrice] = useState(null);

  // Reset simulated tick & symbol-specific position on symbol change
  useEffect(() => {
    setSimulatedTickPrice(null);
    setPosition(null);
    setLimitOrders([]);
  }, [symbol]);

  const fallbackPrice = useMemo(() => {
    if (symbol.includes('BTC')) return 81280.0;
    if (symbol.includes('ETH')) return 2620.0;
    if (symbol.includes('SOL')) return 165.0;
    return 100.0;
  }, [symbol]);

  const currentPrice = useMemo(() => {
    if (simulatedTickPrice != null && simulatedTickPrice > 0) {
      return Number(simulatedTickPrice);
    }
    if (marketSummary?.currentPrice > 0) {
      return Number(marketSummary.currentPrice);
    }
    return fallbackPrice;
  }, [simulatedTickPrice, marketSummary?.currentPrice, fallbackPrice]);

  const stepSize = useMemo(() => {
    if (marketSummary?.stepSize > 0) return Number(marketSummary.stepSize);
    if (symbol.includes('BTC')) return 1.0;
    if (symbol.includes('ETH')) return 0.1;
    return 0.01;
  }, [marketSummary?.stepSize, symbol]);

  const priceDecimals = useMemo(() => {
    if (marketSummary?.priceDecimals != null) return marketSummary.priceDecimals;
    if (stepSize >= 1) return 1;
    const str = stepSize.toFixed(8).replace(/0+$/, '');
    const dot = str.indexOf('.');
    return dot >= 0 ? str.length - dot - 1 : 2;
  }, [marketSummary?.priceDecimals, stepSize]);

  // Nearest Bid & Ask walls from DOM (with realistic fallback if orderbook hasn't loaded yet)
  const nearestBidWall = useMemo(() => {
    if (
      marketSummary?.nearestBidWall?.price > 0 &&
      marketSummary.nearestBidWall.price <= currentPrice - stepSize * 2
    ) {
      return marketSummary.nearestBidWall;
    }
    const p = Number((currentPrice - stepSize * 6).toFixed(priceDecimals));
    return { price: p, usd: 1250000, lifeSec: 42 };
  }, [marketSummary?.nearestBidWall, currentPrice, stepSize, priceDecimals]);

  const nearestAskWall = useMemo(() => {
    if (
      marketSummary?.nearestAskWall?.price > 0 &&
      marketSummary.nearestAskWall.price >= currentPrice + stepSize * 2
    ) {
      return marketSummary.nearestAskWall;
    }
    const p = Number((currentPrice + stepSize * 6).toFixed(priceDecimals));
    return { price: p, usd: 1400000, lifeSec: 38 };
  }, [marketSummary?.nearestAskWall, currentPrice, stepSize, priceDecimals]);

  // Target Stop-Loss wall used for Risk-Based Position Sizing
  const activeStopWall = useMemo(() => {
    if (position?.side === 'SHORT') return nearestAskWall;
    if (position?.side === 'LONG') return nearestBidWall;
    return slSidePreference === 'ASK' ? nearestAskWall : nearestBidWall;
  }, [position?.side, slSidePreference, nearestBidWall, nearestAskWall]);

  // Risk-based position calculation:
  // Distance from currentPrice to nearest wall (SL):
  // Position Size ($) = Risk ($) / (|CurrentPrice - StopWallPrice| / CurrentPrice)
  const riskCalculation = useMemo(() => {
    const slPrice = activeStopWall?.price || currentPrice * 0.998;
    const rawDistAbs = Math.abs(currentPrice - slPrice);
    // Minimum safe distance of 1 stepSize or 0.02% to prevent division by zero
    const safeDistAbs = Math.max(rawDistAbs, stepSize, currentPrice * 0.0002);
    const distPct = (safeDistAbs / currentPrice) * 100;
    const validRiskUsd = Math.max(1, Number(riskPerStopUsd) || 20);
    const calculatedVolumeUsd = validRiskUsd / (safeDistAbs / currentPrice);
    const calculatedQty = calculatedVolumeUsd / currentPrice;

    return {
      slPrice,
      distAbs: safeDistAbs,
      distPct,
      riskUsd: validRiskUsd,
      calculatedVolumeUsd: Math.round(calculatedVolumeUsd * 100) / 100,
      calculatedQty
    };
  }, [activeStopWall, currentPrice, stepSize, riskPerStopUsd]);

  // Effective Order Size ($) and Qty based on selected mode
  const effectiveVolumeUsd = useMemo(() => {
    if (sizingMode === 'fixed_risk') {
      return riskCalculation.calculatedVolumeUsd;
    }
    return Math.max(10, Number(fixedVolumeUsd) || 1000);
  }, [sizingMode, riskCalculation.calculatedVolumeUsd, fixedVolumeUsd]);

  const effectiveQty = useMemo(() => {
    return currentPrice > 0 ? effectiveVolumeUsd / currentPrice : 0;
  }, [effectiveVolumeUsd, currentPrice]);

  // Notify parent (DOM ladder) when active limit orders change
  useEffect(() => {
    if (onOrdersChange) {
      onOrdersChange(limitOrders);
    }
  }, [limitOrders, onOrdersChange]);

  // Auto-fill working limit orders if currentPrice crosses their limit price
  useEffect(() => {
    if (!limitOrders.length || currentPrice <= 0) return;
    const remaining = [];
    let filledOrder = null;

    for (const ord of limitOrders) {
      if (ord.side === 'BUY' && currentPrice <= ord.price) {
        filledOrder = ord;
      } else if (ord.side === 'SELL' && currentPrice >= ord.price) {
        filledOrder = ord;
      } else {
        remaining.push(ord);
      }
    }

    if (filledOrder) {
      setLimitOrders(remaining);
      setPosition({
        symbol,
        side: filledOrder.side === 'BUY' ? 'LONG' : 'SHORT',
        entryPrice: filledOrder.price,
        sizeUsd: filledOrder.sizeUsd,
        qty: filledOrder.qty,
        stopPrice: filledOrder.wallPrice,
        openedAt: Date.now()
      });
      soundManager.playSignalAlert(filledOrder.side === 'BUY' ? 'BULLISH' : 'BEARISH');
    }
  }, [currentPrice, limitOrders, symbol]);

  // Calculate live PnL ($ and %) for open position
  const livePnl = useMemo(() => {
    if (!position || !position.entryPrice || currentPrice <= 0) {
      return { pnlUsd: 0, pnlPct: 0, unrealizedUsd: 0 };
    }
    const priceDiff =
      position.side === 'LONG'
        ? currentPrice - position.entryPrice
        : position.entryPrice - currentPrice;
    const pnlPct = (priceDiff / position.entryPrice) * 100;
    const pnlUsd = position.qty * priceDiff;
    return {
      pnlUsd,
      pnlPct,
      unrealizedUsd: pnlUsd
    };
  }, [position, currentPrice]);

  // Market BUY action (Hotkey 'Q')
  const handleMarketBuy = useCallback(() => {
    const entry = marketSummary?.bestAsk > 0 && simulatedTickPrice == null
      ? Number(marketSummary.bestAsk)
      : currentPrice;
    const sizeUsd = effectiveVolumeUsd;
    const qty = entry > 0 ? sizeUsd / entry : 0;
    const stopPrice = nearestBidWall?.price || Number((entry * 0.998).toFixed(priceDecimals));

    setSlSidePreference('BID');
    setPosition({
      symbol,
      side: 'LONG',
      entryPrice: entry,
      sizeUsd,
      qty,
      stopPrice,
      openedAt: Date.now()
    });
    soundManager.playSignalAlert('BULLISH');
  }, [marketSummary?.bestAsk, simulatedTickPrice, currentPrice, effectiveVolumeUsd, nearestBidWall, priceDecimals, symbol]);

  // Market SELL action (Hotkey 'W')
  const handleMarketSell = useCallback(() => {
    const entry = marketSummary?.bestBid > 0 && simulatedTickPrice == null
      ? Number(marketSummary.bestBid)
      : currentPrice;
    const sizeUsd = effectiveVolumeUsd;
    const qty = entry > 0 ? sizeUsd / entry : 0;
    const stopPrice = nearestAskWall?.price || Number((entry * 1.002).toFixed(priceDecimals));

    setSlSidePreference('ASK');
    setPosition({
      symbol,
      side: 'SHORT',
      entryPrice: entry,
      sizeUsd,
      qty,
      stopPrice,
      openedAt: Date.now()
    });
    soundManager.playSignalAlert('BEARISH');
  }, [marketSummary?.bestBid, simulatedTickPrice, currentPrice, effectiveVolumeUsd, nearestAskWall, priceDecimals, symbol]);

  // Limit Order in front of BID Wall (Long before wall)
  const handleLimitBeforeBidWall = useCallback(() => {
    setSlSidePreference('BID');
    const wallPrice = nearestBidWall.price;
    const limitPrice = Number((wallPrice + stepSize).toFixed(priceDecimals));
    const distAbs = Math.max(stepSize, Math.abs(limitPrice - wallPrice));
    const sizeUsd =
      sizingMode === 'fixed_risk'
        ? Math.round(((Math.max(1, Number(riskPerStopUsd) || 20) * limitPrice) / distAbs) * 100) / 100
        : effectiveVolumeUsd;
    const qty = limitPrice > 0 ? sizeUsd / limitPrice : 0;

    const newOrd = {
      id: `lmt-bid-${Date.now()}`,
      symbol,
      side: 'BUY',
      price: limitPrice,
      wallPrice,
      sizeUsd,
      qty,
      createdAt: Date.now()
    };
    setLimitOrders((prev) => [newOrd, ...prev.filter((o) => o.side !== 'BUY')]);
  }, [nearestBidWall, stepSize, priceDecimals, sizingMode, riskPerStopUsd, effectiveVolumeUsd, symbol]);

  // Limit Order in front of ASK Wall (Short before wall)
  const handleLimitBeforeAskWall = useCallback(() => {
    setSlSidePreference('ASK');
    const wallPrice = nearestAskWall.price;
    const limitPrice = Number((wallPrice - stepSize).toFixed(priceDecimals));
    const distAbs = Math.max(stepSize, Math.abs(wallPrice - limitPrice));
    const sizeUsd =
      sizingMode === 'fixed_risk'
        ? Math.round(((Math.max(1, Number(riskPerStopUsd) || 20) * limitPrice) / distAbs) * 100) / 100
        : effectiveVolumeUsd;
    const qty = limitPrice > 0 ? sizeUsd / limitPrice : 0;

    const newOrd = {
      id: `lmt-ask-${Date.now()}`,
      symbol,
      side: 'SELL',
      price: limitPrice,
      wallPrice,
      sizeUsd,
      qty,
      createdAt: Date.now()
    };
    setLimitOrders((prev) => [newOrd, ...prev.filter((o) => o.side !== 'SELL')]);
  }, [nearestAskWall, stepSize, priceDecimals, sizingMode, riskPerStopUsd, effectiveVolumeUsd, symbol]);

  // Cancel all working limit orders (Hotkey 'E')
  const handleCancelAllLimits = useCallback(() => {
    setLimitOrders([]);
  }, []);

  // Close all positions & cancel limits
  const handleCloseAll = useCallback(() => {
    if (position) {
      setRealizedPnlUsd((prev) => prev + livePnl.pnlUsd);
      setPosition(null);
    }
    setLimitOrders([]);
  }, [position, livePnl.pnlUsd]);

  // Global hotkeys Q (Buy Market), W (Sell Market), E (Cancel All Limits)
  const handlersRef = useRef({
    handleMarketBuy,
    handleMarketSell,
    handleCancelAllLimits
  });
  useEffect(() => {
    handlersRef.current = {
      handleMarketBuy,
      handleMarketSell,
      handleCancelAllLimits
    };
  }, [handleMarketBuy, handleMarketSell, handleCancelAllLimits]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'q' || key === 'й') {
        e.preventDefault();
        handlersRef.current.handleMarketBuy();
      } else if (key === 'w' || key === 'ц') {
        e.preventDefault();
        handlersRef.current.handleMarketSell();
      } else if (key === 'e' || key === 'у') {
        e.preventDefault();
        handlersRef.current.handleCancelAllLimits();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Expose API on window.__scalperDesk for automated Playwright E2E verification
  useEffect(() => {
    window.__scalperDesk = {
      symbol,
      sizingMode,
      fixedVolumeUsd,
      riskPerStopUsd,
      currentPrice,
      nearestBidWall,
      nearestAskWall,
      riskCalculation,
      effectiveVolumeUsd,
      effectiveQty,
      position,
      limitOrders,
      livePnl,
      realizedPnlUsd,
      setSimulatedPrice: (p) => setSimulatedTickPrice(p != null ? Number(p) : null),
      marketBuy: handleMarketBuy,
      marketSell: handleMarketSell,
      limitBidWall: handleLimitBeforeBidWall,
      limitAskWall: handleLimitBeforeAskWall,
      cancelLimits: handleCancelAllLimits,
      closeAll: handleCloseAll
    };
  }, [
    symbol,
    sizingMode,
    fixedVolumeUsd,
    riskPerStopUsd,
    currentPrice,
    nearestBidWall,
    nearestAskWall,
    riskCalculation,
    effectiveVolumeUsd,
    effectiveQty,
    position,
    limitOrders,
    livePnl,
    realizedPnlUsd,
    handleMarketBuy,
    handleMarketSell,
    handleLimitBeforeBidWall,
    handleLimitBeforeAskWall,
    handleCancelAllLimits,
    handleCloseAll
  ]);

  return (
    <div
      data-testid="scalper-trade-desk"
      style={{
        backgroundColor: 'var(--bg-panel)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--text-main)',
        fontVariantNumeric: 'tabular-nums'
      }}
      className="flex flex-col border rounded-xs p-1.5 mb-1 text-[10.5px] font-mono select-none shrink-0 space-y-1.5"
    >
      {/* Header Row: Title, Hotkey Legend, Close [×] */}
      <div className="flex items-center justify-between border-b border-[#191e2b] pb-1">
        <div className="flex items-center space-x-1.5">
          <Zap size={11} className="text-[#ffb300]" />
          <span className="font-bold text-white tracking-tight text-[10.5px] font-sans">
            Scalper Trade Desk
          </span>
          <span className="px-1 py-0.2 rounded bg-[#141c2b] text-[#38bdf8] border border-[#38bdf840] text-[8.5px]">
            PAPER
          </span>
        </div>

        <div className="flex items-center space-x-1.5 text-[9px] text-[#787f91]">
          <span title="Горячие клавиши быстрой торговли">
            [Q] Buy • [W] Sell • [E] Отмена
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-0.5 rounded text-[#60697b] hover:text-[#ef5350] hover:bg-[#ef535018] transition cursor-pointer"
              title="Скрыть Scalper Trade Desk"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Mode Switcher: Фиксированный объем ($) vs Фиксированный риск ($ на стоп) */}
      <div className="grid grid-cols-2 gap-1 bg-[#080a0f] p-0.5 rounded border border-[#161a26]">
        <button
          data-testid="mode-fixed-volume"
          onClick={() => setSizingMode('fixed_volume')}
          className={`py-0.5 px-1.5 rounded text-[9.5px] font-sans transition cursor-pointer truncate ${
            sizingMode === 'fixed_volume'
              ? 'bg-[#2563eb] text-white font-bold shadow-xs'
              : 'text-[#787f91] hover:text-white'
          }`}
        >
          Фиксированный объем ($)
        </button>
        <button
          data-testid="mode-fixed-risk"
          onClick={() => setSizingMode('fixed_risk')}
          className={`py-0.5 px-1.5 rounded text-[9.5px] font-sans transition cursor-pointer truncate ${
            sizingMode === 'fixed_risk'
              ? 'bg-[#d97706] text-white font-bold shadow-xs'
              : 'text-[#787f91] hover:text-white'
          }`}
        >
          Фиксированный риск ($ на стоп)
        </button>
      </div>

      {/* Sizing Input + Quick Volume Presets ($500, $1,000, $5,000, $10,000) */}
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center space-x-1 flex-1 min-w-0">
          {sizingMode === 'fixed_volume' ? (
            <>
              <DollarSign size={11} className="text-[#38bdf8] shrink-0" />
              <span className="text-[#787f91] text-[9.5px] shrink-0">Объем:</span>
              <input
                data-testid="input-fixed-volume"
                type="number"
                min="10"
                step="100"
                value={fixedVolumeUsd}
                onChange={(e) => setFixedVolumeUsd(Math.max(0, Number(e.target.value)))}
                className="w-20 bg-[#080a0f] border border-[#1f2430] focus:border-[#38bdf8] rounded px-1.5 py-0.5 text-white font-bold text-right outline-none text-[10.5px]"
              />
            </>
          ) : (
            <>
              <ShieldAlert size={11} className="text-[#ffb300] shrink-0" />
              <span className="text-[#787f91] text-[9.5px] shrink-0">Риск ($):</span>
              <input
                data-testid="input-risk-usd"
                type="number"
                min="1"
                step="5"
                value={riskPerStopUsd}
                onChange={(e) => setRiskPerStopUsd(Math.max(1, Number(e.target.value)))}
                className="w-16 bg-[#080a0f] border border-[#ffb30060] focus:border-[#ffb300] rounded px-1.5 py-0.5 text-[#ffb300] font-bold text-right outline-none text-[10.5px]"
              />
              <div className="flex items-center space-x-0.5">
                {RISK_PRESETS.map((r) => (
                  <button
                    key={r}
                    data-testid={`risk-preset-${r}`}
                    onClick={() => setRiskPerStopUsd(r)}
                    className={`px-1 py-0.5 rounded text-[8.5px] border transition cursor-pointer ${
                      Number(riskPerStopUsd) === r
                        ? 'bg-[#ffb30025] border-[#ffb300] text-[#ffb300] font-bold'
                        : 'bg-[#0c0f17] border-[#1b202e] text-[#787f91] hover:text-white'
                    }`}
                  >
                    ${r}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Always-accessible Volume Presets: $500, $1,000, $5,000, $10,000 */}
        <div className="flex items-center space-x-0.5 shrink-0">
          {VOLUME_PRESETS.map((preset) => (
            <button
              key={preset}
              data-testid={`volume-preset-${preset}`}
              onClick={() => {
                setSizingMode('fixed_volume');
                setFixedVolumeUsd(preset);
              }}
              className={`px-1.5 py-0.5 rounded text-[9px] border transition cursor-pointer ${
                sizingMode === 'fixed_volume' && Number(fixedVolumeUsd) === preset
                  ? 'bg-[#2563eb] border-[#38bdf8] text-white font-bold'
                  : 'bg-[#0c0f17] border-[#1b202e] text-[#94a3b8] hover:text-white hover:border-[#38bdf860]'
              }`}
            >
              ${preset.toLocaleString('en-US')}
            </button>
          ))}
        </div>
      </div>

      {/* Risk-to-Wall Auto-Sizing Telemetry Bar */}
      <div
        data-testid="risk-telemetry-bar"
        className="flex items-center justify-between px-1.5 py-1 rounded bg-[#0a0d14] border border-[#171c29] text-[9.5px]"
      >
        <div className="flex items-center space-x-1 truncate">
          <Crosshair size={10} className="text-[#ffb300] shrink-0" />
          <span className="text-[#787f91]">SL за стенкой:</span>
          <span className="text-white font-semibold" data-testid="sl-wall-price">
            ${riskCalculation.slPrice.toFixed(priceDecimals)}
          </span>
          <span className="text-[#ffb300]" data-testid="sl-distance-pct">
            ({riskCalculation.distPct.toFixed(2)}%)
          </span>
        </div>

        <div className="flex items-center space-x-1 shrink-0">
          <span className="text-[#787f91]">Расч. позиция:</span>
          <span
            data-testid="effective-position-usd"
            className="text-[#38bdf8] font-bold"
          >
            {fmtUsd(effectiveVolumeUsd, 0)}
          </span>
          <span className="text-[#64748b] text-[8.5px]">
            ({effectiveQty.toFixed(4)})
          </span>
        </div>
      </div>

      {/* Trading Actions Row 1: Limit Orders in front of DOM Walls */}
      <div className="grid grid-cols-2 gap-1">
        <button
          data-testid="btn-limit-wall-bid"
          onClick={handleLimitBeforeBidWall}
          className="flex items-center justify-between px-1.5 py-1 rounded bg-[#07261f] hover:bg-[#0a362c] border border-[#26a69a60] text-[#26a69a] font-bold text-[9.5px] transition cursor-pointer truncate"
          title={`Выставить лимитный LONG перед BID-стенкой $${nearestBidWall.price.toFixed(priceDecimals)}`}
        >
          <span className="truncate">Лимитка перед Wall BID</span>
          <span className="text-[8.5px] text-white/90 bg-[#26a69a30] px-1 rounded ml-1 shrink-0">
            ${(nearestBidWall.price + stepSize).toFixed(priceDecimals)}
          </span>
        </button>

        <button
          data-testid="btn-limit-wall-ask"
          onClick={handleLimitBeforeAskWall}
          className="flex items-center justify-between px-1.5 py-1 rounded bg-[#2a0e13] hover:bg-[#3b131a] border border-[#ef535060] text-[#ef5350] font-bold text-[9.5px] transition cursor-pointer truncate"
          title={`Выставить лимитный SHORT перед ASK-стенкой $${nearestAskWall.price.toFixed(priceDecimals)}`}
        >
          <span className="truncate">Лимитка перед Wall ASK</span>
          <span className="text-[8.5px] text-white/90 bg-[#ef535030] px-1 rounded ml-1 shrink-0">
            ${(nearestAskWall.price - stepSize).toFixed(priceDecimals)}
          </span>
        </button>
      </div>

      {/* Trading Actions Row 2: Market BUY [Q], Market SELL [W], Close All */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
        <button
          data-testid="btn-market-buy"
          onClick={handleMarketBuy}
          className="flex items-center justify-center space-x-1 py-1 px-2 rounded bg-[#26a69a] hover:bg-[#1f8f83] text-white font-bold text-[10px] shadow-xs transition cursor-pointer"
          title="Купить по рынку (Горячая клавиша Q)"
        >
          <TrendingUp size={11} />
          <span>По рынку BUY [Q]</span>
        </button>

        <button
          data-testid="btn-market-sell"
          onClick={handleMarketSell}
          className="flex items-center justify-center space-x-1 py-1 px-2 rounded bg-[#ef5350] hover:bg-[#dc3c39] text-white font-bold text-[10px] shadow-xs transition cursor-pointer"
          title="Продать по рынку (Горячая клавиша W)"
        >
          <TrendingDown size={11} />
          <span>По рынку SELL [W]</span>
        </button>

        <button
          data-testid="btn-close-all"
          onClick={handleCloseAll}
          className="flex items-center justify-center space-x-1 py-1 px-2 rounded bg-[#1e2433] hover:bg-[#ef5350] text-[#cbd5e1] hover:text-white border border-[#2e364d] font-bold text-[9.5px] transition cursor-pointer"
          title="Закрыть открытую позицию и отменить все лимитки (Клавиша E — отмена лимиток)"
        >
          <XCircle size={11} />
          <span>Закрыть всё</span>
        </button>
      </div>

      {/* Working Limit Orders Bar (if any) */}
      {limitOrders.length > 0 && (
        <div
          data-testid="working-limit-orders"
          className="flex items-center justify-between px-1.5 py-0.5 rounded bg-[#101624] border border-[#2563eb50] text-[9px]"
        >
          <div className="flex items-center space-x-1.5 truncate">
            <Layers size={10} className="text-[#38bdf8] shrink-0" />
            <span className="text-[#94a3b8]">Лимитки ({limitOrders.length}):</span>
            {limitOrders.map((o) => (
              <span
                key={o.id}
                className={`px-1 rounded font-bold ${
                  o.side === 'BUY' ? 'bg-[#26a69a25] text-[#26a69a]' : 'bg-[#ef535025] text-[#ef5350]'
                }`}
              >
                {o.side} ${o.price.toFixed(priceDecimals)} ({fmtUsd(o.sizeUsd, 0)})
              </span>
            ))}
          </div>
          <button
            data-testid="btn-cancel-limits"
            onClick={handleCancelAllLimits}
            className="text-[#ef5350] hover:underline font-bold ml-1 shrink-0 cursor-pointer"
          >
            Отмена [E]
          </button>
        </div>
      )}

      {/* Open Position Status Bar: Тикер | Направление | Точка входа | Текущий PnL ($ и %) | Нереализованный PnL */}
      <div
        data-testid="active-position-bar"
        className={`flex items-center justify-between px-1.5 py-1 rounded border text-[9.5px] ${
          position
            ? position.side === 'LONG'
              ? 'bg-[#071f1b] border-[#26a69a60]'
              : 'bg-[#230c10] border-[#ef535060]'
            : 'bg-[#080a0f] border-[#161a26] text-[#64748b]'
        }`}
      >
        {position ? (
          <div className="flex items-center justify-between w-full gap-1 flex-wrap">
            <div className="flex items-center space-x-1">
              <span className="font-bold text-white" data-testid="pos-symbol">
                {position.symbol}
              </span>
              <span className="text-[#475569]">|</span>
              <span
                data-testid="pos-side"
                className={`px-1 py-0.1 rounded font-extrabold text-[8.5px] ${
                  position.side === 'LONG' ? 'bg-[#26a69a] text-white' : 'bg-[#ef5350] text-white'
                }`}
              >
                {position.side}
              </span>
              <span className="text-[#475569]">|</span>
              <span className="text-[#94a3b8]">
                Вход:{' '}
                <b className="text-white" data-testid="pos-entry-price">
                  ${position.entryPrice.toFixed(priceDecimals)}
                </b>
              </span>
            </div>

            <div className="flex items-center space-x-1">
              <span className="text-[#94a3b8]">PnL:</span>
              <span
                data-testid="pos-current-pnl"
                className={`font-extrabold ${
                  livePnl.pnlUsd >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'
                }`}
              >
                {livePnl.pnlUsd >= 0 ? '+' : ''}
                {fmtUsd(livePnl.pnlUsd, 2)} ({livePnl.pnlPct >= 0 ? '+' : ''}
                {livePnl.pnlPct.toFixed(2)}%)
              </span>
              <span className="text-[#475569]">|</span>
              <span className="text-[#94a3b8]">
                Нереализ.:{' '}
                <b
                  data-testid="pos-unrealized-pnl"
                  className={livePnl.unrealizedUsd >= 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}
                >
                  {livePnl.unrealizedUsd >= 0 ? '+' : ''}
                  {fmtUsd(livePnl.unrealizedUsd, 2)}
                </b>
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <span>Нет открытой позиции ({symbol})</span>
            <span>
              Цена: <b className="text-[#cbd5e1]">${currentPrice.toFixed(priceDecimals)}</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
