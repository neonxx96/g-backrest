# CLAUDE.md — Правила для Claude / Cline Agent

> **ЕДИНЫЙ ИСТОЧНИК ПРАВИЛ:** Основные архитектурные, инженерные правила, стек технологий, правила Git и шлюз качества определены в [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md). Все требования обязательны к исполнению.

## Быстрые правила для Claude / Cline

1. **Контекст задачи**:
   - Перед началом работы прочитать [HANDOFF.md](file:///d:/AI_agent_space/gemini/HANDOFF.md) и [context/CURRENT_TASK.md](file:///d:/AI_agent_space/gemini/context/CURRENT_TASK.md).
   - Следовать спецификации активной задачи в `tasks/`.

2. **Дизайн-система и верстка**:
   - Строго соблюдать Раздел 11 [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md).
   - Запрет на использование raw Tailwind-цветов (`bg-gray-800`, `text-zinc-400`). Только токены shadcn (`bg-card`, `text-foreground`, `border-border`).
   - Использовать компоненты из `src/components/ui/` (`Button`, `Input`, `Select`, `Dialog`, etc.) вместо нативных `<button>`, `<input>`, `<select>`.
   - Размеры только через `rem` и токены плотности.

3. **Квантовые и архитектурные стандарты**:
   - Zero Look-Ahead Bias: вычисления на свече $t$ используют только данные $\le t$.
   - Все решения и параметры риска валидируются через [docs/DECISIONS.md](file:///d:/AI_agent_space/gemini/docs/DECISIONS.md) и `backend/app/services/risk_engine.py`.

4. **Шлюз качества и завершение задачи**:
   - Перед коммитом запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`.
   - Оформить отчет строго по разделу 7 [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md).
