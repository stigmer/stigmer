# Workflow Architect — Agent-Powered Refine Panel

**Date**: May 15, 2026

## Summary

Replaced the stubbed `useRefineWorkflowFlow` hook and `WorkflowRefinePanel` component with an agent-powered refinement flow using the built-in Workflow Architect system agent. The refine panel now supports multi-turn conversations with real-time streaming, YAML extraction with diff preview, and iterative refinement within a single session — replacing the old direct-LLM request/response model that was removed in Batch 1A.

## Problem Statement

After Batch 1A removed the direct-LLM workflow generation infrastructure (3 RPCs, ~3,800 lines), the workflow refinement feature was left as a non-functional stub. The `useRefineWorkflowFlow` hook threw runtime errors and the `WorkflowRefinePanel` displayed a permanent "being rebuilt" message. Users had no way to refine workflows with AI from the editor.

### Pain Points

- Clicking "Refine" in the workflow editor showed an error message instead of working
- The old request/response model (spinner → result) provided no visibility into what the AI was doing
- No conversational context was preserved between refinement instructions
- The agent infrastructure from Batch 2 (MCP tools, seedpack agent) was ready but not wired to the frontend

## Solution

Rewrote the refinement flow as an agent-powered multi-turn conversation that reuses the same streaming infrastructure established in Batch 3's generate dialog. The Workflow Architect agent (with Refine Mode) handles the actual refinement, using MCP tools to validate and iterate.

## Implementation Details

### Behavior Hook: `useRefineWorkflowFlow` (complete rewrite)

- **Session management**: Lazy session creation on first instruction, persisted across turns via ref
- **Multi-turn execution**: Each instruction creates a new AgentExecution within the same Session, preserving conversational context
- **Streaming**: Composes `useCreateSession` → `useCreateAgentExecution` → `useExecutionStream` + `ConversationStore`
- **YAML extraction**: Reuses `extractWorkflowYaml()` to parse YAML from agent responses
- **Smart YAML delivery**: Captures `currentYaml` at send-time (ref-based, not reactive). Only includes YAML in the message when it differs from the last-sent version, avoiding redundant context
- **Phase model**: `idle | starting | streaming | complete | ready | error` — with `ready` handling both "agent asked a clarifying question" and "user accepted/discarded a result"
- **Reference stability**: All return values wrapped in `useMemo`, callback refs via `useRef` (DD-010)

### Styled Component: `WorkflowRefinePanel` (layout rewrite)

Transitioned from spinner-based to conversational layout:
1. **Header** with streaming status indicator
2. **MessageThread** showing all turns (completed executions + active stream)
3. **Result strip** with diff preview and accept/discard buttons (appears when YAML extracted)
4. **Composer** pinned to bottom with textarea and send button

### Barrel Exports: `workflow/index.ts` + root `index.ts`

- Removed old types: `RefineWorkflowFlowResult`, `RefinementHistoryEntry`
- Added new types: `RefinePhase`, updated `UseRefineWorkflowFlowOptions`, `UseRefineWorkflowFlowReturn`
- Preserved `WorkflowRefinePanelProps` interface (unchanged)

### Key Design Decisions

- **AD-B4-001**: Separate `useRefineWorkflowFlow` hook (not shared with generate) — different lifecycle concerns
- **AD-B4-002**: Session-per-panel-instance — no generation session reuse, simpler wiring, works standalone
- **AD-B4-003**: Multi-turn conversation with `MessageThread` — replaces the old history/spinner/result UI
- **AD-B4-004**: Props interface preservation — `WorkflowEditorView` requires zero changes
- **RD-2**: YAML captured at send-time via ref with smart diffing
- **RD-3**: YAML-absence as the signal for clarifying questions (no special detection needed)
- **RD-4**: Inline YAML for V1, attachment-based delivery tracked as future optimization

## Benefits

- Workflow refinement is functional again after the Batch 1A teardown
- Real-time streaming shows the agent working (tool calls, validation, iteration)
- Multi-turn conversational context means the agent remembers prior instructions
- Diff preview shows exactly what changed before the user accepts
- The agent can ask clarifying questions and the user can respond naturally
- No changes needed to `WorkflowEditorView` or either client app (DD-016 parity)

## Impact

- **SDK consumers**: `useRefineWorkflowFlow` has a new API shape (breaking change from the stub types, but the stub was never functional)
- **Platform builders**: `WorkflowRefinePanelProps` is unchanged — drop-in compatible
- **End users**: Can refine workflows through conversation with the Workflow Architect agent

## Related Work

- Batch 1A: Proto cleanup + backend teardown (2026-05-15-103720)
- Batch 2: Workflow Architect MCP tools + seedpack agent (2026-05-15-115202)
- Batch 3: SDK + Frontend — Generate dialog (2026-05-15-122724)
- Next: Batch 5 — SDK + Frontend — Diagnose

---

**Status**: ✅ Production Ready
**Files Changed**: 4 (427 insertions, 154 deletions)
