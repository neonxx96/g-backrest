import test from 'node:test';
import assert from 'node:assert/strict';
import { maxVolumeOf, pointStyle, selectDensityPoints, splatGeometry } from './densityHeatmapMath.js';

const pt = (ts, price, volume_usd, side = 'bid') => ({ timestamp: ts, price, volume_usd, side });

test('maxVolumeOf ignores junk and negatives', () => {
  assert.equal(maxVolumeOf([pt(1, 100, 500), pt(2, 101, '900'), pt(3, 102, -5), pt(4, 103, NaN)]), 900);
  assert.equal(maxVolumeOf([]), 0);
  assert.equal(maxVolumeOf(null), 0);
});

test('pointStyle scales alpha and size with volume share within fixed bounds', () => {
  const zero = pointStyle(0, 1000);
  const half = pointStyle(500, 1000);
  const full = pointStyle(1000, 1000);
  assert.equal(zero.alpha, 0.12);
  assert.equal(zero.sizePx, 12);
  assert.ok(half.alpha > zero.alpha && half.alpha < full.alpha);
  assert.equal(full.alpha, 0.4);
  assert.equal(full.sizePx, 38);
  // отрицательный объём и битый max не ломают диапазоны
  assert.equal(pointStyle(-100, 1000).alpha, 0.12);
  assert.equal(pointStyle(100, 0).alpha, 0.12);
});

test('selectDensityPoints passes through when under budget', () => {
  const pts = [pt(1, 100, 1), pt(2, 101, 2)];
  assert.equal(selectDensityPoints(pts, 10).length, 2);
  assert.equal(selectDensityPoints(null, 10).length, 0);
  assert.equal(selectDensityPoints(undefined, 10).length, 0);
});

test('selectDensityPoints keeps strongest and most recent within budget and dedups', () => {
  const points = [];
  // 40 точек: объёмы убывают со временем (сильнейшие — старые, свежие — слабые),
  // чтобы множества strongest и recent заметно пересекались, но не совпадали
  for (let i = 0; i < 40; i++) points.push(pt(i, 100 + i, 100_000 - i * 1000));
  const budget = 20;
  const selected = selectDensityPoints(points, budget);
  assert.equal(selected.length, budget);
  // свежие точки должны присутствовать (хвост идёт после strongest в мапе;
  // при переполнении бюджета самый последний может обрезаться — это семантика оригинала)
  const firstRecentTs = points[points.length - Math.floor(budget * 0.45)].timestamp;
  assert.ok(selected.some((p) => p.timestamp === firstRecentTs));
  // самая сильная точка (максимальный объём — тоже последняя, но проверим явно)
  const maxVol = Math.max(...points.map((p) => p.volume_usd));
  assert.ok(selected.some((p) => p.volume_usd === maxVol));
  // дедуп: нет пар с одинаковым ключом side:timestamp:price
  const keys = new Set(selected.map((p) => `${p.side}:${p.timestamp}:${p.price}`));
  assert.equal(keys.size, selected.length);
});

test('splatGeometry honours device pixel ratio', () => {
  const g1 = splatGeometry(pt(1, 100, 1000), 1000, 1);
  const g2 = splatGeometry(pt(1, 100, 1000), 1000, 2);
  assert.equal(g2.radiusPx, g1.radiusPx * 2);
  assert.equal(g1.alpha, 0.4);
});
