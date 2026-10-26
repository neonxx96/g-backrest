import { useState, useEffect, useCallback, useRef } from 'react';
import { getAllTemplates, saveCustomTemplate, getStyleMemory, saveStyleMemory } from '../../config/drawingTemplates';
import { useTradeOverlayStore, calculatePositionMetrics } from '../../stores/tradeOverlayStore';

const API_BASE = "/api";

const USER_DRAWING_TYPES = new Set([
  'segment', 'straightLine', 'horizontalStraightLine', 'verticalStraightLine',
  'rayLine', 'arrow', 'priceLine', 'priceCoordinate', 'rect', 'fibonacciLine', 'measure', 'positionSetupBox'
]);

// Пользовательские инструменты рисования, SMC-шаблоны, стили и undo (Ctrl+Z).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4j, п.1 MODULARIZATION_PLAN):
// состояние, рефы, обработчики и эффекты перенесены без изменений тел.
// Депсы: chartRef, symbol, timeframe, userId, setStatusMsg, magnetEnabled,
// setContextMenu, setIsCatalogOpen, setSettingsDialogIndId (все — из Chart.jsx).

export function useChartDrawings({
  chartRef, symbol, timeframe, userId, setStatusMsg, magnetEnabled,
  setContextMenu, setIsCatalogOpen, setSettingsDialogIndId,
}) {
  const selectedOverlayId = useRef(null);
  const trackedOverlays = useRef(new Map()); // id -> overlay data
  const drawingHistory = useRef([]); // history stack of overlay IDs for Ctrl+Z undo
  const activeDrawingOverlayId = useRef(null);

  const [activeTool, setActiveTool] = useState(null);

  // SMC Drawing Templates & Style Memory
  const [drawingTemplates, setDrawingTemplates] = useState(() => getAllTemplates());
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [activeDrawingStyle, setActiveDrawingStyle] = useState(() => getStyleMemory('default'));
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Save drawings for a specific symbol/timeframe (e.g. before coin switch)
  const saveDrawingsFor = useCallback((targetSymbol, targetTimeframe) => {
    if (!chartRef.current) return;
    const sym = (targetSymbol || symbol).toUpperCase();
    const tf = targetTimeframe || timeframe;

    const saveList = [];

    // Method 1: Check internal _chartStore overlay instance map
    try {
      const store = chartRef.current._chartStore?.getOverlayStore();
      if (store && store._instances) {
        for (const instances of store._instances.values()) {
          instances.forEach(inst => {
            if (inst && inst.points && inst.points.length > 0) {
              if (inst.id !== 'sync_crosshair_marker' && USER_DRAWING_TYPES.has(inst.name)) {
                saveList.push({
                  name: inst.name,
                  points: inst.points,
                  styles: inst.styles
                });
              }
            }
          });
        }
      }
    } catch (_) {}

    // Method 2: Fallback to trackedOverlays ref if store not directly accessible
    if (saveList.length === 0 && trackedOverlays.current.size > 0) {
      for (const [id, data] of trackedOverlays.current.entries()) {
        if (id === 'sync_crosshair_marker') continue;
        const inst = chartRef.current.getOverlayById(id);
        if (inst && inst.points && inst.points.length > 0 && USER_DRAWING_TYPES.has(inst.name)) {
          saveList.push({
            name: inst.name || data.name,
            points: inst.points,
            styles: inst.styles
          });
        } else if (data && data.points && USER_DRAWING_TYPES.has(data.name)) {
          saveList.push(data);
        }
      }
    }

    fetch(`${API_BASE}/drawings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        symbol: sym,
        timeframe: tf,
        elements_json: JSON.stringify(saveList)
      })
    })
    .then(res => res.json())
    .then(() => {
      setStatusMsg("Сохранено!");
      setTimeout(() => setStatusMsg(""), 1200);
    })
    .catch(() => {});
  }, [symbol, timeframe, userId]);

  // Save current active drawings
  const saveDrawings = useCallback(() => {
    saveDrawingsFor(symbol, timeframe);
  }, [saveDrawingsFor, symbol, timeframe]);

  // Load drawings from backend
  const loadDrawings = useCallback(() => {
    if (!chartRef.current) return;

    fetch(`${API_BASE}/drawings?symbol=${symbol}&timeframe=${timeframe}&user_id=${userId}`)
      .then(res => {
        // Пустое тело/не-JSON (например, обрыв ответа под нагрузкой) — не ошибка приложения
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.includes('json')) return null;
        return res.text().then(text => (text ? JSON.parse(text) : null));
      })
      .then(data => {
        if (data && data.elements_json && chartRef.current) {
          try {
            const list = JSON.parse(data.elements_json);
            if (Array.isArray(list)) {
              // Remove ONLY tracked user drawings so liquidations & heatmap aren't wiped
              for (const id of trackedOverlays.current.keys()) {
                try {
                  chartRef.current.removeOverlay({ id });
                } catch (_) {}
              }
              trackedOverlays.current.clear();
              drawingHistory.current = [];
              selectedOverlayId.current = null;

              list.forEach(overlay => {
                if (!overlay || !overlay.name || !USER_DRAWING_TYPES.has(overlay.name)) return;
                const id = chartRef.current.createOverlay({
                  ...overlay,
                  onSelected: (e) => {
                    selectedOverlayId.current = e.overlay.id;
                    return true;
                  },
                  onDeselected: () => {
                    selectedOverlayId.current = null;
                    return true;
                  }
                });
                if (id) {
                  trackedOverlays.current.set(id, overlay);
                  drawingHistory.current.push(id);
                }
              });
            }
          } catch (e) {
            console.error("Failed to parse drawings:", e);
          }
        }
      })
      .catch(e => console.error("Could not load drawings:", e));
  }, [symbol, timeframe, userId]);

  // Undo last drawn figure (Ctrl+Z)
  const handleUndo = useCallback(() => {
    if (!chartRef.current) return;
    if (drawingHistory.current.length > 0) {
      const lastId = drawingHistory.current.pop();
      try {
        chartRef.current.removeOverlay({ id: lastId });
      } catch (_) {}
      trackedOverlays.current.delete(lastId);
      if (selectedOverlayId.current === lastId) {
        selectedOverlayId.current = null;
      }
      saveDrawings();
      setStatusMsg("Отменено (Ctrl+Z)");
      setTimeout(() => setStatusMsg(""), 1200);
    }
  }, [saveDrawings]);

  // Cancel active drawing tool creation and restore cursor / drag navigation
  const cancelActiveDrawing = useCallback(() => {
    setActiveTool(null);
    if (activeDrawingOverlayId.current && chartRef.current) {
      try {
        chartRef.current.removeOverlay({ id: activeDrawingOverlayId.current });
      } catch (_) {}
      trackedOverlays.current.delete(activeDrawingOverlayId.current);
      drawingHistory.current = drawingHistory.current.filter(id => id !== activeDrawingOverlayId.current);
      activeDrawingOverlayId.current = null;
    }
    setStatusMsg("Режим курсора (перетаскивание)");
    setTimeout(() => setStatusMsg(""), 1000);
  }, []);

  // Hotkey listener for Ctrl+Z (Undo), Delete/Backspace on active overlay & Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Ctrl+Z or Cmd+Z: Undo last drawing figure
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я')) {
        e.preventDefault();
        handleUndo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedOverlayId.current && chartRef.current) {
          try {
            chartRef.current.removeOverlay({ id: selectedOverlayId.current });
            trackedOverlays.current.delete(selectedOverlayId.current);
            selectedOverlayId.current = null;
            saveDrawings();
          } catch (_) {}
        }
      } else if (e.key === 'Escape') {
        cancelActiveDrawing();
        setContextMenu({ visible: false, x: 0, y: 0 });
        setIsCatalogOpen(false);
        setSettingsDialogIndId(null);
      } else if ((e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш' || e.key === '/') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setIsCatalogOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [symbol, timeframe, userId, saveDrawings, handleUndo, cancelActiveDrawing]);

  // Global event listener for Undo
  useEffect(() => {
    const onUndo = () => handleUndo();
    window.addEventListener('chart-undo-drawing', onUndo);
    return () => window.removeEventListener('chart-undo-drawing', onUndo);
  }, [handleUndo]);

  // Drawing tool selection with style memory and SMC templates
  const handleSelectTool = (toolName, customStyles = null) => {
    if (!chartRef.current) return;
    if (activeTool === toolName && !customStyles) {
      cancelActiveDrawing();
      return;
    }
    // Cancel any previous incomplete drawing overlay
    if (activeDrawingOverlayId.current) {
      try {
        chartRef.current.removeOverlay({ id: activeDrawingOverlayId.current });
      } catch (_) {}
      trackedOverlays.current.delete(activeDrawingOverlayId.current);
      drawingHistory.current = drawingHistory.current.filter(id => id !== activeDrawingOverlayId.current);
      activeDrawingOverlayId.current = null;
    }

    setActiveTool(toolName);

    const remembered = getStyleMemory(toolName);
    const effectiveStyles = customStyles || {
      line: {
        color: remembered.strokeColor || activeDrawingStyle.strokeColor || '#38bdf8',
        size: remembered.lineWidth || activeDrawingStyle.lineWidth || 2,
        style: remembered.lineStyle || 'solid'
      },
      polygon: {
        color: remembered.fillColor || activeDrawingStyle.fillColor || 'rgba(56, 189, 248, 0.18)',
        borderColor: remembered.strokeColor || activeDrawingStyle.strokeColor || '#38bdf8',
        borderSize: remembered.lineWidth || activeDrawingStyle.lineWidth || 2
      }
    };

    const overlayId = chartRef.current.createOverlay({
      name: toolName,
      lock: false,
      mode: magnetEnabled ? 'strong_magnet' : 'normal',
      styles: effectiveStyles,
      onDrawEnd: (e) => {
        setActiveTool(null);
        activeDrawingOverlayId.current = null;
        if (e && e.overlay) {
          if (e.overlay.name === 'positionSetupBox' && e.overlay.points?.length >= 3) {
            const entryP = Number(e.overlay.points[0]?.value);
            const tpP = Number(e.overlay.points[1]?.value);
            const slP = Number(e.overlay.points[2]?.value);
            const metrics = calculatePositionMetrics({ entryPrice: entryP, tpPrice: tpP, slPrice: slP });
            if (metrics) {
              e.overlay.extendData = { ...e.overlay.extendData, ...metrics };
              useTradeOverlayStore.getState().setTransientSetup(metrics);
              window.__chartActiveSetup = { overlayId: e.overlay.id, ...metrics };
            }
          }
          trackedOverlays.current.set(e.overlay.id, {
            name: e.overlay.name,
            points: e.overlay.points,
            styles: e.overlay.styles
          });
          if (!drawingHistory.current.includes(e.overlay.id)) {
            drawingHistory.current.push(e.overlay.id);
          }
        }
        setTimeout(() => {
          saveDrawings();
        }, 50);
        return true;
      },
      onSelected: (e) => {
        selectedOverlayId.current = e.overlay.id;
        return true;
      },
      onDeselected: () => {
        selectedOverlayId.current = null;
        return true;
      }
    });
    activeDrawingOverlayId.current = overlayId;
  };

  const applyTemplate = (tmpl) => {
    if (!tmpl || !chartRef.current) return;
    setIsTemplateMenuOpen(false);
    if (tmpl.styles?.line?.color || tmpl.styles?.polygon?.borderColor) {
      const color = tmpl.styles?.line?.color || tmpl.styles?.polygon?.borderColor;
      const size = tmpl.styles?.line?.size || tmpl.styles?.polygon?.borderSize || 2;
      const fill = tmpl.styles?.polygon?.color || `${color}25`;
      const nextStyle = { strokeColor: color, lineWidth: size, fillColor: fill };
      setActiveDrawingStyle(nextStyle);
      saveStyleMemory(tmpl.tool, nextStyle);
    }
    handleSelectTool(tmpl.tool, tmpl.styles);
  };

  const updateStyle = (changes) => {
    const next = { ...activeDrawingStyle, ...changes };
    setActiveDrawingStyle(next);
    saveStyleMemory(activeTool || 'default', next);
    if (selectedOverlayId.current && chartRef.current) {
      try {
        const overlayData = trackedOverlays.current.get(selectedOverlayId.current);
        const newOverlayStyles = {
          line: {
            color: next.strokeColor,
            size: next.lineWidth
          },
          polygon: {
            color: next.fillColor || `${next.strokeColor}25`,
            borderColor: next.strokeColor,
            borderSize: next.lineWidth
          }
        };
        chartRef.current.overrideOverlay({
          id: selectedOverlayId.current,
          styles: newOverlayStyles
        });
        if (overlayData) {
          overlayData.styles = newOverlayStyles;
        }
      } catch (_) {}
    }
  };

  const handleSaveCurrentAsTemplate = () => {
    if (!newTemplateName.trim()) return;
    const tool = activeTool || 'straightLine';
    const styles = {
      line: {
        color: activeDrawingStyle.strokeColor,
        size: activeDrawingStyle.lineWidth
      },
      polygon: {
        color: activeDrawingStyle.fillColor,
        borderColor: activeDrawingStyle.strokeColor,
        borderSize: activeDrawingStyle.lineWidth
      }
    };
    const created = saveCustomTemplate({ name: newTemplateName.trim(), tool, styles });
    if (created) {
      setDrawingTemplates(getAllTemplates());
      setStatusMsg(`Шаблон "${newTemplateName}" сохранен`);
      setTimeout(() => setStatusMsg(""), 1500);
    }
    setShowSaveTemplateModal(false);
    setNewTemplateName('');
  };

  const handleClearDrawings = () => {
    if (!chartRef.current) return;
    for (const id of trackedOverlays.current.keys()) {
      try {
        chartRef.current.removeOverlay({ id });
      } catch (_) {}
    }
    trackedOverlays.current.clear();
    drawingHistory.current = [];
    selectedOverlayId.current = null;
    setActiveTool(null);
    saveDrawings();
    setStatusMsg("Разметка очищена");
    setTimeout(() => setStatusMsg(""), 1200);
  };

  return {
    activeTool,
    drawingTemplates, setDrawingTemplates,
    activeDrawingStyle, setActiveDrawingStyle,
    isTemplateMenuOpen, setIsTemplateMenuOpen,
    showSaveTemplateModal, setShowSaveTemplateModal,
    newTemplateName, setNewTemplateName,
    saveDrawingsFor, saveDrawings, loadDrawings,
    handleUndo, cancelActiveDrawing, handleSelectTool,
    applyTemplate, updateStyle, handleSaveCurrentAsTemplate, handleClearDrawings,
  };
}
