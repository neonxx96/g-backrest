# Task 006 — Блок 3: AI Copilot как двухконтурный Sentinel для удержания прибыли (Profit Retention)

## 1. Контекст и цель
Главная проблема алгоритмической торговли на дистанции — **MFE Bleed** (утечка нереализованной прибыли): сделка выходит в плюс `+0.8R..+1.5R`, но не доходит нескольких тиков до дальнего тейка, разворачивается на встречном поглощении и закрывается по стопу или с мизерным плюсом, съедаемым комиссией.

Для решения этой проблемы реализуется **двухконтурный Position Sentinel**:
- **Tier 1 — Cold Quant Profit-Lock (0 мс, детерминированный, на каждом тике в `EarlyExitEngine`)**:
  1. **Fee-Adjusted Breakeven (`MOVE_SL_BREAKEVEN`)**: при достижении `MFE >= 0.8R` стоп переносится в безубыток с запасом на двойную комиссию и тик проскальзывания (`entry ± fee_buffer`).
  2. **Step-Lock MFE Trailing (`STEP_LOCK_SL`)**:
     - При `MFE >= 1.2R` стоп подтягивается минимум на `+0.4R` чистой прибыли.
     - При `MFE >= 1.8R` стоп подтягивается минимум на `+0.9R` чистой прибыли.
  3. **Absorption Reversal Lock (`PARTIAL_CLOSE_50` / `STEP_LOCK_SL`)**: если позиция в плюсе (`MFE >= 0.7R`), но в кластерах/ленте появляется встречное поглощение (`absorption_detected`) или сильная встречная дельта (`depth_delta_pct`), Sentinel фиксирует 50% позиции (`PARTIAL_CLOSE_50`) и подтягивает стоп на `+0.5R`.
  4. **Smart Time-Stop (`EARLY_EXIT_MARKET` / `MOVE_SL_BREAKEVEN`)**: если сделка висит дольше `time_stop_seconds` без импульса (`pnl_r < time_stop_r_threshold`) и идёт отток объёма против позиции — ранний выход или подтяжка стопа.
- **Tier 2 — Event-Driven OpenRouter AI Sentinel (`evaluate_open_position_sentinel`)**:
  - Вызывается асинхронно с кулдауном 90 секунд на позицию только при возникновении триггерных событий (`MFE >= 0.8R`, `MFE_Bleed`, `Time_Stop`, встречный дисбаланс стакана).
  - Возвращает структурированный вердикт: `HOLD` | `TIGHTEN_SL` | `PARTIAL_CLOSE_50` | `EARLY_EXIT_MARKET`, `suggested_sl` и объяснение на русском языке.
  - При недоступности LLM / исчерпании дневного лимита бесшовно переключается на детерминированный Cold Quant Sentinel Fallback.
- **Строгий инвариант безопасности (`clamp_protective_stop`)**:
  - Ни одно правило Quant или AI Sentinel **никогда не имеет права расширить стоп-лосс** (увеличить риск) или поставить стоп по ту сторону текущей рыночной цены.

## 2. Затрагиваемые файлы
- `backend/app/services/early_exit_engine.py`
- `backend/app/services/openrouter_client.py`
- `backend/app/services/live_paper_runner.py`
- `backend/tests/test_ai_sentinel_profit_lock.py`
