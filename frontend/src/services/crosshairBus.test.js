import test from 'node:test';
import assert from 'node:assert/strict';
import { crosshairBus } from './crosshairBus.js';

test('crosshairBus subscribe, publish and loop protection', () => {
  crosshairBus.setEnabled(true);
  const events = [];
  const unsub = crosshairBus.subscribe((ev) => events.push(ev));

  crosshairBus.publish({ timestamp: 1000, price: 50000, sourceId: 'chart-1' });
  // Duplicate event with same properties should be ignored by loop protection
  crosshairBus.publish({ timestamp: 1000, price: 50000, sourceId: 'chart-1' });

  assert.equal(events.length, 1);
  assert.equal(events[0].price, 50000);

  // New event should arrive
  crosshairBus.publish({ timestamp: 2000, price: 50100, sourceId: 'chart-1' });
  assert.equal(events.length, 2);
  assert.equal(events[1].price, 50100);

  unsub();
  crosshairBus.publish({ timestamp: 3000, price: 50200, sourceId: 'chart-1' });
  assert.equal(events.length, 2);
});

test('crosshairBus respects enabled state', () => {
  crosshairBus.setEnabled(false);
  assert.equal(crosshairBus.isEnabled(), false);

  const events = [];
  const unsub = crosshairBus.subscribe((ev) => events.push(ev));
  crosshairBus.publish({ timestamp: 9999, price: 12345, sourceId: 'chart-1' });
  assert.equal(events.length, 0);

  crosshairBus.setEnabled(true);
  assert.equal(crosshairBus.isEnabled(), true);
  crosshairBus.publish({ timestamp: 9999, price: 12345, sourceId: 'chart-1' });
  assert.equal(events.length, 1);
  unsub();
});
