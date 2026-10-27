import React, { useState } from 'react';
import { Layers, Sliders, ShieldCheck, Activity, Filter, Eye } from 'lucide-react';

/**
 * LayerToolbar Component (Ref 2 + Quant Controls)
 * Supports:
 * - Layer toggles: Liq Heatmap, Liq Levels, OB Depth, OB Profile
 * - Leverage filters: 25x, 50x, 75x, 100x
 * - Wall filter slider (Min Wall Size Multiplier: 1.5x - 6.0x)
 * - Wall line thickness (1px - 4px)
 * - Layer Opacity (50% - 100%)
 */
export default function LayerToolbar({
  layers = { liqHeatmap: true, liqLevels: true, obDepth: true, obProfile: true },
  onLayerToggle,
  leverages = { '25x': true, '50x': true, '75x': true, '100x': true },
  onLeverageToggle,
  minWallMultiplier = 2.5,
  onMinWallChange,
  wallLineThickness = 2,
  onWallThicknessChange,
  layerOpacity = 100,
  onOpacityChange,
}) {
  const [showWallConfig, setShowWallConfig] = useState(false);

  return (
    <div
      className="px-3 py-1.5 border-b flex items-center justify-between gap-3 text-xs select-none shrink-0 flex-wrap"
      style={{
        backgroundColor: 'var(--panel)',
        borderColor: 'var(--border)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Left: Layer Toggles (Ref 2) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="text-[10px] uppercase font-mono tracking-wider mr-1"
          style={{ color: 'var(--text-3)' }}
        >
          Layers:
        </span>

        {/* Liq Heatmap */}
        <button
          type="button"
          onClick={() => onLayerToggle('liqHeatmap')}
          className="px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer border"
          style={{
            backgroundColor: layers.liqHeatmap ? 'var(--raised)' : 'transparent',
            borderColor: layers.liqHeatmap ? 'var(--accent)' : 'var(--border)',
            color: layers.liqHeatmap ? 'var(--text-1)' : 'var(--text-2)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: layers.liqHeatmap ? 'var(--accent)' : 'var(--text-3)' }}
          />
          <span>Карта ликвидаций</span>
        </button>

        {/* Liq Levels */}
        <button
          type="button"
          onClick={() => onLayerToggle('liqLevels')}
          className="px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer border"
          style={{
            backgroundColor: layers.liqLevels ? 'var(--raised)' : 'transparent',
            borderColor: layers.liqLevels ? 'var(--accent)' : 'var(--border)',
            color: layers.liqLevels ? 'var(--text-1)' : 'var(--text-2)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: layers.liqLevels ? 'var(--accent)' : 'var(--text-3)' }}
          />
          <span>Уровни ликвидаций (оценка)</span>
        </button>

        {/* OB Depth Limit Walls */}
        <button
          type="button"
          onClick={() => onLayerToggle('obDepth')}
          className="px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer border"
          style={{
            backgroundColor: layers.obDepth ? 'var(--raised)' : 'transparent',
            borderColor: layers.obDepth ? 'var(--accent)' : 'var(--border)',
            color: layers.obDepth ? 'var(--text-1)' : 'var(--text-2)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: layers.obDepth ? 'var(--accent)' : 'var(--text-3)' }}
          />
          <span>Спот-стены</span>
        </button>

        {/* OB Profile */}
        <button
          type="button"
          onClick={() => onLayerToggle('obProfile')}
          className="px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer border"
          style={{
            backgroundColor: layers.obProfile ? 'var(--raised)' : 'transparent',
            borderColor: layers.obProfile ? 'var(--accent)' : 'var(--border)',
            color: layers.obProfile ? 'var(--text-1)' : 'var(--text-2)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: layers.obProfile ? 'var(--accent)' : 'var(--text-3)' }}
          />
          <span>Профиль стакана</span>
        </button>

        {/* Spot Wall Filter Settings Popover toggle */}
        <button
          type="button"
          onClick={() => setShowWallConfig(!showWallConfig)}
          className="px-2 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 transition cursor-pointer border"
          style={{
            backgroundColor: showWallConfig ? 'var(--panel)' : 'var(--raised)',
            borderColor: showWallConfig ? 'var(--warn)' : 'var(--border)',
            color: showWallConfig ? 'var(--warn)' : 'var(--text-2)',
          }}
          title="Настройка фильтра плотностей стакана и толщины линий"
        >
          <Filter size={10} />
          <span>Стены: {minWallMultiplier}x</span>
        </button>
      </div>

      {/* Right: Leverage Chips & Intensity/Opacity Scale */}
      <div className="flex items-center gap-3">
        {/* Leverage Filters */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-mono mr-1" style={{ color: 'var(--text-3)' }}>
            LEV:
          </span>
          {['25x', '50x', '75x', '100x'].map((lev) => (
            <button
              key={lev}
              type="button"
              onClick={() => onLeverageToggle(lev)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer border"
              style={{
                backgroundColor: leverages[lev] ? 'var(--panel)' : 'transparent',
                borderColor: leverages[lev] ? 'var(--accent)' : 'var(--border)',
                color: leverages[lev] ? 'var(--accent)' : 'var(--text-3)',
              }}
            >
              {lev}
            </button>
          ))}
        </div>

        {/* Intensity Scale Bar (LOW — HIGH LIQ gradient) */}
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-mono uppercase" style={{ color: 'var(--text-3)' }}>
            LOW
          </span>
          <div
            className="w-14 h-1.5 rounded-sm border"
            style={{
              background: 'var(--liq-grad, linear-gradient(90deg, #2b1a5e, #7b2a9c, #d6479a, #ffd84a))',
              borderColor: 'var(--border)',
              opacity: layerOpacity / 100,
            }}
          />
          <span className="text-[9px] font-mono uppercase" style={{ color: 'var(--text-3)' }}>
            HI
          </span>
        </div>

        {/* Opacity slider */}
        <div className="flex items-center gap-1 pl-2 border-l" style={{ borderColor: 'var(--border)' }}>
          <Sliders size={11} style={{ color: 'var(--text-2)' }} />
          <input
            type="range"
            min="50"
            max="100"
            value={layerOpacity}
            onChange={(e) => onOpacityChange(parseInt(e.target.value, 10))}
            className="w-14 h-1 bg-[var(--border)] rounded cursor-pointer accent-[var(--accent)]"
            title="Layer opacity"
          />
          <span className="text-[10px] font-mono w-6 text-right" style={{ color: 'var(--text-2)' }}>
            {layerOpacity}%
          </span>
        </div>
      </div>

      {/* Wall Filter Slider Expandable Tray */}
      {showWallConfig && (
        <div
          className="w-full pt-1.5 mt-1 border-t flex items-center justify-between text-[11px] font-mono gap-4"
          style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}
        >
          <div className="flex items-center gap-2">
            <span>Порог плотности стены:</span>
            <input
              type="range"
              min="1.5"
              max="6.0"
              step="0.5"
              value={minWallMultiplier}
              onChange={(e) => onMinWallChange(parseFloat(e.target.value))}
              className="w-24 h-1 bg-[var(--border)] rounded cursor-pointer accent-[var(--warn)]"
            />
            <span className="font-bold text-[var(--warn)]">{minWallMultiplier}x от среднего</span>
          </div>

          <div className="flex items-center gap-2">
            <span>Толщина линий стен:</span>
            {[1, 2, 3, 4].map((th) => (
              <button
                key={th}
                type="button"
                onClick={() => onWallThicknessChange(th)}
                className="px-2 py-0.5 rounded border transition cursor-pointer"
                style={{
                  backgroundColor: wallLineThickness === th ? 'var(--panel)' : 'transparent',
                  borderColor: wallLineThickness === th ? 'var(--accent)' : 'var(--border)',
                  color: wallLineThickness === th ? 'var(--accent)' : 'var(--text-3)',
                }}
              >
                {th}px
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
