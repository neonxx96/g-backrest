# Current Task: Слияние recorder-ветки в main (2026-10-22)

## Status
- **Priority**: 🟡 СЛИЯНИЕ ВЫПОЛНЕНО (merge main + agent/codex/recorder)
- **Agent**: Kimi Work (новый агент)
- **Branch**: main (merge commit)
- **Gate**: scripts/check.ps1 — ALL QUALITY CHECKS PASSED (212 pytest, build, blocking + live UI smoke)

## Completed
- ✅ Все ветки слиты в main (merge, 1 конфликт в CURRENT_TASK.md — разрешён)
- ✅ scripts/check.ps1 GREEN (212 passed, 28 skipped; build; Playwright blocking + live WS)
- ✅ Tag stable-20261018-merged создан (main = a129916, tag pushed)
- ✅ Model routing synchronized (config/model-routing.json = OpenRouter budget models)
- ✅ Recorder S1: canonical envelope, нормализаторы, fsync spool, immutable zstd Parquet + SHA-256 манифесты, gap-журнал, YAML-конфиг; Docker-артефакты собраны
- ✅ ROADMAP.md и CODEGRAPH.md добавлены (мастер-план + карта кода)

## Quant Constraints (limit-fill task)
- Zero look-ahead bias: bars with open_time <= created_at_ts are ignored.
- Limit fill: low <= entry (BUY) / high >= entry (SELL), price = entry, fee = maker.
- TP = limit (maker), SL = market (taker + adverse slippage).
- Tie-break (TP & SL in same bar): conservative → SL first (worst case).
- Timestamps: UTC ms, deterministic (no Math.random()).

## Next Steps
1. Remote deployment recorder (нужен SSH/Docker target от пользователя) + 48 ч параллельного прогона.
2. Внедрить пресет production_robust в overnight_pilot.py (см. AI_HANDOFF.md §3).
3. Судьба веток agent/cline/* (replay-engine, limit-fill-simulator, live-assistant) — решение Di.
4. Дальнейшие шаги — по ROADMAP.md (редактирует Di).

## Notes
- Consultative mode only: auto-trading forbidden.
- If scope creep detected → stop and ask user.
- Backend: два runtime (старый listener 8000, новый 8002 по data/backend_runtime.json) — требует решения (ROADMAP Фаза 0.2).
