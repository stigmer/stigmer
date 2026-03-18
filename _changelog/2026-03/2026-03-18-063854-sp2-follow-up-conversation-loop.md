# SP2: Follow-Up Conversation Loop

**Date**: March 18, 2026

## Summary

Added the follow-up conversation loop to the session view, enabling users to send additional messages within the same session. Delivered as an SDK behavior hook (`useSessionConversation`), an SDK styled component (`FollowUpInput`), and optimistic message support in `MessageThread`. The Console's `SessionPage` is now a thin orchestration shell consuming these SDK primitives.

## Problem Statement

After SP1, the session view was read-only. Users could see the initial conversation thread with streaming, tool call summaries, and phase badges, but had no way to continue the conversation. The session launcher created a session and navigated to it, but there was no input component on the session page.

### Pain Points

- Users could not send follow-up messages after the initial session creation
- The session view was a dead end — view-only, no interaction
- Platform builders embedding Stigmer would need to reimplement the full conversation orchestration (~40 lines of non-trivial hook composition) themselves

## Solution

Built the conversation loop as three SDK primitives consumed by the Console:

1. **`FollowUpInput`** — SDK styled component: auto-resizing textarea with optional `ModelSelector`, Enter/Shift+Enter keyboard handling, inline SVG icons, auto-focus on re-enable
2. **`useSessionConversation`** — SDK behavior hook: composes `useSession`, `useSessionExecutions`, `useCreateAgentExecution`, and `useExecutionStream` into a single conversation lifecycle API
3. **`pendingUserMessage` prop on `MessageThread`** — Optimistic user message rendering at reduced opacity before the stream delivers real data

## Implementation Details

### FollowUpInput (`sdk/react/src/execution/FollowUpInput.tsx`)

- Props: `onSubmit`, `isSubmitting`, `disabled`, `showModelSelector`, `defaultModelId`, `onModelChange`, `className`
- Uses `<div>` not `<form>` (embeddable inside host forms, decision #23)
- Inline SVG icons (no `lucide-react` — follows SDK pattern)
- Auto-focus when `disabled` transitions `true` -> `false`

### useSessionConversation (`sdk/react/src/session/useSessionConversation.ts`)

- `pendingExecutionId` state: after `createExecution` returns, immediately start streaming without waiting for list refetch
- `pendingUserMessage` state: set on submit, cleared when stream delivers first snapshot
- `canSendFollowUp = !isSending && activeExecutionId === null` — sequential follow-ups only
- Stream-to-fetch fallback preserved from SP1
- Re-exports `streamError` and `reconnectStream` so consumers don't need separate hooks

### MessageThread Enhancement

- New optional `pendingUserMessage?: string | null` prop
- Extended `ThreadItem` discriminated union with `pending-message` kind
- Rendered as a HumanMessage at 70% opacity to signal "sending"
- Additive — existing consumers see zero difference

### SessionPage Rewrite

- Replaced ~40 lines of inline hook composition with `useSessionConversation(id, org)`
- Added `FollowUpInput` at the bottom of the page
- Extracted `usePersistedModel()` for localStorage model persistence
- Page is now ~60 lines including all sub-components

## Benefits

- Users can continue conversations within the same session
- Platform builders get the full conversation loop via one hook + one component
- Optimistic message display eliminates the 200-500ms feedback gap
- SessionPage reduced from orchestration-heavy to a thin shell
- Sequential follow-up pattern matches CLI behavior for predictable UX

## Impact

- **SDK surface**: +1 hook (`useSessionConversation`), +1 component (`FollowUpInput`), +1 prop on `MessageThread`
- **Files**: 2 new, 5 modified
- **Lines**: ~300 lines of new/changed code
- **Console**: `SessionPage` simplified from ~78 lines to ~60 lines while gaining follow-up capability

## Related Work

- **SP1 (Core Thread + Streaming)**: Foundation that SP2 builds on — hooks, components, and streaming infrastructure
- **SP3 (Session Context Panel)**: Independent of SP2, can proceed next
- **SP4 (Expandable Tool Groups)**: Independent of SP2, can proceed next
- **SP5 (HITL Approvals)**: Depends on SP4

---

**Status**: Production Ready
**Timeline**: Single session (~1 hour)
