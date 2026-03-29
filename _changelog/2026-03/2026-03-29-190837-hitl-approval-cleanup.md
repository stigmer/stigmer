# HITL Approval Cleanup -- Eliminate Redundant Python Gathering and Dead Signal Code

**Date**: March 29, 2026

## Summary

Removed three layers of waste from the Human-in-the-Loop approval flow: Python's redundant `pending_approvals` computation (overwritten by Go on every UpdateStatus), the dead `submitApproval` signal code in both Go and Java, and the legacy `interrupt_proxy.py` module name. The Go workflow now reads `pending_approvals` from the DB via `loadExecution()`, matching the pattern Java already uses. Net deletion of ~2,400 lines across Python, Go, and Java.

## Problem Statement

After eliminating `InterruptProxyRunnable` in favor of LangGraph native subgraph mode, several redundancies remained in the HITL approval flow:

### Pain Points

- **Python computed `pending_approvals` that Go immediately overwrote.** `post_stream.py` queried LangGraph checkpoint interrupts, built a `PendingApproval` list, and set it on the status proto. When this status reached Go via gRPC `UpdateStatus`, Go's `ComputePendingApprovals()` overwrote it. The Python computation only survived in the slim Temporal return value -- a redundant copy that violated the "Single Source of Truth" principle.
- **Go's `pendingCount` guard read from the slim activity return.** This meant Go relied on Python's redundant computation rather than its own authoritative DB state. Java already read from DB via `loadExecution()`.
- **`submitApproval` signal was dead code.** Go's `SignalApproval()` method was never called. Java's `@SignalMethod submitApproval` was an explicit no-op. Both `SIGNAL_SUBMIT_APPROVAL` constants were unreferenced.
- **`interrupt_proxy.py` was a misleading module name.** The `InterruptProxyRunnable` class had been deleted, but the file was kept for `compile_subagent()`. The filename no longer reflected its content.

## Solution

Applied the "Delete Over Refactor" and "Single Source of Truth" principles:

1. **Renamed** `interrupt_proxy.py` to `subagent.py` -- name matches content.
2. **Deleted** Python-side `pending_approvals` gathering -- `build_snapshot_from_interrupts()`, `build_pending_approvals_snapshot()`, the snapshot block in `post_stream.py`, and the `pending_approvals` copy in `slim_status_for_temporal()`.
3. **Modified** Go workflow to read `pendingCount` from DB via `loadExecution()` after `persistFinalStatus()` -- matching Java's existing pattern.
4. **Deleted** `SignalApproval()` method, `SignalSubmitApproval` constant (Go), `submitApproval` interface method / no-op handler / constant (Java), and 11 dead test methods.
5. **Cleaned** stale `InterruptProxy` and `submitApproval` references in comments across all three languages.

## Implementation Details

### Python (Phase 1-2)

- **Module rename**: `graphton/core/interrupt_proxy.py` -> `subagent.py`. Updated 2 import sites in `agent.py`, renamed test file, and updated 26 `@patch` targets across 4 test files.
- **Deleted functions**: `build_snapshot_from_interrupts()` from `hitl.py`, `build_pending_approvals_snapshot()` from `status_builder.py`, removed `PendingApproval` import.
- **Simplified `post_stream.py`**: Replaced the 20-line interrupt query + fallback snapshot + `del/extend` block with a single log line.
- **Simplified `slim_status_for_temporal()`**: Removed the `pending_approvals` append loop. The function now returns only phase, error, and timestamps.
- **Updated tests**: Replaced `TestBuildPendingApprovalsSnapshot` and `TestBuildSnapshotFromInterrupts` with `TestSlimStatusPhaseOnly` that verifies `pending_approvals` is intentionally omitted.

### Go (Phase 3-4)

- **DB-driven `pendingCount`**: In `executeGraphtonWithHitl`, after `persistFinalStatus()`, the workflow now calls `w.loadExecution(ctx, executionID)` and reads `pendingCount` from `dbExecution.GetStatus().GetPendingApprovals()`. If `loadExecution` fails, defaults to `pendingCount = 1` (conservative: wait for signal rather than skip it).
- **Deleted dead code**: `SignalApproval()` method (~60 lines) from `workflow_creator.go`, `SignalSubmitApproval` constant from `workflow_types.go`.
- **Updated test**: HITL test now mocks `loadExecution` to return an execution with `PendingApprovals` populated.

### Java (Phase 4)

- **Deleted dead code**: `submitApproval` from `InvokeAgentExecutionWorkflow` interface, no-op handler from impl, `SIGNAL_SUBMIT_APPROVAL` constant, and 11 test methods (~450 lines) that tested the dead signal path.

## Benefits

- **~2,400 net lines deleted** across Python, Go, and Java
- **Eliminated a redundant data flow** -- Python no longer computes state that Go overwrites
- **Go and Java HITL loops now use the same pattern** -- both read `pendingCount` from DB
- **Removed dead code** -- no more phantom `submitApproval` signal infrastructure
- **Module naming reflects reality** -- `subagent.py` accurately describes `compile_subagent()`

## Impact

- **Python agent-runner**: Simpler `post_stream.py` and `temporal_helpers.py`. No behavioral change for the agent execution flow.
- **Go stigmer-server**: HITL loop makes one additional local activity call (`loadExecution`) per approval cycle. This is negligible overhead -- it's a local activity hitting the DB, same as Java already does.
- **Java stigmer-service**: Interface change removes `submitApproval` signal method. No Temporal compatibility risk since the handler was a no-op and no callers existed.
- **No proto changes, no new RPCs, no behavioral changes** to the approval flow from the end-user perspective.

## What Stays the Same

- `ComputePendingApprovals` in Go/Java -- still the authoritative computation
- `SubmitApproval` RPC handler -- still writes decisions to DB and signals `approvalGateResolved`
- `approvalGateResolved` signal -- still the sole Temporal coordination signal for HITL
- `extract_interrupt_tool_call_ids()` -- still used for orphan reconciliation on resume
- `ResumeReconciler` -- unchanged
- `compile_subagent()` function -- unchanged, only its module location changed
- Interrupt value shape -- unchanged (`{tool_call_id, message}`)

---

**Status**: Production Ready
**Timeline**: Single session
