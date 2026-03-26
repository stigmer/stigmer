# Fix HITL Approval Flow: Stale Idempotency Short-Circuit Bug

**Date**: March 26, 2026

## Summary

Fixed a critical bug where the Human-in-the-Loop (HITL) approval flow permanently stuck executions in `WAITING_FOR_APPROVAL` when the LLM produced a tool call with the same `tool_call_id` across multiple approval cycles. The root cause was the idempotency check in `SubmitApprovalHandler` firing before the `pending_approvals` check, causing a stale `approval_action` from a previous cycle to suppress the Temporal workflow signal.

## Problem Statement

Agent executions using HITL approval were getting permanently stuck. The UI showed "Waiting for approval" but either displayed no approval task (requiring a page refresh), or after refresh, the approval button appeared but submitting it had no effect — the approval kept reappearing on every refresh.

### Pain Points

- Executions stuck indefinitely in `WAITING_FOR_APPROVAL` with no way to recover
- Users forced to refresh the page to see approval tasks
- Submitted approvals silently dropped — no error feedback
- The bug was non-deterministic: it only triggered when the LLM produced the same `tool_call_id` across cycles (deterministic model output from similar checkpoint contexts)

## Solution

A three-layer defense-in-depth fix across the Java approval handler and the Python agent-runner:

1. **Reorder validation logic** in `ValidateApprovalStep` — check `pending_approvals` BEFORE the idempotency check, so a tool_call_id present in `pending_approvals` is always treated as a fresh approval
2. **Reset stale `approval_action`** on ToolCalls in the agent-runner when they re-enter `pending_approvals` in a new cycle, preventing stale state from reaching the DB
3. **Add cycle-boundary diagnostic logging** to make this class of bug immediately visible in future logs

## Implementation Details

### Primary Fix: `AgentExecutionSubmitApprovalHandler.java` (stigmer-cloud)

Restructured `ValidateApprovalStep.execute()` into a clear three-phase flow:

1. **Phase gate** → If not `WAITING_FOR_APPROVAL`, delegate to `handleNonWaitingPhase()` which checks for idempotent retries before rejecting
2. **Pending approvals check (primary path)** → If `tool_call_id` is in `pending_approvals`, always proceed as a fresh approval. A `CYCLE_BOUNDARY` log fires when the ToolCall also carries a stale `approval_action`
3. **Not-in-pending fallback** → `handleNotInPendingApprovals()` checks for idempotent retries (approval already resolved, pending entry removed) before returning `INVALID_ARGUMENT`

Extracted helper methods: `findInPendingApprovals()`, `handleNonWaitingPhase()`, `handleNotInPendingApprovals()`, and `logStaleApprovalActionIfPresent()`.

### Secondary Fix: `execute_graphton.py` (stigmer)

After interrupt capture finalizes the `pending_approvals` list, a new block iterates all ToolCalls (top-level and sub-agent) and resets `approval_action` to `APPROVAL_ACTION_UNSPECIFIED` on any whose `tc_id` appears in the new `pending_approvals`. This prevents stale approval decisions from cycle N-1 from ever being written to the DB.

### Unit Tests: `AgentExecutionSubmitApprovalHandlerTest.java` (stigmer-cloud)

Added three new tests and two helper builders:

- `testNotIdempotent_WhenStaleApprovalActionButInPendingApprovals` — Core regression test
- `testIdempotent_WhenApprovalActionAndNotInPendingApprovals` — Validates the legitimate idempotency path
- `testFailedPrecondition_WhenDifferentAction` — Validates conflicting action rejection (replaces an incorrect pre-existing test)

## Benefits

- Eliminates the permanent-stuck-execution failure mode in HITL approval flows
- Defense-in-depth: even if one fix is bypassed, the other layer catches it
- `CYCLE_BOUNDARY` log line makes future cross-cycle tool_call_id reuse immediately diagnosable
- No breaking changes to the approval API contract

## Impact

- **Agent Executions**: All HITL executions that involve multi-cycle approvals are now resilient to `tool_call_id` reuse
- **End Users**: Approval submissions reliably deliver signals to the Temporal workflow; no more stuck executions
- **Operators**: New log markers (`CYCLE_BOUNDARY`, stale reset counts in `INTERRUPT_CAPTURE`) aid debugging

## Related Work

- Execution `aex_01kmmzk7450r4vbdsnt1ccynzm` (Mahatma Gandhi biography scenario) was the original reproduction case
- The `RESUME_RECONCILE` code in `execute_graphton.py` that sets `approval_action` on ToolCalls during cycle resume is the upstream source of the stale state

---

**Status**: ✅ Production Ready
**Files Changed**:
- `stigmer-cloud/.../AgentExecutionSubmitApprovalHandler.java` (handler restructure)
- `stigmer-cloud/.../AgentExecutionSubmitApprovalHandlerTest.java` (new tests)
- `stigmer/.../execute_graphton.py` (stale approval_action reset)
