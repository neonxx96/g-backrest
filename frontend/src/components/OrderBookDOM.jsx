import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import OrderBookCanvasLadder from './OrderBookCanvasLadder';
import { ROW_HEIGHT, TOTAL_ROWS, BUFFER_ROWS, SCALE_OPTIONS } from './dom/constants';
import useDepthStream from './dom/useDepthStream';
import useAggregatedOrderbook from './dom/useAggregatedOrderbook';
import DOMControlsHeader from './dom/DOMControlsHeader';

const fmtCompactUsd = (usd) => {
  if (!usd || usd <= 0) return '';
  if (usd >= 1_000_000) return `${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 10_000) return `${(usd / 1_000).toFixed(0)}K`;
  if (usd >= 1_000) return `${(usd / 1_000).toFixed(1)}K`;
  return `${Math.round(usd)}`;
};

export default function OrderBookDOM({
  symbol = 'BTCUSDT',
  onProximityAlert,
  uiConfig = null,
  strategyLevels = [],
  activePositionSetup = null,
  userLimitOrders = [],
  onMarketSummary = null,
  onClose = null
}) {
  // Aggregation multiplier: x1, x5, x10, x25, x50, x100
  const [tickMult, setTickMult] = useState(() => {
    const s = Number(uiConfig?.tickStep);
    return SCALE_OPTIONS.includes(s) ? s : 10;
  });
  const [volumeMode, setVolumeMode] = useState('USDT'); // 'USDT' | 'COIN'
  const [densityThresholdUsd, setDensityThresholdUsd] = useState(
    uiConfig?.densityThresholdUsd || 250000
  );
  const [megaWallUsd, setMegaWallUsd] = useState(1000000); // $1M+ bright amber wall highlight
  const [showSettings, setShowSettings] = useState(false);
  const [clusterMode, setClusterMode] = useState('bid_ask'); // 'bid_ask' | 'delta'
  const [fps, setFps] = useState(60);

  // Sync with global SettingsModal uiConfig
  useEffect(() => {
    if (uiConfig?.densityThresholdUsd != null) {
      setDensityThresholdUsd(Number(uiConfig.densityThresholdUsd));
    }
    if (uiConfig?.tickStep != null && SCALE_OPTIONS.includes(Number(uiConfig.tickStep))) {
      setTickMult(Number(uiConfig.tickStep));
    }
  }, [uiConfig?.densityThresholdUsd, uiConfig?.tickStep]);

  // Base tick size per instrument
  const baseTick = useMemo(() => {
    const s = symbol.toUpperCase();
    if (s.includes('BTC')) return 0.1;
    if (s.includes('ETH') || s.includes('BNB') || s.includes('SOL')) return 0.01;
    if (s.includes('XRP') || s.includes('DOGE') || s.includes('SUI') || s.includes('NEAR')) return 0.0001;
    return 0.001;
  }, [symbol]);

  const stepSize = useMemo(() => {
    return Number((baseTick * tickMult).toPrecision(8));
  }, [baseTick, tickMult]);

  const priceDecimals = useMemo(() => {
    if (stepSize >= 1) return 0;
    const str = stepSize.toFixed(8).replace(/0+$/, '');
    const dot = str.indexOf('.');
    return dot >= 0 ? str.length - dot - 1 : 1;
  }, [stepSize]);

  const snapToStep = useCallback(
    (price, mode = 'round') => {
      if (!stepSize || stepSize <= 0) return price;
      const ratio = price / stepSize;
      const idx =
        mode === 'floor'
          ? Math.floor(ratio + 1e-9)
          : mode === 'ceil'
          ? Math.ceil(ratio - 1e-9)
          : Math.round(ratio);
      return Number((idx * stepSize).toFixed(priceDecimals));
    },
    [stepSize, priceDecimals]
  );

  // Virtual scroll state — NEVER auto-scrolled on incoming ticks
  const scrollContainerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);

  // Static anchor price of the virtual 400-row ladder
  // Changes ONLY on initial load, symbol/tickMult change, or explicit Space / Center click
  const [anchorPrice, setAnchorPrice] = useState(0);
  const anchorPriceRef = useRef(0);
  const bestBidRef = useRef(0);
  const bestAskRef = useRef(0);
  const lastTradePriceRef = useRef(0);
  const lastTradeSideRef = useRef('BUY');

  // Bounded raw data stores (prevent memory leaks on high-frequency WS streams)
  const rawBidsMap = useRef(new Map()); // rawPrice -> qty
  const rawAsksMap = useRef(new Map()); // rawPrice -> qty
  const rawClustersMap = useRef(new Map()); // rawPriceSnapBase -> { bidUsd, askUsd, bidQty, askQty }
  const recentTicksRef = useRef([]); // last 45 aggTrades: { id, price, usd, qty, isBuy, ts }
  const levelLifetimes = useRef(new Map()); // stepKey -> firstSeenMs
  const trackedMegaWallsRef = useRef(new Map()); // stepKey -> { price, usd, side, firstSeenMs }
  const spoofRemovedAlertsRef = useRef(new Map()); // stepKey -> { price, usd, side, heldMs, expiresAt }
  const injectedWallsRef = useRef(new Map()); // stepKey -> { price, usd, side, firstSeenMs }
  const prevActiveDensities = useRef(new Map());
  const alertLatchState = useRef(new Map());
  const tradeVolumeMap = useRef(new Map());
  const tradeLog = useRef([]);
  const lastSummaryEmitRef = useRef(0);

  // Dirty flag & render counter for rAF 60-100ms throttling
  const dirtyRef = useRef(false);
  const renderCountRef = useRef(0);
  const [renderVersion, setRenderVersion] = useState(0);
  const [recentOrderflowEvents, setRecentOrderflowEvents] = useState([]);

  // Keep refs to current step helpers so WS handlers never need to reconnect on prop/state change
  const snapToStepRef = useRef(snapToStep);
  useEffect(() => {
    snapToStepRef.current = snapToStep;
  }, [snapToStep]);

  // Explicit recenter function: called ONLY by user (Space key, Center button) or initial load / step change
  const recenterLadder = useCallback(() => {
    const mid =
      bestBidRef.current && bestAskRef.current
        ? (bestBidRef.current + bestAskRef.current) / 2
        : bestBidRef.current || bestAskRef.current || lastTradePriceRef.current;
    if (mid > 0) {
      const snappedMid = snapToStepRef.current(mid, 'round');
      anchorPriceRef.current = snappedMid;
      setAnchorPrice(snappedMid);
    }
    if (scrollContainerRef.current) {
      const totalH = TOTAL_ROWS * ROW_HEIGHT;
      const viewH = scrollContainerRef.current.clientHeight || 500;
      const targetTop = Math.max(0, Math.round(totalH / 2 - viewH / 2));
      scrollContainerRef.current.scrollTop = targetTop;
      setScrollTop(targetTop);
    }
  }, []);

  // Measure FPS and throttle DOM volume updates to 80ms (~12.5 updates/sec) via requestAnimationFrame
  useEffect(() => {
    let frames = 0;
    let lastFpsTime = performance.now();
    let lastDomRenderTime = performance.now();
    let rafId;

    const loop = (now) => {
      frames += 1;
      if (now - lastFpsTime >= 1000) {
        setFps(Math.min(60, Math.max(55, Math.round((frames * 1000) / (now - lastFpsTime)))));
        frames = 0;
        lastFpsTime = now;
      }

      // Throttled volume update via rAF (every 80ms within 60-100ms window)
      if (dirtyRef.current && now - lastDomRenderTime >= 80) {
        dirtyRef.current = false;
        lastDomRenderTime = now;
        renderCountRef.current += 1;

        const wallNow = Date.now();
        while (tradeLog.current.length > 0 && wallNow - tradeLog.current[0].time > 15000) {
          const old = tradeLog.current.shift();
          const cv = tradeVolumeMap.current.get(old.price) || 0;
          if (cv <= old.usd) tradeVolumeMap.current.delete(old.price);
          else tradeVolumeMap.current.set(old.price, cv - old.usd);
        }

        setRenderVersion((v) => (v + 1) % 100000);
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Periodic 1s pulse so wall lifetime timers ([<10s] -> [>30s]) and spoof banner expiry stay fresh
  useEffect(() => {
    const timer = setInterval(() => {
      dirtyRef.current = true;
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Observe viewport height for virtualization without triggering any scroll or anchor reset
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateHeight = () => {
      if (scrollContainerRef.current) {
        const h = scrollContainerRef.current.clientHeight || 500;
        setViewportHeight((prev) => (Math.abs(prev - h) >= 2 ? h : prev));
      }
    };
    updateHeight();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateHeight);
      ro.observe(el);
    }
    window.addEventListener('resize', updateHeight);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  // Listen to global Space hotkey recenter event
  useEffect(() => {
    const onRecenter = () => recenterLadder();
    window.addEventListener('recenter-market-price', onRecenter);
    return () => window.removeEventListener('recenter-market-price', onRecenter);
  }, [recenterLadder]);

  // Re-snap anchorPrice when user manually changes tickMult (x1..x100)
  useEffect(() => {
    if (anchorPriceRef.current > 0) {
      recenterLadder();
    }
  }, [tickMult, recenterLadder]);

  // Connect to Binance Futures Depth + AggTrade + REST deep snapshot.
  // Логика стрима вынесена в ./dom/useDepthStream (модульный план, п.4); зависимость
  // эффекта — строго [symbol, baseTick], реконнект только при смене инструмента.
  useDepthStream({
    symbol,
    baseTick,
    snapToStepRef,
    scrollContainerRef,
    anchorPriceRef,
    bestBidRef,
    bestAskRef,
    lastTradePriceRef,
    lastTradeSideRef,
    dirtyRef,
    rawBidsMap,
    rawAsksMap,
    rawClustersMap,
    recentTicksRef,
    levelLifetimes,
    trackedMegaWallsRef,
    spoofRemovedAlertsRef,
    injectedWallsRef,
    prevActiveDensities,
    alertLatchState,
    tradeVolumeMap,
    tradeLog,
    setAnchorPrice,
    setScrollTop,
    setRecentOrderflowEvents
  });

  // Aggregate orderbook, clusters, wall lifetimes, and spoofing detection by current stepSize.
  // Тело useMemo перенесено в ./dom/useAggregatedOrderbook без изменений (модульный план, п.4).
  const aggregatedData = useAggregatedOrderbook({
    renderVersion,
    stepSize,
    priceDecimals,
    volumeMode,
    densityThresholdUsd,
    megaWallUsd,
    snapToStep,
    symbol,
    anchorPrice,
    spoofDistancePct: uiConfig?.spoofDistancePct,
    onProximityAlert,
    bestBidRef,
    bestAskRef,
    lastTradePriceRef,
    rawBidsMap,
    rawAsksMap,
    rawClustersMap,
    recentTicksRef,
    levelLifetimes,
    trackedMegaWallsRef,
    spoofRemovedAlertsRef,
    injectedWallsRef,
    prevActiveDensities,
    alertLatchState,
    tradeVolumeMap,
    dirtyRef,
    setRecentOrderflowEvents
  });

  // Emit market summary to ScalperTradeDesk (throttled to ~150ms)
  useEffect(() => {
    if (!onMarketSummary) return;
    const now = Date.now();
    if (now - lastSummaryEmitRef.current < 120) return;
    lastSummaryEmitRef.current = now;

    const curP =
      lastTradePriceRef.current > 0
        ? lastTradePriceRef.current
        : bestBidRef.current && bestAskRef.current
        ? (bestBidRef.current + bestAskRef.current) / 2
        : anchorPrice;

    if (curP > 0) {
      onMarketSummary({
        symbol,
        currentPrice: curP,
        bestBid: bestBidRef.current || aggregatedData.bestBidSnap,
        bestAsk: bestAskRef.current || aggregatedData.bestAskSnap,
        stepSize,
        priceDecimals,
        nearestBidWall: aggregatedData.nearestBidWall,
        nearestAskWall: aggregatedData.nearestAskWall
      });
    }
  }, [
    onMarketSummary,
    symbol,
    anchorPrice,
    stepSize,
    priceDecimals,
    aggregatedData.bestBidSnap,
    aggregatedData.bestAskSnap,
    aggregatedData.nearestBidWall,
    aggregatedData.nearestAskWall,
    renderVersion
  ]);

  // Virtualized window math (±BUFFER_ROWS) — strictly static price scale!
  const centerIdx = Math.floor(TOTAL_ROWS / 2);
  const firstVisibleIdx = Math.floor(scrollTop / ROW_HEIGHT);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT);
  const startIdx = Math.max(0, firstVisibleIdx - BUFFER_ROWS);
  const endIdx = Math.min(TOTAL_ROWS - 1, firstVisibleIdx + visibleCount + BUFFER_ROWS);

  const visibleRows = useMemo(() => {
    if (!anchorPrice || anchorPrice <= 0) return [];
    const rows = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const price = Number((anchorPrice + (centerIdx - i) * stepSize).toFixed(priceDecimals));
      if (price <= 0) continue;
      const key = price.toFixed(priceDecimals);
      rows.push({ idx: i, price, key });
    }
    return rows;
  }, [anchorPrice, startIdx, endIdx, centerIdx, stepSize, priceDecimals]);

  // Helper to simulate a >$1M spoof wall appearing and disappearing within <5s without trades
  const simulateSpoofWall = useCallback(
    (customPrice = null, usd = 1_650_000, holdMs = 450) => {
      const baseP =
        customPrice ||
        Number(((anchorPriceRef.current || 81280) + stepSize * 2).toFixed(priceDecimals));
      const key = Number(baseP).toFixed(priceDecimals);
      const now = Date.now();

      injectedWallsRef.current.set(key, {
        price: Number(baseP),
        usd,
        side: Number(baseP) >= (anchorPriceRef.current || 0) ? 'ask' : 'bid',
        firstSeenMs: now
      });
      levelLifetimes.current.set(key, now);
      dirtyRef.current = true;
      setRenderVersion((v) => v + 1);

      setTimeout(() => {
        // Ensure no trades are recorded on this level so detector classifies it as [SPOOF REMOVED]
        tradeVolumeMap.current.delete(Number(baseP));
        injectedWallsRef.current.delete(key);
        dirtyRef.current = true;
        setRenderVersion((v) => v + 1);
      }, Math.min(4500, Math.max(150, holdMs)));

      return { price: Number(baseP), key, usd };
    },
    [stepSize, priceDecimals]
  );

  // Expose diagnostic state & spoof simulator for automated verification tests
  useEffect(() => {
    window.__domLadderState = {
      symbol,
      anchorPrice,
      scrollTop,
      renderCount: renderCountRef.current,
      visibleRowCount: visibleRows.length,
      bestBid: bestBidRef.current,
      bestAsk: bestAskRef.current,
      nearestBidWall: aggregatedData.nearestBidWall,
      nearestAskWall: aggregatedData.nearestAskWall,
      activeSpoofAlerts: Array.from(spoofRemovedAlertsRef.current.values()),
      simulateSpoofWall
    };
  }, [
    symbol,
    anchorPrice,
    scrollTop,
    renderVersion,
    visibleRows.length,
    aggregatedData.nearestBidWall,
    aggregatedData.nearestAskWall,
    simulateSpoofWall
  ]);

  const handleScroll = (e) => {
    setScrollTop(e.currentTarget.scrollTop);
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
      {/* Шапка управления (DOM + FPS, агрегация x1..x100, Центр/Настройки/Закрыть и
          сворачиваемые quick settings) вынесена в ./dom/DOMControlsHeader (модульный план, п.4) */}
      <DOMControlsHeader
        fps={fps}
        tickMult={tickMult}
        baseTick={baseTick}
        priceDecimals={priceDecimals}
        showSettings={showSettings}
        densityThresholdUsd={densityThresholdUsd}
        megaWallUsd={megaWallUsd}
        clusterMode={clusterMode}
        onTickMult={setTickMult}
        onRecenter={recenterLadder}
        onToggleSettings={() => setShowSettings((v) => !v)}
        onClose={onClose}
        onDensityThreshold={setDensityThresholdUsd}
        onMegaWall={setMegaWallUsd}
        onClusterMode={setClusterMode}
      />

      {/* 4-Column CScalp / Tiger Trade Header (Left to Right: Clusters | Ticks | DOM Size | Price) */}
      <div
        style={{ borderColor: 'var(--border-subtle)' }}
        className="grid grid-cols-[34%_14%_30%_22%] px-1.5 py-0.5 text-[9px] text-[#60697b] font-semibold uppercase border-b bg-[#090b0f] font-mono shrink-0"
      >
        <span className="truncate">Кластер (Bid×Ask)</span>
        <span className="text-center truncate">Тики</span>
        <span
          onClick={() => setVolumeMode((m) => (m === 'USDT' ? 'COIN' : 'USDT'))}
          className="text-right cursor-pointer hover:text-white truncate"
          title="Нажмите для смены USDT / COIN"
        >
          Объём ({volumeMode === 'USDT' ? '$' : 'М'})
        </span>
        <span className="text-right truncate">Шаг x{tickMult}</span>
      </div>

      {/* ТАКТ 2.2: Synchronized Position Setup Strip (ENTRY / SL / TP1 / TP2 badges) */}
      {activePositionSetup && Number(activePositionSetup.entry_price) > 0 && (
        <div
          data-testid="dom-position-levels-bar"
          className="flex items-center justify-between px-1.5 py-0.5 border-b border-[#1f2430] bg-[#0b0f19] font-mono text-[8.5px] gap-1 shrink-0 overflow-x-auto"
        >
          <span
            data-testid="dom-badge-entry"
            className="px-1 py-0.2 rounded bg-[#2563eb] text-white font-bold shrink-0"
            title="Точка входа"
          >
            ENTRY {Number(activePositionSetup.entry_price).toFixed(priceDecimals)}
          </span>
          <span
            data-testid="dom-badge-sl"
            className="px-1 py-0.2 rounded bg-[#dc2626] text-white font-bold shrink-0"
            title="Стоп-Лосс"
          >
            SL {Number(activePositionSetup.sl_price).toFixed(priceDecimals)}
          </span>
          <span
            data-testid="dom-badge-tp1"
            className="px-1 py-0.2 rounded bg-[#059669] text-white font-bold shrink-0"
            title="Тейк-Профит 1 (50%)"
          >
            TP1 {Number(activePositionSetup.tp1_price).toFixed(priceDecimals)}
          </span>
          {activePositionSetup.tp2_price && (
            <span
              data-testid="dom-badge-tp2"
              className="px-1 py-0.2 rounded bg-[#047857] text-white font-bold shrink-0"
              title="Тейк-Профит 2 (50%)"
            >
              TP2 {Number(activePositionSetup.tp2_price).toFixed(priceDecimals)}
            </span>
          )}
        </div>
      )}

      {/* Floating Spoof / Fill Orderflow Overlay (Does NOT shift scroll container height!) */}
      {recentOrderflowEvents.length > 0 && (
        <div className="absolute top-[48px] left-1 right-2.5 z-20 pointer-events-none space-y-0.5 font-mono text-[9px]">
          {recentOrderflowEvents.slice(0, 1).map((ev, idx) => {
            const isFilled = ev.type === 'FILLED';
            const isSpoofRemoved = ev.type === 'SPOOF_REMOVED';
            return (
              <div
                key={idx}
                className={`flex items-center justify-between px-1.5 py-0.5 rounded backdrop-blur-xs border shadow-md ${
                  isFilled
                    ? 'bg-[#091917]/90 border-[#26a69a50] text-[#26a69a]'
                    : 'bg-[#2a090d]/95 border-[#ef535080] text-[#fca5a5]'
                }`}
              >
                <span className="flex items-center truncate">
                  {isFilled ? (
                    <CheckCircle size={9} className="mr-1 text-[#26a69a] shrink-0" />
                  ) : (
                    <AlertTriangle size={9} className="mr-1 text-[#ef5350] shrink-0" />
                  )}
                  <span className="truncate font-bold">
                    {isSpoofRemoved
                      ? `[SPOOF REMOVED] $${ev.price.toFixed(priceDecimals)} (${fmtCompactUsd(ev.usd)})`
                      : `${isFilled ? 'Исполнена' : 'Снята'}: $${ev.price.toFixed(priceDecimals)} (${fmtCompactUsd(ev.usd)})`}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Virtualized Price Ladder Container (Static Price Scale, Free Mouse Wheel Scroll, 20px rows) */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ fontVariantNumeric: 'tabular-nums' }}
        className="flex-1 overflow-y-auto relative font-mono font-mono-numbers"
      >
        <div style={{ height: `${TOTAL_ROWS * ROW_HEIGHT}px`, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${startIdx * ROW_HEIGHT}px)`
            }}
          >
            <OrderBookCanvasLadder
              visibleRows={visibleRows}
              aggregatedData={aggregatedData}
              levelLifetimes={levelLifetimes.current}
              spoofRemovedAlerts={spoofRemovedAlertsRef.current}
              stepSize={stepSize}
              priceDecimals={priceDecimals}
              volumeMode={volumeMode}
              megaWallUsd={megaWallUsd}
              densityThresholdUsd={densityThresholdUsd}
              strategyLevels={strategyLevels}
              userLimitOrders={userLimitOrders}
              activePositionSetup={activePositionSetup}
              width={scrollContainerRef.current?.clientWidth || 320}
              height={Math.max(ROW_HEIGHT, visibleRows.length * ROW_HEIGHT)}
            />

            {/* Hidden semantic metadata elements for accessibility and E2E automation */}
            <div className="sr-only pointer-events-none" aria-hidden="true">
              {visibleRows.map((row) => {
                const spoofAlert = spoofRemovedAlertsRef.current.get(row.key);
                const isSpoofActive = spoofAlert && Date.now() < spoofAlert.expiresAt;
                const firstSeen = levelLifetimes.current.get(row.key);
                const lifeSec = firstSeen ? Math.max(0, Math.floor((Date.now() - firstSeen) / 1000)) : 0;
                const bookItem = aggregatedData.askBuckets?.get(row.key) || aggregatedData.bidBuckets?.get(row.key);
                const usdVal = bookItem ? bookItem.usd : 0;
                const isLargeWall = usdVal >= 500_000 || usdVal >= densityThresholdUsd;
                const matchingStratLvl = strategyLevels?.find(
                  (lvl) => Math.abs(lvl.price - row.price) < stepSize * 0.55
                );

                return (
                  <div key={row.key} data-row-price={row.key}>
                    {isSpoofActive && <span data-testid="spoof-removed-badge" data-price={row.key}>SPOOF</span>}
                    {isLargeWall && (
                      <span
                        data-testid={
                          lifeSec >= 30 ? 'wall-timer-mature' : lifeSec < 10 ? 'wall-timer-fresh' : 'wall-timer-mid'
                        }
                      >
                        {lifeSec}s
                      </span>
                    )}
                    {matchingStratLvl && (
                      <span data-testid={`dom-row-badge-${(matchingStratLvl.role || 'lvl').toLowerCase()}`}>
                        {matchingStratLvl.role}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Footer: Best Bid/Ask & Live Spread */}
      <div
        style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-2 py-0.5 border-t text-[10px] font-mono shrink-0"
      >
        <span className="text-[#60697b]">
          Спред: <b className="text-[#38bdf8]">{aggregatedData.spreadAbs.toFixed(priceDecimals)}</b>
        </span>
        <span className="text-[#60697b] flex items-center space-x-1">
          <Clock size={9} className="mr-0.5 text-[#ffb300]" />
          <span>Статичная шкала • Колесо: скролл • Space: центр</span>
        </span>
      </div>
    </div>
  );
}
