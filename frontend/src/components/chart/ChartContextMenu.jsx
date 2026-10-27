import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  RotateCcw,
  Trash2,
  Magnet,
  Check
} from 'lucide-react';

const API_BASE = "/api";

// Контекстное меню по правому клику + карточка экспресс-инспектора отскоков.
// Состояние и обработчики — в хуке useChartContextMenu (извлечены ДОСЛОВНО из
// Chart.jsx, слайс 6.4i, п.1 MODULARIZATION_PLAN). JSX компонента — дословный
// перенос блоков «Right-Click Context Menu» и «Level Inspector Result Card».

export function useChartContextMenu({ chartContainerRef, chartRef, currentKlines, setStatusMsg, symbol, timeframe }) {
  // Context Menu & Level Inspector State (ТАКТ 3)
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, price: null });
  const [levelInspectorData, setLevelInspectorData] = useState(null);
  const [inspectingLevel, setInspectingLevel] = useState(false);

  const handleInspectLevel = useCallback(async (targetPrice) => {
    let p = targetPrice;
    if (!p && currentKlines.current.length > 0) {
      p = currentKlines.current[currentKlines.current.length - 1].close;
    }
    if (!p) return;
    setInspectingLevel(true);
    setStatusMsg(`Анализ отскоков от $${p.toFixed(1)}...`);
    try {
      const res = await fetch(`${API_BASE}/backtest/inspect-level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          timeframe,
          price: Number(p),
          days: 14,
          tolerance_pct: 0.35
        })
      });
      if (res.ok) {
        const data = await res.json();
        setLevelInspectorData(data);
        setStatusMsg(`Уровень $${p.toFixed(1)}: ${data.bounce_winrate_pct}% отскоков`);
      } else {
        setStatusMsg("Ошибка анализа уровня");
      }
    } catch (err) {
      console.error('Inspect level error:', err);
      setStatusMsg("Сбой запроса анализа уровня");
    } finally {
      setInspectingLevel(false);
      setTimeout(() => setStatusMsg(""), 2500);
    }
  }, [symbol, timeframe]);

  // Close context menu on outside click
  useEffect(() => {
    const handleWindowClick = () => {
      if (contextMenu.visible) {
        setContextMenu({ visible: false, x: 0, y: 0 });
      }
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, [contextMenu.visible]);

  // Right-Click Context Menu handler (Task 6 & ТАКТ 3)
  const handleContextMenu = (e) => {
    e.preventDefault();
    const bounds = chartContainerRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const relX = e.clientX - bounds.left;
    const relY = e.clientY - bounds.top;

    let clickedPrice = null;
    if (chartRef.current) {
      try {
        if (typeof chartRef.current.convertFromPixel === 'function') {
          const pt = chartRef.current.convertFromPixel({ x: relX, y: relY }, { paneId: 'candle_pane' });
          if (pt && typeof pt.value === 'number') {
            clickedPrice = pt.value;
          }
        }
      } catch (_) {}
    }

    if (!clickedPrice && currentKlines.current.length > 0) {
      clickedPrice = currentKlines.current[currentKlines.current.length - 1].close;
    }

    // Constrain context menu within canvas
    const x = Math.min(e.clientX, bounds.right - 230);
    const y = Math.min(e.clientY, bounds.bottom - 280);

    setContextMenu({ visible: true, x, y, price: clickedPrice });
  };


  const handleResetScale = () => {
    if (chartRef.current) {
      chartRef.current.scrollToRealTime();
      setContextMenu({ visible: false, x: 0, y: 0 });
      setStatusMsg("Масштаб сброшен");
      setTimeout(() => setStatusMsg(""), 1200);
    }
  };

  return {
    contextMenu, setContextMenu,
    levelInspectorData, setLevelInspectorData,
    inspectingLevel,
    handleInspectLevel, handleContextMenu, handleResetScale,
  };
}

export default function ChartContextMenu({
  contextMenu, setContextMenu,
  levelInspectorData, setLevelInspectorData,
  handleResetScale, handleInspectLevel,
  handleClearDrawings,
  magnetEnabled, setMagnetEnabled,
  toggleIndicator, activeIndicators,
}) {
  // Latent-баг оригинала: JSX меню читал несуществующую переменную `indicators`
  // (ReferenceError при открытии меню). Канон истины — activeIndicators (тот же
  // паттерн, что в ChartToolbar): галочки EMA/VOL по enabled !== false.
  const indicators = {
    ema: activeIndicators.some(i => i.id === 'ema' && i.enabled !== false),
    vol: activeIndicators.some(i => i.id === 'vol' && i.enabled !== false),
  };
  return (
    <>
      {/* Right-Click Context Menu (Task 6 & ТАКТ 3) */}
      {contextMenu.visible && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 bg-[#101217] border border-[#1f2430] rounded shadow-2xl py-1 w-52 text-[11px] font-mono text-[#d1d4dc] backdrop-blur-md select-none"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.price && (
            <>
              <button
                onClick={() => {
                  const p = contextMenu.price;
                  setContextMenu({ visible: false, x: 0, y: 0 });
                  handleInspectLevel(p);
                }}
                className="w-full px-3 py-1.5 text-left bg-[#38bdf815] hover:bg-[#38bdf828] text-[#38bdf8] flex items-center space-x-2 transition font-bold"
                title="Экспресс-бэктест отскоков и пробоев от этого уровня за 14 дней"
              >
                <BarChart3 size={13} className="text-[#38bdf8] shrink-0" />
                <span className="truncate">
                  📊 Отскоки ${contextMenu.price >= 1000 ? contextMenu.price.toFixed(1) : contextMenu.price.toFixed(3)}
                </span>
              </button>
              <div className="h-px bg-[#161820] my-1" />
            </>
          )}

          <button
            onClick={handleResetScale}
            className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] hover:text-foreground flex items-center space-x-2 transition"
          >
            <RotateCcw size={12} className="text-[#38bdf8]" />
            <span>Сбросить масштаб цены</span>
          </button>

          <button
            onClick={() => {
              handleClearDrawings();
              setContextMenu({ visible: false, x: 0, y: 0 });
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-[#ef535018] text-[#ef5350] flex items-center space-x-2 transition"
          >
            <Trash2 size={12} />
            <span>Удалить все объекты</span>
          </button>

          <div className="h-px bg-[#161820] my-1" />

          <button
            onClick={() => {
              setMagnetEnabled(!magnetEnabled);
              setContextMenu({ visible: false, x: 0, y: 0 });
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] text-[#787f91] hover:text-foreground flex items-center justify-between transition"
          >
            <span className="flex items-center space-x-2">
              <Magnet size={12} className={magnetEnabled ? "text-[#26a69a]" : "text-[#787f91]"} />
              <span>Магнит к свечам</span>
            </span>
            {magnetEnabled && <Check size={11} className="text-[#26a69a]" />}
          </button>

          <button
            onClick={() => {
              toggleIndicator('ema');
              setContextMenu({ visible: false, x: 0, y: 0 });
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] text-[#787f91] hover:text-foreground flex items-center justify-between transition"
          >
            <span>Показать EMA(20)</span>
            {indicators.ema && <Check size={11} className="text-[#38bdf8]" />}
          </button>

          <button
            onClick={() => {
              toggleIndicator('vol');
              setContextMenu({ visible: false, x: 0, y: 0 });
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-[#191c26] text-[#787f91] hover:text-foreground flex items-center justify-between transition"
          >
            <span>Показать объём (VOL)</span>
            {indicators.vol && <Check size={11} className="text-[#26a69a]" />}
          </button>

          <div className="h-px bg-[#161820] my-1" />

          <button
            onClick={() => setContextMenu({ visible: false, x: 0, y: 0 })}
            className="w-full px-3 py-1 text-left text-[#60697b] hover:text-foreground text-[10px]"
          >
            ✕ Закрыть
          </button>
        </div>
      )}

      {/* Level Inspector Result Card (ТАКТ 3) */}
      {levelInspectorData && (
        <div className="absolute top-12 right-4 z-40 bg-[#0c0f17]/95 border border-[#38bdf880] rounded shadow-2xl p-3 w-80 text-xs font-mono text-foreground backdrop-blur-md animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#1f2430] mb-2">
            <div className="flex items-center gap-1.5 font-bold text-[#38bdf8]">
              <BarChart3 size={14} />
              <span>Отскоки от уровня ${levelInspectorData.level_price?.toFixed(1)}</span>
            </div>
            <button
              onClick={() => setLevelInspectorData(null)}
              className="text-[#787f91] hover:text-foreground cursor-pointer px-1"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 mb-2 text-center">
            <div className="bg-[#141822] p-1.5 rounded">
              <div className="text-[9px] text-[#787f91]">КАСАНИЙ</div>
              <div className="text-sm font-bold text-foreground">{levelInspectorData.total_touches}</div>
            </div>
            <div className="bg-[#141822] p-1.5 rounded">
              <div className="text-[9px] text-[#787f91]">WINRATE</div>
              <div className={`text-sm font-bold ${levelInspectorData.bounce_winrate_pct >= 55 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {levelInspectorData.bounce_winrate_pct}%
              </div>
            </div>
            <div className="bg-[#141822] p-1.5 rounded">
              <div className="text-[9px] text-[#787f91]">СР. ИМПУЛЬС</div>
              <div className="text-sm font-bold text-[#26a69a]">+{levelInspectorData.avg_bounce_pnl_pct}%</div>
            </div>
          </div>

          <div className="text-[10px] text-[#94a3b8] bg-[#07090e] p-2 rounded border border-[#1e2330] leading-relaxed mb-2">
            {levelInspectorData.recommendation}
          </div>

          <div className="flex items-center justify-between text-[9px] text-[#64748b]">
            <span>Период: {levelInspectorData.days}дн ({levelInspectorData.timeframe})</span>
            <span>Отскоков: {levelInspectorData.bounces_count} / Пробоев: {levelInspectorData.breakouts_count}</span>
          </div>
        </div>
      )}
    </>
  );
}
