# Fix HITL Approval Blocking and Checkpoint-Based Orphan Reconciliation

**Date**: March 28, 2026

## Summary

Fixed a critical bug where the Go Temporal workflow permanently blocked waiting for approval signals that could never arrive. The root cause was a mismatch between the Python pending-approvals snapshot (which included orphaned tool calls from completed sub-agents) and the actual LangGraph checkpoint interrupts. Introduced interrupt-based snapshots, checkpoint reconciliation on resume, and a multi-layer defense across Python, Go, and Java.

## Problem Statement

When a sub-agent completed but left behind orphaned `WAITING_APPROVAL` tool calls (due to the `InterruptProxyRunnable` thread-counter bug creating fresh sub-agent threads on parent replay), the entire execution became permanently stuck.

### Pain Points

- **Go workflow signal deadlock**: `signalsNeeded` was derived from the Python snapshot which counted orphaned tool calls. The Go handler treated re-approvals of already-decided tools as idempotent (no signal sent), so fewer signals arrived than expected. The workflow blocked forever at `waitForApprovalSignal`.
- **Ghost approval cards**: UI showed approval cards for tool calls belonging to completed sub-agents. Approving them had no effect — the checkpoint had no corresponding interrupt.
- **Resume failures**: When Python received approval decisions for orphaned tool calls, it couldn't match them to checkpoint interrupts. If all decisions were orphaned, the execution failed. If mixed, the orphaned ones were silently dropped.
- **Stale DB state**: Orphaned `WAITING_APPROVAL` tool calls persisted in the DB status across resume cycles, polluting `pending_approvals` projections.

## Solution

Four-layer fix addressing the problem at each level of the stack, with the interrupt-based snapshot as the primary correctness fix.

## Implementation Details

### Layer 1: InterruptProxyRunnable thread management (root cause)

**File**: `backend/libs/python/graphton/src/graphton/core/interrupt_proxy.py`

Replaced the unconditional `_next_thread_id()` counter increment with checkpoint-first logic in `ainvoke()`:
- Probes the current thread's checkpoint via `_safe_get_state()`
- If interrupts exist: resumes on the same thread (preserves checkpoint)
- If a completed checkpoint exists: advances the counter (new sequential call)
- If no checkpoint: starts fresh on the current thread

Added `_current_thread_config()` helper that returns thread ID and config without incrementing.

### Layer 2: Sub-agent completion cleanup (StatusBuilder defense)

**File**: `backend/services/agent-runner/worker/activities/graphton/status_builder.py`

Added `_finalize_orphaned_tool_calls()` called from `_handle_sub_agent_end()`. When a sub-agent completes or fails, sweeps its messages for `WAITING_APPROVAL` tool calls with no recorded decision and marks them `SKIPPED`.

### Layer 3: Server-side pending-approvals filter (Go + Java)

**Files**:
- `backend/services/stigmer-server/pkg/domain/agentexecution/approval/compute.go`
- `stigmer-cloud: backend/services/stigmer-service/.../approval/PendingApprovalComputer.java`

Added `isTerminalSubAgent()` check to `ComputePendingApprovals` / `compute()`. Tool calls from `SUB_AGENT_COMPLETED` or `SUB_AGENT_FAILED` sub-agents are excluded from the DB-projected `pending_approvals`.

### Layer 4: Interrupt-based snapshot and checkpoint reconciliation

**Files**:
- `backend/services/agent-runner/worker/activities/graphton/hitl.py`
- `backend/services/agent-runner/worker/activities/graphton/post_stream.py`
- `backend/services/agent-runner/worker/activities/execute_graphton.py`

**Interrupt-based snapshot** (`post_stream.py`): The pending-approvals snapshot for Temporal coordination is now built from `graph_state.interrupts` (the LangGraph checkpoint) instead of scanning tool call statuses in protobuf messages. This makes `signalsNeeded` in the Go workflow match exactly what Python can process on resume.

**Shared helpers** (`hitl.py`):
- `extract_interrupt_tool_call_ids()` — extracts tool_call_ids from both direct and proxy interrupt shapes
- `build_snapshot_from_interrupts()` — builds `list[PendingApproval]` from checkpoint interrupts

**Checkpoint orphan reconciliation** (`execute_graphton.py`, Step 7.7): On resume, after `ResumeReconciler` handles decided tool calls, sweeps remaining `WAITING_APPROVAL` tool calls against the checkpoint interrupt set. Any tool call not in the interrupts and not in the decisions is marked `SKIPPED`. This cleans up stale DB state before streaming begins.

### Tests

**File**: `backend/services/agent-runner/tests/test_hitl_contracts.py`

Added 16 new tests across 3 classes:
- `TestExtractInterruptToolCallIds` (6 tests): direct, proxy, mixed, empty, edge cases
- `TestBuildSnapshotFromInterrupts` (3 tests): sorted output, empty, proxy
- `TestReconcileOrphansAgainstCheckpoint` (7 tests): orphan skipped, interrupt-set preserved, decision-set preserved, completed untouched, already-decided untouched, mixed, empty

Also added tests for Layer 1 (`TestInterruptProxyThreadManagement`, 4 tests) and Layer 2 (`TestSubAgentCompletionCleanup`, 5 tests).

## Benefits

- **Eliminates permanent workflow deadlock**: `signalsNeeded` is now grounded in checkpoint truth, not stale proto state
- **Ghost approval cards disappear**: Orphaned tool calls are cleaned up on resume and excluded from snapshots
- **Clean resume path**: DB status is reconciled against the checkpoint before streaming, so the UI always reflects reality
- **Defense in depth**: Four independent layers ensure the problem is caught even if one layer has a timing gap

## Impact

- **Python agent-runner**: Core fix in `hitl.py`, `post_stream.py`, `execute_graphton.py`, `interrupt_proxy.py`, `status_builder.py`
- **Go stigmer-server**: `ComputePendingApprovals` now filters terminal sub-agents
- **Java stigmer-service**: `PendingApprovalComputer` mirrors the Go filter
- **All HITL executions**: Any execution with sub-agent HITL tools benefits from these fixes

## Related Work

- Builds on T03 HITL simplification (messages as single source of truth)
- Builds on DD-001 (server-computed pending_approvals)
- Complements the `ResumeReconciler` introduced for decided tool call transitions

---

**Status**: Production Ready
**Timeline**: ~4 hours across investigation, design, and implementation
