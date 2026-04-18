---
name: Fix HITL Reject Flow
overview: "Make tool rejection non-terminal: instead of failing the entire execution, return a corrective message to the LLM so the agent can adapt and continue. Fix the cascading error display in the CLI."
todos:
  - id: tool-wrappers
    content: "Layer 1: Change reject handler in tool_wrappers.py to return a corrective message instead of raising ToolExecutionRejectedError"
    status: completed
  - id: status-builder
    content: "Layer 2: Change REJECT branch in StatusBuilder.set_tool_approval_decision to use TOOL_CALL_SKIPPED and stay non-terminal"
    status: completed
  - id: reconciliation
    content: "Layer 3: Update reconciliation mapping in execute_graphton.py (REJECT -> SKIPPED) and add auto-skip for remaining WAITING_APPROVAL tools"
    status: completed
  - id: cli-suppression
    content: "Layer 5: Fix trackSuppression in run_stream_inline_approval.go to suppress rejected tools (prevent duplicate rendering)"
    status: completed
  - id: tests
    content: "Layer 6: Update tool_wrappers tests to expect returned message instead of raised exception on reject"
    status: completed
isProject: false
---

# Fix Human-in-the-Loop Reject Flow

## Problem Summary

When a user rejects a tool in the approval prompt, the execution crashes with `ToolExecutionRejectedError` treated as a system error. The CLI then shows the error 3-4 times redundantly. The user expects Cursor-like behavior: the agent is told about the rejection and adapts its approach.

**Root cause chain:**

1. Tool wrapper raises `ToolExecutionRejectedError` on reject (exception, not control flow)
2. Exception escapes the LangGraph streaming loop
3. Generic `except Exception` handler catches it, classifies it as "System error"
4. Execution phase set to `EXECUTION_FAILED`
5. CLI renders failure at multiple points: phase change, done event, session summary

## Design Decision

**Skip** and **Reject** are both non-terminal. Both mean "tool did not execute." They differ in the message sent to the LLM:

- **Skip**: "Tool skipped. Proceed with your plan." (indifferent -- agent continues current plan)
- **Reject**: "Tool rejected. User does not want this. Reconsider your approach." (corrective -- agent re-evaluates)

**No proto changes.** Use `TOOL_CALL_SKIPPED` for both. The `approval_action` field on `ToolCall` already stores `APPROVAL_ACTION_REJECT` vs `APPROVAL_ACTION_SKIP`, and the CLI already uses this for differentiated rendering (red bullet + "Rejected" vs dim bullet + "Skipped").

**For "stop everything":** Users use Cancel/Terminate (separate from approval flow).

**Batch behavior:** When one tool in a pending batch is rejected, the Go workflow short-circuits (keeps current behavior). The activity auto-skips any remaining `WAITING_APPROVAL` tools that have no decision.

---

## Layer 1: Tool Wrappers -- Return Message Instead of Exception

**File:** `[backend/libs/python/graphton/src/graphton/core/tool_wrappers.py](backend/libs/python/graphton/src/graphton/core/tool_wrappers.py)`

Change the `reject` branch in `_check_and_handle_approval` (lines 843-848) from raising `ToolExecutionRejectedError` to returning a rejection message, matching the pattern used by `skip` (lines 835-841):

```python
elif action == "reject":
    reject_message = (
        f"Tool '{tool_name}' was REJECTED by the user. "
        "The user has explicitly indicated they do not want this operation. "
        "Do NOT retry this exact operation. "
        "Re-evaluate your approach and propose an alternative."
    )
    logger.info(f"❌ {reject_message}")
    return reject_message
```

Also change the `else` (unknown action) branch (lines 854-863) to return a rejection message instead of raising.

`ToolExecutionRejectedError` class remains in the codebase for now (tests reference it, and it does no harm as dead code). Can be cleaned up in a follow-up.

---

## Layer 2: StatusBuilder -- Reject is Non-Terminal

**File:** `[backend/services/agent-runner/worker/activities/graphton/status_builder.py](backend/services/agent-runner/worker/activities/graphton/status_builder.py)`

Change the `APPROVAL_ACTION_REJECT` branch in `set_tool_approval_decision` (lines 2114-2129) to match the Skip pattern instead of failing the execution:

```python
elif action == ApprovalAction.APPROVAL_ACTION_REJECT:
    tool_call.status = ToolCallStatus.TOOL_CALL_SKIPPED
    tool_call.result = (
        f"Tool '{tool_call.name}' was REJECTED by the user. "
        "The user has explicitly indicated they do not want this operation. "
        "Do NOT retry this exact operation. "
        "Re-evaluate your approach and propose an alternative."
    )
    tool_call.completed_at = timestamp
    self._remove_from_pending(run_id)
```

