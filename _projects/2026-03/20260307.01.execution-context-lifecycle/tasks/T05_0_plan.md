# Task T05: Comprehensive Cancellation Safety for Cleanup Operations

**Created**: 2026-03-07
**Status**: READY (follow-up from T04)
**Type**: Architectural Refactor / Reliability

## Background

T04 introduced `workflow.NewDisconnectedContext` for the new `DeleteExecutionContext` cleanup call, ensuring ExecutionContext cleanup survives workflow cancellation. However, the existing cleanup operations (`updateStatusOnFailure`, `completeExternalActivity`) do **not** use `NewDisconnectedContext` and will silently fail if the workflow is cancelled.

This task was intentionally separated from T04 because the existing cleanup operations have **mixed failure semantics** that make a naive `defer` + `NewDisconnectedContext` restructuring dangerous.

## Problem Statement

### Current State (after T04)

In both AE and WE workflows, the `Run()` method has explicit success and failure paths:

**Failure path (AE):**
1. `updateStatusOnFailure(ctx, ...)` -- best-effort, logs on error
2. `completeExternalActivity(ctx, token, nil, err)` -- best-effort, logs on error
3. `deleteExecutionContext(ctx, ...)` -- cancellation-safe via `NewDisconnectedContext`

**Success path (AE):**
1. `loadExecution(ctx, ...)` -- must-succeed (error returned to workflow)
2. `completeExternalActivity(ctx, token, execution, nil)` -- **must-succeed** (error returned to workflow, triggering Temporal retry)
3. `deleteExecutionContext(ctx, ...)` -- cancellation-safe via `NewDisconnectedContext`

### The Problem

If a workflow is cancelled (e.g., user cancels the execution, Temporal namespace timeout):
- `updateStatusOnFailure` will fail with context cancellation -- the execution stays in `RUNNING` state forever (phantom execution)
- `completeExternalActivity` will fail -- the parent Zigflow workflow never receives a completion signal (stuck parent)
- `deleteExecutionContext` will succeed (already cancellation-safe from T04)

### Why This Wasn't Solved in T04

The critical challenge is `completeExternalActivity`'s **dual failure semantics**:

| Path | `completeExternalActivity` behavior | Correct behavior on failure |
|------|--------------------------------------|----------------------------|
| **Success** | Reports success result to parent | **Return error** (trigger Temporal retry to ensure parent gets notified) |
| **Failure** | Reports error to parent | **Log and continue** (best-effort notification) |

A simple `defer` block with `NewDisconnectedContext` cannot distinguish these two paths. If we wrap `completeExternalActivity` in a `defer` that treats it as best-effort:
- **Regression on success path**: If the activity fails on success, the workflow would return `nil` (success) without notifying the parent. The parent Zigflow workflow would hang forever waiting for a callback that never arrives. Today, the error is returned and Temporal retries the workflow, eventually completing the callback.

This is why a blanket `NewDisconnectedContext` + `defer` approach is architecturally dangerous here.

## Design Questions to Resolve

Before implementation, these architectural questions need answers:

### 1. Should `completeExternalActivity` always be best-effort?

**Current behavior**: Must-succeed on success path, best-effort on failure path.

**Alternative**: Make it always best-effort. Rationale: if the external activity completion fails, the parent Zigflow execution will eventually time out. The question is whether silent timeout is acceptable vs. explicit retry.

**Consideration**: If we make it best-effort, we lose the Temporal retry mechanism that eventually delivers the callback. The parent would need its own timeout + retry logic.

### 2. Should workflow cancellation be a distinct code path?

Instead of retrofitting cancellation safety onto the existing success/failure paths, we could detect cancellation explicitly:

```go
func (w *InvokeAgentExecutionWorkflowImpl) Run(ctx workflow.Context, input *Input) error {
    // ... existing logic ...
    
    // After the main flow, check if we were cancelled
    if ctx.Err() != nil {
        return w.handleCancellation(ctx, executionID, callbackToken)
    }
    
    // ... normal success/failure paths ...
}
```

This would allow cancellation-specific cleanup logic (e.g., set status to `CANCELLED` instead of `FAILED`, always best-effort callback).

### 3. Should we use Temporal's built-in cancellation scope pattern?

Temporal Go SDK supports `workflow.NewDisconnectedContext` at the workflow level for comprehensive cleanup. The recommended pattern from Temporal docs is:

```go
func MyWorkflow(ctx workflow.Context) error {
    defer func() {
        if !errors.Is(ctx.Err(), workflow.ErrCanceled) {
            return
        }
        // Cleanup code that runs on cancellation
        disconnectedCtx, cancel := workflow.NewDisconnectedContext(ctx)
        defer cancel()
        // Run cleanup activities...
    }()
    
    // Normal workflow logic...
}
```

