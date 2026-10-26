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
            {m.content}
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
