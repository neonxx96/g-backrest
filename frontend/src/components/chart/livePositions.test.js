// node:test для livePositions.js (нормализация живых позиций для графика).
// Запуск: npm run test:pilot (через scripts/check.ps1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectOpenPositions } from './livePositions.js';

const MARATHON_POS = {
  symbol: 'BTCUSDT', side: 'LONG', qty: 0.0309,
  avg_entry_price: 80832.17, entry_ts: 1792845609208,
  stop_price: 80459.77, target_price: 81267.59, tp2_price: 0.0,
  unrealized_pnl: -4.10, reason: '[ema_trend] EMA cross up',
};

function pilotStatus(positions, strategy = 'ema_trend') {
  return {
    sessions: {
      BTCUSDT: { strategy_type: strategy, paper: { open_positions: positions } },
    },
  };
}

test('collects marathon open position for active symbol', () => {
  const out = collectOpenPositions(pilotStatus([MARATHON_POS]), {}, 'BTCUSDT');
  assert.equal(out.length, 1);
  const pos = out[0];
  assert.equal(pos.source, 'marathon');
  assert.equal(pos.sourceLabel, 'марафон · ema_trend');
  assert.equal(pos.side, 'LONG');
  assert.equal(pos.entryPrice, 80832.17);
  assert.equal(pos.stopPrice, 80459.77);
  assert.equal(pos.targetPrice, 81267.59);
  assert.equal(pos.tp2Price, null); // 0.0 — нет второго тейка, не синтезируем
  assert.equal(pos.unrealizedPnl, -4.10);
  assert.equal(pos.entryTs, 1792845609208);
  assert.ok(pos.key.startsWith('marathon:BTCUSDT:LONG:'));
});

test('collects a singleton marathon position object for the active symbol', () => {
  const positions = collectOpenPositions({
    sessions: { BNBUSDT: { strategy_type: 'ema_trend', paper: { open_positions: { ...MARATHON_POS, symbol: 'BNBUSDT' } } } },
  }, null, 'BNBUSDT');

  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'BNBUSDT');
  assert.equal(positions[0].source, 'marathon');
});

test('collects live-runner position and filters by symbol', () => {
  const live = {
    runner: {
      strategy_type: 'live_density_bounce',
      open_positions: [MARATHON_POS, { ...MARATHON_POS, symbol: 'ETHUSDT' }],
    },
  };
  const out = collectOpenPositions({}, live, 'ethusdt'); // регистронезависимо
  assert.equal(out.length, 1);
  assert.equal(out[0].source, 'live_runner');
  assert.equal(out[0].sourceLabel, 'live · live_density_bounce');
});

test('empty and malformed payloads produce no positions', () => {
  assert.deepEqual(collectOpenPositions({}, {}, 'BTCUSDT'), []);
  assert.deepEqual(collectOpenPositions(null, undefined, 'BTCUSDT'), []);
  assert.deepEqual(
    collectOpenPositions(pilotStatus([{ side: 'LONG' }]), {}, 'BTCUSDT'),
    [], // нет symbol — truth-first, не рисуем
  );
  assert.deepEqual(collectOpenPositions({ sessions: {} }, { runner: {} }, ''), []);
});

test('missing numeric fields stay null, side normalizes', () => {
  const partial = { symbol: 'SOLUSDT', side: 'short', avg_entry_price: 210.5 };
  const out = collectOpenPositions(pilotStatus([partial], 'naked_test'), {}, 'SOLUSDT');
  assert.equal(out.length, 1);
  const pos = out[0];
  assert.equal(pos.side, 'SHORT');
  assert.equal(pos.qty, null);
  assert.equal(pos.stopPrice, null);
  assert.equal(pos.targetPrice, null);
  assert.equal(pos.entryPrice, 210.5);
  assert.equal(pos.entryTs, null);
});
