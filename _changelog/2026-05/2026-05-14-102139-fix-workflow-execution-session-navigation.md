# Fix: Workflow Execution to Agent Session Navigation

**Date**: May 14, 2026

## Summary

Fixed broken navigation from the WorkflowExecutionViewer's "View execution" drill-down to the agent's parent session page. The fix introduces an SDK resolution hook that maps agent execution IDs to session IDs before navigating, ensuring both web and desktop consoles land on the correct session page.

## Problem Statement

When a workflow invokes an agent task (via `llm_call` or `agent_call`), the WorkflowExecutionTimeline displays an `agentCallStarted` event with a "View execution" link. Clicking this link was broken in both client apps.

### Pain Points

- **Web**: Navigated to `/sessions?execution=aex_...` -- a query string parameter that `SessionNavigationProvider` never reads. Users landed on an empty session launcher with no session loaded.
- **Desktop**: Navigated to `/sessions/aex_...` -- passing an agent execution ID (`aex_*`) into a route that expects a session ID (`ses_*`). `useSessionPageFlow` attempted to load a non-existent session resource, resulting in a 404 error.
- **Unified `/executions/[id]` route**: For `aex_*` IDs, redirected to the same broken `/sessions?execution=` URL.

## Solution

Two-layer fix following the SDK-first architecture (DD-001, DD-004):

1. **SDK resolution hook** (`useResolveAgentExecutionSession`): Fetches the `AgentExecution` resource by ID and extracts `spec.sessionId`. This is a pure SDK behavior hook with no framework dependencies.
2. **Client app wiring**: Both web and desktop store the clicked `aex_*` ID in local state, pass it to the resolution hook, and navigate to the resolved session ID via their platform-appropriate navigation mechanism.

## Implementation Details

### New SDK Hook

`sdk/react/src/workflow/useResolveAgentExecutionSession.ts` -- follows the established `useFetch` pattern from `useWorkflowExecution`. Accepts `agentExecutionId: string | null` (null skips fetching), returns `{ sessionId, isLoading, error }`.

### Web Console

- `WorkflowExecutionDetailPage.tsx`: Uses `useSessionNavigation().navigateToSession()` for proper session-zone navigation (respects `SessionNavigationProvider` state machine).
- `executions/[id]/page.tsx`: For `aex_*` IDs, resolves to session ID before navigating (replaces broken query string redirect).

### Desktop App

- `WorkflowExecutionDetailPage.tsx`: Uses `navigate(/sessions/${sessionId}, { replace: true })` with the resolved session ID.

### Loading UX

A floating indicator pill ("Navigating to session...") appears centered above the workflow execution viewer during the brief resolution (~100-300ms). No full-page overlay -- the viewer remains visible and non-disruptive.

### DD-016 Parity

Both client apps use the identical pattern: `pendingAgentExecutionId` state -> `useResolveAgentExecutionSession` hook -> effect-based navigation on resolution. The only difference is the platform-appropriate navigation call.

## Benefits

- Users can now drill down from workflow execution events to the agent's session page
- Navigation uses the correct domain model relationship (`AgentExecution.spec.session_id`)
- Both web and desktop have identical behavior (DD-016 compliance)
- Resolution hook is reusable by platform builders embedding workflow components

## Impact

- **Users**: Workflow execution "View execution" links now work correctly
- **Platform builders**: New `useResolveAgentExecutionSession` hook exported from `@stigmer/react` for custom navigation patterns
- **Codebase**: Zero new framework dependencies, follows established SDK patterns

## Related Work

- T09: Workflow Execution Viewer (created the `onNavigateToAgentExecution` callback)
- T14: Dashboard Integration + Desktop Parity (established DD-016 parity pattern)
- T15: Visual Canvas Editor (prior batch on this branch)

---

**Status**: Production Ready
**Files**: 1 new, 5 modified
