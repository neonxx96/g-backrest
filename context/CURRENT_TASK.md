# Current Task: Limit Order Simulator (Fast Backtest Setup)

## Status
- **Priority**: 🔴 CRITICAL (торговля завтра)
- **Agent**: Antigravity (OpenRouter)
- **Branch**: main (HEAD: a129916, tag: stable-20261018-merged)
- **Target**: agent/cline/limit-fill-simulator

## Completed
- ✅ All branches merged to main (35 commits, fast-forward, 0 conflicts)
- ✅ scripts/check.ps1 GREEN (16 tests, build 611ms, Playwright smoke + live WS)
- ✅ Tag stable-20261018-merged created
- ✅ Push to origin completed (main = a129916, tag pushed)
- ✅ Model routing synchronized (config/model-routing.json = OpenRouter budget models)

## Next Steps
1. Create branch agent/cline/limit-fill-simulator from main.
2. Implement backend simulator (backend/app/services/limit_fill_simulator.py).
3. Add API route POST /api/backtest/simulate-limit-box.
4. Write tests (backend/tests/test_limit_fill_simulator.py) with look-ahead bias check.
5. Run scripts/check.ps1 → EXIT_CODE=0.
6. Do NOT implement frontend HUD yet (Chart.jsx монолит не трогать).

## Quant Constraints
- Zero look-ahead bias: bars with open_time <= created_at_ts are ignored.
- Limit fill: low <= entry (BUY) / high >= entry (SELL), price = entry, fee = maker.
- TP = limit (maker), SL = market (taker + adverse slippage).
- Tie-break (TP & SL in same bar): conservative → SL first (worst case).
- Timestamps: UTC ms, deterministic (no Math.random()).

## Notes
- Consultative mode only: auto-trading forbidden.
- If scope creep detected → stop and ask user.
