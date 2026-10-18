/**
 * SMC (Smart Money Concepts) Drawing Templates & Style Memory
 * 
 * Provides pre-seeded templates for BOS, CHoCH, Order Blocks, Liquidity Pools, FVG,
 * and persistent localStorage style memory across sessions.
 */

export const PRESEEDED_SMC_TEMPLATES = [
  {
    id: 'bos_choch',
    name: 'BOS / CHoCH (Слом структуры)',
    category: 'SMC',
    tool: 'straightLine',
    styles: {
      line: {
        color: '#f59e0b',
        size: 2,
        style: 'dashed',
        dashedValue: [6, 4]
      }
    },
    badge: 'BOS/CHoCH',
    badgeColor: '#f59e0b',
    description: 'Break of Structure / Change of Character'
  },
  {
    id: 'ob_bull',
    name: 'Order Block (Бычий OB)',
    category: 'SMC',
    tool: 'rect',
    styles: {
      polygon: {
        color: 'rgba(16, 185, 129, 0.20)',
        borderColor: '#10b981',
        borderSize: 1.5,
        borderStyle: 'solid'
      }
    },
    badge: 'OB BUY',
    badgeColor: '#10b981',
    description: 'Зона институционального набора покупок'
  },
  {
    id: 'ob_bear',
    name: 'Order Block (Медвежий OB)',
    category: 'SMC',
    tool: 'rect',
    styles: {
      polygon: {
        color: 'rgba(239, 68, 68, 0.20)',
        borderColor: '#ef4444',
        borderSize: 1.5,
        borderStyle: 'solid'
      }
    },
    badge: 'OB SELL',
    badgeColor: '#ef4444',
    description: 'Зона институционального распределения продаж'
  },
  {
    id: 'liquidity_pool',
    name: 'Liquidity Pool (BSL / SSL)',
    category: 'SMC',
    tool: 'horizontalStraightLine',
    styles: {
      line: {
        color: '#a855f7',
        size: 2,
        style: 'dashed',
        dashedValue: [4, 4]
      }
    },
    badge: '$$$ LIQ',
    badgeColor: '#a855f7',
    description: 'Пул ликвидности и скопления стоп-лоссов'
  },
  {
    id: 'fvg_imbalance',
    name: 'FVG (Fair Value Gap)',
    category: 'SMC',
    tool: 'rect',
    styles: {
      polygon: {
        color: 'rgba(56, 189, 248, 0.20)',
        borderColor: '#38bdf8',
        borderSize: 1.5,
        borderStyle: 'dashed'
      }
    },
    badge: 'FVG',
    badgeColor: '#38bdf8',
    description: 'Ценовой имбаланс между свечами'
  },
  {
    id: 'rr_setup',
    name: 'Risk / Reward Box (1:3)',
    category: 'SMC',
    tool: 'positionSetupBox',
    styles: {},
    badge: 'R:R 1:3',
    badgeColor: '#10b981',
    description: 'Интерактивный сетап с авто-расчетом риска'
  }
];

const CUSTOM_TEMPLATES_KEY = 'signalscript_custom_drawing_templates';
const STYLE_MEMORY_KEY = 'signalscript_drawing_style_memory';

/**
 * Get all available templates (pre-seeded + custom from localStorage)
 */
export function getAllTemplates() {
  let custom = [];
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    if (raw) custom = JSON.parse(raw);
  } catch (_) {}

  return [...PRESEEDED_SMC_TEMPLATES, ...custom];
}

/**
 * Save user custom template
 */
export function saveCustomTemplate({ name, tool, styles }) {
  if (!name || !tool) return null;
  const id = `custom_${Date.now()}`;
  const template = {
    id,
    name,
    category: 'Пользовательские',
    tool,
    styles: styles || {},
    badge: name.slice(0, 8),
    badgeColor: '#38bdf8',
    description: `Пользовательский шаблон для ${tool}`
  };

  try {
    const all = getAllTemplates().filter(t => t.id.startsWith('custom_'));
    all.push(template);
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(all));
  } catch (_) {}

  return template;
}

/**
 * Delete custom template
 */
export function deleteCustomTemplate(id) {
  try {
    const all = getAllTemplates().filter(t => t.id.startsWith('custom_') && t.id !== id);
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(all));
  } catch (_) {}
}

/**
 * Load remembered drawing styles
 */
export function getStyleMemory(toolName) {
  try {
    const raw = localStorage.getItem(STYLE_MEMORY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (toolName && parsed[toolName]) return parsed[toolName];
      return parsed._default || { strokeColor: '#38bdf8', lineWidth: 2, fillColor: 'rgba(56, 189, 248, 0.18)' };
    }
  } catch (_) {}

  return { strokeColor: '#38bdf8', lineWidth: 2, fillColor: 'rgba(56, 189, 248, 0.18)' };
}

/**
 * Save remembered drawing styles
 */
export function saveStyleMemory(toolName, styleObj) {
  try {
    const raw = localStorage.getItem(STYLE_MEMORY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (toolName) parsed[toolName] = styleObj;
    parsed._default = styleObj;
    localStorage.setItem(STYLE_MEMORY_KEY, JSON.stringify(parsed));
  } catch (_) {}
}

export default {
  PRESEEDED_SMC_TEMPLATES,
  getAllTemplates,
  saveCustomTemplate,
  deleteCustomTemplate,
  getStyleMemory,
  saveStyleMemory
};
