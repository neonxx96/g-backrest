/**
 * Unit Test Suite for Order Book Logic
 * Verifies:
 * 1. Density pulled without trades -> 'PULLED' (Spoof)
 * 2. Density eaten by market trades -> 'FILLED' (Not a spoof!)
 * 3. Density far away (> spoofDistancePct) -> Ignored
 * 4. Density too close (< minDistanceBps) -> Ignored (no 0.00% alert on spread)
 * 5. Density in proximity zone [minDistanceBps, maxProximityBps] -> Alerts
 * 6. Single-alert latching & cooldown -> Does NOT alert twice while staying in zone
 * 7. Hysteresis release -> Alerts again when price leaves and returns
 * 8. Price tick aggregation x1, x10, x100
 */

import assert from 'node:assert';
import {
  aggregateDepth,
  detectSpoofOrFill,
  evaluateProximityAlert
} from './src/utils/orderbookLogic.js';

console.log("=" .repeat(70));
console.log("🧪 Запуск Unit-тестов Order Book Logic (Синтетические данные)");
console.log("=" .repeat(70));

let passed = 0;

// Test 1: Density pulled without trades -> PULLED (Spoof)
{
  const prev = new Map([
    [81500, { price: 81500, usd: 200000, side: 'ask' }]
  ]);
  const curr = new Map(); // wall removed
  const midPrice = 81450; // distance = 0.06% (very close)
  const trades = new Map(); // zero trades passed

  const events = detectSpoofOrFill({
    prevDensities: prev,
    currentDensities: curr,
    midPrice,
    tradeVolumeMap: trades,
    densityThresholdUsd: 50000,
    spoofDistancePct: 0.35,
    fillRatio: 0.5
  });

  assert.strictEqual(events.length, 1, "Should detect exactly 1 spoof event");
  assert.strictEqual(events[0].type, 'PULLED', "Type must be PULLED");
  assert.strictEqual(events[0].price, 81500);
  assert.strictEqual(events[0].usd, 200000);
  console.log("✅ Тест 1: Плотность снята без сделок -> 'PULLED' (Спуф обнаружен)");
  passed++;
}

// Test 2: Density eaten by market trades -> FILLED (Not a spoof!)
{
  const prev = new Map([
    [81500, { price: 81500, usd: 200000, side: 'ask' }]
  ]);
  const curr = new Map(); // wall disappeared from depth
  const midPrice = 81501; // price hit and passed the wall
  const trades = new Map([
    [81500, 180000] // $180k trades passed directly at 81500 (> 50% of $200k)
  ]);

  const events = detectSpoofOrFill({
    prevDensities: prev,
    currentDensities: curr,
    midPrice,
    tradeVolumeMap: trades,
    densityThresholdUsd: 50000,
    spoofDistancePct: 0.35,
    fillRatio: 0.5
  });

  assert.strictEqual(events.length, 1, "Should detect 1 filled event");
  assert.strictEqual(events[0].type, 'FILLED', "Type must be FILLED, not PULLED");
  assert.strictEqual(events[0].tradedUsd, 180000);
  console.log("✅ Тест 2: Плотность съедена сделками ($180k) -> 'FILLED' (Не спуф)");
  passed++;
}

// Test 3: Density pulled far away (> 0.35%) -> Ignored
{
  const prev = new Map([
    [82500, { price: 82500, usd: 300000, side: 'ask' }]
  ]);
  const curr = new Map();
  const midPrice = 81000; // distance = 1.85% (> 0.35%)
  const trades = new Map();

  const events = detectSpoofOrFill({
    prevDensities: prev,
    currentDensities: curr,
    midPrice,
    tradeVolumeMap: trades,
    densityThresholdUsd: 50000,
    spoofDistancePct: 0.35
  });

  assert.strictEqual(events.length, 0, "Distant cancellations must NOT trigger spoof alert");
  console.log("✅ Тест 3: Плотность снята далеко от цены (1.85%) -> Игнорируется (Без ложного алерта)");
  passed++;
}

// Test 4: Density too close (< minDistanceBps) -> Ignored (no 0.00% alert on spread)
{
  const latch = new Map();
  const densities = [
    { price: 81486.8, usd: 500000, side: 'ask' } // at 81486.8
  ];
  const midPrice = 81486.75; // dist = 0.06 bps (< 5 bps min distance)

  const alert = evaluateProximityAlert({
    activeDensities: densities,
    midPrice,
    minDistanceBps: 5, // min 5 bps (0.05%)
    maxProximityBps: 20, // max 20 bps (0.20%)
    densityThresholdUsd: 50000,
    alertLatchState: latch,
    now: 1000
  });

  assert.strictEqual(alert, null, "Should not alert when wall is inside spread (< minDistanceBps)");
  console.log("✅ Тест 4: Плотность прямо на спреде (< 5 bps) -> Отфильтрована (Нет алерта 0.00%)");
  passed++;
}

