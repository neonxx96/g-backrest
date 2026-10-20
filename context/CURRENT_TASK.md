# Current Task Specification

### Objective
Initial project setup and architecture baseline.

### Quant Constraints
- UTC millisecond timestamps (ms).
- Zero future data leakage (No Look-Ahead Bias).
- Strict handling of slippage, commissions, and order book depth.

### Affected Files
- context/CURRENT_TASK.md

### Implementation Checklist
- [x] Initial coordination files created.
- [x] S0 read-only audit of legacy recorder and recorded Parquet completed.
- [x] S0 lake architecture and integrity rules recorded in `DECISIONS.md`.
- [x] S1 standalone recorder implementation.
- [ ] Remote deployment and 24-hour acceptance run.

### Execution Log
- Coordination environment successfully initialized.
- S0 completed on branch `agent/codex/recorder`; no source code or legacy data changed.
- Next session/step: implement S1 in a separate process/package and keep the existing recorder running in parallel.
- S1 progress: canonical envelope, Binance trade/ticker/mark/liquidation/closed-kline normalizers, fsync spool journal, immutable zstd Parquet writer with SHA-256 manifests, gap journal, and YAML config are implemented and covered by six tests.
- S1 deployment artifacts: `Dockerfile.recorder`, `docker-compose.recorder.yml`, `recorder.yaml` with `max_storage_gib: 50`, and `run_recorder.ps1`/`stop_recorder.ps1`; local Docker build succeeded.
- Remote deployment is pending only because no server target was discoverable in the current environment.
