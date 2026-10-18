# Antigravity Trading Terminal Engineering Rules

## 1. Master Context Source
- The current blueprint, architectural constraints, and task definitions are located in context/CURRENT_TASK.md.
- Read context/CURRENT_TASK.md before planning actions or launching subagents.

## 2. Quantitative & Architecture Standards
- Zero Look-Ahead Bias: Strategies must only consume data available strictly at or before execution timestamp t.
- Performance: Prioritize vectorization (NumPy/Polars) or zero-copy event-driven structures.
- Precision: Round prices and lot sizes according to exchange tick-size/lot-size filters.

## 3. Artifact & Log Protocol
- Reflect all completed checklist items directly in context/CURRENT_TASK.md.
- Run terminal test verification (pytest, benchmarks) before concluding the task.
- Update "### Execution Log" with diff summaries and test results.
