# Fix: Pending Approvals Race Condition (Belt-and-Suspenders Overwrite)

**Date**: March 18, 2026

## Summary

A lost-update race condition in the Temporal workflow's "belt-and-suspenders" persist caused already-resolved `pending_approvals` entries to reappear in the database. When a user approved a tool call and then refreshed the page, the stale approval card would return. Attempting to skip the already-approved entry produced a `FAILED_PRECONDITION` error: "already has approval action APPROVE, cannot change to SKIP."

This was a follow-up to the `ResolvePendingApprovalStep` fix (see `2026-03-18-135821`), which solved the root protobuf3 serialization gap but introduced a narrow race window with the workflow's redundant persist.

## Root Cause

The Temporal workflow performs a "belt-and-suspenders" persist of the `WAITING_FOR_APPROVAL` status before blocking on the signal channel. This persist re-sends the original `finalStatus` (including ALL `pending_approvals`) through the `UpdateExecutionStatus` handler.

The `UpdateStatus` merge logic replaces `pending_approvals` wholesale when the input has them. If the user approves a tool call while the belt-and-suspenders persist is executing (or shortly before), the persist overwrites the resolution performed by `ResolvePendingApprovalStep`:

1. `ResolvePendingApprovalStep` removes tool A from `pending_approvals` → DB has `[B, C]`
2. Belt-and-suspenders persist merges input `[A, B, C]` → DB has `[A, B, C]` (stale overwrite)

This is a classic lost-update race between two concurrent DB writers with no optimistic concurrency control.

## Solution

### Workflow Fix (Go OSS + Java Cloud)

Strip `pending_approvals` from the status before the belt-and-suspenders persist. The pending_approvals were already persisted by Python's gRPC `updateStatus` call. Re-persisting them creates the race.

With `pending_approvals` nil/empty in the input, the `UpdateStatus` merge logic preserves whatever is currently in the DB -- correct regardless of whether `ResolvePendingApprovalStep` has already cleaned entries.

**Go**: `proto.Clone(finalStatus)` then `statusForPersist.PendingApprovals = nil`
**Java**: `finalStatus.toBuilder().clearPendingApprovals().build()`

### Java Cloud: Port ResolvePendingApprovalStep

The Java `AgentExecutionSubmitApprovalHandler` did not have a `ResolvePendingApprovalStep`. It relied entirely on the async chain (Python clearing via `updateStatus`) and the Phase 5.4 defensive cleanup in the workflow. The previous changelog incorrectly noted the Java backend was "unaffected."

Ported the step from Go with identical behavior:
- Removes matching `PendingApproval` by `toolCallId` from top-level and sub-agent lists
- Records `approval_action` and `approval_decided_at` on the matching `ToolCall`
- Persists to MongoDB and publishes to Redis for real-time subscribers

### Java Cloud: Validation Alignment

Aligned the idempotency check to match Go behavior. Previously, the Java backend silently accepted conflicting approval actions (e.g., approve then skip) as idempotent. Now it rejects them with `FAILED_PRECONDITION`, providing a clear error message. Also extended the tool call search to include sub-agent tool calls via a shared `findToolCallInExecution` helper.

## Files Changed

- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go` (Go OSS workflow)
- `backend/services/stigmer-service/.../handler/AgentExecutionSubmitApprovalHandler.java` (Java Cloud handler)
- `backend/services/stigmer-service/.../workflow/InvokeAgentExecutionWorkflowImpl.java` (Java Cloud workflow)

## Impact

- **Go OSS**: Belt-and-suspenders persist no longer re-introduces stale `pending_approvals`
- **Java Cloud**: Full parity with Go OSS approval handling (ResolvePendingApprovalStep + workflow fix + validation alignment)
- **Frontend**: No changes -- stale cards disappear because the backend data is now correct
- **Python agent-runner**: No changes

---

**Status**: Production Ready
**Timeline**: Single session
