# Work Queue

This is the shared queue for LibreChat, Cline, and Antigravity.

## Statuses

- `DRAFT` — task is being prepared by LibreChat.
- `READY_FOR_CLINE` — Cline may claim the task.
- `READY_FOR_ANTIGRAVITY` — Antigravity reviews or implements the explicitly assigned part.
- `WAITING_FOR_LIBRECHAT` — an agent has reported and is waiting for the coordinator.
- `NEEDS_USER_DECISION` — work pauses for a product or architecture decision.
- `DONE` — acceptance criteria and checks passed.

## Active task

- `DONE` — **003-phase1-production-robust-closeout** (`tasks/003-phase1-production-robust-closeout.md`):
  closeout ROADMAP 1.1–1.2, ветка `agent/kimi/phase1-production-robust-closeout`, агент Kimi Work.
  Ожидает решения Di: запуск paper-марафона 3–5 суток (вне рамок задачи).

## Backlog (приоритет сверху, добавлено Di / Kimi 2026-10-24)

1. `READY_FOR_CLINE` — **Кластерные индикаторы в торговых стратегиях** (запрос Di, аннотация к панели
   Футпринт): спец-индикаторы поверх footprint (stacked imbalance, absorption, POC-migration,
   дельта-дивергенции) должны стать сигнальными фильтрами в `orderflow_backtester` и live-раннерах.
   Источник данных готов: `/api/recorder/clusters` + `annotate_cluster_metrics` (poc_price уже есть).
2. `DRAFT` — **Единый paper-модуль, этап 2**: из вкладки «По парам» (TradeHistoryWidget) —
   запуск/остановка торговли по паре прямо из таблицы (сейчас — переход в мастер paper-торговли),
   применение AI-рекомендаций оптимизатора в один клик (продолжение ROADMAP 6.2 «Apply Strategy #X»).

## Rules

1. Only one agent may have an active task at a time.
2. The task file is the authority for scope, allowed files, acceptance criteria, and tests.
3. Agents must append their report to `context/AGENT_MESSAGES.md` and update `context/COORDINATION_STATE.json`.
4. Do not treat a changed file as a message until the report and status are written.
