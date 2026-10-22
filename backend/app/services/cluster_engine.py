"""Deterministic footprint, profile, wall and liquidation calculations."""

from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple


@dataclass(frozen=True)
class TradeEvent:
    price: float
    quantity: float
    is_buyer_maker: bool
    timestamp: int


@dataclass
class ClusterCell:
    price: float
    bid_volume: float = 0.0
    ask_volume: float = 0.0

    @property
    def total_volume(self) -> float:
        return self.bid_volume + self.ask_volume

    @property
    def delta(self) -> float:
        return self.ask_volume - self.bid_volume

    @property
    def imbalance(self) -> float:
        smaller = min(self.bid_volume, self.ask_volume)
        return self.total_volume / smaller if smaller > 0 else (float("inf") if self.total_volume else 0.0)


@dataclass
class Footprint:
    cells: Dict[float, ClusterCell]
    cvd: float


@dataclass(frozen=True)
class VolumeProfile:
    poc_price: float
    vah_price: float
    val_price: float
    total_volume: float


@dataclass(frozen=True)
class Wall:
    price: float
    amount: float
    multiplier: float


@dataclass(frozen=True)
class LiquidationLevel:
    price: float
    leverage: str
    side: str
    intensity: float


class ClusterEngine:
    def __init__(self, price_step: float = 1.0):
        if price_step <= 0:
            raise ValueError("price_step must be positive")
        self.price_step = float(price_step)

    def _bucket(self, price: float) -> float:
        return round((float(price) // self.price_step) * self.price_step, 10)

    def aggregate_trades(self, trades: Iterable[TradeEvent], starting_cvd: float = 0.0) -> Footprint:
        cells: Dict[float, ClusterCell] = {}
        cvd = float(starting_cvd)
        for trade in trades:
            if trade.price <= 0 or trade.quantity < 0:
                continue
            price = self._bucket(trade.price)
            cell = cells.setdefault(price, ClusterCell(price=price))
            if trade.is_buyer_maker:
                cell.bid_volume += trade.quantity
                cvd -= trade.quantity
            else:
                cell.ask_volume += trade.quantity
                cvd += trade.quantity
        return Footprint(cells=cells, cvd=cvd)

    def volume_profile(self, footprint: Footprint, value_area_fraction: float = 0.70) -> VolumeProfile:
        if not footprint.cells:
            return VolumeProfile(0.0, 0.0, 0.0, 0.0)
        if not 0 < value_area_fraction <= 1:
            raise ValueError("value_area_fraction must be in (0, 1]")
        ordered = sorted(footprint.cells.values(), key=lambda cell: cell.price)
        poc = max(ordered, key=lambda cell: (cell.total_volume, -cell.price))
        total = sum(cell.total_volume for cell in ordered)
        target = total * value_area_fraction
        selected = {poc.price}
        covered = poc.total_volume
        while covered < target and len(selected) < len(ordered):
            candidates = [cell for cell in ordered if cell.price not in selected]
            candidate = max(candidates, key=lambda cell: (cell.total_volume, -abs(cell.price - poc.price)))
            selected.add(candidate.price)
            covered += candidate.total_volume
        return VolumeProfile(min(selected), max(selected), min(selected), total) if len(selected) == 1 else VolumeProfile(poc.price, max(selected), min(selected), total)

    def detect_walls(self, levels: Sequence[Tuple[float, float]], multiplier: float = 3.0) -> List[Wall]:
        positive = [float(amount) for _, amount in levels if amount > 0]
        if not positive or multiplier <= 0:
            return []
        walls: List[Wall] = []
        for index, (price, amount) in enumerate(levels):
            if amount <= 0:
                continue
            peers = [value for peer_index, (_, value) in enumerate(levels) if peer_index != index and value > 0]
            baseline = sum(peers) / len(peers) if peers else float(amount)
            ratio = float(amount) / baseline if baseline > 0 else 0.0
            if ratio >= multiplier:
                walls.append(Wall(float(price), float(amount), ratio))
        return walls

    def liquidation_levels(self, current_price: float, leverage_tiers: Sequence[int] = (25, 50, 75, 100)) -> List[LiquidationLevel]:
        if current_price <= 0:
            raise ValueError("current_price must be positive")
        levels: List[LiquidationLevel] = []
        for leverage in leverage_tiers:
            if leverage <= 0:
                continue
            distance = 1.0 / float(leverage)
            levels.extend([
                LiquidationLevel(current_price * (1 - distance), f"{leverage}x", "LONG", min(1.0, leverage / 100)),
                LiquidationLevel(current_price * (1 + distance), f"{leverage}x", "SHORT", min(1.0, leverage / 100)),
            ])
        return levels
