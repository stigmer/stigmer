# Agent-Powered Workflow Execution Diagnosis

**Date**: May 15, 2026

## Summary

Replaced the stubbed `useDiagnoseExecution` hook with a fully functional `useDiagnoseExecutionFlow` behavior hook that leverages the Workflow Architect system agent for streaming, multi-turn diagnosis of failed workflow executions. The `WorkflowRepairCard` component was rewritten from a simple loading/result card into a conversational streaming panel with `MessageThread`, diff previews, and follow-up input. Both web and desktop consoles now wire the required props for diagnosis to appear.

## Problem Statement

After Batch 1A removed the direct-LLM diagnosis RPC, the `useDiagnoseExecution` hook was left as a stub that always threw an error. Users viewing failed workflow executions had no AI-powered diagnosis capability — the "Diagnose" button either didn't appear (web, due to missing `org`) or produced an immediate error (desktop).

### Pain Points

- Failed workflow executions had no automated root-cause analysis
- The "Diagnose" button was invisible in the web console (missing `org` prop)
- Neither console wired `onNavigateToWorkflowEditor`, so "Apply Fix" couldn't navigate
- The old `WorkflowRepairCard` was a single-shot loading spinner with no streaming visibility
- No multi-turn follow-up capability — users couldn't ask clarifying questions after diagnosis

## Solution

Implemented Batch 5 of the agent-powered workflow generation rewrite, creating an agent-powered diagnosis flow that mirrors the refine pattern established in Batch 4:

1. **New behavior hook** (`useDiagnoseExecutionFlow`) — auto-starts on mount, creates a Session with the `workflow-architect` agent, streams diagnosis in real-time, extracts YAML fixes via `extractWorkflowYaml`, supports multi-turn follow-ups
2. **Rewritten component** (`WorkflowRepairCard`) — conversational streaming UI with MessageThread, result strip with diff/apply, runtime error notices, and follow-up composer
3. **Layout upgrade** — execution viewer sidebar expands from fixed `w-64` to `w-[40%]` when diagnosis is active
4. **Client app wiring** — both web and desktop pass `org` and `onNavigateToWorkflowEditor`

## Implementation Details

### New: `useDiagnoseExecutionFlow.ts`

Behavior hook following the exact same infrastructure as `useRefineWorkflowFlow`:
- `useCreateSession` → `useCreateAgentExecution` → `useExecutionStream` + `ConversationStore`
- Phase model: `idle | starting | streaming | complete | ready | error`
- Auto-starts via `useEffect` on mount (AD-B5-002) — no intermediate confirmation
- Terminal detection triggers `extractWorkflowYaml()` — YAML presence = definition fix, absence = runtime error
- Multi-turn: follow-ups reuse the same Session for conversational context
- Referentially stable returns via `useMemo` (DD-010)

### Rewrite: `WorkflowRepairCard.tsx`

From single-shot loading card to streaming conversational panel:
- Header with streaming indicator
- `MessageThread` showing all turns (completed + active execution)
- Result strip: explanation, unified diff preview, "Apply Fix" / "Discard" buttons
- Runtime error notice when no YAML fix is suggested
- Follow-up composer (pinned bottom) for multi-turn questions
- Props contract preserved (AD-B5-005)

### Modify: `WorkflowExecutionViewer.tsx`

Conditional layout (AD-B5-001):
- `showDiagnosis` active: aside expands to `w-[40%] min-w-[360px] max-w-[500px]`, task/cost/artifact panels are replaced (not nested)
- `showDiagnosis` inactive: standard `w-64` sidebar with all panels

### Client App Wiring (DD-016 Parity)

- **Web**: Sources `org` from `useActiveOrgSlug()`, adds `onNavigateToWorkflowEditor` navigating to `/workflows/${org}/${slug}`
- **Desktop**: Adds `onNavigateToWorkflowEditor` using React Router's `navigate()`

## Benefits

- **Immediate AI diagnosis** on failed executions — agent autonomously fetches execution events and analyzes root cause
- **Streaming visibility** — users see the agent working in real-time (tool calls, reasoning)
- **Multi-turn conversations** — "what about task X?" after initial analysis
- **Apply Fix workflow** — when the agent suggests a YAML fix, users see a diff and can navigate directly to the editor
- **Consistent patterns** — same infrastructure as generate (Batch 3) and refine (Batch 4)

## Impact

- **SDK consumers**: New `useDiagnoseExecutionFlow` hook available for headless diagnosis (DD-003)
- **Platform builders**: `WorkflowRepairCard` works identically with same props, but now powered by streaming agent
- **End users (web)**: "Diagnose" button now appears on failed executions (previously invisible due to missing `org`)
- **End users (desktop)**: Diagnosis actually works instead of throwing a stub error

## Related Work

- Batch 1A: Proto cleanup + backend teardown (Session 1)
- Batch 2: Workflow Architect MCP tools + seedpack agent (Session 2)
- Batch 3: SDK + Frontend — Generate (Session 3)
- Batch 4: SDK + Frontend — Refine (Session 4)
- Changelog: `_changelog/2026-05/2026-05-15-132017-workflow-architect-refine-panel.md`

---

**Status**: Production Ready
**Timeline**: ~30 minutes (implementation + verification)
