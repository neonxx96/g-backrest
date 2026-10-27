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
    const cleanNode = {
      ...node,
      data: {
        ...node.data,
        views,
        activeView: views.includes(node.data?.activeView) ? node.data.activeView : views[0]
      }
    };
    if (cleanNode.size === null || (cleanNode.size !== undefined && typeof cleanNode.size !== 'number' && (!cleanNode.size || typeof cleanNode.size !== 'object' || !cleanNode.size.type))) {
      delete cleanNode.size;
    }
    return cleanNode;
  }
  if (node.type === 'branch') {
    const data = (node.data || []).map((child) => sanitizeNode(child, panelIds)).filter(Boolean);
    if (!data.length) return null;
    const cleanNode = { ...node, data };
    if (cleanNode.size === null || (cleanNode.size !== undefined && typeof cleanNode.size !== 'number' && (!cleanNode.size || typeof cleanNode.size !== 'object' || !cleanNode.size.type))) {
      delete cleanNode.size;
    }
    return cleanNode;
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
  if (!root) return null;
  const grid = { ...layout.grid, root };
  if (grid.width === null) delete grid.width;
  if (grid.height === null) delete grid.height;
  return { ...layout, panels, grid };
}
