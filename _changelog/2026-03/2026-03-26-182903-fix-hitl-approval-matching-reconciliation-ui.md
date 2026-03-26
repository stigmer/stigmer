# Fix HITL Approval: Interrupt Matching, Reconciliation Sync, and UI Presentation

**Date**: March 26, 2026

## Summary

Fixed three interrelated bugs in the Human-in-the-Loop (HITL) approval flow that caused approvals to get permanently stuck, tool call status to remain stale across approval cycles, and a "duplicate execution" appearance in the UI. The root cause was a chain of failures: INTERRUPT_CAPTURE matching the wrong tool_call_id across cycles, RESUME_RECONCILE not syncing message-embedded tool call copies, and the frontend not treating resolved approvals as terminal states.

## Problem Statement

After a tool is approved and the LLM produces a new (different) tool call in the next cycle, the approval flow deadlocks. The user sees the execution appear to "restart" (showing all messages from all cycles linearly), and the Temporal workflow gets permanently stuck waiting for a signal on the wrong tool_call_id.

### Pain Points

- Approval submissions had no effect — the Temporal workflow waited for a signal for a tool_call_id that the user never saw
- After approving a tool, the execution appeared to restart from scratch (same think + write messages appeared again)
- Tool calls from previous cycles still showed "Waiting for approval" status even though they were already approved
- The mismatch between what the DB showed as pending and what the Temporal workflow expected caused permanent deadlocks

## Solution

A layered defense-in-depth fix across three codebases (agent-runner Python, stigmer-service Java tests, SDK React):

1. **Fingerprint-based interrupt matching** — Added a Priority 2 matching step between run_id and name-based fallback that uses args fingerprints to disambiguate tool calls with the same name but different content
2. **Message-embedded tool call sync** — Made RESUME_RECONCILE update both the flat `tool_calls` list AND the independent message-embedded copies via `_update_tool_call_on_ai_message()`
3. **Phase 1/Phase 2 collision cleanup** — Detect and remove stale Phase 1 pending approval entries when Phase 2 matches a different tool_call_id for the same tool name
4. **UI resolved-approval recognition** — Frontend now treats `WAITING_APPROVAL` tool calls with a set `approvalAction` as resolved/completed

## Implementation Details

### Fingerprint-Based INTERRUPT_CAPTURE Matching (`execute_graphton.py`)

The INTERRUPT_CAPTURE matching now follows a three-priority chain:

1. **Priority 1 (run_id)**: Resolve via `_run_id_aliases` — unchanged but now with diagnostic logging on failure
2. **Priority 2 (fingerprint)**: Compute fingerprint from interrupt's `tool_name + tool_args`, look up `_fingerprint_to_tool_call_id`, verify the candidate is `WAITING_APPROVAL`
3. **Priority 3 (name)**: Original name-based fallback — first `WAITING_APPROVAL` tool with matching name

This prevents the stale-cycle tool call (with matching name but different args/fingerprint) from being incorrectly matched.

### RESUME_RECONCILE Message Sync (`execute_graphton.py`)

After reconciling the flat `tool_calls` list, the code now iterates `decisions_by_tc` and calls `_update_tool_call_on_ai_message()` on both top-level and sub-agent messages. This ensures the message-embedded copies (which are independent protobuf objects) reflect the reconciled status.

A defensive warning now fires for any tool call that remains `WAITING_APPROVAL` after reconciliation, logging the decision keys to aid debugging.

Auto-skip (on REJECT) is also synced to message-embedded copies.

### Phase 1/Phase 2 Collision Cleanup (`execute_graphton.py`)

When INTERRUPT_CAPTURE's Phase 2 matches a tool_call_id not in Phase 1, it now checks for stale Phase 1 entries with the same tool_name but different tool_call_id. If found, the stale entries are removed with a warning log, preventing dual pending approvals that confuse the Temporal workflow's signal validation.

### UI Resolved-Approval Recognition (`ToolCallGroup.tsx`, `ToolCallItem.tsx`)

- `deriveAggregateStatus()` in `ToolCallGroup` now treats `WAITING_APPROVAL` tool calls with `approvalAction` set (APPROVE/SKIP/REJECT) as terminal — the group shows as "completed" instead of "waiting"
- `mapToolCallStatus()` in `ToolCallItem` now accepts the full `ToolCall` object and checks `approvalAction` — if set on a `WAITING_APPROVAL` tool call, it maps to "completed" instead of "waiting"

### Unit Tests (`AgentExecutionSubmitApprovalHandlerTest.java`)

Added two new test cases:
- `testSuccess_WhenDualPendingApprovalsForSameToolName()` — validates that two pending approvals for the same tool name (Phase 1/Phase 2 collision) both pass validation
- `testSuccess_WhenOldCycleToolCallIdInPendingApprovals()` — validates the exact bug scenario where INTERRUPT_CAPTURE matched the wrong tool_call_id

## Benefits

- Approvals no longer deadlock when the LLM produces different tool calls across cycles
- Tool calls from previous approval cycles show their resolved status correctly
- The "duplicate execution" visual is mitigated — cycle 1's tool groups collapse as "completed" instead of showing the yellow "waiting" indicator
- Diagnostic logging enables rapid debugging of any remaining matching edge cases

## Impact

- **Agent Execution**: All HITL approval cycles now correctly match interrupts to the right tool call, preventing permanent workflow deadlocks
- **Web Console**: Previously-approved tool calls no longer show stale "Waiting for approval" status, reducing user confusion
- **Operational**: New diagnostic logs at `[INTERRUPT_CAPTURE]` and `[RESUME_RECONCILE]` provide clear visibility into matching decisions

## Related Work

- Previous fix: `2026-03-26-174359-fix-hitl-approval-stale-idempotency-short-circuit.md` — addressed the stale idempotency check in `SubmitApprovalHandler`; this change fixes the upstream matching that produces the wrong pending_approvals in the first place

---

**Status**: Production Ready
**Timeline**: ~2 hours
