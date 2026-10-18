# LibreChat Agent Setup

## Agent name

`SignalScript Coordinator`

## System prompt

Use the full prompt from `context/LIBRECHAT_AGENT_SYSTEM_PROMPT.md`.

## Files/knowledge to attach

- `AGENTS.md`
- `HANDOFF.md`
- `context/CURRENT_TASK.md`
- `context/WORK_QUEUE.md`
- `context/COORDINATION_STATE.json`
- `context/AGENT_MESSAGES.md`
- `tasks/TEMPLATE.md`
- `scripts/cline-auto.ps1`
- `config/model-routing.json`

## Tool permissions

- File read: enabled.
- File write: enabled only inside this project.
- Terminal: enabled for `git diff`, tests, `scripts/check.ps1`, and the Cline router.
- Web access: use only when the task explicitly requires current external information.
- Secrets: never expose `.env`, API keys, passwords, or full environment dumps to the model context.

## First test message

```text
Прочитай AGENTS.md, HANDOFF.md и все файлы context/. Не меняй код. Проверь, что координационный протокол понятен, перечисли текущий статус и предложи одну следующую задачу в tasks/ без её выполнения.
```

## Acceptance test

The agent must report:

1. `COORDINATION_STATE.json` is `READY`.
2. There is no active agent.
3. The next task must be isolated in `tasks/`.
4. Cline must be started through `scripts/cline-auto.ps1`.
5. The agent asks the user before changing architecture or financial execution rules.
