import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels, formatLabelAmount, PRIORITY_RANKS } from './labelLayout.js';

test('formatLabelAmount formats numbers correctly', () => {
  assert.equal(formatLabelAmount(150_000_000), '$150.0M');
  assert.equal(formatLabelAmount(1_200_000_000), '$1.2B');
  assert.equal(formatLabelAmount(450_000), '$450k');
  assert.equal(formatLabelAmount(999), '$999');
  assert.equal(formatLabelAmount(-500_000), '-$500k');
  assert.equal(formatLabelAmount(null), '$0');
  assert.equal(formatLabelAmount(NaN), '$0');
});

test('layoutLabels respects top-N limit and includes current price', () => {
  const items = [
    { id: 'liq1', y: 100, type: 'liq', valueUsd: 100_000 },
    { id: 'liq2', y: 150, type: 'liq', valueUsd: 200_000 },
    { id: 'liq3', y: 200, type: 'liq', valueUsd: 300_000 },
    { id: 'liq4', y: 250, type: 'liq', valueUsd: 400_000 },
    { id: 'wall1', y: 300, type: 'wall', valueUsd: 1_000_000 },
    { id: 'wall2', y: 350, type: 'wall', valueUsd: 2_000_000 },
    { id: 'curr', y: 220, type: 'current', valueUsd: 0 },
    { id: 'liq5', y: 400, type: 'liq', valueUsd: 50_000 },
  ];

  const result = layoutLabels(items, { height: 600, maxLabels: 4, showAll: false });
  // Should select 4 labels total, and 'curr' must be one of them
  assert.equal(result.length, 4);
  assert.ok(result.some((it) => it.id === 'curr'));
  // Walls should be selected before small liqs
  assert.ok(result.some((it) => it.id === 'wall2'));
  assert.ok(result.some((it) => it.id === 'wall1'));
});

test('layoutLabels spreads overlapping labels apart without collisions', () => {
  const items = [
    { id: 'l1', y: 100, type: 'wall', valueUsd: 500_000 },
    { id: 'l2', y: 104, type: 'liq', valueUsd: 200_000 }, // only 4px gap!
  ];

  const result = layoutLabels(items, { height: 600, minGap: 16 });
  const active = result.filter((it) => !it.hidden);
  assert.equal(active.length, 2);
  const diff = Math.abs(active[1].y - active[0].y);
  assert.ok(diff >= 14, `Expected gap >= 14, got ${diff}`);
});

test('layoutLabels clamps within margins', () => {
  const items = [
    { id: 'top', y: 10, type: 'wall', valueUsd: 100_000 },
    { id: 'bottom', y: 590, type: 'wall', valueUsd: 100_000 },
  ];

  const result = layoutLabels(items, { height: 600, topMargin: 28, bottomMargin: 24, minGap: 16 });
  assert.ok(result[0].y >= 28 + 8);
  assert.ok(result[1].y <= 600 - 24 - 8);
});
