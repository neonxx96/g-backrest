import React from 'react';
import { X } from 'lucide-react';

// Save Custom Template Modal (SMC-шаблоны рисования).
// Извлечено ДОСЛОВНО из Chart.jsx (слайс 6.4o, п.1 MODULARIZATION_PLAN):
// JSX, тексты и обработчики перенесены без изменений.
// Пропсы: showSaveTemplateModal/setShowSaveTemplateModal, newTemplateName/
// setNewTemplateName (state из useChartDrawings через Chart.jsx),
// activeTool/activeDrawingStyle (useChartDrawings), handleSaveCurrentAsTemplate.

export default function SaveTemplateModal({
  showSaveTemplateModal,
  setShowSaveTemplateModal,
  newTemplateName,
  setNewTemplateName,
  activeTool,
  activeDrawingStyle,
  handleSaveCurrentAsTemplate,
}) {
  return (
    <>
      {/* Save Custom Template Modal */}
      {showSaveTemplateModal && (
        <div
          data-testid="modal-save-template"
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 font-sans"
        >
          <div className="bg-[#0f1420] border border-[#253248] rounded-lg p-4 w-80 shadow-2xl font-mono text-xs text-[#d1d4dc]">
            <div className="flex items-center justify-between mb-3 border-b border-[#1f2738] pb-2">
              <span className="font-bold text-foreground text-sm">Сохранить как шаблон SMC</span>
              <button
                type="button"
                onClick={() => setShowSaveTemplateModal(false)}
                className="text-[#64748b] hover:text-foreground cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
            <div className="mb-3">
              <label className="text-[10px] text-[#94a3b8] block mb-1">Название шаблона:</label>
              <input
                data-testid="input-template-name"
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="например, Мой FVG H1"
                className="w-full bg-[#070a10] border border-[#2a364f] rounded px-2 py-1 text-foreground text-xs outline-none focus:border-[#38bdf8]"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-[#64748b] mb-4">
              <span>Инструмент: {activeTool || 'Линия'}</span>
              <div className="flex items-center space-x-1">
                <span>Цвет:</span>
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: activeDrawingStyle.strokeColor }} />
                <span>({activeDrawingStyle.lineWidth}px)</span>
              </div>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowSaveTemplateModal(false)}
                className="px-2.5 py-1 rounded bg-[#1e2536] hover:bg-[#2a3449] text-[#94a3b8] text-xs cursor-pointer"
              >
                Отмена
              </button>
              <button
                data-testid="btn-confirm-save-template"
                type="button"
                onClick={handleSaveCurrentAsTemplate}
                disabled={!newTemplateName.trim()}
                className="px-3 py-1 rounded bg-[#2563eb] hover:bg-[#1d4ed8] text-foreground font-bold text-xs disabled:opacity-40 cursor-pointer"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