// Test 5: Density in proximity zone [5 bps, 20 bps] -> Fires alert
{
  const latch = new Map();
  const densities = [
    { price: 81570, usd: 250000, side: 'ask' } // dist = 10.4 bps from 81485
  ];
  const midPrice = 81485;

  const alert = evaluateProximityAlert({
    activeDensities: densities,
    midPrice,
    minDistanceBps: 5,
    maxProximityBps: 20,
    densityThresholdUsd: 50000,
    alertLatchState: latch,
    now: 1000
  });

  assert.notStrictEqual(alert, null, "Should alert on 10.4 bps distance");
  assert.strictEqual(alert.price, 81570);
  assert.ok(alert.distBps >= 5 && alert.distBps <= 20);
  console.log(`✅ Тест 5: Плотность на расстоянии ${alert.distPct.toFixed(2)}% -> Алерт сработал корректно`);
  passed++;
}

// Test 6: Single-alert latching & cooldown -> No duplicate alert while in zone
{
  const latch = new Map();
  const densities = [
    { price: 81570, usd: 250000, side: 'ask' }
  ];
  const midPrice = 81485;

  // First check at t=1000 -> Alerts
  const alert1 = evaluateProximityAlert({
    activeDensities: densities,
    midPrice,
    minDistanceBps: 5,
    maxProximityBps: 20,
    densityThresholdUsd: 50000,
    alertLatchState: latch,
    now: 1000,
    cooldownMs: 15000
  });
  assert.notStrictEqual(alert1, null);

  // Second check 2 seconds later (t=3000), price still nearby -> Latched (null)
  const alert2 = evaluateProximityAlert({
    activeDensities: densities,
    midPrice: 81490, // moved slightly but still in zone
    minDistanceBps: 5,
    maxProximityBps: 20,
    densityThresholdUsd: 50000,
    alertLatchState: latch,
    now: 3000,
    cooldownMs: 15000
  });
  assert.strictEqual(alert2, null, "Must NOT alert again while latched");
  console.log("✅ Тест 6: Плотность остаётся в зоне -> Повторный алерт заблокирован (Latch активен)");
  passed++;
}

// Test 7: Hysteresis release -> Price moves away and returns -> Alerts again
{
  const latch = new Map([
    [81570, { time: 1000, distBps: 10 }]
  ]);
  const densities = [
    { price: 81570, usd: 250000, side: 'ask' }
  ];

  // Price moves far away (e.g. down to 81000, dist = 70 bps > 1.5 * 20 bps)
  evaluateProximityAlert({
    activeDensities: densities,
    midPrice: 81000,
    minDistanceBps: 5,
    maxProximityBps: 20,
    densityThresholdUsd: 50000,
    alertLatchState: latch,
    now: 5000
  });
  assert.strictEqual(latch.has(81570), false, "Latch must be released when price leaves zone");

  // Price returns to 81485 -> Fires fresh alert!
  const alert3 = evaluateProximityAlert({
    activeDensities: densities,
    midPrice: 81485,
    minDistanceBps: 5,
    maxProximityBps: 20,
    densityThresholdUsd: 50000,
    alertLatchState: latch,
    now: 8000
  });
  assert.notStrictEqual(alert3, null, "Should alert again after returning from outside zone");
  console.log("✅ Тест 7: Цена ушла и вернулась к плотности -> Новый алерт сработал (Гистерезис)");
  passed++;
}

// Test 8: Price tick aggregation x1, x10, x100
{
  const rawBids = [
    ["81486.7", "1.5"],
    ["81486.2", "2.0"],
    ["81485.8", "5.0"],
    ["81480.1", "10.0"]
  ];
  const rawAsks = [
    ["81486.8", "1.0"],
    ["81487.3", "3.0"],
    ["81489.5", "4.0"],
    ["81495.2", "8.0"]
  ];

  // x1 (no aggregation)
  const x1 = aggregateDepth(rawBids, rawAsks, 1, 0.1);
  assert.strictEqual(x1.bids.length, 4);
  assert.strictEqual(x1.bids[0][0], 81486.7);

  // x10 (step = 1.0)
  const x10 = aggregateDepth(rawBids, rawAsks, 10, 0.1);
  assert.strictEqual(x10.bids[0][0], 81486.0); // 81486.7 + 81486.2 grouped into 81486.0
  assert.strictEqual(x10.bids[0][1], 3.5); // 1.5 + 2.0 = 3.5
  assert.strictEqual(x10.asks[0][0], 81487.0); // ceil(81486.8 / 1) * 1 = 81487.0

  // x100 (step = 10.0)
  const x100 = aggregateDepth(rawBids, rawAsks, 100, 0.1);
  assert.strictEqual(x100.bids[0][0], 81480.0);
  assert.strictEqual(x100.bids[0][1], 18.5); // sum of all bids

  console.log("✅ Тест 8: Агрегация шага цены x1, x10, x100 -> Бакеты и объёмы сгруппированы верно");
  passed++;
}

console.log("=" .repeat(70));
console.log(`🎉 ВСЕ ${passed} UNIT-ТЕСТОВ ПРОЙДЕНЫ УСПЕШНО!`);
console.log("=" .repeat(70));
