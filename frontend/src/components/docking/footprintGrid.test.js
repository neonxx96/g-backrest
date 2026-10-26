import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFootprintGrid,
  buildSessionProfile,
  detectImbalance,
  fmtVol,
  fmtTime,
  cellSide,
  cellIntensity
} from './footprintGrid.js';

const lvl = (price, buy_vol, sell_vol, imbalance = null) => ({
  price,
  buy_vol,
  sell_vol,
  delta: buy_vol - sell_vol,
  trades: 1,
  imbalance
});

const candle = (timestamp, levels, extra = {}) => ({
  timestamp,
  total_volume: levels.reduce((a, l) => a + l.buy_vol + l.sell_vol, 0),
  total_delta: levels.reduce((a, l) => a + l.delta, 0),
  levels,
  stacked_imbalance: { buy: 0, sell: 0 },
  absorption: false,
  poc_price: null,
  ...extra
});

test('buildFootprintGrid: строки — объединение уровней по убыванию, столбцы — свечи', () => {
  const candles = [
    candle(1000, [lvl(101, 5, 3), lvl(100, 2, 8)]),
    candle(2000, [lvl(102, 1, 1), lvl(101, 4, 4)])
  ];
  const grid = buildFootprintGrid(candles, 14);

  assert.deepEqual(grid.rows.map((r) => r.price), [102, 101, 100]);
  // ячейка (102, свеча 0) пустая, (102, свеча 1) заполнена
  assert.equal(grid.rows[0].cells[0], null);
  assert.equal(grid.rows[0].cells[1].vol, 2);
  // уровень 101 есть в обеих свечах
  assert.equal(grid.rows[1].cells[0].vol, 8);
  assert.equal(grid.rows[1].cells[1].vol, 8);
});

test('buildFootprintGrid: CVD и суммарный объём считаются по окну', () => {
  const candles = [candle(1000, [lvl(100, 10, 5)]), candle(2000, [lvl(100, 2, 12)])];
  const grid = buildFootprintGrid(candles, 14);

  assert.equal(grid.cvd, 5 - 10);
  assert.equal(grid.totalVolume, 15 + 14);
});

test('buildFootprintGrid: maxBars обрезает старые свечи', () => {
  const candles = [candle(1, [lvl(100, 1, 1)]), candle(2, [lvl(100, 2, 2)]), candle(3, [lvl(100, 3, 3)])];
  const grid = buildFootprintGrid(candles, 2);

  assert.equal(grid.bars.length, 2);
  assert.equal(grid.bars[0].timestamp, 2);
});

test('buildFootprintGrid: пустой вход — пустой грид без падения', () => {
  const grid = buildFootprintGrid([], 14);
  assert.deepEqual(grid, { bars: [], rows: [], cvd: 0, totalVolume: 0 });
  assert.deepEqual(buildFootprintGrid(null, 14).rows, []);
});

test('buildFootprintGrid: флаг isPoc по poc_price свечей', () => {
  const candles = [candle(1000, [lvl(100, 1, 1), lvl(101, 9, 9)], { poc_price: 101 })];
  const grid = buildFootprintGrid(candles, 14);

  assert.equal(grid.rows.find((r) => r.price === 101).isPoc, true);
  assert.equal(grid.rows.find((r) => r.price === 100).isPoc, false);
});

test('detectImbalance: порог 3.0 (как бэкенд, >=) и значимый объём', () => {
  assert.equal(detectImbalance(90, 30, 4), 'buy');  // ровно 3.0 -> imbalance (как в annotate_cluster_metrics)
  assert.equal(detectImbalance(91, 30, 4), 'buy');
  assert.equal(detectImbalance(89, 30, 4), null);
  assert.equal(detectImbalance(30, 90, 4), 'sell');
  assert.equal(detectImbalance(25, 0, 1), 'buy');   // односторонний
  assert.equal(detectImbalance(1, 0, 5), null);     // ниже значимости
  assert.equal(detectImbalance(0, 0, 0), null);
});

test('cellSide/cellIntensity: доминанта и нормировка объёма', () => {
  assert.equal(cellSide({ delta: 1 }), 'buy');
  assert.equal(cellSide({ delta: -1 }), 'sell');
  assert.equal(cellSide({ delta: 0 }), null);
  assert.equal(cellSide(null), null);

  assert.equal(cellIntensity({ vol: 5 }, 10), 0.5);
  assert.equal(cellIntensity({ vol: 20 }, 10), 1); // кламп
  assert.equal(cellIntensity(null, 10), 0);
  assert.equal(cellIntensity({ vol: 5 }, 0), 0);
});

test('fmtVol: компактные суффиксы', () => {
  assert.equal(fmtVol(2_345_678), '2.3M');
  assert.equal(fmtVol(12_500), '12.5K');
  assert.equal(fmtVol(47.057), '47.1');
  assert.equal(fmtVol(0.0342), '0.03');
  assert.equal(fmtVol(null), '—');
});

test('fmtTime: HH:MM UTC из epoch-ms', () => {
  assert.equal(fmtTime(0), '00:00');
  assert.equal(fmtTime(null), '—');
  // 2026-10-24 21:55 UTC
  assert.equal(fmtTime(Date.UTC(2026, 9, 24, 21, 55)), '21:55');
});

test('buildSessionProfile: считает суммарный объём по уровням и выделяет Session POC', () => {
  const candles = [
    candle(1000, [lvl(100, 10, 5), lvl(101, 20, 10)], { poc_price: 101 }),
    candle(2000, [lvl(100, 30, 20), lvl(101, 5, 5)], { poc_price: 100 })
  ];
  const grid = buildFootprintGrid(candles, 14);
  const prof = buildSessionProfile(grid);

  // На уровне 100 суммарно 15 + 50 = 65; на 101 суммарно 30 + 10 = 40
  assert.equal(prof.sessionPocPrice, 100);
  assert.equal(prof.maxVol, 65);
  const row100 = prof.levels.find((l) => l.price === 100);
  const row101 = prof.levels.find((l) => l.price === 101);
  assert.equal(row100.isSessionPoc, true);
  assert.equal(row100.vol, 65);
  assert.equal(row101.isSessionPoc, false);
  assert.equal(row101.vol, 40);

  // isCandlePoc маркирует POC конкретной свечи
  assert.equal(grid.rows.find((r) => r.price === 101).cells[0].isCandlePoc, true);
  assert.equal(grid.rows.find((r) => r.price === 101).cells[1].isCandlePoc, false);
  assert.equal(grid.rows.find((r) => r.price === 100).cells[1].isCandlePoc, true);
});

test('detectImbalance: поддерживает кастомный порог imbalanceRatio (200% / 400%)', () => {
  assert.equal(detectImbalance(50, 25, 1, 2.0), 'buy');   // 2.0x при пороге 2.0 -> buy
  assert.equal(detectImbalance(50, 25, 1, 3.0), null);    // 2.0x при пороге 3.0 -> null
  assert.equal(detectImbalance(35, 100, 1, 2.5), 'sell'); // 2.85x при пороге 2.5 -> sell
});
