// Адаптер ChartEngine -> klinecharts 9.8.12 (СТРОГО API v9).
// Единственное место, где новый код вызывает init/dispose/applyNewData/convertToPixel.
import { init, dispose } from 'klinecharts';
import { buildChartStyles } from '../chartStyles.js';

const CANDLE_PANE_ID = 'candle_pane';
const VIEWPORT_ACTIONS = ['onZoom', 'onScroll', 'onVisibleRangeChange'];

export function createKLineChartsV9Adapter() {
  let chart = null;
  let container = null;
  let barSpaceMin = 3;
  let barSpaceMax = 60;
  let rafId = 0;
  const viewportSubs = new Set();
  const nativeUnsubs = [];

  const safe = (fn, fallback) => {
    try { return fn(); } catch (_) { return fallback; }
  };

  const tsAtIndex = (idx) => {
    if (!chart || idx == null) return null;
    const list = safe(() => chart.getDataList(), []) || [];
    const i = Math.min(list.length - 1, Math.max(0, Math.round(idx)));
    return list[i]?.timestamp ?? null;
  };

  const getVisibleRange = () => {
    // v9: VisibleRange = { from, to, realFrom, realTo } — ИНДЕКСЫ данных, не объекты.
    const r = chart ? safe(() => chart.getVisibleRange(), null) : null;
    if (!r) return { fromIndex: 0, toIndex: 0, fromTs: null, toTs: null };
    return {
      fromIndex: r.from,
      toIndex: r.to,
      fromTs: tsAtIndex(r.from),
      toTs: tsAtIndex(r.to),
    };
  };

  const getViewport = () => {
    const size = chart ? safe(() => chart.getSize(CANDLE_PANE_ID, 'main'), null) : null;
    return {
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      barSpace: chart ? safe(() => chart.getBarSpace(), 0) : 0,
      range: getVisibleRange(),
    };
  };

  // Один rAF на пачку событий zoom/scroll/resize — слои не перерисовываются дважды за кадр.
  const emitViewport = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!chart || viewportSubs.size === 0) return;
      const vp = getViewport();
      viewportSubs.forEach((cb) => safe(() => cb(vp)));
    });
  };

  const engine = {
    get raw() { return chart; },

    mount(el, opts = {}) {
      if (!el) return;
      if (chart) engine.destroy();
      container = el;
      barSpaceMin = opts.barSpaceMin ?? 3;
      barSpaceMax = opts.barSpaceMax ?? 60;
      safe(() => dispose(el));
      chart = init(el);
      chart.setScrollEnabled(true);
      chart.setZoomEnabled(true);
      safe(() => chart.setPaneOptions({ id: CANDLE_PANE_ID, dragEnabled: true, axisOptions: { scrollZoomEnabled: true } }));
      chart.setStyles(buildChartStyles(opts.uiConfig || {}));
      safe(() => chart.setTimezone(opts.timezone || 'Europe/Kyiv'));

      // Clamp масштаба: защита от деления на ноль на Canvas и искажения оверлеев при колесе.
      const clampZoom = () => safe(() => {
        const bs = chart.getBarSpace();
        if (typeof bs === 'number' && Number.isFinite(bs)) {
          if (bs < barSpaceMin) chart.setBarSpace(barSpaceMin);
          else if (bs > barSpaceMax) chart.setBarSpace(barSpaceMax);
        }
      });
      chart.subscribeAction('onZoom', clampZoom);
      nativeUnsubs.push(() => chart && chart.unsubscribeAction('onZoom', clampZoom));
      for (const type of VIEWPORT_ACTIONS) {
        chart.subscribeAction(type, emitViewport);
        nativeUnsubs.push(() => chart && chart.unsubscribeAction(type, emitViewport));
      }
    },

    destroy() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      nativeUnsubs.splice(0).forEach((fn) => safe(fn));
      viewportSubs.clear();
      if (container) safe(() => dispose(container));
      chart = null;
      container = null;
    },

    isMounted() { return !!chart; },

    setHistory(bars, { hasMore = true, onDone } = {}) {
      if (!chart) return;
      chart.applyNewData(bars || [], hasMore, onDone);
    },

    updateBar(bar) { if (chart && bar) chart.updateData(bar); },
    clear() { if (chart) safe(() => chart.clearData()); },
    getBars() { return chart ? (safe(() => chart.getDataList(), []) || []) : []; },

    setTheme(uiConfig) { if (chart) chart.setStyles(buildChartStyles(uiConfig || {})); },

    priceTimeToCoord(points) {
      if (!chart || !Array.isArray(points) || points.length === 0) return [];
      const res = safe(() => chart.convertToPixel(
        points.map((p) => ({ timestamp: p.timestamp, value: p.price })),
        { paneId: CANDLE_PANE_ID }
      ), []);
      return (Array.isArray(res) ? res : [res]).map((c) => ({
        x: Number.isFinite(c?.x) ? c.x : NaN,
        y: Number.isFinite(c?.y) ? c.y : NaN,
      }));
    },

    coordToPriceTime(coords) {
      if (!chart || !Array.isArray(coords) || coords.length === 0) return [];
      const res = safe(() => chart.convertFromPixel(coords, { paneId: CANDLE_PANE_ID }), []);
      return (Array.isArray(res) ? res : [res]).map((p) => ({
        timestamp: p?.timestamp ?? null,
        price: Number.isFinite(p?.value) ? p.value : null,
      }));
    },

    getVisibleRange,
    getViewport,

    subscribeViewportChange(cb) {
      viewportSubs.add(cb);
      return () => viewportSubs.delete(cb);
    },

    subscribeCrosshair(cb) {
      if (!chart) return () => {};
      // v9: Crosshair = { x, y, paneId, kLineData, dataIndex } — цены нет, считаем из y.
      // Цена осмысленна только над панелью свечей.
      const handler = (data) => {
        let price = null;
        if (data?.paneId === CANDLE_PANE_ID && Number.isFinite(data.y)) {
          const p = safe(() => chart.convertFromPixel([{ y: data.y }], { paneId: CANDLE_PANE_ID }), null);
          const first = Array.isArray(p) ? p[0] : p;
          if (Number.isFinite(first?.value)) price = first.value;
        }
        cb({ timestamp: data?.kLineData?.timestamp ?? null, price });
      };
      chart.subscribeAction('onCrosshairChange', handler);
      const off = () => { if (chart) safe(() => chart.unsubscribeAction('onCrosshairChange', handler)); };
      nativeUnsubs.push(off);
      return off;
    },

    setLoadMore(cb) { if (chart) safe(() => chart.loadMore(cb)); },
    scrollToRealTime() { if (chart) safe(() => chart.scrollToRealTime()); },
    scrollToTimestamp(ts) { if (chart) safe(() => chart.scrollToTimestamp(ts, 0)); },
    resize() { if (chart) safe(() => chart.resize()); },
  };

  return engine;
}
