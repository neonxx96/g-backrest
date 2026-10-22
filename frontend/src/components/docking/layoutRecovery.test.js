import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readCachedDockviewLayout,
  resolveDockviewLayout,
  persistDockviewLayoutLocally,
  readChartPanelTimeframe,
  persistChartPanelTimeframe,
} from './layoutRecovery.js';

const validLayout = {
  grid: { root: { type: 'leaf', data: { views: ['chart_main'], activeView: 'chart_main' } } },
  panels: { chart_main: { contentComponent: 'chart' } },
};

test('workspace layout wins, then a valid local snapshot, then built-in defaults', () => {
  const workspaceLayout = { ...validLayout, source: 'workspace' };
  const cachedLayout = { ...validLayout, source: 'cache' };

  assert.deepEqual(
    resolveDockviewLayout({ layout_data: { dockview: workspaceLayout } }, cachedLayout),
    { layout: workspaceLayout, source: 'workspace' },
  );
  assert.deepEqual(resolveDockviewLayout(null, cachedLayout), { layout: cachedLayout, source: 'local' });
  assert.deepEqual(resolveDockviewLayout(null, { panels: {} }), { layout: null, source: 'default' });
});

test('local Dockview snapshot is written synchronously and malformed cache is ignored', () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
  };

  assert.equal(persistDockviewLayoutLocally(validLayout, storage), true);
  assert.deepEqual(readCachedDockviewLayout(storage), validLayout);
  values.set('signalscript_last_dockview_layout', '{bad json');
  assert.equal(readCachedDockviewLayout(storage), null);
});

test('chart timeframe is isolated per panel and invalid saved values fall back safely', () => {
  const values = new Map();
  const storage = {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
  };

  assert.equal(persistChartPanelTimeframe('chart_main', '1h', storage), true);
  assert.equal(persistChartPanelTimeframe('chart_secondary', '5m', storage), true);
  assert.equal(readChartPanelTimeframe('chart_main', storage), '1h');
  assert.equal(readChartPanelTimeframe('chart_secondary', storage), '5m');
  values.set('signalscript_chart_timeframes', JSON.stringify({ chart_main: '2d' }));
  assert.equal(readChartPanelTimeframe('chart_main', storage), '15m');
});
