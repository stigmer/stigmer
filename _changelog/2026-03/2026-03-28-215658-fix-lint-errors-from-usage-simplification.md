# Fix Lint and Compile Errors from Usage Tracking Simplification

**Date**: March 28, 2026

## Summary

Resolved all remaining lint and compile errors left over from the usage tracking simplification (`04bb8914`). The proto breaking change — removing `status.usage` from `AgentExecutionStatus` and `SubAgentExecution` — left two Go test files referencing the deleted field, two Python lint violations in the refactored status builder, and a mypy type conflict in the error handler.

## Problem Statement

After the usage tracking simplification landed, `make check` failed in the Stigmer OSS repo due to test files and production code that still referenced the removed `Usage` field or had lint issues introduced during the refactor.

### Pain Points

- `usage_aggregation_test.go` (stigmer-server) — Go vet error: `unknown field Usage in struct literal of type agentexecutionv1.AgentExecutionStatus`
- `run_display_summary_test.go` (CLI) — same Go vet error in 3 test functions that set `Status.Usage` directly
- `status_builder.py` — import sorting violation (I001) and unused variable `wait_ms` (F841)
- `execute_graphton.py` — mypy type conflict: `error_msg` first assigned as `str`, then as `AgentMessage`

## Solution

Updated all test code to construct `AgentMessage` objects with `LlmCallMetrics` (the new single source of truth) instead of the removed `Usage` field. Fixed Python lint violations that were introduced during the refactor.

## Implementation Details

### Go Test Rewrites (2 files)

- **`usage_aggregation_test.go`**: Replaced `makeUsage()` + `Status.Usage` pattern with `makeAIMessage()` helper that creates `AgentMessage` with `LlmCallMetrics`. Updated `makeExecution()` to accept `[]*AgentMessage` instead of `*UsageMetrics`. Recalculated test expectations to account for `computeUsageFromMessages()` aggregating across main + sub-agent messages.
- **`run_display_summary_test.go`**: Updated 3 test functions (`WithUsageCost`, `WithUsageNoCost`, `CacheHitRateDisplay`) to embed `LlmCallMetrics` on messages instead of setting `Status.Usage`.

### Python Lint Fixes (2 files)

- **`status_builder.py`**: Moved `todo_pb2.TodoItem` import to correct alphabetical position (after `subagent_pb2`). Removed unused `wait_ms` variable left over from the usage tracker removal.
- **`execute_graphton.py`**: Renamed `error_msg` (AgentMessage) to `fail_system_msg` to avoid mypy type conflict with earlier `error_msg` (str) declaration in the approval resume path.

### Go Format (1 file)

- **`usage_format.go`**: `gofmt` alignment normalization (whitespace only).

## Benefits

- `make check` passes cleanly in the Stigmer OSS repo
- All 1305 Python tests, 165 TypeScript tests, and all Go tests pass
- No functional changes — only test data construction and lint compliance

## Impact

- **Stigmer OSS repo only** — Stigmer Cloud was already clean
- **No behavioral changes** — test expectations verify the same business logic
- Unblocks CI for the usage tracking simplification branch

## Related Work

- [Usage Tracking Simplification](2026-03-28-212723-usage-tracking-simplification.md) — the parent change that removed `status.usage`

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes
