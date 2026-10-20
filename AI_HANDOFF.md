# AI Handoff & Project State
Last Updated: 2026-10-21 00:05:26 MSK
Phase: 3 - Production Paper Trading & Fee Drag Optimization

## 1. Current Architecture State

Backend работает на динамических портах (старый 8000, новый 8002).

Учетный инвариант PnL строго подтвержден (145/145 тестов). Комиссии (Maker 0.02% / Taker 0.05%) и Slippage считаются корректно.

Механики выхода (Dynamic Breakeven, Trailing Stop, Limit TP) работают без ошибок.

## 2. Identified Blockers (Solved)

Проблема сплошного NO_ENTRY была вызвана слишком узким окном RSI (40-42) и Fee Drag (съедание профита комиссиями при скальп-целях).

## 3. Next Immediate Actions (For next AI Agent)

Core: Внедрить пресет production_robust в overnight_pilot.py (vol_mult = 1.25, RSI 42-58, R:R >= 2.75:1 с TP >= 2.2% и SL 0.75-0.80%).

Scripts: Обновить scripts/night-pilot.ps1 для запуска пресета production_robust на порту 8002 для BTC, ETH, SOL.

Logging: Добавить вывод WinRate, Net PnL по монетам и алерты (Warning Sentinel) при блокировке входов.
