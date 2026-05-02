# Cursor Runner: TodoWrite Event Capture

**Date**: May 2, 2026

## Summary

Added `TodoTracker` to the cursor-runner service, closing the data pipeline gap that prevented Cursor harness executions from populating `AgentExecutionStatus.todos`. The existing React `TodoList` and CLI `emitTodoEvents` consumers already handle this proto field — they just never received data from Cursor executions because the runner wasn't extracting it from `TodoWrite` tool call events.

## Problem Statement

The Cursor SDK emits `TodoWrite` as a standard `tool_call` stream event. The `MessageAccumulator` correctly captures it as a `MESSAGE_TOOL` (preserving tool call visibility), but the structured todo data inside the args was serialized to `ToolCall.argsPreview` as a JSON string and never parsed into `TodoItem` protos on `status.todos`. The downstream UI rendered an empty checklist.

### Pain Points

- **Empty TodoList in Cursor executions**: The React `TodoList` component renders `execution.status.todos` — which was always `{}` for Cursor harness runs despite the agent actively using TodoWrite.
- **CLI todo diff never fires**: `emitTodoEvents` diffs `execution.Status.GetTodos()` — an empty map never triggers a `TodoUpdateEvent`.
- **Python parity gap**: The Python agent-runner's `StatusBuilder` has handled `write_todos` since inception. Cursor executions lacked equivalent handling.

## Solution

A new `TodoTracker` class that intercepts completed `TodoWrite` tool call events, parses their args, and writes structured `TodoItem` protos directly into the `status.todos` map reference. Follows the same single-responsibility pattern as `DeltaEnricher`.

## Implementation Details

### TodoTracker (`todo-tracker.ts`)

- **Event filtering**: Only acts on `tool_call` events where `name === "TodoWrite"` and `status === "completed"`. Running/errored events are ignored (args are incomplete).
- **Args parsing**: Handles both string (JSON) and object args defensively, matching `translateToolCall`'s existing pattern.
- **Merge semantics**: Respects Cursor's `merge` parameter — `merge: true` updates existing entries by ID and adds new ones; `merge: false` (or absent) clears the map and rebuilds from args (snapshot replace, matching Python's proven pattern).
- **Status mapping**: Maps string statuses (`pending`, `in_progress`, `completed`, `cancelled`) to `TodoStatus` enum values. Unknown statuses default to `TODO_PENDING`.
- **Timestamp handling**: On merge, preserves existing `created_at`; on replace, uses the raw arg's `created_at` or falls back to now. `updated_at` is always set to the current timestamp.
- **ID fallback**: Missing or empty IDs get `todo-{index}`, matching the Python pattern.
- **Dirty flag**: Set when todos change, used to trigger immediate persistence. No debounce needed (TodoWrite events are infrequent).

### Execute-Cursor Integration (`execute-cursor.ts`)

Four lines added:
1. Import `TodoTracker`
2. Create instance with `status.todos` reference
3. Call `todoTracker.processEvent(event)` in the stream loop
4. Include `todoTracker.isDirty` in the persist condition and call `markPersisted()` after writes

## Benefits

- **Full todo visibility in Cursor executions**: Users now see the agent's task checklist in both the web console (`TodoList` component) and CLI (todo update events) during Cursor harness runs.
- **No proto changes**: The existing `map<string, TodoItem>` on `AgentExecutionStatus` already supports everything needed.
- **No downstream changes**: React `TodoList.tsx`, `ExecutionProgress.tsx`, `SubAgentSection.tsx`, and CLI `emitTodoEvents` already handle the data model — they just never received it from Cursor executions.
- **Python pattern alignment**: Snapshot-replace semantics match the proven `StatusBuilder._update_todos()` pattern.
- **Additive, non-breaking**: TodoWrite tool calls still flow through `MessageAccumulator` as normal `MESSAGE_TOOL` entries. The tracker is a parallel extraction, not a replacement.

## Impact

- **cursor-runner**: `todo-tracker.ts` (new, 108 lines), `execute-cursor.ts` (4 lines added)
- **Tests**: 32 new tests covering snapshot replace, merge, status mapping, args parsing, event filtering, dirty flag, timestamps, and ID fallback. All 204 tests pass.
- **Users**: Cursor harness executions now show todo progress in the same components that already work for Python/Graphton executions.

## Related Work

- Event Visibility changelog (2026-05-02): Fixed tool call attachment, sub-agent tracking, and thinking blocks
- Delta Enrichment changelog (2026-05-02): Added real-time shell output streaming and tool timing
- Python agent-runner `StatusBuilder._update_todos()`: The proven pattern this aligns with
- Sub-agent todo routing (future): Requires `SubAgentExecution` tracking in cursor-runner first

---

**Status**: Production Ready
**Timeline**: Single session
