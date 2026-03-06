# Comprehensive Cancellation Safety for Workflow Cleanup Operations

**Date**: March 7, 2026

## Summary

Added explicit cancellation handling to all four Temporal workflow implementations (Go AE, Go WE, Java AE, Java WE) so that cleanup operations -- status update, callback notification, and ExecutionContext deletion -- reliably execute even when a workflow is cancelled. Cancelled executions now correctly transition to `EXECUTION_CANCELLED` instead of remaining stuck in `RUNNING`.

## Problem Statement

When a Temporal workflow is cancelled (user cancels execution, namespace timeout), the workflow context is cancelled. All cleanup operations that depend on this context silently fail.

### Pain Points

- **Phantom executions**: Status stays `RUNNING` forever because `updateStatusOnFailure` fails with context cancellation -- creates ghost executions that confuse operators and users
- **Hung parent workflows**: `completeExternalActivity` callback never delivered to parent Zigflow workflow (AE only) -- parent hangs until its own timeout
- **Java EC cleanup broken**: The `finally` block runs in the cancelled root scope, so `deleteExecutionContextActivity` silently fails under cancellation -- secrets not cleaned up
- **No distinct cancellation status**: Cancellation was treated as failure, making it impossible to distinguish "the system broke" from "someone stopped it"

## Solution

Introduced cancellation as a **third distinct code path** alongside the existing success and failure paths. When a workflow context is cancelled, cleanup runs in a disconnected/detached context that is immune to cancellation, and the execution transitions to `EXECUTION_CANCELLED` (proto value 5, already existed in both AE and WE enums -- zero proto changes).

## Implementation Details

### Go OSS (2 files, +125 lines)

**Agent Execution workflow** (`invoke_workflow_impl.go`):
- `Run()`: Detects cancellation via `temporal.IsCanceledError(ctx.Err())` immediately after `executeGraphtonFlow` returns an error, before the existing failure path
- `handleCancellation()`: Creates `workflow.NewDisconnectedContext`, then runs `updateStatusOnCancellation`, `completeExternalActivity` (best-effort), and `deleteExecutionContext`
- `updateStatusOnCancellation()`: Sets `EXECUTION_CANCELLED` phase with system message, best-effort

**Workflow Execution workflow** (`invoke_workflow_impl.go`):
- Same pattern, no callback token (WE has no external activity completion)

### Java Cloud (2 files, +120/-40 lines)

**Agent Execution workflow** (`InvokeAgentExecutionWorkflowImpl.java`):
- `run()`: Added `catch (CanceledFailure cf)` before `catch (Exception e)` with `!pauseRequested` guard to distinguish external cancellation from pause-triggered cancellation
- `executeGraphtonFlow()`: Added `catch (CanceledFailure cf) { throw cf; }` to prevent `wrapActivityError` from wrapping cancellation in a generic `RuntimeException`
- `handleCancellation()`: Uses `Workflow.newDetachedCancellationScope()` to update status and fail external activity
- `finally` block: Wrapped EC cleanup in `Workflow.newDetachedCancellationScope()` so it survives cancellation

**Workflow Execution workflow** (`InvokeWorkflowExecutionWorkflowImpl.java`):
- Same pattern, no callback token

### Three Exit Paths (after T05)

| Path | Status update | External callback | EC cleanup | Context |
|------|-------------|-------------------|------------|---------|
| **Success** | Set by runner | Must-succeed | Best-effort | Normal |
| **Failure** | `EXECUTION_FAILED` | Best-effort | Best-effort | Normal |
| **Cancellation** | `EXECUTION_CANCELLED` | Best-effort | Best-effort | Disconnected/Detached |

### Key Design Decision

Cancellation detection uses `temporal.IsCanceledError(ctx.Err())` in Go (consistent with the existing pattern in `workflow-runner`) and `catch (CanceledFailure cf)` in Java. The `!pauseRequested` guard in Java ensures pause-triggered `CanceledFailure` (from `CancellationScope.cancel()`) is not mistaken for external workflow cancellation.

## Benefits

- Cancelled executions now show correct `EXECUTION_CANCELLED` status instead of staying stuck in `RUNNING`
- Parent Zigflow workflows receive cancellation notification instead of hanging until timeout
- ExecutionContext (containing secrets) is reliably cleaned up on all exit paths, including cancellation
- Operators can distinguish cancellations from failures in dashboards and alerts (different SLIs)
- Java `finally` block EC cleanup now works under cancellation (was silently failing before)

## Impact

- **4 workflow files** modified across 2 repositories (Go OSS + Java Cloud)
- **Zero proto changes** -- `EXECUTION_CANCELLED` already existed in both enums
- **Zero breaking changes** -- success and failure paths completely untouched
- **Replay safe** -- new cancellation check only fires when `ctx.Err()` reports cancellation (a new event for in-flight workflows)

## Related Work

- [Execution Context Lifecycle - Downstream Clients](2026-03-07-015611-execution-context-lifecycle-downstream-clients.md) (T01)
- [Execution Context Pipeline Step](2026-03-07-021631-execution-context-pipeline-step.md) (T02)
- [Slim Workflow Input & Runtime Env Stripping](2026-03-07-025122-slim-workflow-input-runtime-env-stripping.md) (T03)
- [Execution Context Cleanup Activity](2026-03-07-031948-execution-context-cleanup-activity.md) (T04)

---

**Status**: Production Ready
**Timeline**: T05 of the ExecutionContext Lifecycle project (T01-T05 now complete)
