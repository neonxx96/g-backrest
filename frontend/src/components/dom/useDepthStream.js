import { useEffect } from 'react';
import { ROW_HEIGHT, TOTAL_ROWS } from './constants';

// Хук живого рыночного стакана — вынесен из OrderBookDOM.jsx (модульный план, п.4).
// Отвечает за:
//   1. Deep snapshot книги (REST /api/depth -> failover на Binance, рефреш каждые 8 c)
//   2. Сид начальных aggTrades для мгновенного Footprint Cluster
//   3. Live WebSocket @depth20@100ms с автореконнектом (базовый буфер глубины)
//   4. Live WebSocket @aggTrade с автореконнектом (кластеры, тики, trade log)
// Все буферы — общие мьютейбл-refs компонента; хук их наполняет, агрегация читает.
// Зависимость эффекта — СТРОГО [symbol, baseTick]: реконнект только при смене инструмента.

const API_BASE = '/api';

export default function useDepthStream({
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
}) {
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
            id: t.a ?? `${t.T}-${t.p}-${t.q}`,
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

    // 3. Live Depth WebSocket (@depth20@100ms) with auto-reconnect
    let depthWs = null;
    let depthReconnectTimer = null;

    const connectDepthWs = () => {
      if (isUnmounted) return;
      if (depthReconnectTimer) {
        clearTimeout(depthReconnectTimer);
        depthReconnectTimer = null;
      }
      if (depthWs) {
        try {
          depthWs.onopen = null;
          depthWs.onmessage = null;
          depthWs.onerror = null;
          depthWs.onclose = null;
          depthWs.close();
        } catch (_) {}
        depthWs = null;
      }

      try {
        const ws = new WebSocket(`wss://fstream.binance.com/ws/${cleanSym}@depth20@100ms`);
        depthWs = ws;

        ws.onmessage = (ev) => {
          if (isUnmounted || depthWs !== ws) return;
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

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          if (!isUnmounted && depthWs === ws) {
            depthReconnectTimer = setTimeout(connectDepthWs, 2000);
          }
        };
      } catch (_) {
        if (!isUnmounted) {
          depthReconnectTimer = setTimeout(connectDepthWs, 2500);
        }
      }
    };

    // 4. Live AggTrade WebSocket (@aggTrade) with auto-reconnect
    let tradeWs = null;
    let tradeReconnectTimer = null;

    const connectTradeWs = () => {
      if (isUnmounted) return;
      if (tradeReconnectTimer) {
        clearTimeout(tradeReconnectTimer);
        tradeReconnectTimer = null;
      }
      if (tradeWs) {
        try {
          tradeWs.onopen = null;
          tradeWs.onmessage = null;
          tradeWs.onerror = null;
          tradeWs.onclose = null;
          tradeWs.close();
        } catch (_) {}
        tradeWs = null;
      }

      try {
        const ws = new WebSocket(`wss://fstream.binance.com/ws/${cleanSym}@aggTrade`);
        tradeWs = ws;

        ws.onmessage = (ev) => {
          if (isUnmounted || tradeWs !== ws) return;
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
              id: t.a ?? `${ts}-${t.p}-${t.q}`,
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
            if (tradeLog.current.length > 500) {
              const dropped = tradeLog.current.shift();
              if (dropped) {
                const cv = tradeVolumeMap.current.get(dropped.price) || 0;
                if (cv <= dropped.usd) tradeVolumeMap.current.delete(dropped.price);
                else tradeVolumeMap.current.set(dropped.price, cv - dropped.usd);
              }
            }
            tradeVolumeMap.current.set(price, (tradeVolumeMap.current.get(price) || 0) + usd);
            dirtyRef.current = true;
          } catch (_) {}
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          if (!isUnmounted && tradeWs === ws) {
            tradeReconnectTimer = setTimeout(connectTradeWs, 2000);
          }
        };
      } catch (_) {
        if (!isUnmounted) {
          tradeReconnectTimer = setTimeout(connectTradeWs, 2500);
        }
      }
    };

    const handleNetworkOnline = () => {
      if (isUnmounted) return;
      connectDepthWs();
      connectTradeWs();
      fetchDeepBook();
    };
    window.addEventListener('online', handleNetworkOnline);

    connectDepthWs();
    connectTradeWs();

    return () => {
      isUnmounted = true;
      window.removeEventListener('online', handleNetworkOnline);
      clearInterval(deepRefreshTimer);
      if (depthReconnectTimer) clearTimeout(depthReconnectTimer);
      if (tradeReconnectTimer) clearTimeout(tradeReconnectTimer);
      if (depthWs) {
        try {
          depthWs.onopen = null;
          depthWs.onmessage = null;
          depthWs.onerror = null;
          depthWs.onclose = null;
          depthWs.close();
        } catch (_) {}
        depthWs = null;
      }
      if (tradeWs) {
        try {
          tradeWs.onopen = null;
          tradeWs.onmessage = null;
          tradeWs.onerror = null;
          tradeWs.onclose = null;
          tradeWs.close();
        } catch (_) {}
        tradeWs = null;
      }
    };
  }, [symbol, baseTick]);
}
