# Server-Side Computed Pending Approvals (T05)

**Date**: March 27, 2026

## Summary

Replaced the merge-based `pending_approvals` protocol with a server-side computed projection in both Go (stigmer) and Java (stigmer-cloud). `PendingApproval` entries are now derived on every write from the authoritative tool call state in `messages[].tool_calls`, eliminating an entire class of sync bugs where stale or duplicate pending approvals could accumulate. Also introduced `WorkflowPendingApproval` to cleanly separate workflow-level routing concerns from agent-level approval semantics.

## Problem Statement

The HITL approval system managed `pending_approvals` through a complex merge-and-lifecycle protocol that was fragile and bug-prone.

### Pain Points

- **Dual management**: Both Python (agent-runner) and Go/Java (server) could write `pending_approvals`, creating race conditions and stale entries
- **Lifecycle states**: `PendingApproval` had lifecycle states (`INTERRUPT_CAPTURE`, `DECISION_RECORDED`, `RESUME_RECONCILED`) that added complexity with no correctness benefit since T02/T03 eliminated the need
- **Merge logic**: `PendingApprovalMerger` used upsert-by-tool_call_id with forward-only lifecycle enforcement — subtle bugs when lifecycle states got out of sync
- **Cross-aggregate leak**: `child_agent_execution_id` on `PendingApproval` was a workflow-level routing concern bleeding into the agent execution domain
- **Top-level ToolCalls**: The deleted `AgentExecutionStatus.tool_calls` field was still referenced by Go/Java code, preventing compilation on the `hitl-flow-simplification` branch

## Solution

Make `messages[].tool_calls` the single source of truth and `pending_approvals` a server-computed projection:

1. **ComputePendingApprovals** function scans messages for tool calls matching: `status == WAITING_APPROVAL && requires_approval == true && approval_action == UNSPECIFIED`
2. **SubmitApproval** sets `approval_action` on the tool call in messages, then recomputes — the entry vanishes instantly
3. **WorkflowPendingApproval** wrapper cleanly separates domain concerns
4. **Full-replace protocol** for workflow-level pending_approvals eliminates merge logic entirely

## Implementation Details

### Proto Changes (Phase 0)
- Removed `child_agent_execution_id` (field 8) from `PendingApproval`, reserved the field number
- Added `WorkflowPendingApproval` message in `workflowexecution/v1` wrapping `PendingApproval` + `child_agent_execution_id`
- Changed `WorkflowExecutionStatus.pending_approvals` type to `repeated WorkflowPendingApproval`

### Go Server (Phases 1-7)
- **New**: `approval/compute.go` — `ComputePendingApprovals()` + `projectToolCall()` with 9 table-driven tests
- **Deleted**: `approval/merge.go` + `merge_test.go` (referenced deleted proto fields)
- **UpdateStatus** (controller + activity): replaced merge with compute, removed `ToolCalls` merge block
- **SubmitApproval**: `findToolCallInExecution` searches messages; validation simplified; records decision then recomputes
- **InvokeWorkflow HITL loop**: loads execution from DB for `pending_approvals` count (Python's slim return no longer includes them)
- **WorkflowExecution**: full-replace protocol for `pending_approvals`
- **workflow-runner**: constructs `WorkflowPendingApproval` wrapping each child `PendingApproval`, clears via empty slice

### Java Server (Phase 8)
- **New**: `PendingApprovalComputer.java` — mirrors Go `ComputePendingApprovals`
- **Deleted**: `PendingApprovalMerger.java` + `PendingApprovalMergerTest.java`
- **New activity method**: `UpdateExecutionStatusActivity.loadExecution()` for HITL loop DB reads
- All 6 handler/activity files updated with same patterns as Go
- All 4 test files updated for new types and data model

### CLI (Phase 9)
- New `collectToolCallsFromMessages()` helper replaces all `execution.Status.ToolCalls` references
- `WorkflowPendingApproval` field access via `.GetApproval()`
- Removed `InterruptId` from dedup key

### Tests (Phase 10)
- Go: `compute_test.go` (9 cases), CLI tests (snapshot, events, display_summary)
- Java: SubmitApproval, WorkflowSubmitApproval, WorkflowUpdateStatus, WorkflowSignal tests

## Benefits

- **Eliminates sync bugs**: No dual management of pending_approvals — one computation, one source
- **Simpler code**: Deleted ~3900 lines, added ~2000 — net reduction of ~1900 lines
- **Instant consistency**: After SubmitApproval, the approved entry disappears immediately (recomputed, not deferred)
- **Clean domain boundaries**: `PendingApproval` knows nothing about workflow routing; `WorkflowPendingApproval` adds that concern
- **No lifecycle states**: Forward-only lifecycle enforcement was a bug magnet — gone entirely
- **Both languages aligned**: Go and Java now use identical patterns (compute, not merge)

## Impact

- **Server (Go + Java)**: All UpdateStatus and SubmitApproval paths use computed projections
- **Workflow runner (Go)**: Full-replace protocol simplifies workflow-level approval management
- **CLI (Go)**: All tool call access goes through messages, no more stale top-level lists
- **Python**: No changes needed (T03 already stopped writing pending_approvals)
- **React SDK**: Not yet updated (T06) but unblocked
- **Proto compatibility**: Field 8 reserved, new wrapper message is additive

## Related Work

- **T02**: Proto data model cleanup (removed fields that T05 code depended on)
- **T03**: Python single writer to messages (made server-computed projection possible)
- **T06**: React SDK updates (next — remove polling/staleness workarounds)

---

**Status**: ✅ Production Ready (both repos compile, Go tests pass)
**Timeline**: ~3 hours across 2 sessions (sessions 4-5)
