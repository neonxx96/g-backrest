"""
Регрессионный тест на дедлок оценки входов LivePaperRunner (баг aad9717).

История: гвард в tick_cycle `self._last_entry_candle == self.indicator_candle_close_time`
(защита от дубль-входа на одной свече) с init-значений 0 == 0 был истинен ДО первого
вызова _load_indicator_context (который и устанавливает indicator_candle_close_time) —
оценка сигналов никогда не запускалась: paper-марафон жил с evaluations=0 и 0 сделок
(замечено 2026-10-23 в morning report, см. docs/PAPER_MARATHON.md).

Фикс: sentinel -1 вместо 0. Дубль-вход на свечу по-прежнему блокируется — после входа
_last_entry_candle присваивается indicator_candle_close_time (строка присваивания в
обработке входа не менялась).
"""

from unittest.mock import patch

from backend.app.services.live_paper_runner import LivePaperRunner


def test_fresh_runner_entry_guard_not_deadlocked():
    """Свежий раннер: гвард дубль-входа НЕ совпадает — цикл оценки может стартовать."""
    runner = LivePaperRunner()
    assert runner._last_entry_candle == -1
    assert runner.indicator_candle_close_time == 0
    # Именно это сравнение в tick_cycle уводило в ранний return при 0 == 0:
    assert runner._last_entry_candle != runner.indicator_candle_close_time


def test_start_resets_entry_candle_to_sentinel():
    """start() переводит раннер в «нет записанного входа», а не в 0 == close_time."""
    runner = LivePaperRunner()
    # Имитируем уже записанный вход, затем перезапускаем сессию
    runner._last_entry_candle = 1_792_700_000_000
    runner.indicator_candle_close_time = 1_792_700_000_000

    with patch("asyncio.create_task") as mock_create_task, \
         patch.object(runner, "_runner_loop", return_value=None):
        mock_create_task.return_value = None
        runner.start(config={"symbol": "BTCUSDT", "timeframe": "15m"}, run_id="r", config_fingerprint="f")

    assert runner._last_entry_candle == -1
    # indicator_candle_close_time сбрасывается в 0 — гвард снова НЕ совпадает
    assert runner.indicator_candle_close_time == 0
    assert runner._last_entry_candle != runner.indicator_candle_close_time
