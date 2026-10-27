import React from 'react';

// Быстрые вопросы-чипы ассистенту (сайдбар AI Copilot) — прокидывают готовый промпт
// в обработчик чата AICopilotSidebar.

const QUICK_PROMPTS = [
  { emoji: '🧱', label: 'Стенки в стакане', prompt: 'Где сейчас крупные лимитные плотности и стенки?' },
  { emoji: '📊', label: 'Дивергенция CVD', prompt: 'Как трактовать текущую кумулятивную дельту CVD?' },
  { emoji: '🛡️', label: 'Риск-менеджмент ATR', prompt: 'Как правильно рассчитать динамический SL по ATR?' },
  { emoji: '🎯', label: 'Рекомендация', prompt: 'Дай торговую рекомендацию по Order Flow прямо сейчас' }
];

export default function QuickPromptChips({ onPrompt }) {
  return (
    <div className="pt-2 border-t border-[#1f2430]">
      <div className="text-[10px] text-[#787f91] mb-1.5 font-semibold">
        Быстрые вопросы ассистенту:
      </div>
      <div className="flex flex-wrap gap-1">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q.label}
            onClick={() => onPrompt(q.prompt)}
            className="px-2 py-0.5 rounded-full bg-[#161a24] hover:bg-[#202738] text-[#94a3b8] hover:text-foreground border border-[#262c3d] text-[10px] transition cursor-pointer"
          >
            {q.emoji} {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
