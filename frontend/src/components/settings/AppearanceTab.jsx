import React from 'react';
import { THEME_PRESETS, MONO_FONTS } from './uiConfig';

// Вкладка «Внешний вид & Тема» — управляемая: cfg + updateUi колбэк (логика в SettingsModal).
export default function AppearanceTab({ cfg, updateUi }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-white font-bold mb-2 text-xs">
          Цветовая тема терминала:
        </label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {Object.values(THEME_PRESETS).map(preset => {
            const isSelected = cfg.theme === preset.id;
            return (
              <div
                key={preset.id}
                onClick={() => updateUi({ theme: preset.id })}
                style={{ backgroundColor: preset.bgPanel }}
                className={`p-3 rounded-md border cursor-pointer transition flex flex-col justify-between ${
                  isSelected
                    ? 'border-[#38bdf8] ring-1 ring-[#38bdf8]/50 shadow-lg'
                    : 'border-[#1f2430] opacity-75 hover:opacity-100 hover:border-[#2e3646]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs" style={{ color: preset.textMain }}>
                      {preset.name}
                    </span>
                    <span
                      className="text-[9px] px-1.5 py-0.2 rounded font-bold"
                      style={{ backgroundColor: `${preset.accent}22`, color: preset.accent }}
                    >
                      {preset.badge}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#787f91] leading-snug">{preset.desc}</p>
                </div>

                {/* Swatches preview */}
                <div className="flex items-center space-x-1.5 mt-2.5 pt-2 border-t border-[#161922]">
                  <span className="w-3.5 h-3.5 rounded-xs border border-white/20" style={{ backgroundColor: preset.bgRoot }} title="Фон" />
                  <span className="w-3.5 h-3.5 rounded-xs" style={{ backgroundColor: preset.bull }} title="Покупки (Bull)" />
                  <span className="w-3.5 h-3.5 rounded-xs" style={{ backgroundColor: preset.bear }} title="Продажи (Bear)" />
                  <span className="w-3.5 h-3.5 rounded-xs" style={{ backgroundColor: preset.accent }} title="Акцент" />
                  {isSelected && <span className="ml-auto text-[10px] text-[#38bdf8] font-bold">✓ Активна</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-[#1b212f]" />

      {/* Monospace Font Selector */}
      <div>
        <label className="block text-white font-bold mb-1.5 text-xs">
          Моноширинный шрифт для котировок, шкалы и стакана:
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {MONO_FONTS.map(f => {
            const active = cfg.fontFamily === f.id;
            return (
              <button
                key={f.id}
                onClick={() => updateUi({ fontFamily: f.id })}
                style={{ fontFamily: f.stack }}
                className={`p-2 rounded border text-left transition ${
                  active
                    ? 'bg-[#17253b] border-[#38bdf8] text-white font-bold'
                    : 'bg-[#10131a] border-[#1f2430] text-[#848e9c] hover:text-white'
                }`}
              >
                <div className="text-[11px] truncate">{f.label}</div>
                <div className="text-[10px] text-[#38bdf8] mt-0.5">81,462.50</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-px bg-[#1b212f]" />

      {/* Opacity Sliders: Grid & Candles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-2.5 rounded bg-[#10131a] border border-[#1b212f] space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-white font-semibold text-[11px]">Прозрачность сетки графика:</span>
            <span className="text-[#38bdf8] font-bold">{Math.round((cfg.gridOpacity ?? 0.22) * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.04"
            max="0.60"
            step="0.02"
            value={cfg.gridOpacity ?? 0.22}
            onChange={e => updateUi({ gridOpacity: parseFloat(e.target.value) })}
            className="w-full accent-[#38bdf8]"
          />
          <div className="text-[9.5px] text-[#60697b]">
            Регулирует контраст линий сетки KLineCharts
          </div>
        </div>

        <div className="p-2.5 rounded bg-[#10131a] border border-[#1b212f] space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-white font-semibold text-[11px]">Яркость свечей (Opacity):</span>
            <span className="text-[#26a69a] font-bold">{Math.round((cfg.candleOpacity ?? 1.0) * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.40"
            max="1.00"
            step="0.05"
            value={cfg.candleOpacity ?? 1.0}
            onChange={e => updateUi({ candleOpacity: parseFloat(e.target.value) })}
            className="w-full accent-[#26a69a]"
          />
          <div className="text-[9.5px] text-[#60697b]">
            Приглушает тело свечей для акцента на кластерах и плотностях
          </div>
        </div>
      </div>
    </div>
  );
}
