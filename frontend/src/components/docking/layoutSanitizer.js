export const DOCKVIEW_COMPONENT_IDS = new Set([
  'chart', 'orderbook', 'dom', 'watchlist', 'screener', 'signals', 'trades',
  'footprint', 'footprint_placeholder', 'cvd_placeholder', 'papertrade', 'tradehistory',
  'liq_analytics', 'liquidations'
]);

function sanitizeNode(node, panelIds) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'leaf') {
    const views = (node.data?.views || []).filter((id) => panelIds.has(id));
    if (!views.length) return null;
    return { ...node, data: { ...node.data, views, activeView: views.includes(node.data?.activeView) ? node.data.activeView : views[0] } };
  }
  if (node.type === 'branch') {
    const data = (node.data || []).map((child) => sanitizeNode(child, panelIds)).filter(Boolean);
    return data.length ? { ...node, data } : null;
  }
  return null;
}

/** Drop stale Dockview components before restoring a persisted workspace. */
export function sanitizeDockviewLayout(layout) {
  if (!layout?.grid?.root || !layout?.panels) return null;
  let seenTradeHistory = false;
  const panels = {};
  for (const [id, panel] of Object.entries(layout.panels)) {
    if (!DOCKVIEW_COMPONENT_IDS.has(panel?.contentComponent)) continue;
    if (panel?.contentComponent === 'tradehistory' || panel?.contentComponent === 'papertrade') {
      if (seenTradeHistory) {
        continue; // Deduplicate: keep only one paper trading / trade history panel
      }
      seenTradeHistory = true;
      panels[id] = { ...panel, contentComponent: 'tradehistory', title: 'Демо-торговля & Сделки (20 пар)' };
    } else {
      panels[id] = panel;
    }
  }
  const panelIds = new Set(Object.keys(panels));
  const root = sanitizeNode(layout.grid.root, panelIds);
  return root ? { ...layout, panels, grid: { ...layout.grid, root } } : null;
}
