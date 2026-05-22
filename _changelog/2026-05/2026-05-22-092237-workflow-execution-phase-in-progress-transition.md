# Workflow Execution Phase Transitions to IN_PROGRESS on Start

**Date**: May 22, 2026

## Summary

Fixed a gap where workflow executions stayed in `EXECUTION_PENDING` (or skipped straight to `EXECUTION_COMPLETED`) because the TS runner emitted `execution_started` events without setting `status.phase`. The runner now sets `EXECUTION_IN_PROGRESS` and `startedAt` on the first `updateStatus` call, unblocking seven lifecycle integration tests.

## Problem Statement

Lifecycle integration tests (cancel, terminate, pause, recover) poll for `EXECUTION_IN_PROGRESS` before sending control signals. Executions never left `PENDING` during the run window, causing 30s timeouts or early failure when the orchestrator jumped to `COMPLETED`.

### Pain Points

- Seven tests timed out waiting for `EXECUTION_IN_PROGRESS` after 30s
- Some fast workflows reached `EXECUTION_COMPLETED` before tests could observe `IN_PROGRESS`
- Cancel/terminate handlers require `PENDING` or `IN_PROGRESS`; tests could not exercise the in-progress path reliably
- Proto and Java comments documented `execution_started` as the PENDING→IN_PROGRESS transition, but no code performed it

## Solution

Set `status.phase` and `status.startedAt` in the existing `emitWorkflowEvents` gRPC payload when the event batch includes `execution_started`. No Java or orchestrator changes required — `BuildNewStateWithStatusStep` already merges phase when explicitly provided.

## Implementation Details

**File**: `backend/services/runner/src/activities/workflow-event-activities.ts`

- Import `ExecutionPhase` from workflow execution enum protos
- Detect `execution_started` in the outgoing event batch
- Spread `phase: EXECUTION_IN_PROGRESS` and `startedAt` into `WorkflowExecutionStatus` on that `updateStatus` call only

Terminal phases (`COMPLETED`, `FAILED`, `CANCELLED`) remain owned by the Java Temporal orchestrator via `handleCompletion` / `handleFailure` / `handleCancellation`, matching the existing split of responsibilities.

## Benefits

- Correct lifecycle visibility for UI, API consumers, and integration tests
- Semantically accurate transition: IN_PROGRESS when the runner actually starts executing
- No Temporal workflow versioning or orchestrator history changes
- Single-file, minimal diff with clear ownership

## Impact

- **Runner**: First status update after workflow start now includes phase
- **Java service**: No code changes; merge behavior unchanged
- **Tests**: All seven affected lifecycle tests pass (sub-second to ~12s vs 30s+ timeouts)

| Test | Before | After |
|------|--------|-------|
| `TestWorkflowExecution_Cancel` | 30s timeout | PASS ~1.1s |
| `TestWorkflowExecution_CancelIdempotent` | timeout | PASS ~0.5s |
| `TestWorkflowExecution_Terminate` | timeout | PASS ~1.1s |
| `TestWorkflowExecution_TerminateIdempotent` | timeout | PASS ~0.5s |
| `TestWorkflowExecution_Pause` | COMPLETED skip / timeout | PASS ~0.5s |
| `TestWorkflowExecution_PauseAndResume` | COMPLETED skip / timeout | PASS ~12s |
| `TestWorkflowExecution_RecoverOnCancelledFails` | 30s timeout | PASS ~1.1s |

## Related Work

- Session 4 triage: `_changelog/2026-05/2026-05-22-025000-integration-test-suite-session4-failure-report.md` (RC3)
- Session 5: `_changelog/2026-05/2026-05-22-032331-integration-test-suite-session5-fixes.md` (replaced `time.Sleep` with `WaitForPhase` polling)
- Investigation notes: `_cursor/fix-lifecycle-phase-transition.md`

---

**Status**: ✅ Production Ready  
**Timeline**: Single focused fix; verified via integration test subset
