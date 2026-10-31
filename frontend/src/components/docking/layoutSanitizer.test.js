import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeDockviewLayout,
  hasNullSizes,
  normalizeDockviewSizes,
} from './layoutSanitizer.js';

// Реальный пресет в стиле default_classic: структура здоровая, но size:null везде
// (так dockview v8 сериализует деградировавшее состояние).
const poisonedLayout = {
  grid: {
    orientation: 'HORIZONTAL',
    width: null,
    height: null,
    root: {
      type: 'branch',
      size: null,
      data: [
        { type: 'leaf', size: null, data: { views: ['watchlist_main'], activeView: 'watchlist_main', id: '1' } },
        {
          type: 'branch',
          size: null,
          data: [
            { type: 'leaf', size: null, data: { views: ['chart_main'], activeView: 'chart_main', id: '2' } },
            {
              type: 'branch',
              size: null,
              data: [
                { type: 'leaf', size: null, data: { views: ['orderbook_main'], activeView: 'orderbook_main', id: '4' } },
                { type: 'leaf', size: null, data: { views: ['signals_main'], activeView: 'signals_main', id: '5' } },
              ],
            },
          ],
        },
        { type: 'leaf', size: null, data: { views: ['tradehistory_main'], activeView: 'tradehistory_main', id: '3' } },
      ],
    },
  },
  panels: {
    watchlist_main: { contentComponent: 'watchlist' },
    chart_main: { contentComponent: 'chart' },
    orderbook_main: { contentComponent: 'orderbook' },
    signals_main: { contentComponent: 'signals' },
    tradehistory_main: { contentComponent: 'tradehistory' },
  },
};

test('hasNullSizes detects degenerate serialization marker', () => {
  assert.equal(hasNullSizes(poisonedLayout), true);
  assert.equal(hasNullSizes({ grid: { root: { type: 'leaf', size: 400, data: {} } } }), false);
  assert.equal(hasNullSizes(null), false);
  assert.equal(hasNullSizes({}), false);
});

test('normalizeDockviewSizes bakes explicit sizes into a null-sized layout', () => {
  const layout = JSON.parse(JSON.stringify(poisonedLayout));
  normalizeDockviewSizes(layout, 1920, 1000);

  const root = layout.grid.root;
  assert.equal(typeof root.size, 'number');
  assert.ok(root.size > 0, 'root size must be positive');
  // root HORIZONTAL: size = height, children share width
  assert.equal(root.size, 1000);
  const [watch, mid, tradehistory] = root.data;
  const sum = (n) => n.data.reduce((acc, c) => acc + c.size, 0);
  assert.ok(Math.abs(sum(root) - 1920) <= 4, `children widths must sum to ~1920, got ${sum(root)}`);
  // каждый узел получил числовой size
  const walk = (node) => {
    assert.equal(typeof node.size, 'number', `node ${node.type} must have numeric size`);
    assert.ok(node.size > 0);
    if (Array.isArray(node.data)) node.data.forEach(walk);
  };
  walk(root);
  // вертикальная ветка: дети делят высоту родителя (= root.size)
  assert.ok(Math.abs(sum(mid) - root.size) <= 4, `mid children heights must sum to ~${root.size}`);
  // листья watchlist/tradehistory — ширинные доли root
  assert.ok(watch.size >= 120 && tradehistory.size >= 120);
});

test('normalizeDockviewSizes leaves healthy layouts untouched', () => {
  const healthy = {
    grid: {
      orientation: 'HORIZONTAL',
      width: 2785,
      height: 1324,
      root: {
        type: 'branch',
        size: 1324,
        data: [
          { type: 'leaf', size: 317, data: { views: ['a'] } },
          { type: 'leaf', size: 381, data: { views: ['b'] } },
        ],
      },
    },
    panels: { a: { contentComponent: 'chart' }, b: { contentComponent: 'orderbook' } },
  };
  const before = JSON.stringify(healthy);
  normalizeDockviewSizes(healthy, 1920, 1000);
  assert.equal(JSON.stringify(healthy), before);
});

test('sanitizeDockviewLayout still strips null sizes and unknown components', () => {
  const layout = JSON.parse(JSON.stringify(poisonedLayout));
  layout.panels.stale = { contentComponent: 'unknown_widget' };
  const clean = sanitizeDockviewLayout(layout);
  assert.ok(clean);
  assert.equal(Object.keys(clean.panels).length, 5);
  assert.equal(clean.panels.stale, undefined);
});
