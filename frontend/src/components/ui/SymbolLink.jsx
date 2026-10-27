import React from 'react';
import { useColorLinksStore, COLOR_CHANNELS } from '../../stores/colorLinksStore';

/**
 * SymbolLink - Интерактивный тикер инструмента для таблиц и виджетов.
 * 
 * Особенности:
 * - Клик переключает активный символ во всех виджетах канала (по умолчанию c1).
 * - Отображает точку цветового канала, если привязан.
 * - Чистый моно-шрифт с hover-подсветкой.
 */
export default function SymbolLink({
  symbol,
  channel = 'c1',
  className = '',
  onClick = null,
  showDot = true,
}) {
  if (!symbol) return null;

  const cleanSym = String(symbol).toUpperCase().trim();
  const focusSymbol = useColorLinksStore((s) => s.focusSymbol);
  const activeChannelConfig = COLOR_CHANNELS.find((c) => c.id === channel);

  const handleClick = (e) => {
    e.stopPropagation();
    if (onClick) {
      onClick(cleanSym);
    } else if (focusSymbol) {
      focusSymbol(cleanSym, channel);
    } else {
      useColorLinksStore.getState().setChannelSymbol(channel, cleanSym);
    }
  };

  return (
    <button
      type="button"
      data-testid={`symbol-link-${cleanSym}`}
      onClick={handleClick}
      title={`Открыть ${cleanSym} на графике и в стакане (Канал ${channel.toUpperCase()})`}
      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded font-mono text-xs font-semibold text-foreground hover:text-primary hover:bg-muted/80 transition cursor-pointer select-none border border-transparent hover:border-border/60 ${className}`}
    >
      {showDot && activeChannelConfig && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: activeChannelConfig.color }}
        />
      )}
      <span>{cleanSym}</span>
    </button>
  );
}
