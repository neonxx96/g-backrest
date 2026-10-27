import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useTableColumns - Хук управления колонками таблицы (reorder, resize, visibility, persistence).
 * 
 * @param {string} tableId - Уникальный идентификатор таблицы для localStorage
 * @param {Array<Object>} defaultColumns - [{ id, label, defaultWidth, minWidth, maxWidth, defaultVisible }]
 */
export function useTableColumns(tableId, defaultColumns = []) {
  const storageKey = `signalscript:table-columns:${tableId}`;

  const [columns, setColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (saved && typeof saved === 'object') {
        const order = Array.isArray(saved.order) ? saved.order : defaultColumns.map((c) => c.id);
        const widths = saved.widths || {};
        const visibility = saved.visibility || {};

        // Build list based on saved order
        const map = new Map(defaultColumns.map((c) => [c.id, c]));
        const result = [];

        order.forEach((id) => {
          if (map.has(id)) {
            const def = map.get(id);
            result.push({
              ...def,
              width: widths[id] ?? def.defaultWidth ?? 100,
              visible: visibility[id] !== undefined ? visibility[id] : (def.defaultVisible !== false),
            });
            map.delete(id);
          }
        });

        // Any newly added columns not in saved order
        map.forEach((def) => {
          result.push({
            ...def,
            width: def.defaultWidth ?? 100,
            visible: def.defaultVisible !== false,
          });
        });

        return result;
      }
    } catch (_) {}

    return defaultColumns.map((c) => ({
      ...c,
      width: c.defaultWidth ?? 100,
      visible: c.defaultVisible !== false,
    }));
  });

  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const persist = useCallback((nextColumns) => {
    try {
      const payload = {
        order: nextColumns.map((c) => c.id),
        widths: Object.fromEntries(nextColumns.map((c) => [c.id, c.width])),
        visibility: Object.fromEntries(nextColumns.map((c) => [c.id, c.visible])),
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (_) {}
  }, [storageKey]);

  const reorderColumn = useCallback((dragIdx, hoverIdx) => {
    if (dragIdx === hoverIdx) return;
    setColumns((prev) => {
      const next = [...prev];
      const [removed] = next.splice(dragIdx, 1);
      next.splice(hoverIdx, 0, removed);
      persist(next);
      return next;
    });
  }, [persist]);

  const resizeColumn = useCallback((colId, deltaX) => {
    setColumns((prev) => {
      const next = prev.map((col) => {
        if (col.id === colId) {
          const min = col.minWidth || 40;
          const max = col.maxWidth || 500;
          const newW = Math.max(min, Math.min(max, (col.width || 100) + deltaX));
          return { ...col, width: newW };
        }
        return col;
      });
      persist(next);
      return next;
    });
  }, [persist]);

  const toggleVisibility = useCallback((colId) => {
    setColumns((prev) => {
      const next = prev.map((col) => {
        if (col.id === colId) {
          return { ...col, visible: !col.visible };
        }
        return col;
      });
      persist(next);
      return next;
    });
  }, [persist]);

  const resetColumns = useCallback(() => {
    const next = defaultColumns.map((c) => ({
      ...c,
      width: c.defaultWidth ?? 100,
      visible: c.defaultVisible !== false,
    }));
    setColumns(next);
    persist(next);
  }, [defaultColumns, persist]);

  const visibleColumns = columns.filter((c) => c.visible !== false);

  return {
    columns,
    visibleColumns,
    reorderColumn,
    resizeColumn,
    toggleVisibility,
    resetColumns,
  };
}
