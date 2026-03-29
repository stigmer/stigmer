# Preserve Approval Fields During update_status Merges

**Date**: March 29, 2026

## Summary

Fixed a data-loss bug where the `update_status` handler — called by the Python agent runner after every LLM step — silently erased approval decisions that `SubmitApproval` had atomically recorded moments earlier. A new `PreserveApprovalFields` helper (Go) / `ApprovalFieldPreserver` (Java) copies approval-owned fields from the existing DB snapshot onto incoming tool calls before they are persisted, closing the race across all four affected code paths.

## Problem Statement

The `update_status` RPC replaces the entire `messages` and `sub_agent_executions` lists on an `AgentExecution` document with the latest state from the Python worker. Python has no knowledge of approval decisions — it always sends `APPROVAL_ACTION_UNSPECIFIED` for every tool call. Because the replacement is wholesale, any approval fields (`approval_action`, `approval_decided_at`, `approved_by`) that were set by `SubmitApproval` between two consecutive `update_status` calls were erased.

### Pain Points

- Approval decisions appeared to succeed (atomic `$set` / `UpdateResource` from T01 worked correctly) but were silently overwritten seconds later by the next `update_status` heartbeat
- The workflow hung indefinitely because the DB no longer reflected the user's approval, so resume conditions were never satisfied
- The bug manifested in all four update paths: Go gRPC handler, Go Temporal activity, Java gRPC handler, and Java Temporal activity
- Debugging was difficult because the approval write and the overwrite were separated by time, making the causal chain non-obvious

## Solution

Introduce a preservation step that runs after message replacement but before `ComputePendingApprovals`:

1. **Snapshot** the existing messages and sub-agent executions (with their approval data) before the wholesale replacement
2. **Build an index** of `tool_call_id → approval fields` from the existing snapshot, only including tool calls that have a non-UNSPECIFIED `approval_action`
3. **Apply** the indexed approval fields onto the incoming tool calls whose `approval_action` is `UNSPECIFIED`
4. **Skip** any incoming tool call that already carries a non-UNSPECIFIED approval (defensive — should not happen today but protects against future senders)

## Implementation Details

### Go: `approval/preserve.go`

- `PreserveApprovalFields(incomingMessages, incomingSubAgents, existingMessages, existingSubAgents)` — mutates incoming proto messages in place (Go protos are pointer-based)
- `buildApprovalIndex` flattens all tool calls from root messages and recursively from sub-agent executions into a `map[string]*approvalSnapshot`
- `applyApprovalFields` walks incoming messages and overwrites UNSPECIFIED approval fields from the index
- 8 unit tests in `preserve_test.go` covering root messages, sub-agent messages, no-op fast path, non-overwrite of existing non-UNSPECIFIED approvals, new tool calls, mixed states, cross-scope preservation, and nil inputs

### Java: `ApprovalFieldPreserver.java`

- `preserve(incomingMessages, existingMessages, incomingSubAgents, existingSubAgents)` returns a `Result` record with rebuilt immutable proto lists
- Uses a `HashMap<String, ApprovalSnapshot>` index, same logical approach as Go
- Reconstructs messages via proto `toBuilder()` because Java protobuf messages are immutable
- 8 unit tests in `ApprovalFieldPreserverTest.java` mirroring the Go suite

### Integration Points

| Code Path | File | Change |
|-----------|------|--------|
| Go gRPC handler | `controller/update_status.go` | Call `PreserveApprovalFields` after message replacement, using un-cloned `existing` as source |
| Go Temporal activity | `activities/update_status_impl.go` | Snapshot before replacement, call `PreserveApprovalFields` after |
| Java gRPC handler | `AgentExecutionUpdateStatusHandler.java` | Snapshot from `existing`, call `preserve()` after replacement, update builder |
| Java Temporal activity | `UpdateExecutionStatusActivityImpl.java` | Snapshot from builder, call `preserve()` after replacement, update builder |

## Benefits

- **Approval durability**: Once a user approves or rejects a tool call, the decision survives any number of subsequent `update_status` heartbeats
- **No Python changes required**: The fix is entirely server-side; the Python agent runner continues to send UNSPECIFIED and the server fills in the correct values
- **Independently deployable**: Each repo can be deployed independently — the preservation is additive and safe even if only one side is deployed first
- **Defensive by design**: Only overwrites UNSPECIFIED fields, so if Python ever starts sending approval data, it won't be silently dropped

## Impact

- **Users**: Approval decisions now persist reliably — no more "phantom approvals" where a decision appears to succeed but the workflow never resumes
- **Operators**: Eliminates a class of support tickets where workflows hang after approval
- **Developers**: Clear field-ownership model — `SubmitApproval` owns approval fields, `update_status` owns everything else — makes future changes safer

## Related Work

- **T01**: Atomic SubmitApproval ([2026-03-29-055135-atomic-submit-approval-race-condition-fix.md](2026-03-29-055135-atomic-submit-approval-race-condition-fix.md)) — made the write side atomic; this change makes the read side durable
- **T03** (upcoming): DB-driven resume — will change the Temporal workflow to read approval state from the DB instead of counting signals
- **T04** (upcoming): Phase gate relaxation — will allow approvals to be submitted even after the workflow resumes

---

**Status**: ✅ Production Ready
**Timeline**: ~2 hours (including both Go and Java implementations with full test suites)
