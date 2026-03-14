# Fix Usage Tracking on Non-Happy Paths and Read Tool Output Filtering

**Date**: March 14, 2026

## Summary

Fixed two critical bugs in the agent execution runtime discovered through production observation: usage metrics were not persisted for interrupted/cancelled/failed executions (showing zero tokens and zero cost), and read tool output was not being filtered from the persisted execution state due to a tool name mismatch, inflating state size to 22,000+ lines.

## Problem Statement

After completing the 9-phase usage-metrics-and-cost-optimization project, a production run of `stigmer draft skill` against a large monorepo revealed that the optimizations were partially ineffective due to two bugs.

### Pain Points

- Interrupting an agent execution mid-run produced a usage report showing 0 tokens, 0 cost — making it impossible to understand spend on cancelled runs
- The execution state file (`data.yaml`) was 22,142 lines because all 86 read tool calls stored full file contents, despite the filtering mechanism supposedly preventing this
- Users could not trust usage reports for any execution that didn't complete normally

## Solution

Two surgical fixes in the agent-runner Python codebase, both addressing gaps between intended behavior and actual behavior.

## Implementation Details

### Bug 1: Usage Metrics Not Finalized on Non-Happy Paths

The `finalize_usage()` method — which stamps accumulated token/cost data from the `UsageTracker` onto the `AgentExecutionStatus` proto — was only called on the normal completion path in `execute_graphton.py`. Four other exit paths skipped it:

- **Pause/Cancel**: User interrupts the execution
- **Stall timeout**: Agent produces no output for the configured timeout period
- **Recursion limit**: Agent exhausts its tool-call budget
- **Exception**: Unhandled error during execution

Added the same idempotent two-line pattern to all four paths, placed immediately before the `update_status()` gRPC call:

```python
if not status_builder.current_status.completed_at:
    status_builder.current_status.completed_at = _utc_timestamp()
status_builder.finalize_usage()
```

**File**: `backend/services/agent-runner/worker/activities/execute_graphton.py` (+21 lines)

### Bug 2: Read Tool Filter Name Mismatch

The `_READ_ONLY_TOOLS` set in `status_builder.py` contained `{"read_file"}`, but the canonical tool name set at `tool_wrappers.py:966` is `"read"`. The filter condition `if tool_name in _READ_ONLY_TOOLS` never matched for the canonical name, so all read tool results were persisted verbatim.

Fixed by adding `"read"` to the set alongside the existing `"read_file"` alias:

```python
_READ_ONLY_TOOLS: set[str] = {"read", "read_file"}
```

**File**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (+1/-1 line)

### Tests

Added 6 new tests in `test_status_builder.py`:

- `TestReadOnlyToolFiltering` (3 tests): canonical `read` tool result replaced with placeholder, `read_file` alias also filtered, non-read tool (`grep`) result preserved verbatim
- `TestFinalizeUsage` (3 tests): usage stamps tokens/cost/duration correctly, graceful degradation without `completed_at`, idempotency of repeated calls

## Benefits

- Usage data is now captured for every execution regardless of how it terminates — cancelled, stalled, crashed, or completed
- Execution state size reduced dramatically for read-heavy runs (22,000+ lines → proportional to actual non-read tool calls)
- `stigmer usage session` reports now show accurate cost data even for interrupted executions

## Impact

- **End users**: Accurate cost visibility for all execution outcomes, not just successful completions
- **State storage**: Reduced storage and transfer costs for execution state (gRPC updates, Temporal payloads)
- **Debugging**: Execution state remains useful for debugging without being overwhelmed by file contents

## Related Work

- Part of the [usage-metrics-and-cost-optimization](../_projects/2026-03/20260313.01.usage-metrics-cost-optimization/) project (post-release fixes)
- Phase 3 originally introduced read tool filtering (`_READ_ONLY_TOOLS`), but the name mismatch was introduced during the tool aliasing refactor
- Phase 2.4 introduced `finalize_usage()`, but only wired it to the happy path

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (bug investigation + fix + tests)
