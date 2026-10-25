import test from 'node:test';
import assert from 'node:assert/strict';
import { createWallTracker, binLevels, useLiquidityWallStore, getWallsForSymbol } from './liquidityWallStore.js';

// Книга вокруг mid=100: bid 99.9, ask 100.1; tick=0.1
const book = (ts, { bids = [], asks = [] } = {}) => ({
  ts,
  tick: 0.1,
  bids: [[99.9, 10], ...bids],
  asks: [[100.1, 10], ...asks],
  minUsd: 100_000,
});

test('binLevels: bid — floor, ask — ceil, суммирует USD по бину', () => {
  const b = binLevels([[100.04, 1], [100.06, 1]], 'bid', 0.1);
  assert.equal(b.size, 1);
  assert.ok(b.has(100));
  const a = binLevels([[100.04, 1], [100.06, 1]], 'ask', 0.1);
  assert.ok(a.has(100.1));
  assert.equal(binLevels(null, 'bid', 0.1).size, 0);
});

test('пустая/без стенок книга — стенок нет, ничего не выдумывается', () => {
  const t = createWallTracker();
  t.ingest({ ts: 1, bids: [], asks: [] });
  assert.deepEqual(t.getWalls(), []);
  t.ingest(book(2));
  assert.deepEqual(t.getWalls(), []);
});

test('стенка из первого снимка помечена нижней границей возраста', () => {
  const t = createWallTracker();
  t.ingest(book(1000, { bids: [[99.5, 3000]] })); // $298k
  const [w] = t.getWalls();
  assert.equal(w.side, 'bid');
  assert.equal(w.ageIsLowerBound, true);
  assert.equal(w.firstSeenTs, 1000);
});

test('стенка, появившаяся позже, имеет точное время жизни и depthShare', () => {
  const t = createWallTracker();
  t.ingest(book(0));
  t.ingest(book(5000, { asks: [[101, 2000]] })); // $202k
  t.ingest(book(25000, { asks: [[101, 2000]] }));
  const [w] = t.getWalls();
  assert.equal(w.ageIsLowerBound, false);
  assert.equal(w.firstSeenTs, 5000);
  assert.equal(w.lifetimeSec, 20);
  assert.equal(w.depthShare, 1); // единственная стенка
  assert.ok(w.distanceTicks > 5);
  assert.equal(w.spoofScore, null);
});

test('гистерезис: частичное исполнение выше keepRatio не убивает стенку', () => {
  const t = createWallTracker();
  t.ingest(book(0, { bids: [[99.5, 3000]] }));         // $298k
  t.ingest(book(1000, { bids: [[99.5, 1500]] }));      // $149k >= 50k
  assert.equal(t.getWalls().length, 1);
  t.ingest(book(2000, { bids: [[99.5, 300]] }));       // $29k < 50k -> исчезла
  assert.equal(t.getWalls().length, 0);
});

test('стенка снята, цена не дошла -> SPOOF_SUSPECT, score сохраняется на уровне', () => {
  const t = createWallTracker();
  t.ingest(book(0));
  t.ingest(book(1000, { bids: [[99.8, 2000]] })); // близко к цене, $199k
  t.ingest(book(3000));                            // сняли через 2с, bestBid всё ещё 99.9 > 99.8
  const ev = t.getEvents().at(-1);
  assert.equal(ev.type, 'SPOOF_SUSPECT');
  assert.ok(ev.spoofScore >= 0.6);
  // тот же уровень снова появился — несёт историю снятий
  t.ingest(book(4000, { bids: [[99.8, 2000]] }));
  const [w] = t.getWalls();
  assert.equal(w.spoofScore, ev.spoofScore);
});

test('стенка исчезла, потому что цена дошла до неё -> WALL_CONSUMED, не спуф', () => {
  const t = createWallTracker();
  t.ingest(book(0, { bids: [[99.8, 2000]] }));
  // цена упала на уровень стенки: bestBid стал 99.8 или ниже, а стенки в книге нет
  t.ingest({ ts: 1000, tick: 0.1, minUsd: 100_000, bids: [[99.7, 10]], asks: [[99.9, 10]] });
  const ev = t.getEvents().at(-1);
  assert.equal(ev.type, 'WALL_CONSUMED');
  assert.equal(t.getWalls().length, 0);
});

test('сортировка по объёму и meta.sampleMs', () => {
  const t = createWallTracker();
  t.ingest(book(0, { bids: [[99.5, 2000]], asks: [[101, 4000]] }));
  t.ingest(book(2000, { bids: [[99.5, 2000]], asks: [[101, 4000]] }));
  const w = t.getWalls();
  assert.equal(w[0].side, 'ask');
  assert.ok(w[0].volumeUsd > w[1].volumeUsd);
  assert.equal(t.getMeta().sampleMs, 2000);
});

test('zustand-стор: ingestBook / getWallsForSymbol / resetSymbol', () => {
  const st = useLiquidityWallStore.getState();
  assert.deepEqual(getWallsForSymbol('NOPE'), []);
  st.ingestBook('testusdt', book(0, { bids: [[99.5, 3000]] }));
  assert.equal(getWallsForSymbol('TESTUSDT').length, 1);
  useLiquidityWallStore.getState().resetSymbol('TESTUSDT');
  assert.deepEqual(getWallsForSymbol('TESTUSDT'), []);
});
