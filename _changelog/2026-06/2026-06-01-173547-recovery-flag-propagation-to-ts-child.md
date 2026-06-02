# Recovery Flag Propagation to TS Child Workflow (T03)

**Date**: June 1, 2026

## Summary

Wired the `recovery_mode` flag from the recover pipeline in both Go (OSS) and Java (Cloud) through the Temporal orchestrator to the TS child workflow. This activates the task-level resume engine implemented in T01 and T02 — previously dead code because neither orchestrator set the flag.

## Problem Statement

When a user clicked "Recover" on a failed workflow execution, the Go/Java recover handlers terminated the old Temporal workflow and started a fresh one. But the fresh workflow received no signal that it was a recovery — the `recovery_mode` field existed on the TS receiver but was never set by either orchestrator.

### Pain Points

- Recovery always re-executed all tasks from scratch, wasting completed work
- The T01 (event sequence continuation) and T02 (task-level resume) engine work was complete but inactive
- Users waiting on long workflows had to watch tasks 1-N re-execute even though only task N+1 had failed

## Solution

Added `recovery_mode` as a boolean field to the slim Temporal workflow input type (`InvokeWorkflowExecutionWorkflowInput`) in both Go and Java. The recover pipeline sets it to `true`; all other paths (create, signal, approval) default to `false`. The orchestrator passes the input unchanged to the TS child — no orchestrator logic changes needed.

## Implementation Details

### Go (OSS)

- Added `RecoveryMode bool` with `json:"recovery_mode,omitempty"` to `InvokeWorkflowExecutionWorkflowInput` — follows the established pattern of `AutoApproveAll bool` on the agent execution input
- Set `RecoveryMode: true` in `StartFreshWorkflowStep.Execute()` (recover pipeline only)
- Updated `recover.go` doc comment to describe task-level resume semantics
- Added `TestChildWorkflow_RecoveryModeAccepted` unit test

### Java (Cloud)

- Added `boolean recoveryMode` as the 8th field on the `InvokeWorkflowExecutionWorkflowInput` record
- Added overloaded `fromExecution()` factory: 3-arg (defaults `false`) delegates to 4-arg (accepts explicit flag) — matches the existing `InvokeAgentExecutionWorkflowInput` pattern
- Called 4-arg factory with `true` in `StartNewWorkflowStep` (recover handler)
- Updated handler Javadoc to describe task-level resume semantics
- Fixed pre-existing constructor arity mismatch in `InvokeWorkflowExecutionWorkflowImplTest` (was 6 args for a 7-field record)
- Added `StartNewWorkflowStepTests`, `WorkflowInputTests` (factory overload + Jackson serialization round-trip)

### Wire Compatibility

- Go `omitempty`: field omitted when `false`, present when `true`
- Java `boolean` primitive: always serialized (consistent with `int executionTarget` on same record)
- TS receiver: `input.recovery_mode ?? false` handles all cases
- No Temporal version gates needed — field addition with zero-value default is backward-compatible

## Benefits

- Recovery now skips completed tasks and resumes from the failure point
- Completed work is preserved (outputs restored from `status.tasks[]`)
- Users see `task_skipped` events for completed tasks, then live execution from the failure point
- No behavioral change to normal (non-recovery) execution paths

## Impact

- **End users**: Workflow recovery is dramatically faster — only the failed task and subsequent tasks re-execute
- **Platform reliability**: Reduces wasted compute on recovery (completed tasks are not re-run)
- **Codebase**: Activates 23 unit tests and recovery engine code from T02 that were previously dead paths

## Related Work

- T01: Event sequence continuation from high-water mark (`dd1a4e8cb`)
- T02: Task-level resume in TS engine (`97a6d1911`)
- T03: This change — recovery flag propagation (Go `42bce319f`, Java `39377761`)
- T04-T09: Remaining recovery project tasks (error classification, React reset, cleanup, integration tests)

---

**Status**: Production Ready
**Timeline**: 1 session (~45 minutes)
