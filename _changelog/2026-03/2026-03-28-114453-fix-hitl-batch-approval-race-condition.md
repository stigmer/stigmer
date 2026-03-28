# Fix HITL Batch Approval Race Condition

**Date**: March 28, 2026

## Summary

Fixed a race condition in the HITL batch approval flow where approving multiple tool calls in quick succession caused `EXECUTION_FAILED` errors. The Temporal Go workflow was reading a stale `pending_approvals` count from the database (already mutated by concurrent `SubmitApproval` handlers), resulting in partial LangGraph resumes and checkpoint validation failures. The fix separates the mutable UI projection from the immutable Temporal coordination signal.

## Problem Statement

When a user approved multiple tool calls rapidly, the system intermittently failed with checkpoint validation errors:
- `Graph has pending nodes ['tools'] but stream ended without WAITING_FOR_APPROVAL or PAUSED phase`
- `1 tool call(s) requested by the model have no corresponding ToolMessage in the checkpoint`

### Pain Points

- Approving 2+ tool calls in quick succession triggered the race condition
- The Go workflow read `pending_approvals` from the database to determine how many signals to collect
- The `SubmitApproval` API handler concurrently recorded decisions and recomputed the DB projection, reducing the count before the workflow read it
- This caused the workflow to collect fewer signals than needed, pass partial decisions to Python, and leave LangGraph interrupts unresolved

## Solution

Separated the two conflicting purposes of `pending_approvals`:

1. **UI display** (DB path): Continues using the server-computed materialized projection via `ComputePendingApprovals`, updated in real-time as each decision is recorded
2. **Workflow coordination** (Temporal path): Python now builds a point-in-time snapshot of pending approvals at interrupt time and includes it in the slim status returned to the Go workflow

The Go workflow reads the immutable activity return value instead of the mutable DB state. Two paths, two purposes, no shared mutable state, no race.

## Implementation Details

**Python -- `StatusBuilder.build_pending_approvals_snapshot()`**: New method on `StatusBuilder` that builds minimal `PendingApproval` entries from tool calls in `WAITING_APPROVAL` state. Uses the same filter criteria as Go's `ComputePendingApprovals` (status == WAITING_APPROVAL, requires_approval == true, approval_action == UNSPECIFIED).

**Python -- `post_stream.py`**: When phase is `EXECUTION_WAITING_FOR_APPROVAL`, the snapshot is populated onto `current_status.pending_approvals` before the slim status is returned to Temporal.

**Go -- `invoke_workflow_impl.go`**: Replaced the `loadExecution()` DB call with `finalStatus.GetPendingApprovals()` for signal counting. Removed the stale comment claiming Python's slim return does not include pending approvals.

**Tests -- `test_hitl_contracts.py`**: Added 8 new tests covering the snapshot method (inclusion/exclusion criteria, batch behavior, empty state) and the `slim_status_for_temporal` contract (snapshot preserved through slim copy).

## Benefits

- Eliminates the batch approval race condition at its source
- No compensating layers, drain loops, or DB-recovery fallbacks
- Consistent with DD-001 (Single Source of Truth) from the HITL Approval Cleanup project
- Minimal surface area: 4 files, one new 10-line method, one moved line of Go code

## Impact

- **Users**: Can now approve multiple tool calls in rapid succession without triggering execution failures
- **Architecture**: Cleanly separates the UI display projection (DB) from the workflow coordination signal (Temporal activity return), eliminating a class of race conditions

## Related Work

- [HITL Approval Cleanup project](../../_projects/2026-03/20260327.01.hitl-approval-cleanup/README.md) -- the architectural cleanup that established DD-001 and the patterns this fix builds on
- [DD-001: Single Source of Truth](../../_projects/2026-03/20260327.01.hitl-approval-cleanup/design-decisions/001-single-source-of-truth.md) -- design decision this fix is consistent with

---

**Status**: Production Ready
