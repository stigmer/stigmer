# Fix HITL Resume Race Condition: Prevent Infinite Tool-Call Loops After Approval

**Date**: March 26, 2026

## Summary

Fixed a critical race condition in the Human-in-the-Loop (HITL) approval flow where the Go/Java approval handlers deleted `pending_approvals` from the database before the re-invoked Python activity could read them. This caused the LangGraph resume mechanism to fail silently, triggering the LLM into an infinite loop of regenerating the same tool call after each approval.

## Problem Statement

After a user approved a tool call in the UI, the agent would enter an infinite cycle: thinking, generating an agent message, then issuing the exact same `write` tool call again. Each cycle started fresh (`[COST] seq=1`) rather than resuming the interrupted tool node. The approval itself was processed, but the execution never progressed.

### Pain Points

- The LLM regenerated the same tool call indefinitely after approval, consuming tokens and requiring manual termination
- Logs showed `[RESUME] ExecuteGraphton re-invoked` but never `Batch resume from N approval(s)` -- the resume dict was never constructed
- The root cause was masked by a comment in the Go handler claiming "No race condition exists because the Python activity has already returned"

## Solution

The Go handler (`submit_approval.go`) and Java handler (`AgentExecutionSubmitApprovalHandler.java`) were both removing `pending_approvals` from the database before signaling the Temporal workflow. When the workflow re-invoked `ExecuteGraphton`, the Python activity read an empty `pending_approvals` list and could not build the `Command(resume={interrupt_id: decision})` required by LangGraph to resume from the interrupt.

The fix has three layers:

1. **Primary (Go + Java):** Stop removing `pending_approvals` in the approval handler. The step was renamed from `ResolvePendingApprovalStep` to `RecordApprovalDecisionStep` to reflect that it now only records the decision on the ToolCall without deleting the pending entry.

2. **Stale cleanup (Python):** After RESUME_RECONCILE reads `pending_approvals` and builds the resume command, a clear-signal `PendingApproval(tool_call_id="")` is appended so the pre-stream UpdateStatus call triggers the established clear path in the Java/Go handler.

3. **Defense-in-depth (Python):** A checkpoint-based fallback discovers interrupt IDs directly from the LangGraph checkpoint via `aget_state()` when `pending_approvals` is empty but `approval_decisions` is present.

## Implementation Details

### Go Handler (`submit_approval.go`)

- Renamed `resolvePendingApprovalStep` to `recordApprovalDecisionStep`
- Removed all calls to `removePendingApprovalByToolCallId()`
- Removed the now-dead `removePendingApprovalByToolCallId` function and `pendingApprovalHolder` interface
- Preserved ToolCall `approval_action` / `approval_decided_at` updates for immediate UI feedback
- Updated pipeline comments and log messages

### Java Handler (`AgentExecutionSubmitApprovalHandler.java`)

- Renamed `ResolvePendingApprovalStep` to `RecordApprovalDecisionStep`
- Removed all pending_approval removal logic (top-level and sub-agent)
- Removed private helper methods `removePendingApprovalByToolCallId` and `removePendingApprovalFromSubAgent`
- Preserved ToolCall approval recording for UI feedback

### Python (`execute_graphton.py`)

- RESUME_RECONCILE now appends a clear-signal `PendingApproval(tool_call_id="")` after clearing the in-memory list, leveraging the established sentinel pattern in `BuildNewStateWithStatusStep`
- Added a `RESUME_CHECKPOINT_FALLBACK` block that queries `aget_state()` on the LangGraph graph when `pending_approvals` is empty but `approval_decisions` is present

### Unit Tests (`AgentExecutionSubmitApprovalHandlerTest.java`)

- Added `RecordApprovalDecisionStepTests` with 6 tests covering: pending_approvals preservation, ToolCall approval_action setting, DB/Redis persistence, idempotent request handling, DB failure handling, and criticality

## Benefits

- Eliminates the infinite tool-call loop after HITL approval
- LangGraph now receives proper `Command(resume={interrupt_id: decision})` and resumes the interrupted tool node
- The LLM sees the tool result and concludes naturally instead of regenerating
- Defense-in-depth ensures resilience even during deployment transitions

## Impact

- **Agent executions**: All HITL approval flows now complete correctly after user approval
- **Token consumption**: Eliminates wasted LLM cycles from the infinite loop
- **User experience**: Approvals work as expected without manual intervention
- **Architecture**: Corrects a fundamental misconception about the data dependency between the approval handler and the re-invoked Python activity

## Related Work

- `2026-03-26-174359-fix-hitl-approval-stale-idempotency-short-circuit.md` -- Initial approval validation fix
- `2026-03-26-182903-fix-hitl-approval-matching-reconciliation-ui.md` -- Approval matching, reconciliation, and UI fixes

---

**Status**: Production Ready
**Timeline**: Investigation + implementation across one session
