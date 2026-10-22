import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsableMarketPrice, resolveAlertPriceInput } from './marketTruth.js';
import { deriveBacktestStrategyLevels } from './backtestStrategyLevels.js';

test('market price is absent rather than fabricated when the feed is missing or invalid', () => {
  assert.equal(getUsableMarketPrice(67420.5), 67420.5);
  assert.equal(getUsableMarketPrice('67420.5'), 67420.5);
  assert.equal(getUsableMarketPrice(undefined), null);
  assert.equal(getUsableMarketPrice(Number.NaN), null);
  assert.equal(getUsableMarketPrice(0), null);
  assert.equal(getUsableMarketPrice(-2), null);
});

test('alert price starts with explicit prefill, then live price, otherwise stays empty', () => {
  assert.equal(resolveAlertPriceInput(500, 510), '500');
  assert.equal(resolveAlertPriceInput(null, 510), '510');
  assert.equal(resolveAlertPriceInput(undefined, null), '');
});

test('backtest overlays come only from real signal prices and never from symbol constants', () => {
  assert.deepEqual(deriveBacktestStrategyLevels(null), []);
  assert.deepEqual(deriveBacktestStrategyLevels({ signals: [] }), []);
  assert.deepEqual(deriveBacktestStrategyLevels({ signals: [
    { type: 'BUY', price: 100, reason: 'entry' },
    { type: 'SELL', price: 101, reason: 'exit' },
    { type: 'SELL', price: 101, reason: 'duplicate' },
  ] }), [
    { price: 101, type: 'SELL', label: 'SHORT: duplicate', reason: 'duplicate' },
    { price: 100, type: 'BUY', label: 'BUY ZONE: Wall entry', reason: 'entry' },
  ]);
});
