import React from 'react';
import { InfoTip } from './fields';

// Презентационный (управляемый) компонент пресет-бара — вынесен из BacktestPanel.jsx (п.2 модульного плана).
// Вся логика (applyPresetByObj, handleSavePreset, fetchPresets, store-синхронизация) остаётся в панели;
// здесь только рендер и колбэки.

export default function BacktestPresetsBar({
  presets,
  selectedPresetId,
  showSavePresetInput,
  newPresetName,
  onToggleSaveInput,
  onNameChange,
  onSave,
  onSelectPreset,
  onApplyPreset
}) {
  return (
    <div
      data-testid="strategy-presets-bar"
      className="p-1.5 rounded-md bg-[#0e1217] border border-neutral-800 space-y-1 font-mono"
    >
      <div className="flex items-center justify-between text-[8.5px]">
        <span className="font-bold text-neutral-300 uppercase tracking-wider flex items-center">
          ⚡ Пресеты (1 клик):
          <InfoTip text="Готовые наборы проверенных квант-параметров для быстрого тестирования в 1 клик" />
        </span>
        <button
          type="button"
          data-testid="btn-open-save-preset"
          onClick={onToggleSaveInput}
          className="text-neutral-400 hover:text-neutral-200 hover:underline cursor-pointer font-bold transition-colors"
        >
          {showSavePresetInput ? '✕ Отмена' : '+ Сохранить текущие'}
        </button>
      </div>

      {showSavePresetInput ? (
        <div className="flex items-center space-x-1 pt-0.5">
          <input
            data-testid="input-preset-name"
            type="text"
            placeholder="Название пресета..."
            title="Имя набора текущих параметров (стратегия, SL/TP, фильтры). Сохраняется в браузере и применяется в 1 клик."
            value={newPresetName}
            onChange={(e) => onNameChange(e.target.value)}
            className="flex-1 bg-neutral-900 border border-neutral-700 rounded px-1.5 py-0.5 text-[9.5px] text-white outline-none focus:border-neutral-500"
          />
          <button
            type="button"
            data-testid="btn-confirm-save-preset"
            onClick={onSave}
            disabled={!newPresetName.trim()}
            className="px-2 py-0.5 rounded bg-neutral-200 hover:bg-white text-neutral-950 text-[9px] font-bold disabled:opacity-40 cursor-pointer transition-colors"
          >
            💾 Сохранить
          </button>
        </div>
      ) : (
        <div className="flex items-center space-x-1">
          <select
            data-testid="select-strategy-preset"
            value={selectedPresetId}
            onChange={(e) => onSelectPreset(e.target.value)}
            className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-[9.5px] text-neutral-200 outline-none focus:border-neutral-500"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="btn-apply-preset-1click"
            onClick={onApplyPreset}
            className="px-2 py-0.5 rounded bg-neutral-200 hover:bg-white text-neutral-950 text-[9px] font-bold cursor-pointer shrink-0 transition-colors"
            title="Применить выбранный набор параметров в 1 клик без перезапуска"
          >
            Применить
          </button>
        </div>
      )}
    </div>
  );
}
