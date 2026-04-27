# Fix Temporal Workflow Replay Loop Caused by Local Activity on Failure Path

**Date**: April 27, 2026

## Summary

Replaced local activity calls with regular activities on the failure and cancellation paths of `InvokeAgentExecutionWorkflow` to avoid a Temporal SDK state machine replay bug. The bug caused orphaned workflows whose runners were destroyed to enter an infinite workflow-task retry loop, generating continuous error noise in production logs even though the executions were correctly marked FAILED in the database.

## Problem Statement

Two old agent execution workflows (`aex_01kq4yjebjf8fvmjhgbzf7aqs0` at Attempt 109, `aex_01kq4ybk41b49ahg0ef9skg30e` at Attempt 110) were stuck in an infinite error loop in production, emitting repeated stack traces every few seconds. New executions completed successfully and the UI rendered responses correctly, but the error noise from the stuck workflows was significant.

### Pain Points

- Continuous `java.lang.RuntimeException: LocalActivity: failure executing MARKER_COMMAND_CREATED->RECORD_MARKER` errors in pod logs
- Workflow task retry count climbing indefinitely (109, 110, ...) with no way for the workflow to reach a terminal state
- Spurious error volume obscuring real issues in log aggregation

## Root Cause

The error chain was:

1. **Ephemeral runner destroyed** -- no worker polling the `runner:{id}` task queue
2. **`EnsureThread` activity `ScheduleToStart` timeout** -- `startedEventId=0` confirms no worker ever picked up the task
3. **Workflow catches `ActivityFailure`** and calls **local activity** `UpdateExecutionStatus` to mark the execution FAILED
4. **Local activity succeeds** -- execution IS marked FAILED in the database
5. **Temporal SDK replay** tries to complete the workflow task but the `LocalActivityStateMachine` (Java SDK v1.31.0) hits an invalid state transition: `MARKER_COMMAND_CREATED→RECORD_MARKER` is not in the allowed transitions when a local activity completes in the same workflow task as a remote activity failure
6. **Workflow task fails, Temporal retries** -- infinite loop

The root issue: local activities produce `RECORD_MARKER` commands during replay that conflict with the SDK's internal state machine when the preceding remote activity failed with a timeout.

## Solution

Replace `workflow.ExecuteLocalActivity` with `workflow.ExecuteActivity` (regular activity, no explicit `TaskQueue` -- defaults to the workflow's own stigmer queue) on the two replay-sensitive paths:

- **`updateStatusOnFailure`** -- called from the catch block when `executeGraphtonFlow` returns an error
- **`updateStatusOnCancellation`** -- called from `handleCancellation` when the workflow is cancelled externally

Regular activities produce standard `ActivityTaskScheduled`/`ActivityTaskCompleted` history events instead of local-activity marker commands, sidestepping the replay state machine issue entirely.

Normal-flow local activity calls (HITL approval loop persistence, `loadExecution`, `persistFinalStatus` defense-in-depth) are left unchanged -- they execute after successful remote activities and do not trigger the bug.

## Implementation Details

### Go (stigmer OSS)

**`invoke_workflow_impl.go`**: `updateStatusOnFailure` and `updateStatusOnCancellation` changed from `workflow.ExecuteLocalActivity` to `workflow.ExecuteActivity` with `workflow.ActivityOptions` (30s `StartToCloseTimeout`, 3 retries).

**`worker_config.go`**: `UpdateExecutionStatus` registered with `RegisterActivityWithOptions` and explicit `Name` (matching `UpdateExecutionStatusActivityName`) so the activity name resolves correctly for both `ExecuteActivity` and `ExecuteLocalActivity` dispatch. Follows the existing pattern used by `CompleteExternalActivity`.

### Java (stigmer-cloud)

**`InvokeAgentExecutionWorkflowImpl.java`**: Split the single `updateStatusActivity` local stub into two:
- `updateStatusLocalActivity` (`Workflow.newLocalActivityStub`) -- used by HITL loop and `loadExecution`
- `updateStatusActivity` (`Workflow.newActivityStub`, no `TaskQueue`) -- used by failure catch block and cancellation handler

**`AgentExecutionTemporalWorkerConfig.java`**: Comments updated; `registerActivitiesImplementations` already makes the activity available for both regular and local dispatch.

## Design Decision: Why Not Couple Runner Destroy to Workflow Terminate

The initial investigation considered terminating in-flight workflows when a runner is destroyed. This was rejected because:

- Workflows support **durable execution** and **HITL** (human-in-the-loop) approval flows that can legitimately block for hours or days
- Workflow orchestration (signals, timers, `Await`) runs on the **stigmer workflow queue**, not the per-runner activity queue -- destroying a runner does not affect the workflow's ability to process signals
- Activity-level timeouts (`ScheduleToStart`, heartbeat, `StartToClose`) already define what happens when no worker is available on the runner queue
- The correct fix is making the **failure path replay-safe**, not adding lifecycle coupling that would need to guess intent

## Benefits

- Eliminates the infinite workflow-task retry loop for workflows whose runner is gone
- Workflows that encounter `ScheduleToStart` timeouts now cleanly reach a terminal FAILED state
- No behavioral change for the happy path, HITL loop, or pause/resume -- only the failure/cancellation paths are affected
- Both Go and Java implementations stay aligned

## Impact

- **Production stability**: Stops the continuous error log spam from stuck workflows
- **Workflow lifecycle**: Failure and cancellation paths now produce replay-safe Temporal history
- **No breaking changes**: The activity interface, registration, and normal-flow behavior are unchanged

## Verification

- Go: `go build`, `go vet`, `gofmt`, and all 5 existing workflow tests pass
- Java: Bazel build (`//backend/services/stigmer-service/...`) passes cleanly

## Related Work

- `2026-04-26-182920-remove-waitforrunnerready-temporal-native-fix.md` -- previous `WaitForRunnerReady` changes for ephemeral runner readiness
- Temporal SDK v1.31.0 `LocalActivityStateMachine` -- upstream state machine edge case

---

**Status**: Production Ready
**Timeline**: Investigation + fix completed in single session
