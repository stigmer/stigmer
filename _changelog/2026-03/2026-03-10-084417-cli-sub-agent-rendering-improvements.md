# CLI Sub-agent Rendering Improvements

**Date**: March 10, 2026

## Summary

Overhauled the CLI's sub-agent rendering layer to replace the misleading "Task" label with "Sub-agent", remove defensive fallback chains, display sub-agent input and output in collapsed/expanded views, show sub-agent context in approval prompts, and upgrade the status field from untyped strings to the proto enum for type safety and cancellation support.

## Problem Statement

The CLI rendered sub-agent executions with terminology and behavior that obscured their nature and withheld useful information from the user.

### Pain Points

- The label "Task" (the LangGraph tool name) gave no indication that a sub-agent delegation was happening
- Empty `subject` fields triggered fallback chains (metadata → name) that surfaced misleading or verbose labels
- Sub-agent output was captured by the backend but never shown to the user in any view
- Sub-agent input (the task prompt) was invisible — users couldn't see what was delegated
- Approval prompts from sub-agents looked identical to main-agent approvals, offering no context
- `SubAgentCompletedEvent.Status` was an untyped string, missing the `CANCELLED` state and lacking compile-time safety

## Solution

Six targeted changes across the CLI event pipeline, from event types through rendering:

1. **Label rename (DD-03)**: All four render paths now display "Sub-agent" instead of "Task"
2. **Fallback removal (DD-04)**: `subject` is the single source of truth — no fallback to metadata or name
3. **Typed status enum (Gap 11)**: `SubAgentCompletedEvent.Status` and `subAgentBlock.status` use `agentexecutionv1.SubAgentStatus` directly, with `SUB_AGENT_CANCELLED` rendering as "⊘ Cancelled"
4. **Input display (Gap 6)**: New `Input` field flows from `SubAgentExecution.input` through `SubAgentStartedEvent` to the expanded view as a dimmed "Prompt: ..." line
5. **Output display (Gap 3)**: `block.output` renders in expanded view (dimmed "Result: ...") and collapsed view (truncated dim suffix)
6. **Approval context (Gap 5)**: When an approval originates from a sub-agent, the question is prefixed with `Sub-agent 'name':` so the user knows which agent is requesting

## Implementation Details

### Event Layer (`pkg/executiontui/events.go`)
- `SubAgentStartedEvent` gains `Input string` field
- `SubAgentCompletedEvent.Status` changes from `string` to `agentexecutionv1.SubAgentStatus`
- Added `agentexecutionv1` import

### Bridge Layer (`run_stream_subagent.go`)
- Removed 7-line metadata fallback for `description`; uses `sa.GetSubject()` directly
- Passes `sa.Input` into the started event
- Passes `sa.Status` (enum) directly into the completed event
- Added `SUB_AGENT_CANCELLED` to `isTerminalSubAgentStatus`

### Data Model (`run_stream_inline_types.go`)
- `subAgentBlock.status` changes from `string` to `agentexecutionv1.SubAgentStatus`
- Added `input string` field

### Render Layer
- **`renderSubAgentStarted`**: No fallback; uses `e.Description` directly; stores `e.Input`; label "Sub-agent"
- **`renderSubAgentLine`** (Bubbletea live): Label "Sub-agent"
- **`renderSubAgentBlockItem`**: Label "Sub-agent"; no fallback to `block.name`
- **`renderSubAgentCollapsed`**: Enum switch for status badge; dim output suffix
- **`renderSubAgentExpanded`**: Dimmed "Prompt: ..." line; dimmed "Result: ..." line; enum switch for footer
- **`handleInteractiveApproval`**: Prefixes question with sub-agent name when applicable

### Tool Render (`pkg/toolrender`)
- `toolDisplayMap["task"]` label: `"Task"` → `"Sub-agent"`
- `hasCompactRenderer` and `RenderCompactRunning` updated for new label
- `IsTaskTool` check updated
- Exported `Truncate()` and `DimText()` helpers

### JSON Renderer (`run_stream_json.go`)
- Calls `e.Status.String()` for backward-compatible string output

## Benefits

- **Clarity**: Users see "Sub-agent" and immediately understand delegation is happening
- **Visibility**: Input and output are surfaced in both compact and expanded views
- **Approval safety**: Users know which sub-agent is requesting approval before deciding
- **Type safety**: Compile-time enforcement of status values; new `CANCELLED` state rendered correctly
- **Simplicity**: Removal of fallback chains means one display path, fewer surprises

## Impact

- All CLI users see the new "Sub-agent" label instead of "Task" in live rendering, collapsed blocks, and expanded views
- JSON output consumers see `SUB_AGENT_COMPLETED` / `SUB_AGENT_FAILED` / `SUB_AGENT_CANCELLED` strings instead of `completed` / `failed`
- 16 source files modified, 17 test assertions updated across 5 test files
- No proto or backend changes — purely CLI-layer

## Related Work

- [2026-03-10 Sub-agent execution proto enhancements](2026-03-10-040540-sub-agent-execution-proto-enhancements.md) — PR1 proto layer
- [2026-03-10 Sub-agent subject simplification and approval dual-surfacing](2026-03-10-043512-sub-agent-subject-simplification-and-approval-dual-surfacing.md) — PR2 runner layer
- [2026-03-10 Sub-agent lifecycle hardening](2026-03-10-082456-sub-agent-lifecycle-hardening.md) — PR3 runner layer
- [2026-03-07 Collapsed sub-agent blocks](2026-03-07-005317-collapsed-sub-agent-blocks.md) — original sub-agent block rendering

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~45 min)
