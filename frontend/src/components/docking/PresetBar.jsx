import React, { useState, useEffect } from 'react';
import { useLayoutStore } from '../../stores/layoutStore';
import { LayoutGrid, Plus, Trash2, Check, RefreshCw, AlertCircle, Save, Zap, Layers, ArrowUpDown } from 'lucide-react';

export default function PresetBar({ onSwitchPreset, onNewPreset, onAddTradesPanel, layersProps }) {
  const presets = useLayoutStore((s) => s.presets);
  const activePresetId = useLayoutStore((s) => s.activePresetId);
  const saveStatus = useLayoutStore((s) => s.saveStatus);
  const deletePreset = useLayoutStore((s) => s.deletePreset);

  const [wsHeight, setWsHeight] = useState('auto');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`signalscript_ws_height_${activePresetId}`);
      if (!saved || saved === 'auto') {
        setWsHeight('auto');
      } else {
        const num = parseFloat(saved);
        setWsHeight(!isNaN(num) ? num : 'auto');
      }
    } catch (_) {}
  }, [activePresetId]);

  const dispatchWsHeight = (val) => {
    if (val === 'auto') {
      setWsHeight('auto');
      window.dispatchEvent(new CustomEvent('signalscript:set-workspace-height', { detail: { mode: 'auto' } }));
    } else {
      setWsHeight(val);
      window.dispatchEvent(new CustomEvent('signalscript:set-workspace-height', { detail: { ratio: Number(val) } }));
    }
  };

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
      className="h-[28px] bg-card/90 border-b border-border/60 px-2.5 flex items-center justify-between text-xs select-none shrink-0"
    >
      {/* Left: Layers (if enabled) + Presets list */}
      <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar py-0.5">
        {layersProps?.showLiqLayers && (
          <div className="flex items-center space-x-1 shrink-0 mr-1.5">
            <div className="flex items-center space-x-1 text-muted-foreground text-[11px] uppercase font-mono tracking-wider mr-1 shrink-0">
              <Layers size={11} className="text-primary" />
              <span>Слои:</span>
            </div>
            <button
              type="button"
              onClick={() => layersProps.onLayerToggle ? layersProps.onLayerToggle('liqHeatmap') : layersProps.toggleLayer?.('liqHeatmap')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer shrink-0 ${
                layersProps.layers?.liqHeatmap
                  ? 'bg-primary/20 text-primary border-primary/50 font-bold'
                  : 'text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${layersProps.layers?.liqHeatmap ? 'bg-primary' : 'bg-muted-foreground'}`} />
              <span>Карта ликв.</span>
            </button>
            <button
              type="button"
              onClick={() => layersProps.onLayerToggle ? layersProps.onLayerToggle('liqLevels') : layersProps.toggleLayer?.('liqLevels')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer shrink-0 ${
                layersProps.layers?.liqLevels
                  ? 'bg-primary/20 text-primary border-primary/50 font-bold'
                  : 'text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${layersProps.layers?.liqLevels ? 'bg-primary' : 'bg-muted-foreground'}`} />
              <span>Уровни ликв.</span>
            </button>
            <button
              type="button"
              onClick={() => layersProps.onLayerToggle ? layersProps.onLayerToggle('obDepth') : layersProps.toggleLayer?.('obDepth')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer shrink-0 ${
                layersProps.layers?.obDepth
                  ? 'bg-primary/20 text-primary border-primary/50 font-bold'
                  : 'text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${layersProps.layers?.obDepth ? 'bg-primary' : 'bg-muted-foreground'}`} />
              <span>Спот-стены</span>
            </button>
            <button
              type="button"
              onClick={() => layersProps.onLayerToggle ? layersProps.onLayerToggle('obProfile') : layersProps.toggleLayer?.('obProfile')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center space-x-1 border transition cursor-pointer shrink-0 ${
                layersProps.layers?.obProfile
                  ? 'bg-primary/20 text-primary border-primary/50 font-bold'
                  : 'text-muted-foreground border-border hover:bg-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${layersProps.layers?.obProfile ? 'bg-primary' : 'bg-muted-foreground'}`} />
              <span>Профиль стакана</span>
            </button>
            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-mono bg-muted/60 text-muted-foreground border border-border shrink-0">
              Стены {layersProps.minWallMultiplier}x
            </span>
            <div className="h-3.5 w-px bg-border/60 mx-1 shrink-0" />
          </div>
        )}
        <div className="flex items-center space-x-1 text-muted-foreground text-[11px] uppercase font-mono tracking-wider mr-1.5 shrink-0">
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
                  ? 'bg-[#1e283d] text-foreground border-[#3b82f650] shadow-sm'
                  : 'bg-[#0f1420] text-[#94a3b8] border-[#1b2233] hover:text-foreground hover:bg-[#151c2c]'
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

        {/* Единая форма добавления виджетов — в топ-баре («+ Add Widget» / «Каталог виджетов...») */}

        {/* Open / Focus Trades Tape button */}
        {onAddTradesPanel && (
          <button
            type="button"
            data-testid="btn-add-trades-panel"
            onClick={onAddTradesPanel}
            title="Открыть / Переключить на ленту сделок (Tape)"
            className="flex items-center space-x-1 px-2 py-0.5 rounded text-[10.5px] bg-card text-foreground border border-border hover:bg-muted transition cursor-pointer shrink-0"
          >
            <Zap size={11} />
            <span className="text-[10px] font-mono font-medium">Лента сделок</span>
          </button>
        )}
      </div>

      {/* Right: Workspace Height Selector + Autosave status indicator */}
      <div className="flex items-center space-x-2 text-[10px] font-mono shrink-0 pl-2">
        {/* Workspace Height Quick Menu */}
        <div data-testid="preset-bar-height-menu" className="flex items-center space-x-1 bg-muted/40 px-1.5 py-0.5 rounded border border-border/60">
          <span className="text-muted-foreground flex items-center gap-1 text-[9.5px]">
            <ArrowUpDown size={10} className="text-primary" />
            <span>Высота:</span>
          </span>
          <button
            type="button"
            data-testid="btn-ws-height-auto"
            onClick={() => dispatchWsHeight('auto')}
            title="Автовысота (100% экрана)"
            className={`px-1 py-0.2 rounded transition cursor-pointer ${
              wsHeight === 'auto'
                ? 'bg-primary text-primary-foreground font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Авто
          </button>
          <button
            type="button"
            data-testid="btn-ws-height-125"
            onClick={() => dispatchWsHeight(1.25)}
            title="125% высоты экрана (прокрутка вниз)"
            className={`px-1 py-0.2 rounded transition cursor-pointer ${
              wsHeight === 1.25
                ? 'bg-primary text-primary-foreground font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            +25%
          </button>
          <button
            type="button"
            data-testid="btn-ws-height-150"
            onClick={() => dispatchWsHeight(1.5)}
            title="150% высоты экрана (прокрутка вниз)"
            className={`px-1 py-0.2 rounded transition cursor-pointer ${
              wsHeight === 1.5
                ? 'bg-primary text-primary-foreground font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            +50%
          </button>
          <button
            type="button"
            data-testid="btn-ws-height-200"
            onClick={() => dispatchWsHeight(2.0)}
            title="200% (удвоенная высота экрана)"
            className={`px-1 py-0.2 rounded transition cursor-pointer ${
              wsHeight === 2.0
                ? 'bg-primary text-primary-foreground font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            x2
          </button>
          <button
            type="button"
            data-testid="btn-ws-height-300"
            onClick={() => dispatchWsHeight(3.0)}
            title="300% (утроенная высота экрана)"
            className={`px-1 py-0.2 rounded transition cursor-pointer ${
              wsHeight === 3.0
                ? 'bg-primary text-primary-foreground font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            x3
          </button>
        </div>
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
              <span className="font-bold text-foreground text-[12px] flex items-center gap-1.5">
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
                className="w-full px-2.5 py-1.5 bg-[#080a0f] border border-[#1f2638] rounded text-foreground text-[11px] outline-none focus:border-[#3b82f6]"
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
                className="px-2.5 py-1 rounded text-[10px] text-[#94a3b8] hover:text-foreground hover:bg-[#1a2130] transition cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                data-testid="btn-submit-new-preset"
                className="px-3 py-1 rounded text-[10px] font-bold bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground transition cursor-pointer shadow"
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
