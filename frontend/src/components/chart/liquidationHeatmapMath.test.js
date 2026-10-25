import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTES,
  samplePalette,
  liquidationsToHeatmapPoints,
  liquidationSplatGeometry,
} from './liquidationHeatmapMath.js';

test('PALETTES contains magma, sunset, viridis and classic', () => {
  assert.ok(PALETTES.magma);
  assert.ok(PALETTES.sunset);
  assert.ok(PALETTES.viridis);
  assert.ok(PALETTES.classic);
  assert.equal(PALETTES.magma.id, 0);
  assert.equal(PALETTES.sunset.id, 1);
  assert.equal(PALETTES.viridis.id, 2);
  assert.equal(PALETTES.classic.id, 3);
});

test('samplePalette returns correct RGB stops and interpolates smoothly', () => {
  // t = 0 возвращает первый стоп Magma
  const c0 = samplePalette('magma', 0);
  assert.equal(c0[0], PALETTES.magma.stops[0][0]);
  assert.equal(c0[1], PALETTES.magma.stops[0][1]);
  assert.equal(c0[2], PALETTES.magma.stops[0][2]);

  // t = 1 возвращает последний стоп Magma
  const cLast = samplePalette('magma', 1);
  const lastStop = PALETTES.magma.stops[PALETTES.magma.stops.length - 1];
  assert.equal(cLast[0], lastStop[0]);
  assert.equal(cLast[1], lastStop[1]);
  assert.equal(cLast[2], lastStop[2]);

  // t = 0.5 находится в разумном диапазоне
  const cMid = samplePalette('magma', 0.5);
  assert.ok(cMid[0] > c0[0], 'красный канал растет к середине палитры Magma');

  // boundary clamping
  const cNeg = samplePalette('magma', -5);
  assert.deepEqual(cNeg, c0);
  const cOver = samplePalette('magma', 99);
  assert.deepEqual(cOver, cLast);

  // sunset и viridis также работают без падений
  assert.equal(samplePalette('sunset', 0.5).length, 3);
  assert.equal(samplePalette('viridis', 0.5).length, 3);
});

test('liquidationsToHeatmapPoints filters by minUsd and computes intensity', () => {
  const events = [
    { timestamp: 1700000000000, price: 60000, usd_amount: 10000, side: 'BUY' },
    { timestamp: 1700000010000, price: 60100, usd_amount: 50000, side: 'SELL' },
    { timestamp: 1700000020000, price: 60200, usd_amount: 200000, side: 'SELL' },
    { timestamp: 0, price: 60000, usd_amount: 100000, side: 'BUY' }, // битый ts
    { timestamp: 1700000030000, price: NaN, usd_amount: 100000, side: 'BUY' }, // битая цена
  ];

  // Фильтр minUsd = 20000 оставляет 2 точки
  const filtered = liquidationsToHeatmapPoints(events, 20000);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].usd_amount, 50000);
  assert.equal(filtered[1].usd_amount, 200000);

  // Точка с максимальным объемом получает intensity = 1.0
  assert.equal(filtered[1].intensity, 1.0);
  assert.equal(filtered[0].intensity, 50000 / 200000);
  assert.equal(filtered[1].side, 'ask'); // SELL -> ask (Long liquidation)
});

test('liquidationSplatGeometry applies blur and opacity multipliers', () => {
  const pt = { intensity: 0.5 };
  const gBase = liquidationSplatGeometry(pt, 1, 1.0, 1.0);
  const gBlur = liquidationSplatGeometry(pt, 1, 2.0, 1.0);
  const gLowAlpha = liquidationSplatGeometry(pt, 1, 1.0, 0.5);

  // blur в 2 раза увеличивает радиус сплата
  assert.equal(gBlur.radiusPx, gBase.radiusPx * 2);

  // low alpha снижает прозрачность в 2 раза
  assert.ok(Math.abs(gLowAlpha.alpha - gBase.alpha * 0.5) < 1e-4);

  // DPR удваивает физические пиксели
  const gDpr2 = liquidationSplatGeometry(pt, 2, 1.0, 1.0);
  assert.equal(gDpr2.radiusPx, gBase.radiusPx * 2);
});
