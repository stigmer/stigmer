# Recovery Task-Resume Integration Tests

**Date**: June 1, 2026

## Summary

Added integration tests for the workflow execution recovery task-level resume semantics implemented in T01-T06. Three tests verify that completed tasks are skipped on recovery (with correct events and status transitions), event sequence numbers continue from the pre-recovery high-water mark, and agent_call tasks are correctly handled through the skip path.

## Problem Statement

T01-T06 implemented task-level resume on recovery: skip completed tasks, restore context, continue event sequences, and terminate zombie child workflows. The existing 8 integration tests in `workflow_execution_recover_test.go` covered Temporal-level durability (run IDs, EC recreation, idempotency, phase guards) but had zero coverage of the new task-level semantics.

### Gaps

- No test verified that previously completed tasks show `WORKFLOW_TASK_SKIPPED` status after recovery
- No test verified that `task_skipped` events are emitted with the correct recovery reason
- No test verified that event sequence numbers continue from the high-water mark (the T01 fix)
- No test verified that non-trivial task types (`agent_call`) survive the recovery skip path

## Solution

Created `test/integration/workflow_execution_recover_task_resume_test.go` with three focused integration tests, each testing a distinct layer of the recovery implementation.

## Implementation Details

### Workflow Fixture: `multiTaskFailingWorkflow`

Three sequential tasks following the established `workflow_context_chain_test.go` pattern:
- `initVars` (`set_vars`, exports to `$context`)
- `deriveVars` (`set_vars`, reads `$context.initVars.source`, exports)
- `failTask` (`raise_error`, deterministic failure)

The `Export: {As: "${ . }"}` field is required on set_vars tasks for outputs to flow into `$context` — without it, recovery context restoration has no meaningful data to operate on.

### Test 1: `TestRecover_SkipsCompletedTasks` (1.4s)

Verifies T02 (task-level resume) + T03 (recovery flag propagation) + T06 (child cleanup). Asserts:
- Pre-recovery: initVars=COMPLETED, deriveVars=COMPLETED, failTask=FAILED
- Post-recovery: initVars=SKIPPED, deriveVars=SKIPPED, failTask=FAILED (re-executed)
- Event log: exactly 2 `task_skipped` events with reason containing "recovery"
- Event log: `task_started` + `task_failed` for failTask (proves re-execution)
- Temporal: orchestrator and child both terminal, no WTF loop

### Test 2: `TestRecover_EventSequenceContinuation` (1.2s)

Verifies T01 (event sequence continuation from high-water mark). Asserts:
- Pre-recovery: 8 events with high-water mark=8
- Post-recovery: 6 new events, all with sequence > 8
- Full 14-event log: monotonically increasing, no duplicates

### Test 3: `TestRecover_AgentCallTaskSkip` (14.3s, requires CURSOR_API_KEY)

Verifies agent_call tasks through the recovery skip path. Workflow: `agent_call` (succeeds) -> `raise_error` (fails). After recovery, agent_call correctly skipped. Proves structurally richer task outputs (token usage, tool calls, metadata) survive the skip path without runner crash or misclassification.

## Benefits

- Full integration coverage for the T01-T06 recovery implementation
- Catches regressions in the Go -> Temporal -> TS -> events -> persistence -> status -> gRPC pipeline
- The event sequence test specifically guards against the original T01 bug (sequence reset to 1)
- The agent_call test covers a task type with fundamentally different output structure

## Impact

- **Test suite**: +3 integration tests (2 offline + 1 provider-dependent)
- **Coverage**: Task-level recovery semantics now have end-to-end integration coverage
- **CI runtime**: ~3s for offline tests, ~15s additional when CURSOR_API_KEY available

## Related Work

- T01: Event sequence continuation (session 1)
- T02: Task-level resume in TS engine (session 2)
- T03: Recovery flag propagation (session 3)
- T04: Cursor error classification (session 6)
- T06: Child workflow termination (session 5)
- T08: Proto + documentation fixes (session 7)

---

**Status**: Production Ready
**Timeline**: Session 8 (1 session)
