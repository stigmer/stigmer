# Human Input Prompt Context Propagation

**Date**: May 28, 2026

## Summary

Fixed a three-layer bug preventing workflow-level human_input tasks from showing meaningful context to the reviewer. The `team_lead_review` step in the daily-notification-plan workflow now displays the full compiled plan as rich markdown directly in the inspector panel's Approval tab when clicked.

## Problem Statement

When a workflow reaches a `human_input` task (e.g., `team_lead_review`), the reviewer should see what they're approving. Instead, they saw an empty approval card with just "Approve" / "Reject" buttons and no context.

### Pain Points

- The Java callback never included `final_text` (the agent's raw text output) in the result JSON
- The runner emitted the human_input prompt template with unresolved `${ ... }` expressions
- The approval card component didn't render the prompt text
- The inspector panel's Approval tab only handled agent tool approvals, not workflow-level human_input approvals

## Solution

Four coordinated fixes across the Java service, TypeScript runner, and React SDK:

1. **Java service**: Extract and include `final_text` in the async activity callback result
2. **Runner**: Resolve `${ ... }` expressions in the human_input prompt before event emission
3. **UI card**: Accept and render a `prompt` prop as markdown content
4. **Inspector panel**: Wire the `WorkflowTaskApprovalCard` into the inspector's Approval tab

## Implementation Details

### Fix 1: Java — `buildCallbackResultJson` (stigmer-cloud)

Added `extractLastAiMessageContent()` to read the last `MESSAGE_AI` message from the agent execution's status and include it as `"final_text"` in the callback JSON. Added `escapeJsonString()` for safe JSON string serialization.

**File**: `InvokeAgentExecutionWorkflowImpl.java`

### Fix 2: Runner — Expression Resolution (stigmer)

Added `resolvePromptExpressions()` in `human-input.ts` that handles both strict (whole-value `${ expr }`) and embedded (inline fragment) expression patterns against the workflow state, using the same `resolveEmbeddedExpressions` utility as agent_call tasks.

**File**: `backend/services/runner/src/workflow-engine/tasks/human-input.ts`

### Fix 3: UI — Approval Card Prompt Rendering (stigmer)

Added optional `prompt` prop to `WorkflowTaskApprovalCard` that renders as a scrollable markdown block above the decision form. Uses `react-markdown` with `MARKDOWN_COMPONENTS` for consistent styling.

**Files**: `sdk/react/src/workflow/WorkflowTaskApprovalCard.tsx`, `WorkflowExecutionTimelineEvent.tsx`

### Fix 4: Inspector — Approval Tab for Human Input Tasks (stigmer)

Extended `ExecutionInspector` with `onSubmitTaskApproval` and `isSubmittingTaskApproval` props. Updated `buildVisibleTabs` to show the Approval tab when `detail.approval` exists. Renders `WorkflowTaskApprovalCard` in the panel when a human_input task is selected.

**Files**: `sdk/react/src/workflow/execution-inspector/ExecutionInspector.tsx`, `WorkflowExecutionViewer.tsx`

## Benefits

- Reviewer sees the full agent-generated plan (as markdown) directly in the inspector panel
- No scrolling through events to find the approval action
- The Approval tab auto-selects when clicking a human_input node in the graph
- Works for any workflow that uses the `human_input` task kind with prompt context

## Impact

- All workflows using `human_input` tasks will now properly display their prompt context
- The `final_text` field on agent_call output (documented in the task-kind-registry) is now actually populated
- Expression resolution in human_input prompts follows the same pattern as agent_call messages

## Related Work

- Task-kind-registry already documented `final_text` as part of agent_call's `outputJsonSchema`
- The `AgentCallResult.final_text` TypeScript type was already declared but never populated
- The inspector's `deriveAutoTab` already navigated to the Approval tab on `waiting_approval` status

---

**Status**: Production Ready
**Timeline**: Single session
