# Fix Expression Interpolation Test Isolation Bug

**Date**: May 24, 2026

## Summary

Fixed a test isolation bug in `TestWorkflowExpressionInterpolation_EmbeddedEnvInAgentMessage` where the child execution discovery helper returned a stale execution from a prior test instead of the test's own child. The expression interpolation engine was working correctly all along -- the test was asserting against the wrong execution.

## Problem Statement

The integration test for embedded `${ $env.VAR }` expression interpolation in `agent_call` messages was consistently failing with a completely unrelated message: `"Explain how PostgreSQL B-tree indexes handle range queries"` instead of the expected interpolated output `"Value is hello-world and optional is  — end"`.

### Pain Points

- The test failure masked the fact that the interpolation engine works correctly, creating a misleading signal
- The `findChildAgentExecutionByPrefix` helper listed ALL agent executions org-wide with no workflow-scoped filtering
- The prefix `"expr-interp"` could never match child execution slugs (which follow `aex-wf-{wexId}-{taskName}-{shortId}` naming)
- The fallback path returned the first execution with any `parent_workflow_id`, picking up stale children from prior tests
- A fixed `time.Sleep(20s)` was used instead of the standard polling pattern, making the test both slow and fragile

## Solution

Replaced the broken `findChildAgentExecutionByPrefix` helper with `findChildAgentExecutionForWorkflow`, which:

1. Filters by exact `parent_workflow_id == "workflow-exec-{executionID}"`, scoping the query to the specific workflow execution
2. Polls every 3 seconds with a configurable timeout instead of a fixed 20-second sleep
3. Respects context cancellation for clean test teardown

## Implementation Details

**File changed**: `test/integration/workflow_expression_interpolation_test.go`

- Removed the `findChildAgentExecutionByPrefix` function (unscoped org-wide list with unreliable prefix matching and dangerous fallback)
- Added `findChildAgentExecutionForWorkflow` that matches child executions by their Temporal child workflow ID (`workflow-exec-{wexId}`), following the correct pattern from `agent_call_affinity_test.go`
- Replaced `time.Sleep(20 * time.Second)` with deadline-based polling
- Updated `require.NotNil` assertion to include the workflow execution ID for better diagnostics
- Swapped `strings` import for `fmt` (prefix matching replaced by `fmt.Sprintf` for parent ID construction)

## Benefits

- Test now passes reliably in ~4 seconds (down from 20+ seconds with the sleep, previously failing)
- Eliminates false negative from stale cross-test execution leakage
- Follows the established polling pattern used by `AgentExecutionWaiter` and `ExecutionWaiter` in the harness
- Matches the correct scoped discovery pattern from `agent_call_affinity_test.go`

## Impact

- **Integration test suite**: 1 fewer spurious failure in the main integration suite
- **Developer confidence**: Interpolation engine is confirmed working; the test now verifies what it claims to verify
- **Pattern**: Same broken discovery pattern exists in `workflow_agent_call_env_forwarding_test.go` (Category 3) and `session_subject_generation_test.go` (Category 2) -- those are separate fixes but can follow the identical approach

## Related Work

- Category 1 fix: FGA model missing `artifact` type (2026-05-24-232019)
- Category 2: `agent_call` pipeline failures (separate investigation)
- Category 3: Test isolation in env-forwarding tests (same root cause pattern)

---

**Status**: Production Ready
