import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateCapital, configKey, validateConfigs, readReport, describeProfileApplication, describePaperAdmission, describeLatestChallenger } from './model.js';
import { createPilotStore } from './store.js';
import * as pilotModel from './model.js';

const config = { symbol: 'BTCUSDT', strategy_type: 'confluence_ema', timeframe: '15m', days: 14, initial_capital: 1000, risk_per_trade_pct: 0.5, stop_loss_pct: 0.8, take_profit_pct: 2.2, leverage: 2, duration_hours: 1 };
const ready = (configs) => ({ preflight_id: 'run-a', sessions: Object.fromEntries(configs.map(c => [c.symbol, { config: c, run_id: 'run-a', preflight_valid: true, forecast: { data_status: 'connected' }, backtest: {}, paper: null }])) });
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }; };

test('allocating a total does not multiply the virtual deposit by symbol count', () => {
  assert.deepEqual(allocateCapital(1000, 3), [333.34, 333.33, 333.33]);
  assert.throws(() => allocateCapital(0, 3));
});
test('validation rejects duplicate symbols, missing risk and invalid duration', () => {
  assert.equal(validateConfigs([config]).length, 0);
  assert.ok(validateConfigs([config, { ...config }]).length);
  for (const change of [{ risk_per_trade_pct: '' }, { initial_capital: 0 }, { duration_hours: 13 }, { stop_loss_pct: NaN }]) assert.ok(validateConfigs([{ ...config, ...change }]).length);
});
test('configuration key ignores property insertion order but includes risk', () => {
  assert.equal(configKey([{ a: 1, b: 2 }]), configKey([{ b: 2, a: 1 }]));
  assert.notEqual(configKey([config]), configKey([{ ...config, risk_per_trade_pct: 1 }]));
});

test('latest challenger summary exposes recommendation and safe promotion state', () => {
  const summary = describeLatestChallenger({ challengers: [
    { job_id: 'old', created_at: 10, challenger_strategy: 'ema_pullback', recommendation: 'KEEP' },
    { job_id: 'new', created_at: 20, challenger_strategy: 'cvd_absorption', recommendation: 'CANDIDATE', promotion_status: 'WAITING_FOR_FLAT', reason: 'better OOS' },
  ] });
  assert.deepEqual(summary, {
    strategy: 'cvd_absorption',
    recommendation: 'CANDIDATE',
    promotionStatus: 'WAITING_FOR_FLAT',
    reason: 'better OOS',
  });
  assert.equal(describeLatestChallenger({ challengers: [] }), null);
});

test('profile application reports server config, closed-candle data, and live-cluster divergence honestly', () => {
  const session = {
    config: { strategy_type: 'ema_trend', timeframe: '15m', days: 14, risk_per_trade_pct: 0.5, stop_loss_pct: 0.8, take_profit_pct: 1.6, leverage: 2 },
    config_fingerprint: 'abcdef0123456789',
    backtest: { meta: { data_availability: { closed_candles_only: true, ohlcv_source: 'Binance Futures OHLCV', open_interest: { available: false } } } },
    forecast: { strategy_type: 'ema_trend', profile_application: { strategy_type: 'ema_trend', signal_engine: 'shared_ohlcv_evaluator', fresh_ohlcv_required: true, filters: { atr: true, stacked_imbalance: true } } },
  };

  const profile = describeProfileApplication(session);

  assert.equal(profile.fingerprint, 'abcdef012345');
  assert.equal(profile.closedCandlesOnly, true);
  assert.equal(profile.freshOhlcvRequired, true);
  assert.equal(profile.sameOhlcvProfile, false);
  assert.equal(profile.liveClusterEvidenceSeparate, true);
  assert.deepEqual(profile.enabledFilters, ['atr', 'stacked imbalance']);
});

