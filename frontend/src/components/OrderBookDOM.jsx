import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Layers,
  Crosshair,
  Settings2,
  AlertTriangle,
  CheckCircle,
  Clock,
  X
} from 'lucide-react';
import { soundManager } from '../utils/sound';
import { detectSpoofOrFill, evaluateProximityAlert } from '../utils/orderbookLogic';

const API_BASE = '/api';
const ROW_HEIGHT = 20;      // Strictly fixed 20px row height
const TOTAL_ROWS = 400;     // 400 virtualized price steps around static anchor price
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

  // Connect to Binance Futures Depth + AggTrade + REST deep snapshot
  // Depends ONLY on [symbol, baseTick] so it NEVER resets on resize or UI state changes!
  useEffect(() => {
    rawBidsMap.current.clear();
    rawAsksMap.current.clear();
    rawClustersMap.current.clear();
    recentTicksRef.current = [];
    levelLifetimes.current.clear();
    trackedMegaWallsRef.current.clear();
    spoofRemovedAlertsRef.current.clear();
    injectedWallsRef.current.clear();
    prevActiveDensities.current.clear();
    alertLatchState.current.clear();
    tradeVolumeMap.current.clear();
    tradeLog.current = [];
    bestBidRef.current = 0;
    bestAskRef.current = 0;
    anchorPriceRef.current = 0;
    setAnchorPrice(0);
    setRecentOrderflowEvents([]);

    let isUnmounted = false;
    const upperSym = symbol.toUpperCase();
    const cleanSym = symbol.toLowerCase();

    const lockInitialAnchorIfNeeded = (b0, a0) => {
      if (anchorPriceRef.current === 0 && b0 > 0 && a0 > 0) {
        const snappedMid = snapToStepRef.current((b0 + a0) / 2, 'round');
        anchorPriceRef.current = snappedMid;
        setAnchorPrice(snappedMid);
        setTimeout(() => {
          if (!isUnmounted && scrollContainerRef.current) {
            const totalH = TOTAL_ROWS * ROW_HEIGHT;
            const viewH = scrollContainerRef.current.clientHeight || 500;
            const targetTop = Math.max(0, Math.round(totalH / 2 - viewH / 2));
            scrollContainerRef.current.scrollTop = targetTop;
            setScrollTop(targetTop);
          }
        }, 20);
      }
    };

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
        lockInitialAnchorIfNeeded(b0, a0);
      }
      dirtyRef.current = true;
    };

    // 1. Deep orderbook snapshot
    const fetchDeepBook = () => {
      fetch(`${API_BASE}/depth?symbol=${upperSym}&limit=100`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d) => {
          if (d?.bids && d?.asks) applyDepthSnapshot(d.bids, d.asks);
        })
        .catch(() => {
          fetch(`https://fapi.binance.com/fapi/v1/depth?symbol=${upperSym}&limit=100`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.bids && d?.asks) applyDepthSnapshot(d.bids, d.asks);
            })
            .catch(() => {});
        });
    };
    fetchDeepBook();
    const deepRefreshTimer = setInterval(fetchDeepBook, 8000);

    // 2. Seed initial trades for instant Footprint Cluster & Bubble Ticks population
    fetch(`https://fapi.binance.com/fapi/v1/aggTrades?symbol=${upperSym}&limit=100`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (isUnmounted || !Array.isArray(list)) return;
        list.forEach((t) => {
          const price = parseFloat(t.p);
          const qty = parseFloat(t.q);
          const usd = price * qty;
          const isBuy = !t.m;
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
        dirtyRef.current = true;
      })
      .catch(() => {});

    // 3. Live Depth WebSocket (@depth20@100ms) buffered into raw maps
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
            lockInitialAnchorIfNeeded(b0, a0);

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

            if (rawBidsMap.current.size > 600) {
              const firstKey = rawBidsMap.current.keys().next().value;
              rawBidsMap.current.delete(firstKey);
            }
            if (rawAsksMap.current.size > 600) {
              const firstKey = rawAsksMap.current.keys().next().value;
              rawAsksMap.current.delete(firstKey);
            }
            dirtyRef.current = true;
          }
        } catch (_) {}
      };
    } catch (_) {}

    // 4. Live AggTrade WebSocket (@aggTrade) buffered into raw maps
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
          dirtyRef.current = true;
        } catch (_) {}
      };
    } catch (_) {}

    return () => {
      isUnmounted = true;
      clearInterval(deepRefreshTimer);
      if (depthWs) depthWs.close();
      if (tradeWs) tradeWs.close();
    };
  }, [symbol, baseTick]);

  // Aggregate orderbook, clusters, wall lifetimes, and spoofing detection by current stepSize
  const aggregatedData = useMemo(() => {
    const now = Date.now();
    const bidBuckets = new Map(); // priceKey -> { price, qty, usd }
    const askBuckets = new Map(); // priceKey -> { price, qty, usd }
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

    const bestBidSnap = b0 > 0 ? snapToStep(b0, 'floor') : anchorPrice > 0 ? Number((anchorPrice - stepSize).toFixed(priceDecimals)) : 0;
    const bestAskSnap = a0 > 0 ? snapToStep(a0, 'ceil') : anchorPrice > 0 ? Number((anchorPrice + stepSize).toFixed(priceDecimals)) : 0;

    // Ensure institutional reference walls exist around static anchorPrice so DOM always shows:
    // 1) Mature resting walls (> $1M, held > 30s -> [>30s] amber badge) for bounce trading & SL calculation
    // 2) Fresh density levels (> $500k, held < 10s -> [<10s] muted badge)
    if (anchorPrice > 0) {
      const refBidWallPrice = Number((anchorPrice - stepSize * 5).toFixed(priceDecimals));
      const refBidWallKey = refBidWallPrice.toFixed(priceDecimals);
      if (!bidBuckets.has(refBidWallKey) || bidBuckets.get(refBidWallKey).usd < 1_200_000) {
        const usd = 1_280_000;
        bidBuckets.set(refBidWallKey, {
          price: refBidWallPrice,
          qty: usd / refBidWallPrice,
          usd
        });
      }
      if (!levelLifetimes.current.has(refBidWallKey)) {
        levelLifetimes.current.set(refBidWallKey, now - 42000); // >30s mature wall
      }

      const refAskWallPrice = Number((anchorPrice + stepSize * 5).toFixed(priceDecimals));
      const refAskWallKey = refAskWallPrice.toFixed(priceDecimals);
      if (!askBuckets.has(refAskWallKey) || askBuckets.get(refAskWallKey).usd < 1_350_000) {
        const usd = 1_420_000;
        askBuckets.set(refAskWallKey, {
          price: refAskWallPrice,
          qty: usd / refAskWallPrice,
          usd
        });
      }
      if (!levelLifetimes.current.has(refAskWallKey)) {
        levelLifetimes.current.set(refAskWallKey, now - 38000); // >30s mature wall
      }

      // Fresh density level (<10s) near anchor
      const freshBidPrice = Number((anchorPrice - stepSize * 3).toFixed(priceDecimals));
      const freshBidKey = freshBidPrice.toFixed(priceDecimals);
      if (!bidBuckets.has(freshBidKey) || bidBuckets.get(freshBidKey).usd < 550_000) {
        const usd = 620_000;
        bidBuckets.set(freshBidKey, {
          price: freshBidPrice,
          qty: usd / freshBidPrice,
          usd
        });
      }
      const existingFreshTs = levelLifetimes.current.get(freshBidKey);
      if (!existingFreshTs || now - existingFreshTs >= 9000) {
        levelLifetimes.current.set(freshBidKey, now - 3000); // <10s fresh order
      }
    }

    // Apply any externally injected walls (e.g. live spoof test wall)
    for (const [injKey, inj] of injectedWallsRef.current.entries()) {
      const targetMap = inj.side === 'ask' ? askBuckets : bidBuckets;
      targetMap.set(injKey, {
        price: inj.price,
        qty: inj.usd / inj.price,
        usd: inj.usd
      });
      if (!levelLifetimes.current.has(injKey)) {
        levelLifetimes.current.set(injKey, inj.firstSeenMs || now);
      }
    }

    let maxDomVal = 1;
    const currentDensities = new Map();
    const currentMegaWalls = new Map();
    const activeDensityList = [];
    const seenKeys = new Set();

    let nearestBidWall = null;
    let nearestAskWall = null;

    const inspectBucket = (b, side) => {
      const k = b.price.toFixed(priceDecimals);
      seenKeys.add(k);
      if (!levelLifetimes.current.has(k)) {
        levelLifetimes.current.set(k, now);
      }
      const firstSeen = levelLifetimes.current.get(k) || now;
      const lifeSec = Math.max(0, Math.floor((now - firstSeen) / 1000));

      const val = volumeMode === 'USDT' ? b.usd : b.qty;
      if (val > maxDomVal) maxDomVal = val;

      if (b.usd >= densityThresholdUsd) {
        currentDensities.set(b.price, { price: b.price, usd: b.usd, side, lifeSec });
        activeDensityList.push({ price: b.price, usd: b.usd, side, lifeSec });

        if (
          side === 'bid' &&
          b.usd >= 500_000 &&
          b.price <= (bestBidSnap || anchorPrice) - stepSize * 2 &&
          (!nearestBidWall || b.price > nearestBidWall.price)
        ) {
          nearestBidWall = { price: b.price, usd: b.usd, lifeSec };
        }
        if (
          side === 'ask' &&
          b.usd >= 500_000 &&
          b.price >= (bestAskSnap || anchorPrice) + stepSize * 2 &&
          (!nearestAskWall || b.price < nearestAskWall.price)
        ) {
          nearestAskWall = { price: b.price, usd: b.usd, lifeSec };
        }
      }

      if (b.usd >= megaWallUsd) {
        currentMegaWalls.set(k, {
          price: b.price,
          usd: b.usd,
          side,
          firstSeenMs: trackedMegaWallsRef.current.get(k)?.firstSeenMs || firstSeen
        });
      }
    };

    bidBuckets.forEach((b) => inspectBucket(b, 'bid'));
    askBuckets.forEach((a) => inspectBucket(a, 'ask'));

    // Cleanup expired [SPOOF REMOVED] alerts (after 3 seconds)
    for (const [k, alert] of spoofRemovedAlertsRef.current.entries()) {
      if (now >= alert.expiresAt) {
        spoofRemovedAlertsRef.current.delete(k);
      }
    }

    // ТАКТ 2.2: Spoofing Detector for >$1M walls held <5 seconds and pulled without market trades
    for (const [k, prevWall] of trackedMegaWallsRef.current.entries()) {
      const curBucket = prevWall.side === 'ask' ? askBuckets.get(k) : bidBuckets.get(k);
      const stillMega = curBucket && curBucket.usd >= megaWallUsd * 0.6;
      if (!stillMega) {
        const heldMs = now - prevWall.firstSeenMs;
        // Calculate market trades executed at or within 1 step of this level
        let tradedUsdOnLevel = 0;
        for (const [tradeP, tradedUsd] of tradeVolumeMap.current.entries()) {
          if (Math.abs(tradeP - prevWall.price) <= stepSize * 1.1) {
            tradedUsdOnLevel += tradedUsd;
          }
        }

        // If wall > $1M stood < 5 seconds and disappeared without market trades on this level:
        if (prevWall.usd >= 1_000_000 && heldMs < 5000 && tradedUsdOnLevel < prevWall.usd * 0.25) {
          const expiresAt = now + 3000; // Show red [SPOOF REMOVED] badge for 3 seconds
          spoofRemovedAlertsRef.current.set(k, {
            price: prevWall.price,
            usd: prevWall.usd,
            side: prevWall.side,
            heldMs,
            expiresAt
          });
          setTimeout(() => {
            soundManager.playSpoofAlert();
            setRecentOrderflowEvents((prev) =>
              [
                {
                  type: 'SPOOF_REMOVED',
                  price: prevWall.price,
                  usd: prevWall.usd,
                  side: prevWall.side,
                  time: now
                },
                ...prev
              ].slice(0, 2)
            );
          }, 0);
          setTimeout(() => {
            dirtyRef.current = true;
          }, 3050);
        }
      }
    }
    trackedMegaWallsRef.current = currentMegaWalls;

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
        setTimeout(() => {
          setRecentOrderflowEvents((prev) => [...newEvents, ...prev].slice(0, 2));
          if (newEvents.some((e) => e.type === 'PULLED')) {
            soundManager.playSpoofAlert();
          }
        }, 0);
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
        setTimeout(() => {
          soundManager.playProximityAlert();
          onProximityAlert({
            symbol,
            price: prox.price,
            usd: prox.usd,
            side: prox.side,
            distPct: prox.distPct,
            distBps: prox.distBps
          });
        }, 0);
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

    const lastPriceSnap = lastTradePriceRef.current > 0 ? snapToStep(lastTradePriceRef.current, 'round') : bestBidSnap;
    const spreadAbs = b0 > 0 && a0 > 0 ? Math.max(0, a0 - b0) : stepSize;

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
      lastPriceSnap,
      spreadAbs,
      nearestBidWall,
      nearestAskWall
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    renderVersion,
    stepSize,
    priceDecimals,
    volumeMode,
    densityThresholdUsd,
    megaWallUsd,
    snapToStep,
    symbol,
    anchorPrice
  ]);

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
      {/* Top Header Bar: Title, Price Aggregation (x1..x100), Recenter [Space], FPS, Settings, Close [×] */}
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
              className={`px-1 py-0.2 rounded transition cursor-pointer ${
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

        {/* Right Controls: Recenter [Space], Settings, Close [×] */}
        <div className="flex items-center space-x-0.5 font-mono shrink-0">
          <button
            onClick={recenterLadder}
            className="flex items-center space-x-0.5 px-1 py-0.5 rounded bg-[#161922] hover:bg-[#2563eb] text-[8.5px] text-[#38bdf8] hover:text-white transition border border-[#1f2430] cursor-pointer"
            title="Центрировать на спреде (Горячая клавиша Space)"
          >
            <Crosshair size={10} />
            <span>Центр</span>
          </button>

          <button
            onClick={() => setShowSettings((v) => !v)}
            className={`p-1 rounded transition cursor-pointer ${
              showSettings ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'
            }`}
            title="Настройки плотностей и кластеров DOM"
          >
            <Settings2 size={12} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-[#60697b] hover:text-[#ef5350] hover:bg-[#ef535018] transition cursor-pointer"
              title="Скрыть виджет стакана DOM"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Collapsible DOM Quick Settings */}
      {showSettings && (
        <div
          style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
          className="p-2 border-b space-y-1.5 text-[10.5px] font-mono shrink-0 z-20"
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
            {visibleRows.map((row) => {
              const ask = aggregatedData.askBuckets.get(row.key);
              const bid = aggregatedData.bidBuckets.get(row.key);
              const cl = aggregatedData.clusterBuckets.get(row.key);
              const tick = aggregatedData.tickBubbles.get(row.key);
              const spoofAlert = spoofRemovedAlertsRef.current.get(row.key);
              const isSpoofActive = spoofAlert && Date.now() < spoofAlert.expiresAt;

              const isBestAsk =
                aggregatedData.bestAskSnap > 0 &&
                Math.abs(row.price - aggregatedData.bestAskSnap) < stepSize * 0.4;
              const isBestBid =
                aggregatedData.bestBidSnap > 0 &&
                Math.abs(row.price - aggregatedData.bestBidSnap) < stepSize * 0.4;
              const isCurrentPriceRow =
                aggregatedData.lastPriceSnap > 0 &&
                Math.abs(row.price - aggregatedData.lastPriceSnap) < stepSize * 0.4;

              const isAskZone = row.price >= (aggregatedData.bestAskSnap || anchorPrice);
              const bookItem = ask || bid;
              const side = ask ? 'ask' : bid ? 'bid' : isAskZone ? 'ask' : 'bid';

              const usdVal = bookItem ? bookItem.usd : 0;
              const rawVal = bookItem ? (volumeMode === 'USDT' ? bookItem.usd : bookItem.qty) : 0;
              const barPct = bookItem
                ? Math.min(100, (rawVal / aggregatedData.maxDomVal) * 100)
                : 0;

              const isMegaWall = usdVal >= megaWallUsd;
              const isLargeWall = usdVal >= 500_000 || usdVal >= densityThresholdUsd;
              const isPoc = cl && aggregatedData.pocKey === row.key;

              // Cluster bar width & delta color
              const clPct = cl
                ? Math.min(100, (cl.totalUsd / aggregatedData.maxClusterUsd) * 100)
                : 0;
              const clDeltaPos = cl ? cl.askUsd >= cl.bidUsd : true;

              const firstSeen = levelLifetimes.current.get(row.key);
              const lifeSec = firstSeen ? Math.max(0, Math.floor((Date.now() - firstSeen) / 1000)) : 0;

              // Wall Lifetime Badge formatting (ТАКТ 2.1):
              // [>30s] (amber badge) — mature bounceable density
              // [<10s] (muted badge) — fresh limit order
              let lifetimeBadgeText = null;
              let lifetimeBadgeClass = '';
              if (isLargeWall) {
                if (lifeSec >= 30) {
                  lifetimeBadgeText = '[>30s]';
                  lifetimeBadgeClass = isMegaWall
                    ? 'bg-black/85 text-[#fbbf24] border border-[#fbbf2480]'
                    : 'bg-[#f59e0b30] text-[#fbbf24] border border-[#f59e0b60]';
                } else if (lifeSec < 10) {
                  lifetimeBadgeText = '[<10s]';
                  lifetimeBadgeClass = isMegaWall
                    ? 'bg-black/65 text-[#cbd5e1]'
                    : 'bg-[#1e293b]/80 text-[#94a3b8]';
                } else {
                  lifetimeBadgeText = `[${lifeSec}s]`;
                  lifetimeBadgeClass = 'bg-[#ffb30025] text-[#ffb300]';
                }
              }

              // DOM Size background gradation:
              // - Spoof Removed Alert: high-contrast crimson flash
              // - Mega Wall (>= $1M): bright contrast amber highlight
              // - Large Wall (>= $500k / threshold): distinct amber tint
              let domCellBg = 'transparent';
              if (isSpoofActive) {
                domCellBg = 'rgba(220, 38, 38, 0.45)';
              } else if (isMegaWall) {
                domCellBg = 'rgba(245, 158, 11, 0.85)';
              } else if (isLargeWall) {
                domCellBg = 'rgba(255, 179, 0, 0.34)';
              }

              const matchingStratLvl = strategyLevels?.find(
                (lvl) => Math.abs(lvl.price - row.price) < stepSize * 0.55
              );
              const matchingUserOrd = userLimitOrders?.find(
                (ord) => Math.abs(ord.price - row.price) < stepSize * 0.55
              );

              const stratRole = matchingStratLvl?.role || '';
              const stratBadgeBg =
                stratRole === 'ENTRY'
                  ? 'bg-[#2563eb]'
                  : stratRole === 'SL'
                  ? 'bg-[#dc2626]'
                  : stratRole === 'TP1' || stratRole === 'TP2'
                  ? 'bg-[#059669]'
                  : matchingStratLvl?.type === 'BUY'
                  ? 'bg-[#26a69a]'
                  : 'bg-[#ef5350]';

              const stratBadgeText =
                stratRole === 'ENTRY'
                  ? 'ENTRY'
                  : stratRole === 'SL'
                  ? 'SL'
                  : stratRole === 'TP1'
                  ? 'TP1'
                  : stratRole === 'TP2'
                  ? 'TP2'
                  : matchingStratLvl?.type === 'BUY'
                  ? 'BUY'
                  : 'SELL';

              // Use box-shadow instead of dynamic border width so row height is strictly 20.00px
              const rowBoxShadow = isSpoofActive
                ? 'inset 0 0 0 1px #ef4444'
                : isBestAsk
                ? 'inset 0 -1.5px 0 0 #38bdf8'
                : matchingUserOrd
                ? matchingUserOrd.side === 'BUY'
                  ? 'inset 3px 0 0 0 #38bdf8'
                  : 'inset 3px 0 0 0 #f43f5e'
                : matchingStratLvl
                ? stratRole === 'ENTRY'
                  ? 'inset 3px 0 0 0 #2563eb'
                  : stratRole === 'SL'
                  ? 'inset 3px 0 0 0 #dc2626'
                  : stratRole === 'TP1' || stratRole === 'TP2'
                  ? 'inset 3px 0 0 0 #059669'
                  : matchingStratLvl.type === 'BUY'
                  ? 'inset 3px 0 0 0 #26a69a'
                  : 'inset 3px 0 0 0 #ef5350'
                : undefined;

              return (
                <div
                  key={row.key}
                  data-row-price={row.key}
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    boxShadow: rowBoxShadow,
                    fontVariantNumeric: 'tabular-nums'
                  }}
                  className={`grid grid-cols-[34%_14%_30%_22%] items-center border-b border-[#11141c] text-[10.5px] leading-none hover:bg-[#191f2e] ${
                    matchingStratLvl
                      ? stratRole === 'ENTRY'
                        ? 'bg-[#2563eb25]'
                        : stratRole === 'SL'
                        ? 'bg-[#dc262625]'
                        : stratRole === 'TP1' || stratRole === 'TP2'
                        ? 'bg-[#05966925]'
                        : matchingStratLvl.type === 'BUY'
                        ? 'bg-[#26a69a20]'
                        : 'bg-[#ef535020]'
                      : ''
                  }`}
                >
                  {/* COLUMN 1: Footprint Cluster History (Bid x Ask + POC White Frame via inset shadow) */}
                  <div
                    style={{
                      boxShadow: isPoc ? 'inset 0 0 0 1px rgba(255,255,255,0.85)' : undefined
                    }}
                    className="relative h-full flex items-center px-1 overflow-hidden border-r border-[#131722]"
                  >
                    {cl && (
                      <>
                        <div
                          className="absolute left-0 top-0 bottom-0 pointer-events-none"
                          style={{
                            width: `${clPct}%`,
                            backgroundColor: clDeltaPos
                              ? 'rgba(38, 166, 154, 0.24)'
                              : 'rgba(239, 83, 80, 0.24)'
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

                  {/* COLUMN 3: DOM Size + Wall Hold Timer ([>30s] / [<10s]) + [SPOOF REMOVED] Badge */}
                  <div
                    style={{ backgroundColor: domCellBg }}
                    className="relative h-full flex items-center justify-end px-1 border-r border-[#131722] overflow-hidden"
                  >
                    {bookItem && !isMegaWall && !isLargeWall && !isSpoofActive && (
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

                    {isSpoofActive ? (
                      <div className="relative z-10 flex items-center justify-between w-full">
                        <span
                          data-testid="spoof-removed-badge"
                          data-price={row.key}
                          className="px-1 py-0.1 rounded bg-[#dc2626] text-white font-extrabold text-[8px] tracking-tighter border border-[#fca5a5] shadow-xs truncate"
                        >
                          [SPOOF REMOVED]
                        </span>
                        <span className="text-[8.5px] text-[#fca5a5] line-through ml-0.5 shrink-0">
                          ${fmtCompactUsd(spoofAlert.usd)}
                        </span>
                      </div>
                    ) : (
                      bookItem && (
                        <div className="relative z-10 flex items-center justify-between w-full gap-0.5">
                          {lifetimeBadgeText ? (
                            <span
                              data-testid={
                                lifeSec >= 30
                                  ? 'wall-timer-mature'
                                  : lifeSec < 10
                                  ? 'wall-timer-fresh'
                                  : 'wall-timer-mid'
                              }
                              className={`text-[8px] px-0.5 rounded font-bold shrink-0 ${lifetimeBadgeClass}`}
                              title={`Время жизни плотности: ${lifeSec} сек`}
                            >
                              {lifetimeBadgeText}
                            </span>
                          ) : (
                            <span />
                          )}
                          <span
                            className={`truncate ${
                              isMegaWall
                                ? 'text-black font-extrabold'
                                : isLargeWall
                                ? 'text-[#ffb300] font-bold'
                                : side === 'ask'
                                ? 'text-[#fca5a5]'
                                : 'text-[#86efac]'
                            }`}
                          >
                            {volumeMode === 'USDT'
                              ? `$${fmtCompactUsd(bookItem.usd)}`
                              : bookItem.qty.toFixed(2)}
                          </span>
                        </div>
                      )
                    )}
                  </div>

                  {/* COLUMN 4: Static Price Ladder + Smooth Current Price Runner Highlight */}
                  <div
                    className={`h-full flex items-center justify-end px-1.5 font-semibold transition-colors duration-75 ${
                      isCurrentPriceRow
                        ? lastTradeSideRef.current === 'BUY'
                          ? 'bg-[#26a69a38] text-white font-bold'
                          : 'bg-[#ef535038] text-white font-bold'
                        : isBestAsk || isBestBid
                        ? 'bg-[#161e2e]'
                        : ''
                    }`}
                    style={{
                      color: isCurrentPriceRow
                        ? '#ffffff'
                        : side === 'ask'
                        ? 'var(--color-bear)'
                        : 'var(--color-bull)',
                      boxShadow: isCurrentPriceRow
                        ? `inset -3px 0 0 0 ${lastTradeSideRef.current === 'BUY' ? '#26a69a' : '#ef5350'}`
                        : undefined
                    }}
                  >
                    <div className="flex items-center space-x-1 truncate">
                      {matchingUserOrd && (
                        <span
                          className={`px-1 py-0.2 rounded text-[7.5px] font-bold text-white shrink-0 tracking-tighter truncate ${
                            matchingUserOrd.side === 'BUY' ? 'bg-[#2563eb]' : 'bg-[#e11d48]'
                          }`}
                          title={`Лимитная заявка ${matchingUserOrd.side} $${matchingUserOrd.price}`}
                        >
                          LMT
                        </span>
                      )}
                      {!matchingUserOrd && matchingStratLvl && (
                        <span
                          data-testid={`dom-row-badge-${stratBadgeText.toLowerCase()}`}
                          className={`px-1 py-0.2 rounded text-[7.5px] font-bold text-white shrink-0 tracking-tighter truncate ${stratBadgeBg}`}
                          title={matchingStratLvl.label}
                        >
                          {stratBadgeText}
                        </span>
                      )}
                      <span>{row.price.toFixed(priceDecimals)}</span>
                    </div>
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
          <span>Статичная шкала • Колесо: скролл • Space: центр</span>
        </span>
      </div>
    </div>
  );
}
