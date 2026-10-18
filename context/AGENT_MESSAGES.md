# Agent Messages

Append-only coordination journal for LibreChat, Cline, and Antigravity.

Each message must include:

```markdown
## [UTC timestamp] [AGENT] [TASK-ID] [STATUS]

### Summary
- What was done.

### Changed files
- `path/to/file`

### Verification
- Command and actual result.

### Next action
- Exact next step or `NONE`.
```

No secrets, API keys, passwords, or full environment dumps are allowed here.
