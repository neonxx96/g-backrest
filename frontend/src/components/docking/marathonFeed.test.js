import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectMarathonPositions, collectMarathonTrades, mergePaperLists, hasMarathonData, getSharedPilotAccount, getPilotRunState } from './marathonFeed.js';

const PILOT_STATUS = {
  sessions: {
    BTCUSDT: {
      strategy_type: 'ema_trend',
      paper: {
        open_positions: [
          { symbol: 'BTCUSDT', side: 'LONG', qty: 0.02, avg_entry_price: 88227.3, last_price: 88300.1, unrealized_pnl: 5.81, stop_price: 87900, target_price: 89000 }
        ],
        closed_trades: []
      }
    },
    DOGEUSDT: {
      strategy_type: 'ema_trend',
      paper: {
        open_positions: [
          { symbol: 'DOGEUSDT', side: 'LONG', qty: 31250, avg_entry_price: 0.0768, last_price: 0.0771, unrealized_pnl: 3.2, stop_price: 0.0797, target_price: 0.0804 }
        ],
        closed_trades: [
          { symbol: 'DOGEUSDT', side: 'LONG', entry_price: 0.0760, exit_price: 0.0770, net_pnl: -1.5, fee_drag: 2.49, exit_ts: 1792866632517 }
        ]
      }
    },
    SOLUSDT: { strategy_type: 'ema_trend', paper: { open_positions: null, closed_trades: undefined } }
  },
  aggregate: { paper: { available: true, closed_trades: 1, equity: 14244.51 } }
};

test('collectMarathonPositions собирает open_positions всех сессий и помечает _source', () => {
  const list = collectMarathonPositions(PILOT_STATUS);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((p) => p.symbol).sort(), ['BTCUSDT', 'DOGEUSDT']);
  assert.ok(list.every((p) => p._source === 'marathon'));
  assert.ok(list.every((p) => Number.isFinite(p.avg_entry_price)));
});

test('collectMarathonPositions пуст при отсутствии pilotStatus', () => {
  assert.deepEqual(collectMarathonPositions(null), []);
  assert.deepEqual(collectMarathonPositions({}), []);
});

test('collectMarathonPositions normalizes a singleton backend position object', () => {
  const positions = collectMarathonPositions({
    sessions: {
      BNBUSDT: { paper: { open_positions: { symbol: 'BNBUSDT', side: 'LONG', qty: 0.159 } } },
    },
  });

  assert.deepEqual(positions, [{ symbol: 'BNBUSDT', side: 'LONG', qty: 0.159, _source: 'marathon' }]);
});

test('collectMarathonTrades собирает closed_trades всех сессий и переносит поля сделки', () => {
  const list = collectMarathonTrades(PILOT_STATUS);
  assert.equal(list.length, 1);
  assert.equal(list[0].symbol, 'DOGEUSDT');
  assert.equal(list[0]._source, 'marathon');
  assert.equal(list[0].net_pnl, -1.5);
  assert.equal(list[0].exit_ts, 1792866632517);
});

test('mergePaperLists объединяет live-список и марафон, live идёт первым', () => {
  const live = [{ symbol: 'BTCUSDT', side: 'LONG', net_pnl: 2, _source: 'live' }];
  const merged = mergePaperLists(live, collectMarathonTrades(PILOT_STATUS));
  assert.equal(merged.length, 2);
  assert.equal(merged[0]._source, 'live');
  assert.equal(merged[1]._source, 'marathon');
  assert.deepEqual(mergePaperLists(undefined, []), []);
  assert.deepEqual(mergePaperLists(null, null), []);
});

test('hasMarathonData по aggregate.available или наличию записей', () => {
  assert.equal(hasMarathonData(PILOT_STATUS, [], []), true);
  assert.equal(hasMarathonData({ sessions: {} }, [], []), false);
  assert.equal(hasMarathonData(null, [{ symbol: 'X' }], []), true);
  assert.equal(hasMarathonData(null, [], [{ symbol: 'X' }]), true);
});

test('getSharedPilotAccount never substitutes the legacy wallet for a missing account identity', () => {
  assert.deepEqual(
    getSharedPilotAccount({ aggregate: { paper: { available: true, equity: 100, starting_balance: 100 } } }),
    { available: false, accountId: null, runId: null, equity: null, initialBalance: null, stateSource: 'unavailable' },
  );

  assert.deepEqual(
    getSharedPilotAccount({ aggregate: { paper: {
      available: true,
      account_id: 'overnight_shared_account_1',
      run_id: 'preflight_run_1',
      equity: 998.5,
      starting_balance: 1000,
      state_source: 'persisted_snapshot',
    } } }),
    {
      available: true,
      accountId: 'overnight_shared_account_1',
      runId: 'preflight_run_1',
      equity: 998.5,
      initialBalance: 1000,
      stateSource: 'persisted_snapshot',
    },
  );
});

test('getPilotRunState distinguishes a recoverable persisted run from a live runner', () => {
  assert.deepEqual(
    getPilotRunState({ pilot_running: false, recovery: { required: true, session_count: 5 } }),
    { kind: 'recovery_required', label: 'ТРЕБУЕТ НОВОЙ ПРОВЕРКИ', sessionCount: 5 },
  );
  assert.deepEqual(
    getPilotRunState({ pilot_running: true, sessions: { BTCUSDT: { paper: { is_running: true } } } }),
    { kind: 'running', label: 'RUNNING', sessionCount: 1 },
  );
  assert.deepEqual(getPilotRunState({ sessions: {} }), { kind: 'stopped', label: 'STOPPED', sessionCount: 0 });
});
