/**
 * Pure Order Book Logic & Quant Utilities
 * Handles price tick aggregation, spoof vs filled detection, and proximity alerting with hysteresis.
 */

/**
 * Aggregates orderbook ladder into wider price buckets (x1, x10, x100).
 * @param {Array} rawBids - [[priceStr, qtyStr], ...]
 * @param {Array} rawAsks - [[priceStr, qtyStr], ...]
 * @param {number} multiplier - 1, 10, or 100
 * @param {number} baseTick - e.g. 0.1 for BTC
 * @returns {{ bids: Array, asks: Array }}
 */
export function aggregateDepth(rawBids = [], rawAsks = [], multiplier = 1, baseTick = 0.1) {
  if (multiplier <= 1) {
    return {
      bids: rawBids.slice(0, 16).map(([p, q]) => [parseFloat(p), parseFloat(q)]),
      asks: rawAsks.slice(0, 16).map(([p, q]) => [parseFloat(p), parseFloat(q)])
    };
  }

  const step = Math.max(0.00001, baseTick * multiplier);
  const precision = Math.max(0, -Math.floor(Math.log10(step) + 0.0001));

  // 1. Aggregate Bids (round down with Math.floor)
  const bidBuckets = new Map();
  for (const [pStr, qStr] of rawBids) {
    const p = parseFloat(pStr);
    const q = parseFloat(qStr);
    const bucket = Number((Math.floor(p / step) * step).toFixed(precision));
    bidBuckets.set(bucket, (bidBuckets.get(bucket) || 0) + q);
  }
  const aggregatedBids = Array.from(bidBuckets.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, 16);

  // 2. Aggregate Asks (round up with Math.ceil)
  const askBuckets = new Map();
  for (const [pStr, qStr] of rawAsks) {
    const p = parseFloat(pStr);
    const q = parseFloat(qStr);
    const bucket = Number((Math.ceil(p / step) * step).toFixed(precision));
    askBuckets.set(bucket, (askBuckets.get(bucket) || 0) + q);
  }
  const aggregatedAsks = Array.from(askBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, 16);

  return { bids: aggregatedBids, asks: aggregatedAsks };
}

/**
 * Distinguishes between "Снята (Спуф)" and "Исполнена (Съели объёмом)".
 * If recent trade volume near wall >= 50% of density, it is FILLED, not a spoof!
 * If recent trade volume < 50% and price was approaching (<= spoofDistancePct), it was PULLED (Spoof).
 */
export function detectSpoofOrFill({
  prevDensities,
  currentDensities,
  midPrice,
  tradeVolumeMap,
  densityThresholdUsd = 50000,
  spoofDistancePct = 0.35,
  fillRatio = 0.5
}) {
  const events = [];
  if (!prevDensities || prevDensities.size === 0 || !midPrice) {
    return events;
  }

  for (const [prevP, prevWall] of prevDensities.entries()) {
    if (prevWall.usd >= densityThresholdUsd && !currentDensities.has(prevP)) {
      // Density disappeared!
      const distPct = Math.abs(prevP - midPrice) / midPrice * 100;
      
      // Calculate executed trades volume near this price level (+/- 0.05%)
      let tradedUsdNearLevel = 0;
      if (tradeVolumeMap) {
        for (const [tradeP, tradedUsd] of tradeVolumeMap.entries()) {
          const diffPct = Math.abs(tradeP - prevP) / prevP * 100;
          if (diffPct <= 0.05) {
            tradedUsdNearLevel += tradedUsd;
          }
        }
      }

      if (tradedUsdNearLevel >= prevWall.usd * fillRatio) {
        // Wall was genuinely absorbed / executed by market participants
        events.push({
          type: 'FILLED',
          price: prevP,
          usd: prevWall.usd,
          tradedUsd: tradedUsdNearLevel,
          side: prevWall.side,
          time: Date.now()
        });
      } else if (distPct <= spoofDistancePct) {
        // Wall vanished without trades right as price approached -> SPOOF!
        events.push({
          type: 'PULLED',
          price: prevP,
          usd: prevWall.usd,
          tradedUsd: tradedUsdNearLevel,
          side: prevWall.side,
          time: Date.now()
        });
      }
    }
  }

  return events;
}

/**
 * Evaluates proximity alerts with:
 * 1. Minimum distance filter (minDistanceBps, e.g. 5 bps = 0.05%) to avoid alerting on best bid/ask itself.
 * 2. Maximum trigger distance (maxProximityBps, e.g. 20 bps = 0.20%).
 * 3. Single-alert latching with hysteresis so a wall alerts only once until price leaves and returns.
 */
export function evaluateProximityAlert({
  activeDensities = [],
  midPrice,
  minDistanceBps = 5,
  maxProximityBps = 20,
  densityThresholdUsd = 50000,
  alertLatchState = new Map(),
  now = Date.now(),
  cooldownMs = 15000
}) {
  if (!midPrice || activeDensities.length === 0) {
    return null;
  }

  // 1. Release latch for walls where price has moved far away (hysteresis: > 1.5 * maxProximityBps)
  for (const [p, state] of alertLatchState.entries()) {
    const distBps = Math.abs(p - midPrice) / midPrice * 10000;
    if (distBps > maxProximityBps * 1.5 || (now - state.time > cooldownMs)) {
      alertLatchState.delete(p);
    }
  }

  // 2. Find eligible densities within [minDistanceBps, maxProximityBps]
  let bestCandidate = null;
  let minCandidateDist = Infinity;

  for (const item of activeDensities) {
    if (item.usd < densityThresholdUsd) continue;

    const distBps = Math.abs(item.price - midPrice) / midPrice * 10000;

    // Filter out: too close (e.g. inside the spread / 0.00%) or too far
    if (distBps < minDistanceBps || distBps > maxProximityBps) {
      continue;
    }

    // Check if already latched
    if (alertLatchState.has(item.price)) {
      continue;
    }

    if (distBps < minCandidateDist) {
      minCandidateDist = distBps;
      bestCandidate = {
        price: item.price,
        usd: item.usd,
        side: item.side,
        distBps,
        distPct: distBps / 100
      };
    }
  }

  if (bestCandidate) {
    // Latch this price level
    alertLatchState.set(bestCandidate.price, { time: now, distBps: bestCandidate.distBps });
    return bestCandidate;
  }

  return null;
}
