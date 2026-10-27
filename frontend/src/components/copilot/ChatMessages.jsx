
function renderFormattedText(text) {
  if (!text || typeof text !== 'string') return text;
  // Parse **bold** and `code`
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index} className="font-bold text-foreground">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={match.index} className="px-1 py-0.5 rounded bg-muted font-mono text-[10px] text-accent-foreground border border-border/60">{token.slice(1, -1)}</code>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

import React from 'react';
import { RefreshCw } from 'lucide-react';

// Лента сообщений чата AI Copilot (пузыри user/assistant + индикатор генерации).
// bottomRef — якорь автопрокрутки (передаётся из AICopilotSidebar).

export default function ChatMessages({ messages, chatLoading, selectedModel, bottomRef }) {
  return (
    <div className="space-y-2 pt-1">
      {messages.map((m, idx) => (
        <div
          key={idx}
          className={`flex flex-col ${
            m.role === 'user' ? 'items-end' : 'items-start'
          }`}
        >
          <div
            className={`max-w-[92%] p-2 rounded-lg text-[10.5px] leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-[#2563eb] text-white rounded-br-xs'
                : 'bg-[#141822] text-[#e2e8f0] border border-[#222938] rounded-bl-xs'
            }`}
          >
            {renderFormattedText(m.content)}
          </div>
        </div>
      ))}
      {chatLoading && (
        <div className="flex items-center space-x-1.5 text-[#787f91] text-[10px] p-2 font-mono">
          <RefreshCw size={11} className="animate-spin text-[#38bdf8]" />
          <span>Генерация ответа Order Flow ({selectedModel})...</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
