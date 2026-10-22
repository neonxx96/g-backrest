import test from 'node:test';
import assert from 'node:assert/strict';
import { useMarketDataStore } from './marketDataStore.js';

test('before the exchange responds, no seeded prices are published', () => {
  assert.deepEqual(useMarketDataStore.getState().tickers, {});
  assert.equal(useMarketDataStore.getState().lastUpdateTs, null);
});

test('silent socket becomes disconnected, reconnects, and cleanup cancels timers', t => {
  let now = 1000;
  let serial = 0;
  const timers = new Map();
  const sockets = [];
  const oldSocket = globalThis.WebSocket;
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0;
    constructor() { sockets.push(this); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  globalThis.WebSocket = Socket;
  t.mock.method(Date, 'now', () => now);
  for (const name of ['setTimeout', 'setInterval']) t.mock.method(globalThis, name, (callback, ms) => { const id = ++serial; timers.set(id, { callback, ms, type: name }); return id; });
  for (const name of ['clearTimeout', 'clearInterval']) t.mock.method(globalThis, name, id => timers.delete(id));
  t.after(() => { useMarketDataStore.getState().disconnectStream(); globalThis.WebSocket = oldSocket; });
  useMarketDataStore.getState().initMiniTickerStream();
  sockets[0].readyState = 1; sockets[0].onopen();
  assert.equal(useMarketDataStore.getState().isConnected, false);
  sockets[0].onmessage({ data: JSON.stringify([{ s: 'BTCUSDT', c: '100', o: '99', h: '101', l: '98', q: '1000' }]) });
  assert.equal(useMarketDataStore.getState().isConnected, true);
  now += 31000;
  const watchdog = [...timers.values()].find(timer => timer.type === 'setInterval');
  assert.ok(watchdog, 'silent connections need a freshness watchdog');
  watchdog.callback();
  assert.equal(useMarketDataStore.getState().isConnected, false);
  assert.equal(sockets[0].readyState, 3);
  const reconnect = [...timers.values()].find(timer => timer.type === 'setTimeout' && timer.ms >= 2500);
  assert.ok(reconnect);
  reconnect.callback();
  assert.equal(sockets.length, 2);
  useMarketDataStore.getState().disconnectStream();
  assert.equal([...timers.values()].filter(timer => timer.type === 'setInterval').length, 0);
});
