# Fix Cursor Dispatch Test Gap and ScheduleToStart Timeout Parity

**Date**: May 24, 2026

## Summary

Discovered and closed a critical test coverage gap: the `workflow -> agent_call -> harness: cursor -> ExecuteCursor` dispatch path was **never tested in CI** due to a dead prerequisite check referencing a legacy `CursorRunner` stub. Added offline dispatch verification tests for both global routing (LOCAL/CLI) and execution routing (desktop/sandbox) scenarios, and aligned Go `ScheduleToStartTimeout` values with the Java cloud service (1 min -> 5 min).

## Problem Statement

A workflow-triggered `ExecuteCursor` activity timed out at `ScheduleToStart` in cloud production. Investigation revealed:

### Pain Points

- The only test file for this path (`workflow_cursor_call_test.go`) always skipped because it checked `testHarness.CursorRunner`, a `*CursorRunnerProcess` stub from the pre-unification era that was never populated
- The unified runner (which replaced the separate cursor-runner in May 2025) registers `ExecuteCursor` and is started in every test suite, but the dead skip gate prevented any test from exercising the cursor dispatch path through workflows
- The `wfexec-routing` suite tested `agent_call` sandbox affinity only for native harness, leaving the cursor variant uncovered
- Go OSS `ScheduleToStartTimeout` was 1 minute for all runner activities, while Java cloud used 5 minutes — a parity violation that could cause premature timeouts in sandbox boot scenarios

## Solution

Test-driven diagnosis: write integration tests that reproduce the exact code path, run them, observe results, then fix based on evidence rather than speculation.

## Implementation Details

### Tests Added

1. **`TestWorkflowCursorCall_DispatchOffline`** (`test/integration/workflow_cursor_call_test.go`): Verifies the full workflow -> agent_call -> cursor -> ExecuteCursor path under global routing. No Cursor API key needed — asserts `EXECUTION_FAILED` (not timeout), proving the runner picked up the activity.

2. **`TestAgentCallAffinity_CursorRoutesToParentQueue`** (`test/integration-wfexec-routing/agent_call_affinity_test.go`): Reproduces the exact production scenario under execution routing (`STIGMER_ACTIVITY_ROUTING=session`, `STIGMER_WORKFLOW_ACTIVITY_ROUTING=execution`). Verifies both queue affinity (child routes to parent `wfexec:{id}` queue) and runner pickup (reaches terminal state).

### Test Infrastructure Fixes

- Removed dead `CursorRunner` skip gate from `requireCursorCallPrereqs` — replaced with `requireCursorCallOfflinePrereqs` (unified runner only) and `requireCursorCallProviderPrereqs` (unified runner + `CURSOR_API_KEY`)
- Parameterized `createAffinityTestAgent` to accept a name, avoiding test isolation collisions when native and cursor variants run in the same suite
- Fixed child execution lookup to filter by `parent_workflow_id` matching the current workflow execution

### Timeout Parity (Go/Java)

Aligned `ScheduleToStartTimeout` for all runner activity stubs in Go:
- `execute_cursor.go`: 1 min -> 5 min
- `execute_deep_agent.go`: 1 min -> 5 min
- `ensure_thread.go`: 1 min -> 5 min

Java cloud was already at 5 minutes — the fix brings Go in line.

## Benefits

- The cursor dispatch path through workflows is now tested in CI for both routing modes
- Future regressions in this path will be caught immediately
- Go/Java timeout parity eliminates a class of inconsistency bugs
- Tests run offline (no API keys) — they verify dispatch and pickup, not Cursor SDK functionality

## Impact

- **Integration test suite**: 2 new tests added, 0 existing tests broken
- **Go server**: `ScheduleToStartTimeout` increased for 3 activity stubs (behavioral change for in-flight workflows — Temporal handles version transitions gracefully)
- **Production diagnosis**: Tests confirmed the dispatch/routing code is correct in both LOCAL and wfexec scenarios. The production timeout is a Daytona sandbox infrastructure issue (runner process not surviving), not a code bug

## Related Work

- Unified runner migration (May 2025) consolidated cursor-runner into the unified TS runner
- `agent_call_affinity_test.go` regression test for the StripActivityTaskQueueStep sandbox affinity bug
- Session-routing `dispatch_offline_test.go` pattern for offline cursor dispatch verification

---

**Status**: Production Ready
**Timeline**: ~1 hour
