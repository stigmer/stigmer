# Fix `make check` Lint and Test Failures

**Date**: February 26, 2026

## Summary

Fixed three categories of `make check` failures: a ruff lint import ordering violation in the Graphton Python library, stale bootstrap test assertions that didn't account for the recently-added `mcp-server-creator` skill, and a timestamp precision bug in the signal dedupe store that caused sub-second TTL expiry to silently fail.

## Problem Statement

Running `make check` failed at multiple stages, preventing the CI gate from passing.

### Pain Points

- **Lint failure**: `resource_tools.py` had an unsorted import block (ruff `I001`) that blocked all downstream checks
- **Bootstrap test failures**: 6 assertions in 5 tests expected only 1 skill push call, but the seedpack now contains 3 skills (`agent-creator`, `mcp-server-creator`, `skill-creator`) after a recent addition
- **Signal dedupe TTL bug**: The `SQLiteSignalDedupeStore` used `time.RFC3339` (second-level precision) for timestamp formatting, which silently truncated sub-second TTL values — the cleanup query `expires_at < now` evaluated to false when both timestamps fell within the same second

## Solution

Three targeted fixes, each addressing one failure category:

1. **Lint**: Split a combined `from graphton.core.mcp_manager import (...)` into two separate import statements to satisfy ruff's isort rules
2. **Bootstrap tests**: Updated all 6 skill push count assertions from `1` to `3` across the 5 affected test functions
3. **Signal dedupe store**: Replaced all `time.RFC3339` usage with `time.RFC3339Nano` for formatting, storing, parsing, and comparing timestamps — enabling correct sub-second TTL expiry

## Implementation Details

### Graphton resource_tools.py

Minimal change: split one multi-name import into two single-name imports. No logic change.

### Bootstrap test (bootstrap_test.go)

Updated assertions in:
- `TestBootstrapper_Run_Success`
- `TestBootstrapper_Run_Idempotent`
- `TestBootstrapper_Run_SkipIfSameDigest`
- `TestBootstrapper_Run_DegradedMode_SkillError`
- `TestBootstrapper_Run_DegradedMode_AgentError`
- `TestBootstrapper_Run_DegradedMode_McpServerError`

### Signal dedupe store (signal_dedupe_store.go)

Changed 7 call sites from `time.RFC3339` to `time.RFC3339Nano`:
- `Claim()`: formatting `created_at` and `expires_at` on insert
- `MarkDelivered()`: formatting `delivered_at` on update
- `loadRecord()`: parsing `created_at`, `expires_at`, and `delivered_at`
- `cleanupExpired()`: formatting `now` for the delete comparison

`time.RFC3339Nano` is backward-compatible for parsing — it correctly reads timestamps written with or without fractional seconds.

## Benefits

- `make check` passes cleanly (lint, build, and all tests)
- Signal dedupe TTL now works correctly at any granularity, not just >= 1 second
- Bootstrap tests accurately reflect the current seedpack contents

## Impact

- **CI gate**: Unblocked — `make check` passes end-to-end
- **Signal deduplication**: Correctness fix for TTL-based key expiry in workflow execution deduplication
- **Developer experience**: Tests now match reality, reducing confusion when adding new seedpack resources

## Related Work

- The `mcp-server-creator` skill addition that caused the bootstrap test count mismatch
- Signal dedupe store introduced as part of Gap B2 (Event Dedupe)

---

**Status**: ✅ Production Ready
