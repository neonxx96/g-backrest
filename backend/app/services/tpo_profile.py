"""TPO / Volume Profile из записанных aggTrades-принтов (SRS M1.2a).

Truth-first контракт: если реальных принтов нет (пустой DataFrame, нет файла,
все цены NaN) — `poc_price` / `tpoc_price` / VA-границы возвращаются как None
(JSON null), ничего не синтезируется.

Определения:
- TPO: для каждого периода (по умолчанию 30 мин) собирается множество ценовых
  бакетов, которых касалась цена; TPO-count бакета = число периодов, его коснувшихся.
- TPOC: бакет с максимальным TPO-count (тай-брейк: ближе к VWAP, затем ниже цена).
- TVAH/TVAL: классическая двусторонняя экспансия от TPOC по TPO-count до
  покрытия >= value_area_fraction суммарного TPO.
- POC/VAH/VAL: то же самое по объёму (buy+sell) на бакет.
"""

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class ProfileRow:
    price: float
    tpo_count: int
    buy_volume: float
    sell_volume: float
    total_volume: float
    tpo_in_value_area: bool = False
    volume_in_value_area: bool = False


@dataclass(frozen=True)
class TpoProfile:
    symbol: str
    date: str
    tick_size: float
    period_minutes: int
    value_area_fraction: float
    data_available: bool
    poc_price: Optional[float]
    tpoc_price: Optional[float]
    vah_price: Optional[float]
    val_price: Optional[float]
    tvah_price: Optional[float]
    tval_price: Optional[float]
    total_tpo: int
    total_volume: float
    source: str = "recorded_agg_trades"
    rows: List[ProfileRow] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _empty_profile(symbol: str, date: str, tick_size: float, period_minutes: int,
                   value_area_fraction: float) -> TpoProfile:
    return TpoProfile(
        symbol=symbol, date=date, tick_size=tick_size, period_minutes=period_minutes,
        value_area_fraction=value_area_fraction, data_available=False,
        poc_price=None, tpoc_price=None, vah_price=None, val_price=None,
        tvah_price=None, tval_price=None, total_tpo=0, total_volume=0.0, rows=[],
    )


def _validate(tick_size: float, period_minutes: int, value_area_fraction: float) -> None:
    if tick_size <= 0:
        raise ValueError("tick_size must be positive")
    if period_minutes <= 0:
        raise ValueError("period_minutes must be positive")
    if not 0 < value_area_fraction <= 1:
        raise ValueError("value_area_fraction must be in (0, 1]")


def _value_area(prices: np.ndarray, weights: np.ndarray, poc_idx: int,
                fraction: float) -> List[bool]:
    """Классическая экспансия value area от POC: на каждом шаге берём сторону
    с большим весом (при равенстве — обе), пока покрытие < fraction."""
    n = len(prices)
    total = float(weights.sum())
    target = total * fraction
    in_va = np.zeros(n, dtype=bool)
    in_va[poc_idx] = True
    covered = float(weights[poc_idx])
    lo, hi = poc_idx, poc_idx
    while covered < target and (lo > 0 or hi < n - 1):
        up = float(weights[hi + 1]) if hi < n - 1 else -1.0
        down = float(weights[lo - 1]) if lo > 0 else -1.0
        if up < 0 and down < 0:
            break
        if up > down:
            hi += 1
            in_va[hi] = True
            covered += up
        elif down > up:
            lo -= 1
            in_va[lo] = True
            covered += down
        else:  # равные веса — расширяем в обе стороны
            if hi < n - 1:
                hi += 1
                in_va[hi] = True
                covered += up
            if lo > 0:
                lo -= 1
                in_va[lo] = True
                covered += down
    return in_va.tolist()


def build_tpo_profile(
    trades: pd.DataFrame,
    symbol: str = "",
    date: str = "",
    tick_size: float = 1.0,
    period_minutes: int = 30,
    value_area_fraction: float = 0.70,
) -> TpoProfile:
    """Строит TPO + Volume Profile из принтов (timestamp ms, price, quantity,
    is_taker_buy). Пустой вход → профиль с null-полями (контракт M1.2a)."""
    _validate(tick_size, period_minutes, value_area_fraction)
    symbol = symbol.upper()

    if trades is None or len(trades) == 0:
        return _empty_profile(symbol, date, tick_size, period_minutes, value_area_fraction)

    df = trades.dropna(subset=["price", "timestamp"]).copy()
    df = df[(df["price"] > 0) & (df["quantity"] > 0)]
    if len(df) == 0:
        return _empty_profile(symbol, date, tick_size, period_minutes, value_area_fraction)

    df["bucket"] = (np.floor(df["price"] / tick_size) * tick_size).round(10)
    df["period"] = (df["timestamp"].astype(np.int64) // (period_minutes * 60_000))

    buy_mask = df["is_taker_buy"].astype(bool) if "is_taker_buy" in df.columns else np.zeros(len(df), dtype=bool)
    grouped = df.groupby("bucket")
    total_vol = grouped["quantity"].sum()
    buy_vol = df[buy_mask].groupby("bucket")["quantity"].sum()
    # TPO: число уникальных периодов на бакет
    tpo = df.drop_duplicates(subset=["period", "bucket"]).groupby("bucket").size()

    prices = np.array(sorted(total_vol.index), dtype=float)
    vol_w = np.array([float(total_vol.get(p, 0.0)) for p in prices])
    tpo_w = np.array([float(tpo.get(p, 0)) for p in prices], dtype=float)

    vwap = float((df["price"] * df["quantity"]).sum() / df["quantity"].sum())

    def _poc_idx(weights: np.ndarray) -> int:
        best = int(np.argmax(weights))
        ties = np.flatnonzero(weights == weights[best])
        if len(ties) > 1:
            # детерминированный тай-брейк: ближе к VWAP, затем ниже цена
            best = int(min(ties, key=lambda i: (abs(prices[i] - vwap), prices[i])))
        return best

    vol_poc = _poc_idx(vol_w)
    tpo_poc = _poc_idx(tpo_w)
    vol_va = _value_area(prices, vol_w, vol_poc, value_area_fraction)
    tpo_va = _value_area(prices, tpo_w, tpo_poc, value_area_fraction)

    vol_va_prices = prices[np.array(vol_va)]
    tpo_va_prices = prices[np.array(tpo_va)]

    rows = [
        ProfileRow(
            price=float(p),
            tpo_count=int(tpo.get(p, 0)),
            buy_volume=float(buy_vol.get(p, 0.0)),
            sell_volume=float(total_vol.get(p, 0.0) - buy_vol.get(p, 0.0)),
            total_volume=float(total_vol.get(p, 0.0)),
            tpo_in_value_area=tpo_va[i],
            volume_in_value_area=vol_va[i],
        )
        for i, p in enumerate(prices)
    ]

    return TpoProfile(
        symbol=symbol, date=date, tick_size=tick_size, period_minutes=period_minutes,
        value_area_fraction=value_area_fraction, data_available=True,
        poc_price=float(prices[vol_poc]),
        tpoc_price=float(prices[tpo_poc]),
        vah_price=float(vol_va_prices.max()),
        val_price=float(vol_va_prices.min()),
        tvah_price=float(tpo_va_prices.max()),
        tval_price=float(tpo_va_prices.min()),
        total_tpo=int(tpo.sum()),
        total_volume=float(total_vol.sum()),
        rows=rows,
    )


def infer_tick_size(prices: pd.Series, target_rows: int = 200) -> float:
    """Подбирает «круглый» tick, чтобы профиль имел ~target_rows бакетов."""
    prices = prices.dropna()
    if len(prices) == 0:
        return 1.0
    span = float(prices.max() - prices.min())
    if span <= 0:
        return max(float(prices.iloc[0]) * 1e-4, 1e-8)
    raw = span / max(target_rows, 1)
    magnitude = 10 ** np.floor(np.log10(raw))
    for mult in (1, 2, 5, 10):
        if raw <= mult * magnitude:
            return float(mult * magnitude)
    return float(10 * magnitude)


def load_recorded_trades(data_dir: Path, symbol: str, date: str) -> Optional[pd.DataFrame]:
    """Читает `data_dir/<SYMBOL>/trades_<date>.parquet`; None, если файла нет."""
    parquet_file = Path(data_dir) / symbol.upper() / f"trades_{date}.parquet"
    if not parquet_file.exists():
        return None
    return pd.read_parquet(parquet_file)


def list_recorded_dates(data_dir: Path, symbol: str) -> List[str]:
    """Список дат, по которым есть записанные принты символа."""
    sym_dir = Path(data_dir) / symbol.upper()
    if not sym_dir.exists():
        return []
    return sorted(
        f.name[len("trades_"):-len(".parquet")]
        for f in sym_dir.glob("trades_*.parquet")
    )
