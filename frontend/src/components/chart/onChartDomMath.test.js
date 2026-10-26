import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateTick, niceBinSize, barLength, buildDomBins, hexToRgba, fmtUsdCompact, fmtLife,
} from './onChartDomMath.js';

test('estimateTick: минимальный шаг между реальными уровнями', () => {
  assert.equal(estimateTick([[100.3, 1], [100.1, 1], [100.2, 1], [100.5, 1]]), 0.1);
  assert.equal(estimateTick([[1, 1]]), null);
  assert.equal(estimateTick(null), null);
});

test('niceBinSize: строка не ниже minRowPx, шаг кратен тику (1/2/5)', () => {
  // 1 пикс = 0.05 цены, нужно >= 12px => 0.6 цены => ratio 6 к тику 0.1 -> 10 тиков = 1.0
  const b = niceBinSize(20, 12, 0.1); // 20px на 1.0 цены => 0.05 цены на пиксель... проверка инварианта
  assert.ok(b >= 0.1);
  assert.ok(b * 20 >= 12 - 1e-6, 'строка должна быть >= 12px');
  // достаточно места — остаёмся на тике
  assert.equal(niceBinSize(1000, 10, 0.1), 0.1);
  // нет масштаба — не падаем
  assert.equal(niceBinSize(0, 10, 0.1), 0.1);
  const m = niceBinSize(2, 12, 0.5); // needed=6 -> ratio=12 -> 20 тиков = 10
  assert.equal(m, 10);
});

test('barLength: линейная и лог-шкала, ограничение длиной', () => {
  assert.equal(barLength(0, 100, 100, false), 0);
  assert.equal(barLength(50, 100, 100, false), 50);
  assert.equal(barLength(100, 100, 100, true), 100);
  // лог-шкала приподнимает малые значения относительно линейной
  assert.ok(barLength(1000, 1_000_000, 100, true) > barLength(1000, 1_000_000, 100, false));
  assert.ok(barLength(5e6, 1e6, 100, false) <= 100);
});

test('buildDomBins: бины по убыванию цены, bid/ask раздельно', () => {
  const bins = buildDomBins([[99.91, 1], [99.95, 1]], [[100.11, 2]], 0.1);
  assert.deepEqual(bins.map((b) => b.side), ['ask', 'bid']);
  assert.ok(bins[0].price > bins[1].price);
  assert.ok(Math.abs(bins[1].usd - (99.91 + 99.95)) < 1e-6);
});

test('форматтеры', () => {
  assert.equal(hexToRgba('#26a69a', 0.5), 'rgba(38, 166, 154, 0.5)');
  assert.equal(fmtUsdCompact(1_280_000), '1.28M');
  assert.equal(fmtUsdCompact(620_000), '620K');
  assert.equal(fmtUsdCompact(0), '');
  assert.equal(fmtLife(42, false), '42с');
  assert.equal(fmtLife(125, true), '≥2м05');
});
