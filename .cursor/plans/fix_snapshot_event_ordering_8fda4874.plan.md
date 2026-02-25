---
name: Fix snapshot event ordering
overview: Fix the `snapshotToEvents` function in `run_stream_snapshot.go` so that session resume (`stigmer run ses-xxx`) displays messages, tool calls, and thinking blocks in correct chronological order -- matching the live streaming TUI.
todos:
  - id: rewrite-snapshot-events
    content: "Rewrite emitSnapshotEvents in run_stream_snapshot.go: build chronological timeline from messages[] + non-message tool calls, interleave by timestamp, emit MESSAGE_TOOL as ToolCompletedEvent, strip inline tool calls from AI messages"
    status: completed
  - id: verify-with-session
    content: Verify the fix by running stigmer run ses-01kj8a9cfjdafqt1a6m3awxa9m and confirming correct output ordering
    status: completed
  - id: lint-check
    content: Run linter and ensure no regressions in the snapshot rendering path
    status: completed
isProject: false
---

# Fix Snapshot Event Ordering for Session Resume

## Problem

When resuming a session via `stigmer run ses-xxx`, the output is misordered:

1. **AI messages appear first** with tool calls rendered in a simple non-expandable format ("old format")
2. **Proper expandable tool blocks** with lifecycle badges appear at the end, after all messages
3. **Thinking blocks** appear at the very end instead of before the AI message they precede

The live streaming path works correctly -- this is purely a snapshot replay issue.

## Root Cause

Three interconnected bugs in `[emitSnapshotEvents](client-apps/cli/cmd/stigmer/root/run_stream_snapshot.go)`:

### 1. AI messages don't reference tool calls

The backend `StatusBuilder` never populates `AgentMessage.tool_calls` on AI messages. It only populates it on `MESSAGE_TOOL` entries. The snapshot code at line 83-84 calls `emitReferencedToolEvents(events, msg.ToolCalls, ...)` which expects AI messages to reference their tool calls -- but `msg.ToolCalls` is always empty. This means:

- No tool calls are emitted after AI messages
- No tool call IDs are added to `emittedToolStates`

### 2. MESSAGE_TOOL emitted as ToolResultEvent instead of ToolCompletedEvent

Because `emittedToolStates` stays empty (see above), `isTrackedToolMessage` never suppresses MESSAGE_TOOL entries. They pass through to `emitCompleteMessage` which emits them as `ToolResultEvent` -- rendered as simple, non-expandable blocks without lifecycle badges. This is the "old format" the user sees inline with messages.

### 3. All tool calls treated as orphaned

Since no tool call IDs were added to `emittedToolStates`, the orphaned loop (lines 91-100) re-emits every tool call from `status.ToolCalls[]` as `ToolCompletedEvent` -- creating duplicates of the MESSAGE_TOOL entries, plus placing thinking blocks (`name="think"`) at the very end.

The live streaming path avoids all of this because `emitToolCallStateEvents` runs first, creating proper stateful blocks for ALL tool calls (including thinking), and `isTrackedToolMessage` then suppresses the MESSAGE_TOOL entries.

## Solution

Rewrite `emitSnapshotEvents` to build a proper chronological timeline by:

1. Identifying tool calls that exist only in `tool_calls[]` but have no corresponding `MESSAGE_TOOL` in `messages[]` (e.g., thinking blocks)
2. Sorting these "non-message tool calls" by `started_at` timestamp
3. Walking `messages[]` chronologically, interleaving non-message tool calls at their correct timestamp position
4. Converting `MESSAGE_TOOL` messages to proper stateful `ToolCompletedEvent` blocks (using full data from `toolCallByID`)
5. Emitting AI messages without inline tool calls (tool calls come as separate stateful blocks)
6. Tracking all emitted tool call IDs to prevent duplicates

### Expected output order after fix

```
HUMAN message
ToolCompletedEvent(think)       -- thinking before AI response
AI message (text only)
ToolCompletedEvent(tool1)       -- expandable, with badge
ToolCompletedEvent(tool2)       -- expandable, with badge
AI message (text only)
ToolCompletedEvent(tool3)       -- expandable, with badge
...
```

This matches the live streaming path output exactly.

## Files to Change

- `**[client-apps/cli/cmd/stigmer/root/run_stream_snapshot.go](client-apps/cli/cmd/stigmer/root/run_stream_snapshot.go)**` -- Primary change: rewrite `emitSnapshotEvents` and `emitReferencedToolEvents`. Add a new function to build the chronological event timeline.

## Design Details

### Timeline construction algorithm

```
nonMessageToolCalls = tool_calls[] - {IDs in MESSAGE_TOOL messages}
sort nonMessageToolCalls by started_at

nmCursor = 0
for each msg in messages[]:
    // Interleave non-message tool calls that started before this message
    while nmCursor < len(nonMessageToolCalls) AND
          nonMessageToolCalls[nmCursor].started_at <= msg.timestamp:
        emit ToolCompletedEvent(nonMessageToolCalls[nmCursor])
        mark emitted
        nmCursor++

    switch msg.type:
    case MESSAGE_TOOL:
        fullTC = toolCallByID[msg.tool_calls[0].id]
        emit ToolCompletedEvent(fullTC)   // proper stateful block
        mark emitted
    case MESSAGE_AI:
        emit AIMessageEvent(content only) // no inline tool calls
    default:
        emit as before

// Remaining non-message tool calls
while nmCursor < len(nonMessageToolCalls):
    emit ToolCompletedEvent(...)
```

### What does NOT change

- **Backend status builder** -- no changes to `status_builder.py`
- **Live streaming path** -- `run_stream_events.go` is untouched
- **TUI event handlers** -- `handle_events.go` already handles all event types correctly
- **Rendering functions** -- `render_blocks.go` and `toolrender/` are untouched
- **Sub-agent handling** -- sub-agent events are emitted separately and carry `SubAgentID` for nesting; their position doesn't affect layout

### Edge cases

- **Tool call missing from `toolCallByID`**: Fall back to using the MESSAGE_TOOL's embedded tool call data
- **Missing `started_at` on thinking blocks**: Treat as having the latest possible timestamp (emit at end)
- **Missing `timestamp` on messages**: Should not happen, but fall back to array position ordering
- **Empty `tool_calls[]`**: Nothing to interleave; walk messages as before
- **AI message with empty content and no tool calls**: Shows "Agent is invoking tools..." which is acceptable for the rare case where the LLM produced only tool calls with no text

