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

/** Извлекает упорядоченный список панелей из layout (для пересборки через
 * addPanel, когда fromJSON непригоден: отравленные null-size или
 * деградировавшая структура). Дедупликация по типу компонента —
 * повторы (например, второй DOM) теряются, но это лучше мёртвого стола. */
export function collectSalvagePanels(layout) {
  const panels = layout?.panels || {};
  const viewIds = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'leaf') {
      for (const id of node.data?.views || []) viewIds.push(id);
      return;
    }
    (Array.isArray(node.data) ? node.data : []).forEach(walk);
  };
  walk(layout?.grid?.root);
  const seen = new Set();
  const result = [];
  for (const id of viewIds) {
    const panel = panels[id];
    const component = panel?.contentComponent;
    if (!DOCKVIEW_COMPONENT_IDS.has(component)) continue;
    const key = component === 'dom' ? 'orderbook' : component;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ id, component, title: panel?.title || component });
  }
  return result;
}
/** Маркер отравленного состояния: dockview v8 пишет size:null, когда внутренние
 * размеры деградировали (нулевая ширина групп). Такое нельзя сохранять обратно —
 * иначе травма самоподдерживается: load → деград → save(null) → load. */
export function hasNullSizes(layout) {
  let found = false;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (node.size === null) { found = true; return; }
    const data = node.data;
    if (Array.isArray(data)) data.forEach(walk);
  };
  walk(layout?.grid?.root);
  return found;
}

const MIN_PANE = 120;

/** Dockview v8.6 плохо восстанавливает layout без явных size: вложенные ветки
 * получают нулевую ширину и саши блокируются — рабочий стол выглядит «только
 * одна панель, остальное чёрное, ничего не двигается». Лечение: прописать
 * явные размеры до fromJSON. Семантика size (по эмпирике toJSON v8):
 * size узла = его протяжённость ПОПЕРЁК собственной оси расположения
 * (root при HORIZONTAL = height); дети делят протяжённость родителя ВДОЛЬ
 * его оси поровну, а их size = их доля (протяжённость вдоль оси родителя).
 * Здоровые layout'ы (с числовыми size) не трогаем. */
export function normalizeDockviewSizes(layout, containerWidth = 1600, containerHeight = 900) {
  if (!layout?.grid?.root) return layout;
  if (typeof layout.grid.root.size === 'number' && layout.grid.root.size > 0) return layout;

  const grid = layout.grid;
  const W = Math.max(800, Number(grid.width) || Math.round(containerWidth) || 1600);
  const H = Math.max(600, Number(grid.height) || Math.round(containerHeight) || 900);
  // Обязательно: dockview v8.6 с size на узлах, но без grid.width/height,
  // рендерит группы нулевой ширины (проверено эмпирически на 8.6.0).
  grid.width = W;
  grid.height = H;
  const axis0 = grid.orientation === 'VERTICAL' ? 'VERTICAL' : 'HORIZONTAL';
  const orthogonal = (o) => (o === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL');

  const assign = (node, sizeWritten, axis, totalForChildren) => {
    node.size = Math.max(1, Math.round(sizeWritten));
    const children = node.type === 'branch' && Array.isArray(node.data) ? node.data : null;
    if (!children?.length) return;
    const n = children.length;
    const total = Math.max(MIN_PANE * n, totalForChildren);
    let rest = total;
    children.forEach((child, i) => {
      const share = i === n - 1
        ? Math.max(MIN_PANE, rest)
        : Math.max(MIN_PANE, Math.round(total / n));
      rest -= share;
      // дети располагаются вдоль оси узла; их size = доля вдоль этой оси;
      // их собственные дети делят size этого узла (протяжённость поперёк).
      assign(child, share, orthogonal(axis), sizeWritten);
    });
  };

  // root: size = протяжённость поперёк оси (HORIZONTAL → height); дети
  // делят протяжённость ВДОЛЬ оси (width для HORIZONTAL).
  assign(grid.root, axis0 === 'HORIZONTAL' ? H : W, axis0, axis0 === 'HORIZONTAL' ? W : H);
  return layout;
}
