import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectPaperPairs, pairTotalPnl } from './paperPairs.js';

const session = (over = {}) => ({
  strategy_type: 'ema_trend',
  config: { timeframe: '5m', leverage: 10, ai_control: false },
  paper: {
    strategy_type: 'ema_trend',
    timeframe: '5m',
    leverage: 10,
    is_running: true,
    data_status: 'connected',
    current_equity: 1042.5,
    realized_pnl: 30,
    unrealized_pnl: 12.5,
    roi_pct: 4.25,
    open_positions: [{}],
    closed_trades_count: 3,
    closed_trades: [
      { net_pnl: 10 }, { net_pnl: -5 }, { net_pnl: 25 }
    ]
  },
  backtest: { summary: { net_pnl_usd: -35.94 } },
  ...over
});

test('collectPaperPairs: марафон агрегируется в строки по парам', () => {
  const status = { sessions: { BTCUSDT: session(), ETHUSDT: session() } };
  const pairs = collectPaperPairs(status, null);

  assert.equal(pairs.length, 2);
  const btc = pairs.find((p) => p.symbol === 'BTCUSDT');
  assert.deepEqual(btc.sources, ['marathon']);
  assert.equal(btc.strategy, 'ema_trend');
  assert.equal(btc.running, true);
  assert.equal(btc.equity, 1042.5);
  assert.equal(btc.openCount, 1);
  assert.equal(btc.closedCount, 3);
  assert.equal(btc.winRatePct, 66.7); // 2/3 побед
  assert.equal(btc.backtestNetUsd, -35.94);
});

test('collectPaperPairs: live-раннер мержится с марафоном по тому же символу', () => {
  const status = { sessions: { BTCUSDT: session() } };
  const live = { symbol: 'BTCUSDT', strategy_type: 'live_density_bounce', timeframe: '1m', leverage: 5, is_running: true };
  const pairs = collectPaperPairs(status, live);

  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].sources, ['marathon', 'live']);
  assert.equal(pairs[0].strategy, 'ema_trend'); // приоритет марафона
  assert.equal(pairs[0].running, true);
});

test('collectPaperPairs: live-раннер без марафона — отдельная строка', () => {
  const pairs = collectPaperPairs({ sessions: {} }, { symbol: 'DOTUSDT', is_running: false, positions: [{}, {}] });

  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].sources, ['live']);
  assert.equal(pairs[0].openCount, 2);
  assert.equal(pairs[0].running, false);
});

test('collectPaperPairs: сортировка по символу и truth-first (null вместо выдумок)', () => {
  const pairs = collectPaperPairs(
    { sessions: { SOLUSDT: session({ paper: { is_running: false } }), BNBUSDT: session() } },
    null
  );

  assert.deepEqual(pairs.map((p) => p.symbol), ['BNBUSDT', 'SOLUSDT']);
  const sol = pairs.find((p) => p.symbol === 'SOLUSDT');
  assert.equal(sol.equity, null); // в урезанном paper current_equity отсутствует
  assert.equal(sol.winRatePct, null); // closed_trades нет
});

test('pairTotalPnl: сумма realized+unrealized, null если оба неизвестны', () => {
  assert.equal(pairTotalPnl({ realizedPnl: 30, unrealizedPnl: 12.5 }), 42.5);
  assert.equal(pairTotalPnl({ realizedPnl: null, unrealizedPnl: 7 }), 7);
  assert.equal(pairTotalPnl({ realizedPnl: null, unrealizedPnl: null }), null);
  assert.equal(pairTotalPnl(null), null);
});
