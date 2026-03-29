# T03: DB-Driven Resume — Replace Signal Counting with Single Gate Signal

**Date**: March 29, 2026

## Summary

Replaced the HITL approval flow's signal-counting pattern (N individual `submitApproval` signals per approval cycle) with a DB-driven resume pattern. The workflow now waits for a single `approvalGateResolved` signal, and the Python agent-runner reads approval decisions directly from the database instead of receiving them as Temporal activity arguments. This simplifies the workflow orchestration, eliminates the tight coupling between signal count and pending approvals, and makes the approval flow more robust against concurrency races.

## Problem Statement

The previous HITL approval flow used a **signal-counting** mechanism:

1. Python activity returns `WAITING_FOR_APPROVAL` with a `pending_approvals` snapshot
2. Workflow counts `signalsNeeded = len(pendingApprovals)` and loops N times, receiving one `submitApproval` signal per tool call
3. Workflow collects decisions into `ApprovalDecisionList` and re-invokes Python with decisions as Temporal activity args
4. Python builds `decisions_by_tc` from the Temporal args, reconciles tool call statuses, and resumes the LangGraph

### Pain Points

- **Tight coupling**: The workflow had to know exactly how many signals to expect, creating a fragile dependency between the `pending_approvals` snapshot and signal counting
- **Complexity**: The inner signal-counting loop with REJECT short-circuit, tool_call_id validation, and wait-time tracking added significant workflow code
- **Double data path**: Approval decisions were passed both through the DB (via SubmitApproval's atomic `$set`) and through Temporal activity args, creating redundancy
- **Race conditions**: The pending_approvals count could become stale between the time Python returned it and the time the workflow used it for counting

## Solution

Replaced with a **DB-driven resume** pattern:

1. `SubmitApproval` handler records the decision in DB (unchanged from T01) and conditionally sends a single `approvalGateResolved` signal when either: all tool calls are decided, or a REJECT is submitted
2. Workflow waits for exactly one `approvalGateResolved` signal per approval cycle
3. Python re-invocation passes `nil` decisions — Python detects resume via LangGraph checkpoint interrupts and reads decisions from the DB-loaded execution

## Implementation Details

### Change 1: Conditional Gate Signal (Go + Java)

**Go** — `submit_approval.go`, `workflow_creator.go`, `workflow_types.go`:
- Added `SignalApprovalGateResolved = "approvalGateResolved"` constant
- Added `SignalApprovalGateResolved(executionID)` method on `InvokeAgentExecutionWorkflowCreator`
- Refactored `signalWorkflowStep` from unconditional `SignalApproval()` to conditional `SignalApprovalGateResolved()`:
  - REJECT action → signal immediately
  - `pending_approvals` empty → signal (all decided)
  - Otherwise → no signal, workflow continues waiting

**Java** — `AgentExecutionSubmitApprovalHandler.java`, `AgentExecutionTemporalWorkflowTypes.java`:
- Added `SIGNAL_APPROVAL_GATE_RESOLVED` constant
- Same conditional logic in `SignalWorkflowStep`

### Change 2: Single-Signal Workflow Wait (Go + Java)

**Go** — `invoke_workflow_impl.go`:
- Removed inner `for i := 0; i < signalsNeeded; i++` signal-counting loop
- Removed `waitForApprovalSignal` method and `pendingApprovalDecision` field
- Replaced with single `signalChan.Receive(ctx, nil)` on `approvalGateResolved` channel
- Added guard: if `pending_approvals` is empty on activity return, skip signal wait and re-invoke Python immediately
- Re-invokes `ExecuteGraphton(executionID, threadID, nil)` — no decisions arg

**Java** — `InvokeAgentExecutionWorkflow.java`, `InvokeAgentExecutionWorkflowImpl.java`:
- Added `approvalGateResolved()` signal handler to workflow interface
- Added `approvalGateResolvedFlag` boolean field
- Replaced inner signal-collection loop with `Workflow.await(() -> this.approvalGateResolvedFlag)`
- Kept `submitApproval()` handler as no-op for Temporal interface compatibility
- Same zero-pending guard
- Removed unused imports (`ApprovalDecisionList`, `ApprovalAction`, `PendingApproval`, `ArrayList`, `List`)

### Change 3: Python DB-Driven Resume Detection

**`hitl.py`** — Added `extract_approval_decisions_from_execution()`:
- Scans root messages and sub-agent messages for tool calls with `approval_action != UNSPECIFIED`
- Builds the same `list[SubmitApprovalInput]` that `ResumeReconciler` expects
- Zero downstream changes to `ResumeReconciler` or the interrupt-matching logic

**`execute_graphton.py`** — Added DB-driven resume detection:
- Before the existing `if approval_decisions:` block, checks LangGraph checkpoint for interrupts
- If interrupts exist and no Temporal-args decisions → extracts from DB-loaded execution
- Backward compatible: old workflows sending decisions via Temporal args still work

### Tests

- **Go**: 3 new contract tests for gate resolution logic (all-decided, pending-remaining, reject-with-pending)
- **Java**: Updated `SignalWorkflowStep` tests for conditional signaling (6 tests covering all paths)
- **Python**: 8 new tests for `extract_approval_decisions_from_execution` (approve, reject, skip, sub-agent, mixed, empty, comment handling)

## Benefits

- **Simpler workflow code**: ~160 lines removed from Go workflow, ~150 lines removed from Java workflow
- **Single source of truth**: DB is the authority for approval decisions; no more dual data path via Temporal args
- **Race-resistant**: No more signal count depending on a point-in-time snapshot
- **Backward compatible**: Python accepts both Temporal-args and DB-driven decisions, enabling independent deployment

## Impact

- **Go stigmer-server**: 8 files modified (3 signal/handler, 1 workflow, 2 tests, 2 constants)
- **Java stigmer-service**: 5 files modified (1 handler, 1 constants, 2 workflow, 1 test)
- **Python agent-runner**: 3 files modified (1 activity, 1 hitl module, 1 test)
- **Deployment**: Big-bang within each repo (SubmitApproval + workflow changes deploy together). In-flight HITL workflows at restart will fail with non-determinism errors and need manual termination.

## Related Work

- **T01**: Atomic SubmitApproval — established the DB-first approval recording that T03 depends on
- **T02**: update_status Approval Preservation — ensures Python's status updates don't overwrite approval fields
- **T04 (next)**: Phase Gate Relaxation — will allow approvals to be submitted after the workflow has already resumed

---

**Status**: Production Ready
**Timeline**: 1 session (~2 hours)
