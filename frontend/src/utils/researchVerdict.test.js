import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchVerdict, deterministicSignalId } from './researchVerdict.js';

test('blocks paper trading for toxic regime even when history is profitable', () => {
  const verdict = buildResearchVerdict({ netPnlUsd: 12, feeDragPct: 2, profitBleedPct: 0, regime: 'TOXIC_VOLATILITY', hasL2History: false });
  assert.equal(verdict.level, 'BLOCK');
  assert.equal(verdict.label, 'НЕ ТОРГОВАТЬ / БЛОКИРОВКА');
});

test('blocks paper trading for negative net pnl', () => {
  const verdict = buildResearchVerdict({ netPnlUsd: -0.01, feeDragPct: 2, profitBleedPct: 0, regime: 'TREND_IMPULSE', hasL2History: false });
  assert.equal(verdict.level, 'BLOCK');
});

test('warns when L2 history is unavailable but history is positive', () => {
  const verdict = buildResearchVerdict({ netPnlUsd: 5, feeDragPct: 1, profitBleedPct: 0, regime: 'TREND_IMPULSE', hasL2History: false });
  assert.equal(verdict.level, 'WARN');
  assert.equal(verdict.l2Label, 'L2 History: No data (OHLCV only)');
});

test('uses a deterministic signal id for identical fallback payloads', () => {
  const signal = { symbol: 'BTCUSDT', timestamp: 1700000000000, direction: 'LONG', reason: ['EMA20 > EMA50'] };
  assert.equal(deterministicSignalId(signal), deterministicSignalId(signal));
  assert.notEqual(deterministicSignalId(signal), deterministicSignalId({ ...signal, direction: 'SHORT' }));
});
