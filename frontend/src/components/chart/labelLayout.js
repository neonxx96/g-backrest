/**
 * labelLayout.js - Единый модуль расчёта вертикального расположения плашек и меток у правого края графика.
 * 
 * Особенности:
 * - Приоритет: текущая цена > стены (ASK/BID WALL) > крупные ликвидации > остальные.
 * - Ограничение top-N (по умолчанию 6) с поддержкой флага showAll.
 * - Кластеризация и раздвижка (relaxation) при Delta y < 16px.
 * - Защита от наложения на верхний тулбар (y < topMargin) и ось времени (y > height - bottomMargin).
 * - Форматирование сумм ($107.5M, $450k) и моно-стили плашек.
 */

export const PRIORITY_RANKS = {
  current: 0,
  wall: 1,
  liq: 2,
  other: 3,
};

/**
 * Форматирование денежного значения в компактную биржевую строку ($107.5M, $450k)
 */
export function formatLabelAmount(val) {
  if (val == null || !Number.isFinite(Number(val))) return '$0';
  const num = Math.abs(Number(val));
  const sign = Number(val) < 0 ? '-' : '';
  if (num >= 1e9) return `${sign}$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${sign}$${(num / 1e6).toFixed(1)}M`;
  if (num >= 1e3) return `${sign}$${Math.round(num / 1e3)}k`;
  return `${sign}$${Math.round(num)}`;
}

/**
 * Основная функция раскладки меток
 * @param {Array<Object>} items - элементы { id, price, y, type: 'current'|'wall'|'liq'|'other', valueUsd, label, side, ... }
 * @param {Object} options - параметры раскладки { height, topMargin, bottomMargin, maxLabels, showAll, minGap }
 * @returns {Array<Object>} - массив элементов со скорректированными `y`, `originalY`, `hidden`, `clusterCount`
 */
export function layoutLabels(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const {
    height = 600,
    topMargin = 28,
    bottomMargin = 24,
    maxLabels = 6,
    showAll = false,
    minGap = 16,
  } = options;

  const minY = topMargin + minGap / 2;
  const maxY = Math.max(minY, height - bottomMargin - minGap / 2);

  // 1. Фильтрация валидных элементов в пределах видимой области
  const valid = items
    .filter((it) => it && Number.isFinite(it.y))
    .map((it, idx) => ({
      ...it,
      _idx: idx,
      originalY: it.y,
      type: it.type || 'other',
      priority: PRIORITY_RANKS[it.type] ?? PRIORITY_RANKS.other,
      valueUsd: Number(it.valueUsd || it.volume_usd || 0),
      hidden: false,
      clusterCount: 1,
    }));

  if (valid.length === 0) return [];

  // 2. Сортировка по приоритету (current -> wall -> liq -> other) и объёму для отбора top-N
  valid.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.valueUsd || 0) - (a.valueUsd || 0);
  });

  // Отбираем кандидатов (текущая цена всегда включается)
  let candidates;
  if (showAll) {
    candidates = valid;
  } else {
    const currentPriceItems = valid.filter((it) => it.type === 'current');
    const otherItems = valid.filter((it) => it.type !== 'current');
    const remainingSlots = Math.max(0, maxLabels - currentPriceItems.length);
    candidates = [...currentPriceItems, ...otherItems.slice(0, remainingSlots)];
  }

  // 3. Сортировка кандидатов по вертикали (y по возрастанию, сверху вниз)
  candidates.sort((a, b) => a.originalY - b.originalY);

  // Инициализация рабочих координат
  candidates.forEach((c) => {
    c.y = Math.min(Math.max(c.originalY, minY), maxY);
  });

  // 4. Итеративная раздвижка (spring relaxation) при Delta y < minGap
  const iterations = 6;
  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (let i = 0; i < candidates.length - 1; i++) {
      const a = candidates[i];
      const b = candidates[i + 1];
      if (a.hidden || b.hidden) continue;

      const delta = b.y - a.y;
      if (delta < minGap) {
        changed = true;
        const overlap = minGap - delta;
        // Если один из них - текущая цена, сдвигаем только другой
        if (a.type === 'current' && b.type !== 'current') {
          b.y = Math.min(maxY, b.y + overlap);
        } else if (b.type === 'current' && a.type !== 'current') {
          a.y = Math.max(minY, a.y - overlap);
        } else {
          // Раздвигаем симметрично
          const half = overlap / 2;
          a.y = Math.max(minY, a.y - half);
          b.y = Math.min(maxY, b.y + half);
        }
      }
    }
    if (!changed) break;
  }

  // Финальный проход: проверка жестких коллизий у границ
  for (let i = 0; i < candidates.length - 1; i++) {
    const a = candidates[i];
    const b = candidates[i + 1];
    if (a.hidden || b.hidden) continue;

    if (b.y - a.y < minGap * 0.75) {
      // При сильной тесноте скрываем менее приоритетный элемент
      if (a.priority > b.priority) {
        a.hidden = true;
        b.clusterCount += a.clusterCount;
      } else {
        b.hidden = true;
        a.clusterCount += b.clusterCount;
      }
    }
  }

  return candidates;
}
