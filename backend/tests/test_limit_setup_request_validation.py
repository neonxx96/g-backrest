"""Контрактные тесты валидации геометрии limit-setup (задача 2.5, догоняющий фикс).

Регрессия из ветки agent/cline/replay-engine: ручная проверка `sl_price >= tp_price`
в handler отвергала ВСЕ шорты (у SELL норма — sl ВЫШЕ tp). Проверка перенесена
в model_validator LimitSetupRequest и стала зависимой от стороны.
Чистые функции, без TestClient (конвенция проекта).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.app.routers.backtest import LimitSetupRequest

_BASE = dict(
    symbol="BTCUSDT",
    entry_price=65000.0,
    size=0.01,
    created_at_ts=1_790_000_000_000,
    max_bars=60,
)


def _make(side: str, sl: float, tp: float) -> LimitSetupRequest:
    return LimitSetupRequest(side=side, sl_price=sl, tp_price=tp, **_BASE)


def test_buy_normal_geometry_ok():
    req = _make("BUY", sl=64000.0, tp=67000.0)
    assert req.side == "BUY"


def test_buy_inverted_geometry_rejected():
    with pytest.raises(ValidationError):
        _make("BUY", sl=67000.0, tp=64000.0)


def test_sell_normal_geometry_ok():
    # Шорт: tp ниже входа, sl выше — tp < sl обязан проходить (регрессия).
    req = _make("SELL", sl=67000.0, tp=64000.0)
    assert req.side == "SELL"


def test_sell_inverted_geometry_rejected():
    with pytest.raises(ValidationError):
        _make("SELL", sl=64000.0, tp=67000.0)


def test_side_lowercase_normalized_ok():
    req = _make("sell", sl=67000.0, tp=64000.0)
    assert req.side == "sell"  # значение не мутирует; нормализация — в handler
