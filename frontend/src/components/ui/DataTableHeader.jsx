import { Checkbox } from '@/components/ui/checkbox';
import React, { useState, useRef } from 'react';
import { Columns, RotateCcw, GripVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/**
 * DataTableHeader - Интерактивный заголовок таблицы с drag-to-reorder, resize и меню видимости колонок.
 */
export default function DataTableHeader({
  columns = [],
  visibleColumns = [],
  onReorder = null,
  onResize = null,
  onToggleVisibility = null,
  onReset = null,
  className = '',
}) {
  const [draggedIdx, setDraggedIdx] = useState(null);
  const resizeRef = useRef(null);

  const handleDragStart = (e, idx) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleDragOver = (e, hoverIdx) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === hoverIdx) return;
  };

  const handleDrop = (e, hoverIdx) => {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== hoverIdx && onReorder) {
      onReorder(draggedIdx, hoverIdx);
    }
    setDraggedIdx(null);
  };

  const startResize = (e, colId) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      if (onResize) {
        onResize(colId, deltaX);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <thead className={`bg-muted/50 border-b border-border text-[11px] font-mono text-muted-foreground select-none ${className}`}>
      <tr>
        {visibleColumns.map((col, idx) => (
          <th
            key={col.id}
            draggable={Boolean(onReorder)}
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            style={{ width: col.width ? `${col.width}px` : undefined }}
            className={`relative px-2 py-1.5 text-left font-semibold tracking-wide transition-colors ${
              draggedIdx === idx ? 'opacity-40 bg-muted/80' : 'hover:bg-muted/40'
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate">{col.label || col.id}</span>
              {onReorder && (
                <GripVertical size={10} className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing" />
              )}
            </div>

            {/* Resize Drag Handle */}
            {onResize && (
              <div
                onMouseDown={(e) => startResize(e, col.id)}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/50 transition-colors"
                title="Перетащите для изменения ширины колонки"
              />
            )}
          </th>
        ))}

        {/* Columns Settings Menu Column */}
        {onToggleVisibility && (
          <th className="w-8 px-1 py-1.5 text-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="table-columns-menu-btn"
                  title="Настройка отображения колонок"
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                >
                  <Columns size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 p-1 font-mono text-xs shadow-xl">
                <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground tracking-wider py-1">
                  Видимость колонок
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="max-h-56 overflow-y-auto space-y-0.5">
                  {columns.map((col) => (
                    <label
                      key={col.id}
                      className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-[11px]"
                    >
                      <span className="text-foreground">{col.label || col.id}</span>
                      <input
                        type="checkbox"
                        checked={col.visible !== false}
                        onChange={() => onToggleVisibility(col.id)}
                        className="rounded accent-primary"
                      />
                    </label>
                  ))}
                </div>
                {onReset && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onReset}
                      className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground cursor-pointer"
                    >
                      <RotateCcw size={11} />
                      <span>Сбросить колонки</span>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </th>
        )}
      </tr>
    </thead>
  );
}
