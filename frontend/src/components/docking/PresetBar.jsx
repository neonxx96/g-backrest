import React, { useState } from 'react';
import { useLayoutStore } from '../../stores/layoutStore';
import { LayoutGrid, Plus, Trash2, Check, RefreshCw, AlertCircle, Save, Zap } from 'lucide-react';

export default function PresetBar({ onSwitchPreset, onNewPreset, onAddTradesPanel }) {
  const presets = useLayoutStore((s) => s.presets);
  const activePresetId = useLayoutStore((s) => s.activePresetId);
  const saveStatus = useLayoutStore((s) => s.saveStatus);
  const deletePreset = useLayoutStore((s) => s.deletePreset);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    try {
      setErrorMsg('');
      if (onNewPreset) {
        await onNewPreset(newPresetName.trim());
      }
      setNewPresetName('');
      setShowAddModal(false);
    } catch (err) {
      setErrorMsg(err.message || 'Ошибка создания пресета');
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (window.confirm('Удалить этот пользовательский пресет?')) {
      try {
        await deletePreset(id);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  return (
    <div
      data-testid="preset-bar"
      className="h-[30px] bg-[#0c0f17] border-b border-[#1b2130] px-3 flex items-center justify-between text-xs select-none shrink-0"
    >
      {/* Left: Presets list */}
      <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar py-0.5">
        <div className="flex items-center space-x-1 text-[#64748b] text-[10px] uppercase font-mono tracking-wider mr-1.5 shrink-0">
          <LayoutGrid size={11} className="text-[#3b82f6]" />
          <span>Раскладки:</span>
        </div>

        {presets.map((p) => {
          const isActive = p.id === activePresetId;
          const isProtected = p.id === 'default_classic' || p.id === 'default_orderflow';

          return (
            <div
              key={p.id}
              data-testid={`preset-tab-${p.id}`}
              onClick={() => onSwitchPreset(p.id)}
              className={`group flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10.5px] font-medium transition cursor-pointer border shrink-0 ${
                isActive
                  ? 'bg-[#1e283d] text-white border-[#3b82f650] shadow-sm'
                  : 'bg-[#0f1420] text-[#94a3b8] border-[#1b2233] hover:text-white hover:bg-[#151c2c]'
              }`}
            >
              <span>{p.name}</span>

              {/* Delete button for custom presets */}
              {!isProtected && (
                <button
                  type="button"
                  data-testid={`btn-delete-preset-${p.id}`}
                  onClick={(e) => handleDelete(p.id, e)}
                  title="Удалить пресет"
                  className="opacity-0 group-hover:opacity-100 hover:text-[#ef4444] transition p-0.5 cursor-pointer"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          );
        })}

        {/* Add new preset '+' button (up to 10 max) */}
        {presets.length < 10 && (
          <button
            type="button"
            data-testid="btn-add-preset"
            onClick={() => setShowAddModal(true)}
            title="Создать новый пресет (до 10)"
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10.5px] bg-[#0f1420] text-[#38bdf8] border border-[#1b253b] hover:bg-[#18243b] hover:border-[#38bdf850] transition cursor-pointer shrink-0"
          >
            <Plus size={11} />
            <span className="text-[10px] font-mono">Пресет</span>
          </button>
        )}

        {/* Open / Focus Trades Tape button */}
        {onAddTradesPanel && (
          <button
            type="button"
            data-testid="btn-add-trades-panel"
            onClick={onAddTradesPanel}
            title="Открыть / Переключить на ленту сделок (Tape)"
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] bg-[#171a23] text-[#eab308] border border-[#2e374d] hover:bg-[#202738] hover:border-[#eab30860] transition cursor-pointer shrink-0"
          >
            <Zap size={11} />
            <span className="text-[10px] font-mono font-medium">Лента сделок</span>
          </button>
        )}
      </div>

      {/* Right: Autosave status indicator */}
      <div className="flex items-center space-x-2 text-[10px] font-mono shrink-0 pl-2">
        {saveStatus === 'saving' && (
          <span
            data-testid="save-status-saving"
            className="flex items-center space-x-1 text-[#f59e0b] bg-[#f59e0b15] px-1.5 py-0.5 rounded border border-[#f59e0b30]"
          >
            <RefreshCw size={10} className="animate-spin" />
            <span>Автосохранение...</span>
          </span>
        )}
        {saveStatus === 'saved' && (
          <span
            data-testid="save-status-saved"
            className="flex items-center space-x-1 text-[#10b981] bg-[#10b98115] px-1.5 py-0.5 rounded border border-[#10b98130]"
          >
            <Check size={10} />
            <span>Сохранено в SQLite</span>
          </span>
        )}
        {saveStatus === 'error' && (
          <span
            data-testid="save-status-error"
            className="flex items-center space-x-1 text-[#ef4444] bg-[#ef444415] px-1.5 py-0.5 rounded border border-[#ef444430]"
          >
            <AlertCircle size={10} />
            <span>Ошибка сохранения</span>
          </span>
        )}
      </div>

      {/* Modal for creating a new preset */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleCreate}
            className="bg-[#0e121a] border border-[#222838] rounded-lg p-4 w-80 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#1b2130] pb-2">
              <span className="font-bold text-white text-[12px] flex items-center gap-1.5">
                <Save size={13} className="text-[#3b82f6]" />
                <span>Новый пресет раскладки</span>
              </span>
              <span className="text-[9.5px] font-mono text-[#64748b]">
                {presets.length}/10
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-[#94a3b8] font-mono block">
                Название пресета:
              </label>
              <input
                data-testid="input-new-preset-name"
                type="text"
                autoFocus
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="например: Двойной стакан BTC/ETH"
                className="w-full px-2.5 py-1.5 bg-[#080a0f] border border-[#1f2638] rounded text-white text-[11px] outline-none focus:border-[#3b82f6]"
              />
            </div>

            {errorMsg && (
              <div className="text-[10px] text-[#ef4444] bg-[#ef444415] p-1.5 rounded border border-[#ef444430]">
                {errorMsg}
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-2.5 py-1 rounded text-[10px] text-[#94a3b8] hover:text-white hover:bg-[#1a2130] transition cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                data-testid="btn-submit-new-preset"
                className="px-3 py-1 rounded text-[10px] font-bold bg-[#2563eb] hover:bg-[#1d4ed8] text-white transition cursor-pointer shadow"
              >
                Сохранить
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
