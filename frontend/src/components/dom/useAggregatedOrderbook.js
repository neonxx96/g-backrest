import { useMemo } from 'react';
import { soundManager } from '../../utils/sound';
import { detectSpoofOrFill, evaluateProximityAlert } from '../../utils/orderbookLogic';

// Хук агрегации стакана, кластеров, lifetimes стен и детекции спуфинга — вынесен из
// OrderBookDOM.jsx (модульный план, п.4). Тело useMemo перенесено без изменений:
// снаппинг по stepSize, институциональные референс-стены вокруг anchorPrice, инъекции,
// tracked mega walls -> [SPOOF REMOVED], detectSpoofOrFill, proximity alert, footprint
// кластеры и тик-бабблы. Мьютейбл-сторы — общие refs компонента (наполняет useDepthStream).
// Звук/алерты и сайд-эффекты через setTimeout(0) сохранены как в оригинале.

export default function useAggregatedOrderbook({
  renderVersion,
  stepSize,
  priceDecimals,
  volumeMode,
  densityThresholdUsd,
  megaWallUsd,
  snapToStep,
  symbol,
  anchorPrice,
  spoofDistancePct,
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
}) {
  // Aggregate orderbook, clusters, wall lifetimes, and spoofing detection by current stepSize
  return useMemo(() => {
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

    // Truth-First (AGENTS.md §5.2): Никаких выдуманных референс-стенок!
    // В стакане отображаются строго реальные лимитные заявки из L2 WebSocket / REST глубины.

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
        spoofDistancePct: spoofDistancePct ?? 0.35,
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

    let totalBookUsd = 0;
    bidBuckets.forEach((b) => { totalBookUsd += b.usd; });
    askBuckets.forEach((a) => { totalBookUsd += a.usd; });

    const lastPriceSnap = lastTradePriceRef.current > 0 ? snapToStep(lastTradePriceRef.current, 'round') : bestBidSnap;
    const spreadAbs = b0 > 0 && a0 > 0 ? Math.max(0, a0 - b0) : stepSize;

    return {
      bidBuckets,
      askBuckets,
      clusterBuckets,
      tickBubbles,
      maxDomVal,
      maxClusterUsd,
      totalBookUsd,
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
}
