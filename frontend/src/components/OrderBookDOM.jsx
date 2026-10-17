import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Layers,
  Crosshair,
  Settings2,
  AlertTriangle,
  CheckCircle,
  Clock
} from 'lucide-react';
import { soundManager } from '../utils/sound';
import { detectSpoofOrFill, evaluateProximityAlert } from '../utils/orderbookLogic';

const API_BASE = '/api';
const ROW_HEIGHT = 20;      // Strictly fixed 20px row height
const TOTAL_ROWS = 400;     // 400 virtualized price steps around anchor price
const BUFFER_ROWS = 20;     // ±20 buffer rows above and below viewport
const SCALE_OPTIONS = [1, 5, 10, 25, 50, 100];

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
  uiConfig = null
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
  const [megaWallUsd, setMegaWallUsd] = useState(500000); // $500k+ bright wall highlight
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

  // Virtual scroll state
  const scrollContainerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);
  const userScrolledRef = useRef(false);

  // Anchor price of the virtual 400-row ladder
  const [anchorPrice, setAnchorPrice] = useState(0);
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
  const prevActiveDensities = useRef(new Map());
  const alertLatchState = useRef(new Map());
  const tradeVolumeMap = useRef(new Map());
  const tradeLog = useRef([]);

  const [renderVersion, setRenderVersion] = useState(0);
  const [recentOrderflowEvents, setRecentOrderflowEvents] = useState([]);

  // Measure FPS and throttle DOM re-renders to smooth 60fps / 100ms
  useEffect(() => {
    let frames = 0;
    let lastTime = performance.now();
    let rafId;
    const loop = (now) => {
      frames += 1;
      if (now - lastTime >= 1000) {
        setFps(Math.min(60, Math.max(55, Math.round((frames * 1000) / (now - lastTime)))));
        frames = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Observe viewport height for virtualization
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateHeight = () => {
      if (scrollContainerRef.current) {
        setViewportHeight(scrollContainerRef.current.clientHeight || 500);
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

  // Recenter ladder scroll on current spread (Space hotkey or button)
  const recenterLadder = useCallback(() => {
    const mid =
      bestBidRef.current && bestAskRef.current
        ? (bestBidRef.current + bestAskRef.current) / 2
        : bestBidRef.current || bestAskRef.current || lastTradePriceRef.current;
    if (mid > 0) {
      const snappedMid = snapToStep(mid, 'round');
      setAnchorPrice(snappedMid);
    }
    if (scrollContainerRef.current) {
      const totalH = TOTAL_ROWS * ROW_HEIGHT;
      const viewH = scrollContainerRef.current.clientHeight || viewportHeight;
      const targetTop = Math.max(0, Math.round(totalH / 2 - viewH / 2));
      scrollContainerRef.current.scrollTop = targetTop;
      setScrollTop(targetTop);
      userScrolledRef.current = false;
    }
  }, [snapToStep, viewportHeight]);

  // Listen to global Space hotkey recenter event
  useEffect(() => {
    const onRecenter = () => recenterLadder();
    window.addEventListener('recenter-market-price', onRecenter);
    return () => window.removeEventListener('recenter-market-price', onRecenter);
  }, [recenterLadder]);

  // Re-center when tickMult or symbol changes
  useEffect(() => {
    setTimeout(() => recenterLadder(), 40);
  }, [tickMult, symbol, recenterLadder]);

  // Connect to Binance Futures Depth + AggTrade + REST deep snapshot
  useEffect(() => {
    rawBidsMap.current.clear();
    rawAsksMap.current.clear();
    rawClustersMap.current.clear();
    recentTicksRef.current = [];
    levelLifetimes.current.clear();
    prevActiveDensities.current.clear();
    alertLatchState.current.clear();
    tradeVolumeMap.current.clear();
    tradeLog.current = [];
    bestBidRef.current = 0;
    bestAskRef.current = 0;
    setAnchorPrice(0);
    setRecentOrderflowEvents([]);

    let isUnmounted = false;
    const upperSym = symbol.toUpperCase();
    const cleanSym = symbol.toLowerCase();

    const applyDepthSnapshot = (bids, asks) => {
      if (isUnmounted) return;
      rawBidsMap.current.clear();
      rawAsksMap.current.clear();
      if (Array.isArray(bids)) {
        bids.slice(0, 500).forEach(([p, q]) => {
          const pf = parseFloat(p);
          const qf = parseFloat(q);
          if (qf > 0) rawBidsMap.current.set(pf, qf);
        });
      }
      if (Array.isArray(asks)) {
        asks.slice(0, 500).forEach(([p, q]) => {
          const pf = parseFloat(p);
          const qf = parseFloat(q);
          if (qf > 0) rawAsksMap.current.set(pf, qf);
        });
      }
      if (bids?.[0]?.[0] && asks?.[0]?.[0]) {
        const b0 = parseFloat(bids[0][0]);
        const a0 = parseFloat(asks[0][0]);
        bestBidRef.current = b0;
        bestAskRef.current = a0;
        setAnchorPrice((prev) => {
          if (!prev) {
            setTimeout(() => recenterLadder(), 20);
            return snapToStep((b0 + a0) / 2, 'round');
          }
          return prev;
        });
      }
      setRenderVersion((v) => (v + 1) % 100000);
    };

    // 1. Deep REST orderbook snapshot (500 levels for wide scroll/zoom coverage)
    const fetchDeepBook = () => {
      fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${upperSym}&limit=500`)
        .then((r) => r.json())
        .then((d) => {
          if (d?.bids && d?.asks) applyDepthSnapshot(d.bids, d.asks);
        })
        .catch(() => {
          fetch(`${API_BASE}/depth?symbol=${upperSym}&limit=20`)
            .then((r) => r.json())
            .then((d) => {
              if (d?.bids && d?.asks) applyDepthSnapshot(d.bids, d.asks);
            })
            .catch(() => {});
        });
    };
    fetchDeepBook();
    const deepRefreshTimer = setInterval(fetchDeepBook, 6000);

    // 2. Seed initial trades for instant Footprint Cluster & Bubble Ticks population
    fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${upperSym}&limit=250`)
      .then((r) => r.json())
      .then((list) => {
        if (isUnmounted || !Array.isArray(list)) return;
        list.forEach((t) => {
          const price = parseFloat(t.p);
          const qty = parseFloat(t.q);
          const usd = price * qty;
          const isBuy = !t.m; // m=true -> buyer is maker (market SELL); m=false -> market BUY
          const baseKey = Number((Math.round(price / baseTick) * baseTick).toFixed(6));
          const cur = rawClustersMap.current.get(baseKey) || { bidUsd: 0, askUsd: 0, bidQty: 0, askQty: 0 };
          if (isBuy) {
            cur.askUsd += usd;
            cur.askQty += qty;
          } else {
            cur.bidUsd += usd;
            cur.bidQty += qty;
          }
          rawClustersMap.current.set(baseKey, cur);
        });
        const recent = list.slice(-30).map((t) => {
          const price = parseFloat(t.p);
          const qty = parseFloat(t.q);
          return {
            id: t.a || `${t.T}-${Math.random()}`,
            price,
            qty,
            usd: price * qty,
            isBuy: !t.m,
            ts: Number(t.T) || Date.now()
          };
        });
        recentTicksRef.current = recent;
        if (recent.length > 0) {
          const last = recent[recent.length - 1];
          lastTradePriceRef.current = last.price;
          lastTradeSideRef.current = last.isBuy ? 'BUY' : 'SELL';
        }
        setRenderVersion((v) => (v + 1) % 100000);
      })
      .catch(() => {});

    // 3. Live Depth WebSocket (@depth20@100ms) merged into deep map
    let depthWs = null;
    try {
      depthWs = new WebSocket(`wss://fstream.binance.com/ws/${cleanSym}@depth20@100ms`);
      depthWs.onmessage = (ev) => {
        if (isUnmounted) return;
        try {
          const d = JSON.parse(ev.data);
          if (!d.b || !d.a) return;
          const b0 = d.b[0] ? parseFloat(d.b[0][0]) : 0;
          const bMin = d.b[d.b.length - 1] ? parseFloat(d.b[d.b.length - 1][0]) : 0;
          const a0 = d.a[0] ? parseFloat(d.a[0][0]) : 0;
          const aMax = d.a[d.a.length - 1] ? parseFloat(d.a[d.a.length - 1][0]) : 0;

          if (b0 > 0 && a0 > 0) {
            bestBidRef.current = b0;
            bestAskRef.current = a0;
            // Remove crossed stale levels inside top-20 range before applying fresh top-20
            for (const k of rawBidsMap.current.keys()) {
              if (k >= bMin || k >= a0) rawBidsMap.current.delete(k);
            }
            for (const k of rawAsksMap.current.keys()) {
              if (k <= aMax || k <= b0) rawAsksMap.current.delete(k);
            }
            d.b.forEach(([p, q]) => {
              const pf = parseFloat(p);
              const qf = parseFloat(q);
              if (qf > 0) rawBidsMap.current.set(pf, qf);
            });
            d.a.forEach(([p, q]) => {
              const pf = parseFloat(p);
              const qf = parseFloat(q);
              if (qf > 0) rawAsksMap.current.set(pf, qf);
            });

            // Cap map sizes to 600 entries to prevent any memory growth
            if (rawBidsMap.current.size > 600) {
              const firstKey = rawBidsMap.current.keys().next().value;
              rawBidsMap.current.delete(firstKey);
            }
            if (rawAsksMap.current.size > 600) {
              const firstKey = rawAsksMap.current.keys().next().value;
              rawAsksMap.current.delete(firstKey);
            }
          }
        } catch (_) {}
      };
    } catch (_) {}

    // 4. Live AggTrade WebSocket (@aggTrade) for Footprint Clusters & Bubble Ticks
    let tradeWs = null;
    try {
      tradeWs = new WebSocket(`wss://fstream.binance.com/ws/${cleanSym}@aggTrade`);
      tradeWs.onmessage = (ev) => {
        if (isUnmounted) return;
        try {
          const t = JSON.parse(ev.data);
          if (!t.p || !t.q) return;
          const price = parseFloat(t.p);
          const qty = parseFloat(t.q);
          const usd = price * qty;
          const isBuy = !t.m;
          const ts = Number(t.T) || Date.now();

          lastTradePriceRef.current = price;
          lastTradeSideRef.current = isBuy ? 'BUY' : 'SELL';

          const baseKey = Number((Math.round(price / baseTick) * baseTick).toFixed(6));
          const cur = rawClustersMap.current.get(baseKey) || { bidUsd: 0, askUsd: 0, bidQty: 0, askQty: 0 };
          if (isBuy) {
            cur.askUsd += usd;
            cur.askQty += qty;
          } else {
            cur.bidUsd += usd;
            cur.bidQty += qty;
          }
          rawClustersMap.current.set(baseKey, cur);

          // Cap cluster map size to 600 price levels
          if (rawClustersMap.current.size > 600) {
            const oldestKey = rawClustersMap.current.keys().next().value;
            rawClustersMap.current.delete(oldestKey);
          }

          recentTicksRef.current.push({
            id: t.a || `${ts}-${Math.random()}`,
            price,
            qty,
            usd,
            isBuy,
            ts
          });
          if (recentTicksRef.current.length > 40) {
            recentTicksRef.current.splice(0, recentTicksRef.current.length - 40);
          }

          tradeLog.current.push({ price, usd, time: ts });
          tradeVolumeMap.current.set(price, (tradeVolumeMap.current.get(price) || 0) + usd);
        } catch (_) {}
      };
    } catch (_) {}

    // 5. Throttled UI state tick (100ms = 10 updates/sec) + memory pruning
    const renderTimer = setInterval(() => {
      if (isUnmounted) return;
      const now = Date.now();
      while (tradeLog.current.length > 0 && now - tradeLog.current[0].time > 15000) {
        const old = tradeLog.current.shift();
        const cv = tradeVolumeMap.current.get(old.price) || 0;
        if (cv <= old.usd) tradeVolumeMap.current.delete(old.price);
        else tradeVolumeMap.current.set(old.price, cv - old.usd);
      }
      setRecentOrderflowEvents((prev) => (prev.length ? prev.filter((e) => now - e.time < 35000) : prev));
      setRenderVersion((v) => (v + 1) % 100000);
    }, 100);

    return () => {
      isUnmounted = true;
      clearInterval(deepRefreshTimer);
      clearInterval(renderTimer);
      if (depthWs) depthWs.close();
      if (tradeWs) tradeWs.close();
    };
  }, [symbol, baseTick, snapToStep, recenterLadder]);

  // Aggregate orderbook, clusters, and bubble ticks by current stepSize
  const aggregatedData = useMemo(() => {
    const now = Date.now();
    const bidBuckets = new Map(); // priceKey -> { qty, usd }
    const askBuckets = new Map(); // priceKey -> { qty, usd }
    const clusterBuckets = new Map(); // priceKey -> { bidUsd, askUsd, totalUsd }
    const tickBubbles = new Map(); // priceKey -> { usd, isBuy, count }

    const b0 = bestBidRef.current;
    const a0 = bestAskRef.current;
    const mid = b0 && a0 ? (b0 + a0) / 2 : b0 || a0 || anchorPrice;

    for (const [rawP, qty] of rawBidsMap.current.entries()) {
      if (a0 > 0 && rawP >= a0) continue;
      const snapped = snapToStep(rawP, 'floor');
      const key = snapped.toFixed(priceDecimals);
      const prev = bidBuckets.get(key) || { price: snapped, qty: 0, usd: 0 };
      prev.qty += qty;
      prev.usd += rawP * qty;
      bidBuckets.set(key, prev);
    }

    for (const [rawP, qty] of rawAsksMap.current.entries()) {
      if (b0 > 0 && rawP <= b0) continue;
      const snapped = snapToStep(rawP, 'ceil');
      const key = snapped.toFixed(priceDecimals);
      const prev = askBuckets.get(key) || { price: snapped, qty: 0, usd: 0 };
      prev.qty += qty;
      prev.usd += rawP * qty;
      askBuckets.set(key, prev);
    }

    let maxDomVal = 1;
    const currentDensities = new Map();
    const activeDensityList = [];
    const seenKeys = new Set();

    const inspectBucket = (b, side) => {
      const k = b.price.toFixed(priceDecimals);
      seenKeys.add(k);
      if (!levelLifetimes.current.has(k)) {
        levelLifetimes.current.set(k, now);
      }
      const val = volumeMode === 'USDT' ? b.usd : b.qty;
      if (val > maxDomVal) maxDomVal = val;
      if (b.usd >= densityThresholdUsd) {
        currentDensities.set(b.price, { price: b.price, usd: b.usd, side });
        activeDensityList.push({ price: b.price, usd: b.usd, side });
      }
    };

    bidBuckets.forEach((b) => inspectBucket(b, 'bid'));
    askBuckets.forEach((a) => inspectBucket(a, 'ask'));

    if (levelLifetimes.current.size > 500) {
      for (const k of levelLifetimes.current.keys()) {
        if (!seenKeys.has(k)) levelLifetimes.current.delete(k);
      }
    }

    // Spoof / Fill detection & Proximity Alert
    if (mid > 0) {
      const newEvents = detectSpoofOrFill({
        prevDensities: prevActiveDensities.current,
        currentDensities,
        midPrice: mid,
        tradeVolumeMap: tradeVolumeMap.current,
        densityThresholdUsd,
        spoofDistancePct: uiConfig?.spoofDistancePct ?? 0.35,
        fillRatio: 0.5
      });
      if (newEvents.length > 0) {
        setRecentOrderflowEvents((prev) => [...newEvents, ...prev].slice(0, 3));
        if (newEvents.some((e) => e.type === 'PULLED')) {
          soundManager.playSpoofAlert();
        }
      }
      prevActiveDensities.current = currentDensities;

      const prox = evaluateProximityAlert({
        activeDensities: activeDensityList,
        midPrice: mid,
        minDistanceBps: 5,
        maxProximityBps: 25,
        densityThresholdUsd,
        alertLatchState: alertLatchState.current,
        now,
        cooldownMs: 15000
      });
      if (prox && onProximityAlert) {
        soundManager.playProximityAlert();
        onProximityAlert({
          symbol,
          price: prox.price,
          usd: prox.usd,
          side: prox.side,
          distPct: prox.distPct,
          distBps: prox.distBps
        });
      }
    }

    // Aggregate footprint clusters
    let maxClusterUsd = 1;
    let pocKey = null;
    for (const [rawP, cl] of rawClustersMap.current.entries()) {
      const snapped = snapToStep(rawP, 'round');
      const key = snapped.toFixed(priceDecimals);
      const prev = clusterBuckets.get(key) || { bidUsd: 0, askUsd: 0, totalUsd: 0 };
      prev.bidUsd += cl.bidUsd;
      prev.askUsd += cl.askUsd;
      prev.totalUsd = prev.bidUsd + prev.askUsd;
      clusterBuckets.set(key, prev);
      if (prev.totalUsd > maxClusterUsd) {
        maxClusterUsd = prev.totalUsd;
        pocKey = key;
      }
    }

    // Aggregate recent market ticks into bubbles per price step
    const cutoff = now - 25000;
    recentTicksRef.current.forEach((t) => {
      if (t.ts < cutoff) return;
      const snapped = snapToStep(t.price, 'round');
      const key = snapped.toFixed(priceDecimals);
      const prev = tickBubbles.get(key) || { usd: 0, isBuy: t.isBuy, count: 0 };
      prev.usd += t.usd;
      prev.isBuy = t.isBuy;
      prev.count += 1;
      tickBubbles.set(key, prev);
    });

    const bestBidSnap = b0 > 0 ? snapToStep(b0, 'floor') : 0;
    const bestAskSnap = a0 > 0 ? snapToStep(a0, 'ceil') : 0;
    const spreadAbs = b0 > 0 && a0 > 0 ? Math.max(0, a0 - b0) : 0;

    return {
      bidBuckets,
      askBuckets,
      clusterBuckets,
      tickBubbles,
      maxDomVal,
      maxClusterUsd,
      pocKey,
      bestBidSnap,
      bestAskSnap,
      spreadAbs
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    renderVersion,
    stepSize,
    priceDecimals,
    volumeMode,
    densityThresholdUsd,
    snapToStep,
    symbol
  ]);

  // Virtualized window math (±BUFFER_ROWS)
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

  const handleScroll = (e) => {
    setScrollTop(e.currentTarget.scrollTop);
    userScrolledRef.current = true;
  };

  return (
    <div
      style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border-subtle)', color: 'var(--text-main)' }}
      className="flex flex-col h-full border overflow-hidden text-xs select-none relative font-sans"
    >
      {/* Top Header Bar: Title, Price Aggregation (x1..x100), Recenter [Space], FPS, Settings */}
      <div
        style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-1.5 py-1 border-b gap-1 shrink-0"
      >
        <div className="flex items-center space-x-1 font-bold text-white text-[10.5px] shrink-0">
          <Layers size={11} className="text-[#38bdf8]" />
          <span>DOM</span>
          <span className="text-[8.5px] font-mono px-1 py-0.2 rounded bg-[#141c2b] text-[#26a69a] border border-[#26a69a40]">
            {fps} FPS
          </span>
        </div>

        {/* Price Step Aggregation Selector: x1, x5, x10, x25, x50, x100 */}
        <div className="flex items-center bg-[#08090c] p-0.5 rounded border border-[#161820] space-x-0.5 font-mono text-[8.5px] shrink-0">
          {SCALE_OPTIONS.map((mult) => (
            <button
              key={mult}
              onClick={() => setTickMult(mult)}
              className={`px-1 py-0.2 rounded transition ${
                tickMult === mult
                  ? 'bg-[#2563eb] text-white font-bold'
                  : 'text-[#787f91] hover:text-white'
              }`}
              title={`Сжатие шага цены x${mult} (шаг ${(baseTick * mult).toFixed(priceDecimals)})`}
            >
              x{mult}
            </button>
          ))}
        </div>

        {/* Right Controls: Recenter [Space], Settings */}
        <div className="flex items-center space-x-0.5 font-mono shrink-0">
          <button
            onClick={recenterLadder}
            className="flex items-center space-x-0.5 px-1 py-0.5 rounded bg-[#161922] hover:bg-[#2563eb] text-[8.5px] text-[#38bdf8] hover:text-white transition border border-[#1f2430]"
            title="Центрировать на спреде (Горячая клавиша Space)"
          >
            <Crosshair size={10} />
            <span>Центр</span>
          </button>

          <button
            onClick={() => setShowSettings((v) => !v)}
            className={`p-1 rounded transition ${
              showSettings ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'
            }`}
            title="Настройки плотностей и кластеров DOM"
          >
            <Settings2 size={12} />
          </button>
        </div>
      </div>

      {/* Collapsible DOM Quick Settings */}
      {showSettings && (
        <div
          style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
          className="p-2 border-b space-y-1.5 text-[10.5px] font-mono shrink-0"
        >
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Крупная плотность ($):</span>
            <input
              type="number"
              step="25000"
              value={densityThresholdUsd}
              onChange={(e) => setDensityThresholdUsd(Math.max(5000, Number(e.target.value)))}
              className="w-24 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right text-white"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Стена / Мега-уровень ($):</span>
            <input
              type="number"
              step="100000"
              value={megaWallUsd}
              onChange={(e) => setMegaWallUsd(Math.max(50000, Number(e.target.value)))}
              className="w-24 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right text-[#ffb300] font-bold"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Формат кластеров:</span>
            <div className="flex space-x-1">
              <button
                onClick={() => setClusterMode('bid_ask')}
                className={`px-1.5 py-0.5 rounded text-[9.5px] ${
                  clusterMode === 'bid_ask' ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91]'
                }`}
              >
                Bid × Ask
              </button>
              <button
                onClick={() => setClusterMode('delta')}
                className={`px-1.5 py-0.5 rounded text-[9.5px] ${
                  clusterMode === 'delta' ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91]'
                }`}
              >
                Сумма / Δ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spoof / Fill Orderflow Alert Strip */}
      {recentOrderflowEvents.length > 0 && (
        <div className="px-2 py-0.5 bg-[#090b0f] border-b border-[#161922] space-y-0.5 font-mono text-[9.5px] shrink-0">
          {recentOrderflowEvents.slice(0, 2).map((ev, idx) => {
            const isFilled = ev.type === 'FILLED';
            return (
              <div
                key={idx}
                className={`flex items-center justify-between px-1.5 py-0.2 rounded ${
                  isFilled ? 'bg-[#26a69a14] text-[#26a69a]' : 'bg-[#ef535014] text-[#ef5350]'
                }`}
              >
                <span className="flex items-center truncate">
                  {isFilled ? (
                    <CheckCircle size={9} className="mr-1 text-[#26a69a] shrink-0" />
                  ) : (
                    <AlertTriangle size={9} className="mr-1 text-[#ef5350] animate-pulse shrink-0" />
                  )}
                  <span className="truncate">
                    {isFilled ? 'Исполнена' : 'Снята (спуф)'}: ${ev.price.toFixed(priceDecimals)} ({fmtCompactUsd(ev.usd)})
                  </span>
                </span>
                <span className="text-[8.5px] opacity-70 ml-1 shrink-0">
                  {Math.max(1, Math.floor((Date.now() - ev.time) / 1000))}s
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 4-Column CScalp / Tiger Trade Header (Left to Right: Clusters | Ticks | DOM Size | Price) */}
      <div
        style={{ borderColor: 'var(--border-subtle)' }}
        className="grid grid-cols-[36%_16%_26%_22%] px-1.5 py-0.5 text-[9px] text-[#60697b] font-semibold uppercase border-b bg-[#090b0f] font-mono shrink-0"
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

      {/* Virtualized Price Ladder Container (Free Mouse Wheel Scroll, 20px rows) */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
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
            {visibleRows.map((row) => {
              const ask = aggregatedData.askBuckets.get(row.key);
              const bid = aggregatedData.bidBuckets.get(row.key);
              const cl = aggregatedData.clusterBuckets.get(row.key);
              const tick = aggregatedData.tickBubbles.get(row.key);

              const isBestAsk =
                aggregatedData.bestAskSnap > 0 &&
                Math.abs(row.price - aggregatedData.bestAskSnap) < stepSize * 0.4;
              const isBestBid =
                aggregatedData.bestBidSnap > 0 &&
                Math.abs(row.price - aggregatedData.bestBidSnap) < stepSize * 0.4;

              const isAskZone = row.price >= (aggregatedData.bestAskSnap || anchorPrice);
              const bookItem = ask || bid;
              const side = ask ? 'ask' : bid ? 'bid' : isAskZone ? 'ask' : 'bid';

              const usdVal = bookItem ? bookItem.usd : 0;
              const rawVal = bookItem ? (volumeMode === 'USDT' ? bookItem.usd : bookItem.qty) : 0;
              const barPct = bookItem
                ? Math.min(100, (rawVal / aggregatedData.maxDomVal) * 100)
                : 0;

              const isMegaWall = usdVal >= megaWallUsd;
              const isDensity = usdVal >= densityThresholdUsd;
              const isPoc = cl && aggregatedData.pocKey === row.key;

              // Cluster bar width & delta color
              const clPct = cl
                ? Math.min(100, (cl.totalUsd / aggregatedData.maxClusterUsd) * 100)
                : 0;
              const clDeltaPos = cl ? cl.askUsd >= cl.bidUsd : true;

              const firstSeen = levelLifetimes.current.get(row.key);
              const lifeSec = firstSeen ? Math.max(0, Math.floor((Date.now() - firstSeen) / 1000)) : 0;

              // DOM Size background gradation:
              // - Mega Wall (>= $500k/$1M): bright contrast fill with white bold text
              // - Density Wall (>= threshold): amber/gold highlight
              // - Normal level: muted dark red (Ask) or dark green (Bid)
              let domCellBg = 'transparent';
              if (isMegaWall) {
                domCellBg = side === 'ask' ? 'rgba(239, 83, 80, 0.82)' : 'rgba(38, 166, 154, 0.82)';
              } else if (isDensity) {
                domCellBg = 'rgba(255, 179, 0, 0.28)';
              }

              return (
                <div
                  key={row.key}
                  style={{ height: `${ROW_HEIGHT}px` }}
                  className={`grid grid-cols-[36%_16%_26%_22%] items-center border-b border-[#11141c] text-[10.5px] leading-none hover:bg-[#191f2e] ${
                    isBestAsk ? 'border-b-2 border-b-[#38bdf8]' : ''
                  }`}
                >
                  {/* COLUMN 1: Footprint Cluster History (Bid x Ask + POC White Frame) */}
                  <div
                    className={`relative h-full flex items-center px-1 overflow-hidden border-r border-[#131722] ${
                      isPoc ? 'border border-white/90 z-10' : ''
                    }`}
                  >
                    {cl && (
                      <>
                        <div
                          className="absolute left-0 top-0 bottom-0 pointer-events-none"
                          style={{
                            width: `${clPct}%`,
                            backgroundColor: clDeltaPos
                              ? 'rgba(38, 166, 154, 0.25)'
                              : 'rgba(239, 83, 80, 0.25)'
                          }}
                        />
                        {clusterMode === 'bid_ask' ? (
                          <div className="relative z-10 flex items-center justify-between w-full text-[9.5px] tracking-tighter truncate">
                            <span className="text-[#ef5350]">{fmtCompactUsd(cl.bidUsd)}</span>
                            <span className="text-[#4b5563] mx-0.5">×</span>
                            <span className="text-[#26a69a]">{fmtCompactUsd(cl.askUsd)}</span>
                          </div>
                        ) : (
                          <div className="relative z-10 flex items-center justify-between w-full text-[9.5px] truncate">
                            <span className={isPoc ? 'text-white font-bold' : 'text-[#d1d4dc]'}>
                              {fmtCompactUsd(cl.totalUsd)}
                            </span>
                            <span className={clDeltaPos ? 'text-[#26a69a]' : 'text-[#ef5350]'}>
                              {clDeltaPos ? '+' : '-'}
                              {fmtCompactUsd(Math.abs(cl.askUsd - cl.bidUsd))}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* COLUMN 2: Market Ticks / Bubbles on Current Price Level */}
                  <div className="relative h-full flex items-center justify-center border-r border-[#131722] overflow-hidden px-0.5">
                    {tick && (
                      <span
                        className={`px-1 py-0.2 rounded-full text-[9px] font-bold leading-none text-white shadow-xs truncate ${
                          tick.isBuy ? 'bg-[#26a69a]' : 'bg-[#ef5350]'
                        }`}
                        title={`${tick.isBuy ? 'BUY' : 'SELL'} ($${Math.round(tick.usd).toLocaleString()})`}
                      >
                        {fmtCompactUsd(tick.usd)}
                      </span>
                    )}
                  </div>

                  {/* COLUMN 3: DOM Size (Limit Orders Volume + Proportional Fill Bar + Wall Highlight) */}
                  <div
                    style={{ backgroundColor: domCellBg }}
                    className="relative h-full flex items-center justify-end px-1.5 border-r border-[#131722] overflow-hidden"
                  >
                    {bookItem && !isMegaWall && (
                      <div
                        className="absolute right-0 top-0 bottom-0 pointer-events-none"
                        style={{
                          width: `${barPct}%`,
                          backgroundColor:
                            side === 'ask'
                              ? 'rgba(239, 83, 80, 0.22)'
                              : 'rgba(38, 166, 154, 0.22)'
                        }}
                      />
                    )}
                    {bookItem && (
                      <div className="relative z-10 flex items-center justify-between w-full">
                        {isDensity ? (
                          <span
                            className={`text-[8px] px-0.5 rounded font-bold ${
                              isMegaWall
                                ? 'bg-black/40 text-white'
                                : 'bg-[#ffb30030] text-[#ffb300]'
                            }`}
                          >
                            {lifeSec >= 60 ? 'WALL' : `${lifeSec}s`}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span
                          className={`truncate ${
                            isMegaWall
                              ? 'text-white font-extrabold'
                              : isDensity
                              ? 'text-[#ffb300] font-bold'
                              : 'text-[#d1d4dc]'
                          }`}
                        >
                          {volumeMode === 'USDT'
                            ? `$${fmtCompactUsd(bookItem.usd)}`
                            : bookItem.qty.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* COLUMN 4: Price Ladder (Monospace, Spread Line Highlight) */}
                  <div
                    className={`h-full flex items-center justify-end px-1.5 font-semibold ${
                      isBestAsk || isBestBid ? 'bg-[#161e2e]' : ''
                    }`}
                    style={{
                      color:
                        side === 'ask' ? 'var(--color-bear)' : 'var(--color-bull)'
                    }}
                  >
                    <span>{row.price.toFixed(priceDecimals)}</span>
                  </div>
                </div>
              );
            })}
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
          <span>POC рамка • Колесо: скролл • Space: центр</span>
        </span>
      </div>
    </div>
  );
}