This is more idiomatic but still doesn't solve the mixed failure semantics of `completeExternalActivity`.

### 4. What status should a cancelled execution have?

Currently, there is no `CANCELLED` phase in the execution status proto. Options:
- Add `EXECUTION_CANCELLED` phase to the proto enum
- Reuse `EXECUTION_FAILED` with a cancellation-specific error message
- Leave status as `RUNNING` (current behavior on cancellation -- a bug)

## Affected Files

### OSS Go (stigmer/stigmer)
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`
  - `Run()` method restructuring
  - `updateStatusOnFailure()` -- may need `NewDisconnectedContext`
  - `completeExternalActivity()` -- needs careful analysis per path
- `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows/invoke_workflow_impl.go`
  - `Run()` method restructuring
  - `updateStatusOnFailure()` -- may need `NewDisconnectedContext`

### Cloud Java (stigmer/stigmer-cloud)
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java`
  - `finally` block already handles cleanup, but Java equivalent of `NewDisconnectedContext` may be needed
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/workflow/InvokeWorkflowExecutionWorkflowImpl.java`
  - Same analysis needed

## Implementation Guidance

### Recommended Approach

Based on the T04 analysis, the recommended approach is a **cancellation-aware restructuring** that:

1. Detects cancellation explicitly in `Run()` using `ctx.Err()`
2. Routes to a dedicated `handleCancellation()` method
3. Uses `NewDisconnectedContext` for all operations in the cancellation path
4. Keeps the existing success/failure paths unchanged (preserving `completeExternalActivity`'s must-succeed semantics on the success path)

This avoids the dual-semantics problem by treating cancellation as a third, distinct path.

### Rough Implementation Shape (AE workflow)

```go
func (w *InvokeAgentExecutionWorkflowImpl) Run(ctx workflow.Context, input *Input) error {
    // ... setup ...

    if err := w.executeGraphtonFlow(ctx, input); err != nil {
        // Check if the error was due to cancellation
        if errors.Is(ctx.Err(), workflow.ErrCanceled) {
            w.handleCancellation(ctx, executionID, callbackToken)
            return temporal.NewApplicationError("Workflow cancelled", "", err)
        }

        // Normal failure path (unchanged)
        w.updateStatusOnFailure(ctx, executionID, err)
        if len(callbackToken) > 0 {
            w.completeExternalActivity(ctx, callbackToken, nil, err)
        }
        w.deleteExecutionContext(ctx, executionID)
        return temporal.NewApplicationError("Workflow execution failed", "", err)
    }

    // Normal success path (unchanged)
    // ...
}

func (w *InvokeAgentExecutionWorkflowImpl) handleCancellation(
    ctx workflow.Context, executionID string, callbackToken []byte,
) {
    cleanupCtx, cancel := workflow.NewDisconnectedContext(ctx)
    defer cancel()

    // All operations use cleanupCtx -- guaranteed to run
    w.updateStatusOnCancellation(cleanupCtx, executionID)
    if len(callbackToken) > 0 {
        w.completeExternalActivity(cleanupCtx, callbackToken, nil,
            fmt.Errorf("workflow cancelled"))
    }
    w.deleteExecutionContext(cleanupCtx, executionID)
}
```

### Prerequisites

Before starting T05:
1. Decide on the design questions above (especially #1 and #4)
2. Consider whether to add `EXECUTION_CANCELLED` to the proto enum
3. Review Temporal Go SDK cancellation documentation: https://docs.temporal.io/develop/go/cancellation
4. Review equivalent Java patterns for Temporal cancellation handling

## References

- **Temporal Go SDK** `workflow.NewDisconnectedContext`: Creates a context that is not cancelled when the parent is cancelled
- **Temporal Cancellation Guide**: https://docs.temporal.io/develop/go/cancellation
- **T04 Plan**: `_projects/2026-03/20260307.01.execution-context-lifecycle/` (plan file in Cursor)
- **Previous Conversation**: [T04 implementation](0d0b0017-a91f-4cee-ab17-19f7be260443) -- contains the full architectural analysis and discussion of Options A/B/C

## Risk Assessment

- **Medium complexity**: Requires restructuring the `Run()` method flow in both AE and WE workflows
- **Behavioral risk**: Must preserve `completeExternalActivity`'s must-succeed semantics on the success path
- **Proto change risk**: If adding `EXECUTION_CANCELLED` phase, this is a proto enum extension (backward compatible but requires regeneration)
- **Testing challenge**: Cancellation paths are hard to test without integration tests against a real Temporal cluster
