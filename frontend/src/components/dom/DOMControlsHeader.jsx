import React from 'react';
import { Layers, Crosshair, Settings2, X } from 'lucide-react';
import { SCALE_OPTIONS } from './constants';

// Шапка управления скальперским стаканом — вынесена из OrderBookDOM.jsx (модульный план, п.4).
// Управляемый презентационный компонент: заголовок DOM + счётчик FPS, селектор агрегации
// шага цены (x1..x100), кнопки «Центр» (Space) / «Настройки» / «Закрыть», и сворачиваемая
// панель быстрых настроек (плотность, мега-стена, формат кластеров). Вся логика состояния
// остаётся в OrderBookDOM — сюда прокидываются значения и колбэки.

export default function DOMControlsHeader({
  fps,
  tickMult,
  baseTick,
  priceDecimals,
  showSettings,
  densityThresholdUsd,
  megaWallUsd,
  clusterMode,
  rowHeight = 20,
  volumePalette = 'classic',
  onTickMult,
  onRecenter,
  onToggleSettings,
  onClose,
  onDensityThreshold,
  onMegaWall,
  onClusterMode,
  onRowHeight,
  onVolumePalette,
}) {
  return (
    <>
      {/* Top Header Bar: Title, Price Aggregation (x1..x100), Recenter [Space], FPS, Settings, Close [×] */}
      <div
        style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
        className="flex items-center justify-between px-1.5 py-1 border-b gap-1 shrink-0"
      >
        <div className="flex items-center space-x-1 font-bold text-white text-[10.5px] shrink-0">
          <Layers size={11} className="text-[#38bdf8]" />
          <span>DOM</span>
          <span className="text-[8.5px] font-mono px-1 py-0.2 rounded bg-[#141c2b] text-[#26a69a] border border-[#26a69a40]">
            {fps} FPS
          </span>
        </div>

        {/* Price Step Aggregation Selector: x1, x5, x10, x25, x50, x100 */}
        <div className="flex items-center bg-[#08090c] p-0.5 rounded border border-[#161820] space-x-0.5 font-mono text-[8.5px] shrink-0">
          {SCALE_OPTIONS.map((mult) => (
            <button
              key={mult}
              onClick={() => onTickMult(mult)}
              className={`px-1 py-0.2 rounded transition cursor-pointer ${
                tickMult === mult
                  ? 'bg-[#2563eb] text-white font-bold'
                  : 'text-[#787f91] hover:text-white'
              }`}
              title={`Сжатие шага цены x${mult} (шаг ${(baseTick * mult).toFixed(priceDecimals)})`}
            >
              x{mult}
            </button>
          ))}
        </div>

        {/* Right Controls: Recenter [Space], Settings, Close [×] */}
        <div className="flex items-center space-x-0.5 font-mono shrink-0">
          <button
            onClick={onRecenter}
            className="flex items-center space-x-0.5 px-1 py-0.5 rounded bg-[#161922] hover:bg-[#2563eb] text-[8.5px] text-[#38bdf8] hover:text-white transition border border-[#1f2430] cursor-pointer"
            title="Центрировать на спреде (Горячая клавиша Space)"
          >
            <Crosshair size={10} />
            <span>Центр</span>
          </button>

          <button
            onClick={onToggleSettings}
            className={`p-1 rounded transition cursor-pointer ${
              showSettings ? 'bg-[#2563eb] text-white' : 'text-[#787f91] hover:bg-[#161922] hover:text-white'
            }`}
            title="Настройки плотностей и кластеров DOM"
          >
            <Settings2 size={12} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded text-[#60697b] hover:text-[#ef5350] hover:bg-[#ef535018] transition cursor-pointer"
              title="Скрыть виджет стакана DOM"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Collapsible DOM Quick Settings */}
      {showSettings && (
        <div
          style={{ backgroundColor: 'var(--bg-panel-header)', borderColor: 'var(--border-subtle)' }}
          className="p-2 border-b space-y-1.5 text-[10.5px] font-mono shrink-0 z-20"
        >
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Крупная плотность ($):</span>
            <input
              type="number"
              step="25000"
              value={densityThresholdUsd}
              onChange={(e) => onDensityThreshold(Math.max(5000, Number(e.target.value)))}
              className="w-24 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right text-white"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Стена / Мега-уровень ($):</span>
            <input
              type="number"
              step="100000"
              value={megaWallUsd}
              onChange={(e) => onMegaWall(Math.max(50000, Number(e.target.value)))}
              className="w-24 bg-[#08090c] border border-[#1f2430] rounded px-1.5 py-0.5 text-right text-[#ffb300] font-bold"
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Масштаб строки:</span>
            <div className="flex space-x-1">
              {[16, 20, 24].map((h) => (
                <button
                  key={h}
                  onClick={() => onRowHeight && onRowHeight(h)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] ${
                    rowHeight === h ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'
                  }`}
                  title={`${h}px высота строки`}
                >
                  {h}px
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Палитра объема:</span>
            <div className="flex space-x-1">
              {[
                { id: 'classic', label: 'Классик' },
                { id: 'heat', label: 'Тепловая' },
                { id: 'monochrome', label: 'Моно' },
              ].map((pal) => (
                <button
                  key={pal.id}
                  onClick={() => onVolumePalette && onVolumePalette(pal.id)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] ${
                    volumePalette === pal.id ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91] hover:text-white'
                  }`}
                >
                  {pal.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#787f91]">Формат кластеров:</span>
            <div className="flex space-x-1">
              <button
                onClick={() => onClusterMode('bid_ask')}
                className={`px-1.5 py-0.5 rounded text-[9.5px] ${
                  clusterMode === 'bid_ask' ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91]'
                }`}
              >
                Bid × Ask
              </button>
              <button
                onClick={() => onClusterMode('delta')}
                className={`px-1.5 py-0.5 rounded text-[9.5px] ${
                  clusterMode === 'delta' ? 'bg-[#2563eb] text-white font-bold' : 'bg-[#08090c] text-[#787f91]'
                }`}
              >
                Сумма / Δ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
