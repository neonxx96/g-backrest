import test from 'node:test';
import assert from 'node:assert/strict';
import { useColorLinksStore } from '../../stores/colorLinksStore.js';

test('colorLinksStore focusSymbol sets channel symbol and dispatches event', () => {
  const store = useColorLinksStore.getState();
  store.focusSymbol('SOLUSDT', 'c1');
  assert.equal(useColorLinksStore.getState().channels.c1, 'SOLUSDT');
});
