# Fix Snapshot Event Ordering for Session Resume

**Date**: February 25, 2026

## Summary

Fixed the `stigmer run ses-xxx` session resume path so that messages, tool calls, and thinking blocks display in correct chronological order with proper expandable formatting — matching the live streaming TUI exactly. Previously, session resume showed all AI messages first with tool calls in a flat non-expandable format, duplicated tool blocks at the end, and thinking blocks out of position.

## Problem Statement

When resuming a completed session via `stigmer run ses-xxx`, the TUI output was fundamentally misordered compared to what the user saw during live execution.

### Pain Points

- AI messages appeared with tool calls rendered inline in a simple non-expandable format ("old format") instead of the proper expandable blocks with lifecycle badges
- All proper tool blocks (with badges like checkmark, hourglass) were dumped at the end of the output, after all messages — creating visual duplicates
- Thinking blocks (`name="think"`) appeared at the very end instead of before the AI message they logically precede
- The session resume output did not match the live streaming output, creating a confusing and inconsistent user experience

## Solution

Rewrote the `emitSnapshotEvents` function to build a proper chronological timeline by merging two data sources — `messages[]` and `tool_calls[]` — using timestamp-based interleaving instead of the previous approach that relied on AI messages referencing their tool calls (which the backend never populates).

## Implementation Details

The rewrite addresses three interconnected root causes:

**Root cause 1: AI messages never reference tool calls.** The backend `StatusBuilder` populates `AgentMessage.tool_calls` only on `MESSAGE_TOOL` entries, never on `MESSAGE_AI`. The old snapshot code called `emitReferencedToolEvents(msg.ToolCalls, ...)` after each AI message, which was always a no-op.

**Root cause 2: MESSAGE_TOOL rendered as ToolResultEvent.** Because no tool call IDs were ever marked as "emitted", `isTrackedToolMessage` never suppressed MESSAGE_TOOL entries. They passed through to `emitCompleteMessage` as `ToolResultEvent` — a simpler format without lifecycle badges.

**Root cause 3: All tool calls treated as orphaned.** With no IDs tracked, the orphaned-tools loop re-emitted every tool call from `tool_calls[]` as `ToolCompletedEvent`, creating duplicates and placing thinking blocks at the very end.

The new algorithm:
1. Collects tool call IDs already represented in `messages[]` as MESSAGE_TOOL entries
2. Identifies "non-message" tool calls (thinking blocks) that exist only in `tool_calls[]`
3. Sorts non-message tool calls by `started_at` timestamp
4. Walks messages chronologically, interleaving non-message tool calls at their correct timestamp position
5. Converts MESSAGE_TOOL messages to proper stateful `ToolCompletedEvent` blocks using full data from the top-level `ToolCalls[]` array
6. Emits AI messages as text only — tool calls appear as separate stateful blocks
7. Tracks all emitted IDs to prevent duplicates

New helper functions:
- `emitInterleaved` — interleaves non-message tool calls before each message by timestamp comparison
- `emitToolMessageAsStateful` — promotes MESSAGE_TOOL to proper ToolCompletedEvent with lifecycle badge
- `collectMessageToolIDs` — identifies tool calls already in the message timeline
- `collectNonMessageToolCalls` — finds tool calls needing timestamp-based interleaving

## Benefits

- Session resume output now matches live streaming output exactly — single rendering path, zero parity drift
- Thinking blocks appear in their correct chronological position (before the AI response they precede)
- Tool calls render as proper expandable blocks with lifecycle badges (checkmark for completed, etc.)
- No duplicate tool blocks — each tool call emitted exactly once
- Clean separation between data sources: messages provide the timeline, tool_calls provide rich metadata

## Impact

- **CLI users**: Session resume (`stigmer run ses-xxx`) now shows a coherent conversation flow
- **Live streaming path**: Untouched — continues to work as before
- **Backend**: No changes required — the fix is purely in the CLI snapshot rendering path
- **Tests**: 3 new tests covering thinking interleaving, duplicate prevention, and AI text-only emission; all 10 existing tests pass unchanged

---

**Status**: Production Ready
**Timeline**: Single session
