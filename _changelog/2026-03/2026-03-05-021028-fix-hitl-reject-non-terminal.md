# Fix HITL Reject Flow: Non-Terminal Rejection

**Date**: March 5, 2026

## Summary

Changed tool rejection in the human-in-the-loop (HITL) approval flow from a fatal execution error to a non-terminal corrective signal. When a user rejects a tool, the agent now receives a corrective message and adapts its approach instead of the entire execution crashing with `ToolExecutionRejectedError`. This aligns with Cursor-like UX where rejection is feedback to the agent, not a kill switch.

## Problem Statement

When a user rejected a tool during the approval prompt, the execution crashed with a `ToolExecutionRejectedError` that was caught by the generic exception handler and misclassified as a "System error." The CLI then displayed the error 3-4 times redundantly.

### Pain Points

- Rejecting a tool killed the entire agent execution instead of letting the agent adapt
- The error was classified as "System error" with an "Internal system error" message, misleading users
- The CLI rendered the failure at multiple points: phase change, done event, and session summary
- No distinction between a user's deliberate rejection and an actual tool runtime failure
- Rejected tools were not suppressed in the CLI, causing duplicate rendering (approval result + completion event)

## Solution

Redefine the three approval actions as:

| Action | Semantics | Agent Behavior |
|--------|-----------|----------------|
| **Approve** | "Yes, do it" | Tool executes normally |
| **Skip** | "I don't need this" (indifferent) | Agent continues current plan minus this step |
| **Reject** | "This is wrong" (corrective) | Agent re-evaluates and proposes alternative |

Both Skip and Reject are non-terminal. The distinction is the LLM guidance: Skip says "proceed without this," Reject says "reconsider your approach." For stopping execution entirely, users use Cancel/Terminate (separate mechanisms).

## Implementation Details

### Layer 1: Tool Wrappers (`graphton/core/tool_wrappers.py`)

Changed the `reject` branch in `_check_and_handle_approval` from raising `ToolExecutionRejectedError` to returning a corrective message string, matching the pattern used by `skip`. The message explicitly instructs the LLM not to retry the operation and to re-evaluate its approach.

### Layer 2: StatusBuilder (`status_builder.py`)

Changed the `APPROVAL_ACTION_REJECT` handler to set `TOOL_CALL_SKIPPED` (not `TOOL_CALL_FAILED`), write the corrective message into `result` (not `error`), and call `_remove_from_pending()` to let execution continue. Removed the lines that cleared all pending approvals and set phase to `EXECUTION_FAILED`.

### Layer 3: Activity Reconciliation (`execute_graphton.py`)

Updated the reconciliation mapping to map REJECT to `TOOL_CALL_SKIPPED` instead of `TOOL_CALL_FAILED`. Added auto-skip logic: when a REJECT is in the batch, any remaining `WAITING_APPROVAL` tools (from the Go workflow's signal short-circuit) are automatically marked as skipped with an explanatory message.

### Layer 4: Go Workflow (no changes)

The short-circuit on REJECT in the Temporal workflow stays as-is. When a user rejects one tool in a batch, the remaining tools are likely part of the same wrong plan, so we skip collecting signals for them. The activity handles auto-skipping the remaining tools.

### Layer 5: CLI Suppression (`run_stream_inline_approval.go`)

Removed the early return for `action == "reject"` in `trackSuppression`, so rejected tools are now suppressed like approved/skipped tools. This prevents duplicate rendering.

### Layer 6: Tests (`test_tool_wrappers.py`)

Updated tests that expected `ToolExecutionRejectedError` to be raised. They now assert that a rejection message string is returned containing the corrective guidance.

## Benefits

- Agent adapts to rejection instead of crashing
- Clean CLI output: one "Rejected" line, no error cascade
- Skip and Reject are semantically distinct with different LLM guidance
- No proto changes needed: `approval_action` field already distinguishes SKIP from REJECT
- Batch reject auto-skips remaining tools for clean re-planning

## Impact

- **Backend**: agent-runner activities, graphton tool wrappers, status builder
- **CLI**: approval suppression logic
- **User experience**: rejection is collaborative feedback, not a failure mode

## Related Work

- Approval collapse and follow-up prompt UX fixes
- Compact tool rendering improvements
- Terminal cursor control primitives for approval flow

---

**Status**: ✅ Production Ready
