# Unified SessionComposer Component

**Date**: March 18, 2026

## Summary

Unified the home page session launcher input and the in-session follow-up input into a single `SessionComposer` component in `@stigmer/react`. Added workspace editing support in follow-up messages via a new `useUpdateSession` hook and extended `useSessionConversation` to support session-level workspace updates.

## Problem Statement

The codebase had two separate input implementations with ~80% behavioral overlap: `SessionLauncher` (home page, raw textarea + model selector + workspace editor) and `FollowUpInput` (session page, textarea + model selector, no workspace). Workspace entries were only configurable at session creation and displayed read-only in the session page's right sidebar. Users could not add or remove workspaces during a conversation.

### Pain Points

- Duplicated textarea behavior (auto-resize, Enter-to-submit, keyboard handling)
- Workspace editing unavailable in follow-up context
- No `useUpdateSession` hook despite the backend supporting `session.update()` RPC
- `WorkspaceSummary` in right sidebar was read-only, disconnected from the input flow

## Solution

Created a layered architecture following the SDK-first principle:

1. **`useComposer`** -- headless behavior hook (textarea state, auto-resize, keyboard handling)
2. **`SessionComposer`** -- styled component composing `useComposer` + `ModelSelector` + `WorkspaceEditor`
3. **`useUpdateSession`** -- React hook wrapping the existing `session.update()` SDK method
4. Extended `useSessionConversation` with workspace entries exposure and update-on-follow-up

## Implementation Details

### New Files (SDK)

- `sdk/react/src/composer/useComposer.ts` -- Pure behavior hook with `textareaProps` spread pattern for zero-glue embedding
- `sdk/react/src/composer/SessionComposer.tsx` -- Unified input card with model selector, workspace editor, and send button. Layout-agnostic (consumer controls centering vs bottom-pinning via `className`)
- `sdk/react/src/composer/index.ts` -- Barrel export
- `sdk/react/src/session/useUpdateSession.ts` -- Wraps `session.update()` with loading/error state

### Modified Files (SDK)

- `useSessionConversation` -- Added `workspaceEntries` to return type, extended `sendFollowUp` to accept optional `WorkspaceEntryInput[]`, calls `session.update()` before execution creation when workspace changes
- `FollowUpInput` -- Marked `@deprecated` pointing to `SessionComposer`

### Modified Files (Console)

- `SessionLauncher.tsx` -- Replaced 70+ lines of inline textarea/controls with `<SessionComposer>`. From 217 lines to 130 lines.
- `SessionPage.tsx` -- Replaced `<FollowUpInput>` with `<SessionComposer>`, removed `WorkspaceSummary` from right sidebar, added workspace state initialization from session proto entries

## Benefits

- Single component for all message input contexts (launcher, follow-up, future variants)
- Workspace editing available in follow-up messages (session-level update via existing backend RPC)
- Headless `useComposer` hook for platform builders who want custom UI
- `SessionComposer` works identically in the Stigmer Console and third-party embeddings
- Extensible toolbar pattern for future context attachments (MCP servers, skills, file attachments)

## Impact

- **Platform builders**: New `SessionComposer` and `useComposer` exports in `@stigmer/react`
- **Console**: Both home page and session page now use the same input component
- **Backward compat**: `FollowUpInput` deprecated but not removed; `WorkspaceSummary` still available for read-only contexts

## Related Work

- Session page redesign project (20260318.03.session-page-redesign)
- Session context composition project (20260318.01.session-context-composition)

---

**Status**: Production Ready
