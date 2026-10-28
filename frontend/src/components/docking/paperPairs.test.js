import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectPaperPairs,
  pairTotalPnl,
  sortPaperPairs,
  filterPaperPairs,
  collectCandidateSetups
} from './paperPairs.js';

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

test('collectPaperPairs counts a singleton backend open position', () => {
  const rows = collectPaperPairs({
    sessions: {
      BNBUSDT: { strategy_type: 'ema_trend', paper: { is_running: true, open_positions: { symbol: 'BNBUSDT', qty: 0.159 } } },
    },
  }, null);

  assert.equal(rows[0].openCount, 1);
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

test('sortPaperPairs: корректно сортирует по pnl, equity и winrate с учетом null', () => {
  const p1 = { symbol: 'BTCUSDT', equity: 1050, realizedPnl: 50, unrealizedPnl: 0, winRatePct: 60 };
  const p2 = { symbol: 'ETHUSDT', equity: 980, realizedPnl: -20, unrealizedPnl: 0, winRatePct: 40 };
  const p3 = { symbol: 'SOLUSDT', equity: null, realizedPnl: null, unrealizedPnl: null, winRatePct: null };

  const byPnlDesc = sortPaperPairs([p1, p2, p3], 'pnl', 'desc');
  assert.equal(byPnlDesc[0].symbol, 'BTCUSDT'); // +50
  assert.equal(byPnlDesc[1].symbol, 'ETHUSDT'); // -20
  assert.equal(byPnlDesc[2].symbol, 'SOLUSDT'); // null в конце

  const byEquityAsc = sortPaperPairs([p1, p2, p3], 'equity', 'asc');
  assert.equal(byEquityAsc[0].symbol, 'ETHUSDT'); // 980
  assert.equal(byEquityAsc[1].symbol, 'BTCUSDT'); // 1050
  assert.equal(byEquityAsc[2].symbol, 'SOLUSDT'); // null в конце
});

test('filterPaperPairs: фильтрует по строке поиска и статусу', () => {
  const list = [
    { symbol: 'BTCUSDT', strategy: 'ema_trend', running: true, openCount: 1, dataStatus: 'connected' },
    { symbol: 'ETHUSDT', strategy: 'confluence_ema', running: false, openCount: 0, dataStatus: 'connected' },
    { symbol: 'SOLUSDT', strategy: 'cvd_absorption', running: true, openCount: 0, dataStatus: 'stale' }
  ];

  const searchEth = filterPaperPairs(list, { search: 'ETH' });
  assert.equal(searchEth.length, 1);
  assert.equal(searchEth[0].symbol, 'ETHUSDT');

  const runningOnly = filterPaperPairs(list, { statusFilter: 'running' });
  assert.equal(runningOnly.length, 2);

  const activePosOnly = filterPaperPairs(list, { statusFilter: 'active_positions' });
  assert.equal(activePosOnly.length, 1);
  assert.equal(activePosOnly[0].symbol, 'BTCUSDT');

  const dataAlertOnly = filterPaperPairs(list, { statusFilter: 'data_alert' });
  assert.equal(dataAlertOnly.length, 1);
  assert.equal(dataAlertOnly[0].symbol, 'SOLUSDT');
});

test('collectCandidateSetups: собирает working orders и прогнозные сетапы', () => {
  const sessionData = {
    active_orders: [
      { order_id: 'ord_1', symbol: 'BTCUSDT', role: 'entry', side: 'LONG', price: 60000, context_snapshot: { price: 60200 } }
    ]
  };
  const pilotStatus = {
    sessions: {
      ETHUSDT: {
        config: { strategy_type: 'cvd_absorption' },
        forecast: {
          unified_signal: { direction: 'SHORT', entry_price: 2600, sl: 2650, tp1: 2500, expected_rr: 2.0 },
          cone: { base_price: 2610 }
        }
      }
    }
  };

  const candidates = collectCandidateSetups(pilotStatus, null, sessionData);
  assert.equal(candidates.length, 2);
  assert.equal(candidates.some(c => c.symbol === 'BTCUSDT' && c.type === 'ORDER'), true);
  assert.equal(candidates.some(c => c.symbol === 'ETHUSDT' && c.type === 'SETUP'), true);
});
