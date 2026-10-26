import test from 'node:test';
import assert from 'node:assert/strict';
import { CHART_ENGINE_METHODS, missingEngineMethods } from './ChartEngine.js';
import { buildChartStyles } from '../chartStyles.js';

test('контракт ChartEngine содержит все обязательные методы приложения', () => {
  for (const m of ['setHistory', 'updateBar', 'setTheme', 'priceTimeToCoord',
    'subscribeViewportChange', 'resize', 'destroy']) {
    assert.ok(CHART_ENGINE_METHODS.includes(m), `нет ${m}`);
  }
});

test('missingEngineMethods: пустой объект и неполная реализация', () => {
  assert.deepEqual(missingEngineMethods(null), [...CHART_ENGINE_METHODS]);
  const partial = { mount() {}, destroy() {} };
  assert.ok(missingEngineMethods(partial).includes('setHistory'));
});

test('KLineChartsV9Adapter реализует весь контракт (без mount, без DOM)', async () => {
  let mod;
  try {
    mod = await import('./KLineChartsV9Adapter.js');
  } catch (e) {
    // klinecharts требует браузерное окружение при импорте — проверяется сборкой/смоуком.
    if (/window|document|self|navigator/i.test(String(e?.message))) return;
    throw e;
  }
  const engine = mod.createKLineChartsV9Adapter();
  assert.deepEqual(missingEngineMethods(engine), []);
  // Без mount всё безопасно и честно пусто:
  assert.equal(engine.isMounted(), false);
  assert.deepEqual(engine.getBars(), []);
  assert.deepEqual(engine.priceTimeToCoord([{ timestamp: 1, price: 1 }]), []);
  assert.equal(engine.getVisibleRange().fromTs, null);
  assert.equal(engine.raw, null);
  const off = engine.subscribeViewportChange(() => {});
  assert.equal(typeof off, 'function');
  engine.destroy();
});

test('buildChartStyles: единая тёмная тема для всех тем терминала', () => {
  for (const theme of ['tealstreet', 'tiger', 'bloomberg']) {
    const s = buildChartStyles({ theme });
    assert.equal(s.separator.color, '#1f2638');
    assert.equal(s.separator.fill, true);
    assert.equal(s.crosshair.horizontal.text.backgroundColor, '#141a26');
    assert.equal(s.crosshair.vertical.line.color, '#3a4560');
    assert.ok(s.candle.tooltip.text.color);
    assert.ok(s.indicator.tooltip.text.color);
    assert.equal(s.grid.show, true);
  }
});

test('buildChartStyles: прозрачность свечей и сетки по-прежнему настраивается', () => {
  const s = buildChartStyles({ gridOpacity: 0.5, candleOpacity: 0.4 });
  assert.match(s.grid.horizontal.color, /, 0\.5\)$/);
  assert.match(s.candle.bar.upColor, /, 0\.4\)$/);
});