Key changes:

- `TOOL_CALL_SKIPPED` instead of `TOOL_CALL_FAILED`
- Corrective message in `result` instead of generic error in `error`
- **Remove** the lines that clear all pending approvals and set phase to `EXECUTION_FAILED`
- Call `_remove_from_pending(run_id)` which naturally restores phase when pending list empties

---

## Layer 3: Activity Reconciliation -- Reject Maps to SKIPPED

**File:** `[backend/services/agent-runner/worker/activities/execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)`

**Change 1** (line 2361): Update the reconciliation mapping:

```python
_approval_to_tool_status = {
    ApprovalAction.APPROVAL_ACTION_APPROVE: ToolCallStatus.TOOL_CALL_RUNNING,
    ApprovalAction.APPROVAL_ACTION_SKIP: ToolCallStatus.TOOL_CALL_SKIPPED,
    ApprovalAction.APPROVAL_ACTION_REJECT: ToolCallStatus.TOOL_CALL_SKIPPED,  # was FAILED
}
```

**Change 2** (after line 2394): Auto-skip remaining `WAITING_APPROVAL` tools that have no decision (these are the tools the workflow skipped collecting signals for after the REJECT short-circuit):

```python
has_reject = any(
    d.action == ApprovalAction.APPROVAL_ACTION_REJECT
    for d in approval_decisions
)
if has_reject:
    for tc in status_builder.current_status.tool_calls:
        if tc.status == ToolCallStatus.TOOL_CALL_WAITING_APPROVAL:
            tc.status = ToolCallStatus.TOOL_CALL_SKIPPED
            tc.approval_action = ApprovalAction.APPROVAL_ACTION_SKIP
            tc.approval_decided_at = _utc_timestamp()
            tc.result = (
                f"Tool '{tc.name}' was automatically skipped because "
                "another tool in this batch was rejected by the user."
            )
```

---

## Layer 4: Go Workflow -- No Changes Required

**File:** `[backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go](backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go)`

The short-circuit on REJECT (lines 282-287) stays as-is. It still makes sense: when a user rejects one tool in a batch, the remaining tools are likely part of the same wrong plan, so we don't need to prompt for them individually. The activity handles auto-skipping the remaining tools (Layer 3, Change 2).

The workflow loop (`for finalStatus.GetPhase() == EXECUTION_WAITING_FOR_APPROVAL`) also works correctly: the activity now returns `EXECUTION_IN_PROGRESS` (or `EXECUTION_COMPLETED` if the agent finishes) instead of `EXECUTION_FAILED`, so the loop continues or exits naturally.

---

## Layer 5: CLI -- Fix Duplicate Rendering for Rejected Tools

**File:** `[client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go](client-apps/cli/cmd/stigmer/root/run_stream_inline_approval.go)`

The `trackSuppression` function currently returns early for `action == "reject"`, which means rejected tools are NOT added to `suppressedToolIDs`. This causes a duplicate: the approval flow renders "Rejected" (red bullet), then a later `ToolCompletedEvent` renders the same tool again.

Fix: apply the same suppression logic for rejected tools as for approved/skipped tools. Find the early return for `action == "reject"` and remove it, letting rejected tools fall through to the suppression tracking.

No changes needed in:

- `render_approval.go` -- already renders reject correctly (red bullet + "Rejected")
- `run_display_tools.go` -- `mapToolCallStatus` maps SKIPPED to "skipped"; the approval rendering handles the "Rejected" display
- Error display paths -- with reject being non-terminal, `EXECUTION_FAILED` phase is never set, so the triple-error display disappears naturally

---

## Layer 6: Tests

**File:** `[backend/libs/python/graphton/tests/core/test_tool_wrappers.py](backend/libs/python/graphton/tests/core/test_tool_wrappers.py)`

Update tests that expect `ToolExecutionRejectedError` to be raised on reject. They should now assert that a rejection message string is returned (matching the skip test pattern).

---

## Verification

After implementation, the reject flow should produce this CLI output:

```
Do you want to create agent-fleet/mcp-servers/planton.yaml?
> Reject

● Write(agent-fleet/mcp-servers/planton.yaml)
  └ Rejected

[Agent adapts: "The user rejected the file creation. Let me ask what
changes they'd like, or try a different approach..."]
```

No "Execution failed", no "System error", no duplicate tool rendering.