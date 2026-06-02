# Terminate Child TS Workflow on Recovery

**Date**: June 1, 2026

## Summary

The workflow execution recovery pipeline now explicitly terminates both the Temporal orchestrator and its TS child workflow before starting a fresh one. This prevents a race condition where the new orchestrator's child start could be rejected by Temporal due to the old child still occupying the workflow ID.

## Problem Statement

When recovery fires, the pipeline terminates the orchestrator (`stigmer/workflow-execution/invoke/{id}`) but not the TS child (`workflow-exec-{id}`). The child has `ParentClosePolicy: REQUEST_CANCEL`, which only sends a soft cancellation request — not a hard termination.

### Pain Points

- If the child is stuck in a long-running activity (e.g., waiting on Cursor SDK), the cancellation request may not be processed immediately
- The new orchestrator starts immediately and attempts to spawn a fresh child with the same workflow ID
- Temporal rejects the start because the old child hasn't reached a terminal state
- Recovery fails silently with no user-visible error

## Solution

Extend `TerminateExistingWorkflowStep` in both Go (stigmer-server) and Java (stigmer-service) to terminate the full workflow tree: orchestrator first, then child. This is the first instance of multi-workflow termination in a single pipeline step, setting the pattern for future similar needs.

## Implementation Details

**Structural change (not just an append):** The existing Go code had `return nil` on orchestrator NOT_FOUND, which would skip child termination. A naive append of child termination code would never execute in this case. The fix extracts a private `terminateWorkflow` helper (Go) / `terminateWorkflowIfExists` (Java) that encapsulates the terminate + NOT_FOUND pattern, then calls it twice.

**Go changes** (`lifecycle_steps.go`):
- Restructured `TerminateExistingWorkflowStep.Execute()` into two sequential helper calls
- Private `terminateWorkflow(ctx, executionID, workflowID, description)` handles NOT_FOUND gracefully
- Follows `recreateExecutionContextStep` precedent (which extracts `deleteStaleEC` and `resolveEnvironments` helpers)

**Java changes** (`WorkflowExecutionRecoverHandler.java`):
- Private `terminateWorkflowIfExists(workflowId, description, executionId, reason)` returns null on success, failure result on error
- `execute()` calls helper twice with clear failure short-circuit

**Tests:**
- Go: 8 focused unit tests with a minimal `fakeTemporalClient` struct
- Java: 6 `@Nested` tests using Mockito + `ArgumentCaptor` to verify both workflow IDs

**Stale cleanup (Java test):** Removed broken `CTX_NEW_RUN_ID` / `CTX_RESET_EVENT_ID` references from the old Temporal Reset approach (deferred since Session 3).

## Benefits

- Eliminates the zombie child workflow race condition during recovery
- Hard guarantee that the workflow ID is available for reuse when `StartFreshWorkflow` spawns a new child
- Sets a clean, well-tested pattern for multi-workflow termination
- Fills a test coverage gap (TerminateExistingWorkflowStep previously had zero test coverage)

## Impact

- **Workflow execution recovery**: More reliable — no more silent failures when the old child is stuck
- **Both editions**: Go (OSS) and Java (Cloud) implementations are behaviorally consistent
- **Test coverage**: 14 new tests (8 Go + 6 Java) covering all edge cases

## Related Work

- T01: Event Sequence Continuation (TS Runner) — `dd1a4e8cb`
- T02: Task-Level Resume in TS Engine
- T03: Recovery Flag Propagation (Java + Go) — `42bce319f`, `39377761`
- T05: React Event Store Reset on Recovery — `392ce77d0`

---

**Status**: ✅ Production Ready
**Commits**: `ca65a92d9` (stigmer), `7061f539` (stigmer-cloud)
