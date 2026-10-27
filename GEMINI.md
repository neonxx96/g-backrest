# GEMINI.md — Правила для Antigravity Agent

> **ЕДИНЫЙ ИСТОЧНИК ПРАВИЛ:** Основные архитектурные, инженерные правила, стек технологий, правила Git и шлюз качества определены в [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md). Все требования обязательны к исполнению.

## Быстрые правила для Antigravity

1. **Контекст задачи**:
   - Перед началом работы прочитать [HANDOFF.md](file:///d:/AI_agent_space/gemini/HANDOFF.md) и [context/CURRENT_TASK.md](file:///d:/AI_agent_space/gemini/context/CURRENT_TASK.md).
   - Следовать спецификации задачи в `tasks/` (текущая: [tasks/008-situation-analysis-and-winrate-boost.md](file:///d:/AI_agent_space/gemini/tasks/008-situation-analysis-and-winrate-boost.md)).

2. **Квантовые и архитектурные стандарты**:
   - Zero Look-Ahead Bias: вычисления на свече $t$ используют только данные $\le t$.
   - Все решения и параметры риска валидируются через [docs/DECISIONS.md](file:///d:/AI_agent_space/gemini/docs/DECISIONS.md) и `backend/app/services/risk_engine.py`.

3. **Дизайн-система и верстка**:
   - Строго соблюдать Раздел 11 [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md) и [docs/design/DESIGN_GUIDE.md](file:///d:/AI_agent_space/gemini/docs/design/DESIGN_GUIDE.md).
   - Никаких raw Tailwind-цветов (`bg-gray-800`), только токены shadcn (`bg-card`, `text-foreground`).
   - Использовать компоненты из `src/components/ui/`, а не нативные теги.

4. **Шлюз качества и завершение задачи**:
   - Перед коммитом запустить `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`.
   - Оформить отчет строго по разделу 7 [AGENTS.md](file:///d:/AI_agent_space/gemini/AGENTS.md).
