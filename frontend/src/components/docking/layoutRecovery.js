const LAST_DOCKVIEW_LAYOUT_KEY = 'signalscript_last_dockview_layout';
const CHART_TIMEFRAMES_KEY = 'signalscript_chart_timeframes';
const ALLOWED_CHART_TIMEFRAMES = new Set(['1m', '5m', '15m', '1h', '4h']);

function isDockviewLayout(value) {
  return Boolean(value && typeof value === 'object' && value.grid?.root && value.panels && typeof value.panels === 'object');
}

export function resolveDockviewLayout(workspaceDetail, cachedLayout) {
  const workspaceLayout = workspaceDetail?.layout_data?.dockview;
  if (isDockviewLayout(workspaceLayout)) return { layout: workspaceLayout, source: 'workspace' };
  if (isDockviewLayout(cachedLayout)) return { layout: cachedLayout, source: 'local' };
  return { layout: null, source: 'default' };
}

/** A preset may deliberately be journal- or backtest-only, but never empty. */
export function hasRenderableTerminalPanel(layout) {
  if (!isDockviewLayout(layout)) return false;
  return Object.values(layout.panels || {}).some(
    (panel) => typeof (panel?.contentComponent || panel?.component) === 'string',
  );
}

export function readCachedDockviewLayout(storage = undefined) {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    const raw = target?.getItem(LAST_DOCKVIEW_LAYOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isDockviewLayout(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function persistDockviewLayoutLocally(layout, storage = undefined) {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target || !isDockviewLayout(layout)) return false;
    target.setItem(LAST_DOCKVIEW_LAYOUT_KEY, JSON.stringify(layout));
    return true;
  } catch (_) {
    return false;
  }
}

export function readChartPanelTimeframe(panelId, storage = undefined, fallback = '15m') {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    const saved = JSON.parse(target?.getItem(CHART_TIMEFRAMES_KEY) || '{}');
    const timeframe = saved?.[panelId];
    return ALLOWED_CHART_TIMEFRAMES.has(timeframe) ? timeframe : fallback;
  } catch (_) {
    return fallback;
  }
}

export function persistChartPanelTimeframe(panelId, timeframe, storage = undefined) {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!target || !panelId || !ALLOWED_CHART_TIMEFRAMES.has(timeframe)) return false;
    let saved = {};
    try {
      saved = JSON.parse(target.getItem(CHART_TIMEFRAMES_KEY) || '{}');
    } catch (_) {}
    target.setItem(CHART_TIMEFRAMES_KEY, JSON.stringify({ ...saved, [panelId]: timeframe }));
    return true;
  } catch (_) {
    return false;
  }
}
