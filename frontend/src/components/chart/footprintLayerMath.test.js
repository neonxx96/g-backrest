import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTfSupported, rebinLevels, mergeClustersToTf, computeBarMetrics,
  computeNakedPocs, lodFor, createFrameStats, CLUSTER_BUCKET_MS,
} from './footprintLayerMath.js';

const M5 = CLUSTER_BUCKET_MS;
const cl = (ts, levels) => ({ timestamp: ts, levels });
const lv = (price, buy_vol, sell_vol) => ({ price, buy_vol, sell_vol });

test('isTfSupported: только ТФ, кратные 5м (кластеры 5-мин, из OHLCV не строим)', () => {
  assert.equal(isTfSupported(60_000), false);   // 1m
  assert.equal(isTfSupported(180_000), false);  // 3m
  assert.equal(isTfSupported(300_000), true);
  assert.equal(isTfSupported(900_000), true);
  assert.equal(isTfSupported(3_600_000), true);
  assert.equal(isTfSupported(NaN), false);
});

test('rebinLevels: суммирует buy/sell по бину, убывание цены', () => {
  const r = rebinLevels([lv(100.0, 1, 2), lv(100.1, 3, 4), lv(100.9, 5, 0)], 1);
  assert.deepEqual(r.map((x) => x.price), [101, 100]);
  const l100 = r.find((x) => x.price === 100);
  assert.equal(l100.buy, 4);
  assert.equal(l100.sell, 6);
  assert.equal(l100.delta, -2);
});

test('mergeClustersToTf: 3 корзины по 5м склеиваются в бар 15м, coverage и partial', () => {
  const t0 = 15 * 60_000 * 100; // выровнено по 15м
  const clusters = [
    cl(t0, [lv(10, 1, 1)]),
    cl(t0 + M5, [lv(10, 2, 0), lv(11, 1, 0)]),
    cl(t0 + 2 * M5, [lv(11, 0, 3)]),
    cl(t0 + 3 * M5, [lv(10, 1, 0)]), // следующий 15м-бар, только 1 корзина
  ];
  const now = t0 + 10 * 60_000 * 100; // далеко после — оба бара закрыты
  const bars = mergeClustersToTf(clusters, 15 * 60_000, now);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].coverage, 3);
  assert.equal(bars[0].partial, false);
  const l10 = bars[0].levels.find((l) => l.price === 10);
  assert.equal(l10.buy_vol, 3);
  assert.equal(bars[1].coverage, 1);
  assert.equal(bars[1].partial, true); // рекордер включился посреди бара
});

test('mergeClustersToTf: живой (ещё не закрытый) бар не считается partial', () => {
  const t0 = 15 * 60_000 * 100;
  const bars = mergeClustersToTf([cl(t0, [lv(10, 1, 1)])], 15 * 60_000, t0 + 60_000);
  assert.equal(bars[0].partial, false);
});

test('mergeClustersToTf: неподдерживаемый ТФ и мусор -> пусто', () => {
  assert.deepEqual(mergeClustersToTf([cl(0, [lv(1, 1, 1)])], 60_000), []);
  assert.deepEqual(mergeClustersToTf(null, 300_000), []);
  assert.deepEqual(mergeClustersToTf([{ timestamp: 'x' }], 300_000), []);
});

test('computeBarMetrics: POC по макс. объёму, дельта, имбаланс, пустой бар', () => {
  const levels = rebinLevels([lv(10, 1, 1), lv(11, 50, 5), lv(12, 2, 30)], 0);
  const m = computeBarMetrics(levels, 3);
  assert.equal(m.poc, 11);
  assert.equal(m.buyTotal, 53);
  assert.equal(m.sellTotal, 36);
  assert.equal(m.delta, 17);
  assert.equal(m.total, 89);
  assert.equal(m.levels.find((l) => l.price === 11).imbalance, 'buy');
  assert.equal(m.levels.find((l) => l.price === 12).imbalance, 'sell');
  assert.equal(m.levels.find((l) => l.price === 11).isPoc, true);
  assert.equal(computeBarMetrics([]).poc, null);
});

test('computeNakedPocs: касание только в последующих барах, по реальным high/low', () => {
  const tf = 900_000;
  const bars = [{ timestamp: 0, poc: 100 }, { timestamp: tf, poc: 110 }];
  const candles = [
    { timestamp: 0, high: 105, low: 95 },        // собственный бар POC=100 — не считается касанием
    { timestamp: tf, high: 112, low: 102 },       // касается 110 только внутри собственного бара
    { timestamp: 2 * tf, high: 108, low: 99 },    // касается 100
  ];
  const r = computeNakedPocs(bars, candles, tf);
  assert.equal(r[0].touchedTs, 2 * tf);
  assert.equal(r[0].isNaked, false);
  assert.equal(r[1].isNaked, true); // 110 так и не тронута последующими барами
});

test('lodFor: текст скрывается при недостаточном масштабе', () => {
  assert.equal(lodFor(80, 14).text, true);
  assert.equal(lodFor(80, 8).text, false);   // строка низкая
  assert.equal(lodFor(30, 14).text, false);  // колонка узкая
  assert.equal(lodFor(30, 14).cells, 'heat');
  assert.equal(lodFor(3, 14).cells, 'none');
  assert.equal(lodFor(80, 14).plate, true);
  assert.equal(lodFor(30, 14).plate, false);
});

test('createFrameStats: last/avg/max и ограничение окна', () => {
  const s = createFrameStats(3);
  [1, 2, 3, 10].forEach((x) => s.push(x));
  assert.equal(s.last(), 10);
  assert.equal(s.max(), 10);
  assert.equal(s.avg(), 5);
  assert.equal(createFrameStats().avg(), 0);
});