test('paper admission makes a blocking verdict visible even after a valid preflight', () => {
  const admission = describePaperAdmission(
    { preflight_valid: true, forecast: { data_status: 'connected', base_scenario: { direction: 'NO_TRADE', reason: 'EMA cross absent' } } },
    { verdict: { level: 'BLOCK', reasons: ['negative expectancy'], flags: ['small sample'] } },
  );

  assert.equal(admission.level, 'BLOCK');
  assert.equal(admission.startAllowed, false);
  assert.equal(admission.scenario, 'NO_TRADE');
  assert.deepEqual(admission.reasons, ['negative expectancy', 'small sample']);
});
test('paper admission requires the displayed draft to match the checked profile', () => {
  const admission = describePaperAdmission(
    { preflight_valid: true, forecast: { data_status: 'connected', unified_signal: { direction: 'LONG' } } },
    { verdict: { level: 'READY' } },
    false,
  );

  assert.equal(admission.level, 'RECHECK');
  assert.equal(admission.startAllowed, false);
  assert.match(admission.reasons[0], /изменён/);
});
test('OOS missing evidence never falls back to profitable training summary', () => {
  const report = readReport({ report: { schema_version: 1, status: 'insufficient_evidence', metrics: null, sample: { closed_trades: 3 } }, summary: { net_pnl_usd: 100 } });
  assert.equal(report.metrics, null);
  assert.equal(report.status, 'insufficient_evidence');
  assert.equal(readReport({}).metrics, null);
});
test('editing a checked draft invalidates launch; late preflight cannot approve it', async () => {
  let resolve;
  const api = { preflight: () => new Promise(r => { resolve = r; }) };
  const store = createPilotStore({ api, storage: storage() });
  store.getState().setConfigs([config]);
  const pending = store.getState().check();
  store.getState().updateConfig(0, { stop_loss_pct: 1 });
  resolve(ready([config])); await pending;
  assert.equal(store.getState().canStart(), false);
  assert.equal(store.getState().configs[0].stop_loss_pct, 1);
});
test('start uses checked configuration and server identity; failure is not success', async () => {
  let received;
  const api = { preflight: async c => ready(c), start: async (c, id) => { received = [c, id]; throw new Error('offline'); } };
  const store = createPilotStore({ api, storage: storage() });
  store.getState().setConfigs([config]); await store.getState().check();
  assert.equal(store.getState().canStart(), true);
  await store.getState().start();
  assert.equal(received[1], 'run-a'); assert.equal(received[0][0].initial_capital, 1000);
  assert.match(store.getState().error, /offline/);
  assert.equal(store.getState().canStart(), false);
});
test('reload restores only draft, and failed refresh marks last snapshot stale', async () => {
  const disk = storage();
  const api = { preflight: async c => ready(c), status: async () => { throw new Error('offline'); } };
  const store = createPilotStore({ api, storage: disk });
  store.getState().setConfigs([config]); await store.getState().check();
  const restored = createPilotStore({ api, storage: disk });
  assert.equal(restored.getState().configs[0].symbol, 'BTCUSDT');
  assert.equal(restored.getState().canStart(), false);
  assert.equal(restored.getState().status, null);
  await store.getState().refresh();
  assert.equal(store.getState().connection, 'disconnected');
  assert.equal(store.getState().canStart(), false);
});

test('status request started before preflight cannot overwrite the new run', async () => {
  let resolve;
  const store = createPilotStore({ storage: storage(), api: { status: () => new Promise(r => { resolve = r; }), preflight: async c => ready(c) } });
  store.getState().setConfigs([config]);
  const poll = store.getState().refresh();
  await store.getState().check();
  resolve({ sessions: {} }); await poll;
  assert.equal(store.getState().status.preflight_id, 'run-a');
  assert.equal(store.getState().canStart(), true);
});
test('late event response cannot replace the selected run journal', async () => {
  let resolve;
  const store = createPilotStore({ storage: storage(), api: { events: id => id === 'old' ? new Promise(r => { resolve = r; }) : Promise.resolve({ events: [{ run_id: 'new', event_id: '2' }] }) } });
  const old = store.getState().loadEvents('old');
  await store.getState().loadEvents('new');
  resolve({ events: [{ run_id: 'old', event_id: '1' }] }); await old;
  assert.equal(store.getState().events[0].run_id, 'new');
});

test('a timed paper run is labeled complete while a manual stop remains stopped', () => {
  const timed = { is_running: false, logs: [{ category: 'SYSTEM', message: 'Paper-сессия автоматически остановлена после 12 ч' }] };
  assert.equal(pilotModel.paperStatusLabel(timed), 'Завершена по таймеру');
  assert.equal(pilotModel.paperStatusLabel({ is_running: false, logs: [] }), 'Остановлена');
});

test('decision journal distinguishes a pending limit order from a filled position', () => {
  const pending = { event_type: 'POSITION_OPENED', reason: 'CVD absorption', payload: { order: { status: 'PENDING' } } };
  assert.match(pilotModel.describePilotEvent(pending).title, /Заявка выставлена/);
  assert.doesNotMatch(pilotModel.describePilotEvent(pending).title, /Позиция открыта/);
});

test('rejected RSI in an extreme-value strategy is explained without reversing the threshold', () => {
  const skipped = { event_type: 'DECISION_SKIPPED', payload: { rejections: [{ filter: 'rsi_filter', actual: 49.63, operator: 'outside', threshold: [42, 58] }] } };
  const description = pilotModel.describePilotEvent(skipped);
  assert.match(description.reason, /49\.63/);
  assert.match(description.reason, /ниже 42 или выше 58/);
});
