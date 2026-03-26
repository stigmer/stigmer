# Execution Setup Progress Indicator

**Date**: March 26, 2026

## Summary

Added an animated inline setup progress indicator to the message thread that communicates what the system is doing during the execution `PENDING` phase. Previously, after sending a message, the UI showed nothing while the backend provisioned the sandbox, cloned repositories, loaded skills, and connected MCP servers — a "black box" that could last 10-60+ seconds. Now users see contextual, rotating status messages ("Initializing execution...", "Setting up workspace...", "Preparing agent environment...") in the exact position where the AI response will eventually appear.

## Problem Statement

When a user triggers an agent execution, the backend goes through an extensive setup sequence: sandbox provisioning (Daytona), git repository cloning, environment variable merging, skill installation, attachment downloads, and MCP server connection. This setup is tracked internally via Temporal heartbeats (`heartbeat_during_setup`) but none of that progress reached the UI.

### Pain Points

- The message thread showed the user's message and then nothing — complete silence during setup
- The sidebar showed a static "Pending" dot that did not convey activity
- Users (even developers familiar with the platform) could not distinguish between "system is working" and "system is stuck"
- The `useExecutionStream` hook had an `isConnecting` flag, but `useSessionConversation` did not expose it to consumers
- Platform builders embedding `<MessageThread />` inherited the same black-box experience

## Solution

A frontend-only Phase 1 approach: use the execution phase (`PENDING`) and session configuration to render a time-based contextual indicator. No backend or proto changes required. The indicator derives its messaging from the session's workspace entries — sessions with git repos see workspace-specific messages, while plain sessions see generic preparation messages.

## Implementation Details

### New component: `SetupProgress` (`@stigmer/react`)

- **File**: `sdk/react/src/execution/SetupProgress.tsx`
- Renders a pulsing dot + rotating status message
- Derives step sequence from `workspaceEntries` prop (git repos trigger workspace-specific messaging)
- Time-based progression (~4s per step): "Initializing execution..." → "Setting up workspace..." → "Preparing agent environment..." → "Almost ready..."
- Uses `--stgm-*` tokens; zero hardcoded values

### MessageThread integration

- **File**: `sdk/react/src/execution/MessageThread.tsx`
- Added `setup-progress` variant to the `ThreadItem` discriminated union
- `buildThreadItems` inserts the indicator when: active stream execution is non-null, phase is `PENDING` or `UNSPECIFIED`, and no AI messages exist yet
- New `hasAiMessages()` helper ensures the indicator disappears the instant the first AI content arrives

### ExecutionPhaseBadge animation

- **File**: `sdk/react/src/execution/ExecutionPhaseBadge.tsx`
- Changed `EXECUTION_PENDING` icon from static `DotIcon` to animated `PulseDotIcon`
- Consistent with `EXECUTION_IN_PROGRESS` which already uses the pulsing pattern

### `useSessionConversation` API gap

- **File**: `sdk/react/src/session/useSessionConversation.ts`
- Exposed `isConnecting: boolean` on `UseSessionConversationReturn`, forwarding `stream.isConnecting`
- Platform builders with custom UIs can now differentiate "connecting to stream" from "stream established, execution pending"

## Benefits

- **Eliminates the black-box period**: Users immediately see that the system is actively working after sending a message
- **Contextual messaging**: Git-sourced sessions show workspace-specific progress; plain sessions show generic preparation
- **SDK-first**: The indicator lives in `@stigmer/react`, so platform builders embedding `<MessageThread />` get it automatically
- **Zero backend changes**: Pure frontend implementation; ready for Phase 2 backend enrichment later
- **Accessible**: Uses `role="status"` and `aria-label` for screen readers

## Impact

- **All Stigmer Console users**: Every session now shows setup progress instead of silence
- **Platform builders**: `<MessageThread />` consumers inherit the indicator with zero configuration
- **SDK API surface**: `SetupProgress` and `SetupProgressProps` are new public exports; `UseSessionConversationReturn` gains `isConnecting`

## Related Work

- Phase 2 (future): Add `setup_phase` field to `AgentExecutionStatus` proto so the Python agent-runner can push real setup phases through the execution stream, replacing time-based approximation with server-reported progress
- Backend setup sequence: `execute_graphton.py` `heartbeat_during_setup()` labels document the exact phases that a future backend enrichment would surface

---

**Status**: ✅ Production Ready
**Timeline**: Single session
