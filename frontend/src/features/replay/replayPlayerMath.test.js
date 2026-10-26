// Юнит-тесты replay-плеера (задача 2.5). Запуск: node --test (через test:pilot).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICE_SERIES_MAX,
  advancePlayback,
  applyReplayEvent,
  bookToBars,
  createInitialPlayerState,
  cvdOf,
} from './replayPlayerMath.js';

const trade = (ts, price, qty, buy) => ({
  seq: 1, timestamp: ts, kind: 'trade',
  payload: { price, quantity: qty, usd_amount: price * qty, is_taker_buy: buy, delta: buy ? qty : -qty },
});
const depth = (ts, bids, asks) => ({ seq: 2, timestamp: ts, kind: 'depth', payload: { bids, asks } });

test('trade event updates price, series and CVD sides', () => {
  let s = createInitialPlayerState();
  s = applyReplayEvent(s, trade(1000, 50000, 0.5, true));
  s = applyReplayEvent(s, trade(1001, 50010, 0.2, false));
  assert.equal(s.lastPrice, 50010);
  assert.equal(s.tradeCount, 2);
  assert.equal(s.buyQty, 0.5);
  assert.equal(s.sellQty, 0.2);
  assert.equal(s.priceSeries.length, 2);
  assert.equal(s.priceSeries[0].price, 50000);
  assert.equal(cvdOf(s), 0.3);
});

test('depth event replaces lastBook and counts', () => {
  let s = createInitialPlayerState();
  s = applyReplayEvent(s, depth(2000, [[100, 1.5]], [[101, 2.5]]));
  assert.deepEqual(s.lastBook.bids, [[100, 1.5]]);
  assert.equal(s.depthCount, 1);
  assert.equal(s.tradeCount, 0);
  s = applyReplayEvent(s, depth(2001, [[99, 1]], [[102, 1]]));
  assert.equal(s.depthCount, 2);
  assert.deepEqual(s.lastBook.asks, [[102, 1]]);
});

test('price series is a capped ring', () => {
  let s = createInitialPlayerState();
  for (let i = 0; i < PRICE_SERIES_MAX + 50; i++) {
    s = applyReplayEvent(s, trade(3000 + i, 100 + i, 0.1, true));
  }
  assert.equal(s.priceSeries.length, PRICE_SERIES_MAX);
  assert.equal(s.priceSeries[s.priceSeries.length - 1].price, 100 + PRICE_SERIES_MAX + 49);
  assert.equal(s.priceSeries[0].price, 100 + 50);
});

test('advancePlayback respects speed and clamps at the end', () => {
  // 100 ev/s за 250 мс → 25 шагов
  assert.deepEqual(advancePlayback(0, 1000, 100, 250), { index: 25, finished: false });
  // доклинка: индекс не перескакивает total
  assert.deepEqual(advancePlayback(998, 1000, 1000, 1000), { index: 1000, finished: true });
  // нулевая скорость — стоим на месте
  assert.deepEqual(advancePlayback(7, 1000, 0, 500), { index: 7, finished: false });
  // пустое окно — finished сразу
  assert.deepEqual(advancePlayback(0, 0, 100, 100), { index: 0, finished: true });
});

test('bookToBars sorts, filters and normalizes widths', () => {
  const book = {
    bids: [[100, 2], [99.5, 8], [101, 0], ['bad', 1], [98, 1]],
    asks: [[101, 4], [102, 1]],
  };
  const bars = bookToBars(book, 3);
  assert.deepEqual(bars.bids.map((b) => b.price), [100, 99.5, 98]);
  assert.equal(bars.bids[0].frac, 0.25); // 2 / max 8
  assert.equal(bars.bids[1].frac, 1);
  assert.deepEqual(bars.asks.map((a) => a.price), [101, 102]);
  assert.equal(bars.asks[0].frac, 1);
  assert.deepEqual(bookToBars(null), { bids: [], asks: [] });
});

test('malformed events are ignored without mutation', () => {
  const s = createInitialPlayerState();
  const same = applyReplayEvent(s, null);
  assert.equal(same, s);
  const s2 = applyReplayEvent(s, { kind: 'unknown', timestamp: 1 });
  assert.equal(s2.tradeCount, 0);
  assert.equal(s2.depthCount, 0);
  assert.equal(s2.lastEventTs, 1);
});
