"""Versioned paper-risk contract.

Public API/configuration values use percentage points (``0.5`` means 0.5%).
Execution internals consume fractions (``0.005``).  Conversion is explicit and
performed only here; callers must never infer units from a numeric magnitude.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict


RISK_CONTRACT_VERSION = 1
RISK_UNITS_PERCENT = "percent"


@dataclass(frozen=True)
class SharedRiskProfile:
    risk_per_trade_pct: float
    max_portfolio_heat_pct: float = 1.25
    max_directional_heat_pct: float = 0.75
    max_positions: int = 4
    daily_dd_limit_pct: float = 3.0
    circuit_daily_loss_limit_pct: float = -1.25
    circuit_weekly_loss_limit_pct: float = -3.50
    max_consecutive_losses: int = 3
    contract_version: int = RISK_CONTRACT_VERSION
    units: str = RISK_UNITS_PERCENT

    @classmethod
    def from_api_config(cls, config: Dict[str, Any]) -> "SharedRiskProfile":
        version = int(config.get("risk_contract_version", RISK_CONTRACT_VERSION))
        units = str(config.get("risk_units", RISK_UNITS_PERCENT))
        if version != RISK_CONTRACT_VERSION:
            raise ValueError(f"unsupported risk_contract_version={version}")
        if units != RISK_UNITS_PERCENT:
            raise ValueError("risk_units must be 'percent'; fractions are internal only")
        profile = cls(
            risk_per_trade_pct=float(config.get("risk_per_trade_pct", 1.0)),
            max_portfolio_heat_pct=float(config.get("max_portfolio_heat_pct", 1.25)),
            max_directional_heat_pct=float(config.get("max_directional_heat_pct", 0.75)),
            max_positions=int(config.get("max_positions", 4)),
            daily_dd_limit_pct=float(config.get("daily_dd_limit_pct", 3.0)),
            circuit_daily_loss_limit_pct=float(config.get("circuit_daily_loss_limit_pct", -1.25)),
            circuit_weekly_loss_limit_pct=float(config.get("circuit_weekly_loss_limit_pct", -3.50)),
            max_consecutive_losses=int(config.get("max_consecutive_losses", 3)),
            contract_version=version,
            units=units,
        )
        profile.validate()
        return profile

    def validate(self) -> None:
        if not 0 < self.risk_per_trade_pct <= 10:
            raise ValueError("risk_per_trade_pct must be in (0, 10] percentage points")
        if not 0 < self.max_directional_heat_pct <= self.max_portfolio_heat_pct <= 100:
            raise ValueError("directional heat must be positive and no greater than portfolio heat")
        if self.max_positions < 1:
            raise ValueError("max_positions must be at least one")
        if self.daily_dd_limit_pct <= 0 or self.max_consecutive_losses < 1:
            raise ValueError("drawdown and consecutive-loss limits must be positive")
        if self.circuit_daily_loss_limit_pct >= 0 or self.circuit_weekly_loss_limit_pct >= 0:
            raise ValueError("circuit loss limits must be negative percentage points")

    @property
    def risk_per_trade_fraction(self) -> float:
        return self.risk_per_trade_pct / 100.0

    @property
    def max_portfolio_heat_fraction(self) -> float:
        return self.max_portfolio_heat_pct / 100.0

    @property
    def max_directional_heat_fraction(self) -> float:
        return self.max_directional_heat_pct / 100.0

    def snapshot(self) -> Dict[str, Any]:
        return {
            "risk_contract_version": self.contract_version,
            "risk_units": self.units,
            "risk_per_trade_pct": self.risk_per_trade_pct,
            "risk_per_trade_fraction": self.risk_per_trade_fraction,
            "max_portfolio_heat_pct": self.max_portfolio_heat_pct,
            "max_portfolio_heat_fraction": self.max_portfolio_heat_fraction,
            "max_directional_heat_pct": self.max_directional_heat_pct,
            "max_directional_heat_fraction": self.max_directional_heat_fraction,
            "max_positions": self.max_positions,
            "daily_dd_limit_pct": self.daily_dd_limit_pct,
            "circuit_daily_loss_limit_pct": self.circuit_daily_loss_limit_pct,
            "circuit_weekly_loss_limit_pct": self.circuit_weekly_loss_limit_pct,
            "max_consecutive_losses": self.max_consecutive_losses,
        }
