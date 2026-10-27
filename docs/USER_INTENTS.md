# User Intent Scenarios & Quick Actions

This document captures high-level user commands and intent scenarios automated in SignalScript.

---

## 1. Automated Strategy Calibration & Overnight Marathon

**User Intent:** *"Configure optimal strategies / launch overnight test run"*

- **Single API Call:**
  ```http
  POST http://127.0.0.1:8000/api/overnight-pilot/auto-select
  Content-Type: application/json

  {
    "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    "days": 14,
    "include_explore": true,
    "duration_hours": 12,
    "start": true
  }
  ```
- **CLI Alternative:**
  ```powershell
  .\.venv\Scripts\python.exe scripts/select_pair_strategies.py
  ```
- **Execution Logic:**
  - Trains strategies and timeframes per coin on a 70% TRAIN split, validates on 30% Out-Of-Sample (OOS).
  - Categorizes pairs: `SELECT` (0.35% risk allocation) and `EXPLORE` (0.15% risk allocation). Unviable pairs are marked `SKIP` and omitted from execution.
  - Results are persisted to `data/pair_selection.json` and visualized in the UI under the *"Аналитика & Винрейт"* tab.

---

## 2. Trade Analytics & Post-Mortem Diagnostic

**User Intent:** *"Show trade statistics / what went wrong with the session"*

- **API Endpoint:**
  ```http
  GET http://127.0.0.1:8000/api/paper-trading/analytics/post-mortem?period=24h
  ```
- **Returns:**
  - Categorized loss causes (`STOP_OUT`, `FEE_DRAG`, `MFE_REVERSAL`, `STALE_TIME_OUT`, `ADVERSE_EXIT`, `BAD_ENTRY`).
  - Fee Burden Index (FBI) tracking exchange fee drag relative to gross returns.
  - Actionable timeframe and strategy adjustments.

---

## 3. Docker Production Deployment

**User Intent:** *"Run application in Docker"*

- **Command:**
  ```powershell
  docker compose up -d --build
  ```
- **Service Endpoints:**
  - Backend API: `http://127.0.0.1:8000`
  - Web UI: `http://127.0.0.1:7100`
  - Persistent volume: `./data` mounted into `/app/data`

---

## 4. "Never Regress" Principle

- Every code change must first pass the verification gate: `powershell -ExecutionPolicy Bypass -File scripts/check.ps1`.
- Any algorithmic strategy changes are accepted **only** upon confirmation on Out-Of-Sample (OOS) data and A/B verification, never solely on in-sample training data.
