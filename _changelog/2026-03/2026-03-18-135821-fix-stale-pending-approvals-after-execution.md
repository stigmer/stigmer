# Fix: Stale Pending Approvals Persisting After Execution Completion

**Date**: March 18, 2026

## Summary

After an HITL approval flow completed and the execution reached a terminal state (COMPLETED), stale `pending_approvals` entries persisted in the database. On page refresh, the UI rendered both a "Completed" badge and a live "Approval required" card with actionable buttons -- a confusing and incorrect state. The root cause was traced to a protobuf serialization gap combined with the `SubmitApproval` handler not owning the state transition it represents.

## Problem Statement

When a user approved a tool call and the execution completed normally, refreshing the page showed a stale approval card alongside the "Completed" badge. The tool appeared to still be waiting for approval even though the execution had finished.

### Pain Points

- Users see contradictory UI state: "Completed" + "Approval required" simultaneously
- Clicking "Approve" on the stale card would fail (workflow no longer running)
- The issue only manifests after page refresh -- during live streaming, optimistic dismissal hides the stale card
- No amount of subsequent status updates from Python could clear the stale entries due to the protobuf serialization gap

## Root Cause

The `SubmitApproval` RPC handler was a read-only pass-through: it validated the request, signaled the Temporal workflow, and returned the execution state untouched. It did not modify the database.

The actual clearing of `pending_approvals` was delegated to an async chain:

```
SubmitApproval → Temporal signal → Go workflow → Python activity → gRPC UpdateStatus → Go merge logic
```

This chain silently failed because Python cleared `pending_approvals` by emptying the repeated field (`del pending_approvals[:]`), but in protobuf3 an empty repeated field is indistinguishable from an absent field on the wire. The Go merge logic in `UpdateStatus` interpreted `len(requestStatus.PendingApprovals) == 0` as "preserve existing," so the stale entries survived every subsequent status update -- including the final COMPLETED one.

## Solution

Made the `SubmitApproval` handler own the state transition by adding a `ResolvePendingApprovalStep` to its pipeline. This step runs before the Temporal signal is sent, ensuring the DB is clean before the workflow even processes the approval.

## Implementation Details

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/submit_approval.go`

**Pipeline change**:
```
Before:  ValidateProto → LoadExisting → ValidateApproval → SignalWorkflow → BuildResponse
After:   ValidateProto → LoadExisting → ValidateApproval → ResolvePendingApproval → SignalWorkflow → BuildResponse
```

The `ResolvePendingApprovalStep`:

1. Skips for idempotent requests (already processed)
2. Clones the execution via `proto.Clone` (same pattern as `BuildNewStateWithStatusStep`)
3. Removes the matching `PendingApproval` entry by `toolCallId` from `status.pending_approvals`
4. Removes the entry from dual-surfaced `SubAgentExecution.pending_approvals`
5. Records `approval_action` and `approval_decided_at` on the matching `ToolCall` for immediate UI feedback
6. Persists the updated execution to the store
7. Broadcasts to active subscribers via `StreamBroker`
8. Updates the pipeline context so downstream steps see the resolved state

A `removePendingApprovalByToolCallId` helper uses a `pendingApprovalHolder` interface to handle both `AgentExecutionStatus` and `SubAgentExecution` without code duplication.

**No race condition**: During the approval wait, the Python activity has already returned. The workflow is blocked on `signalChan.Receive()`. The strict ordering is: persist → signal → workflow receives → re-invokes Python → Python loads clean DB.

## Benefits

- The DB immediately reflects the user's approval decision -- no stale data after page refresh
- The UI subscriber receives the cleared state via broadcast without waiting for async Python updates
- Batch approvals work naturally: each `SubmitApproval` call removes its own entry
- No changes required to the merge logic, Temporal workflow, frontend, or Python agent-runner

## Impact

- **Backend (Go OSS)**: Single file changed (`submit_approval.go`), one new pipeline step
- **Frontend**: No changes -- stale approval cards disappear because the backend data is now correct
- **Python agent-runner**: No changes -- Python's empty-list clearing is now harmless (preserving an already-empty list)
- **Java Cloud backend**: Affected -- Phase 5.4 defensive cleanup only handled the post-completion case. A follow-up fix ported ResolvePendingApprovalStep to Java and addressed a belt-and-suspenders persist race condition (see `2026-03-18-fix-pending-approvals-race-condition.md`)

## Related Work

- Java Cloud's `InvokeAgentExecutionWorkflowImpl.java` Phase 5.4 defensive validation (lines 777-820) addresses the same symptom from the workflow side
- The protobuf3 empty-vs-absent repeated field limitation is a known protocol constraint that affects the three-state merge convention in `update_status.go`

---

**Status**: Production Ready
**Timeline**: Single session
