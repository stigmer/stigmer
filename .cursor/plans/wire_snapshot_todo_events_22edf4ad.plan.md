---
name: Wire snapshot todo events
overview: Emit a TodoUpdateEvent from the snapshot bridge so resumed sessions reconstruct the todo block from stored execution state. The change is a single guard+emit in emitSnapshotEvents, plus tests.
todos:
  - id: emit-todo
    content: Add TodoUpdateEvent emission in emitSnapshotEvents after sub-agents, before DoneEvent
    status: completed
  - id: tests
    content: "Add 3 tests: emits todos, skips empty, ordering before DoneEvent"
    status: completed
  - id: build-verify
    content: Build and run tests to confirm clean compilation
    status: completed
isProject: false
---

# Wire Todo Handling in Snapshot Bridge

## What

Add todo event emission to `emitSnapshotEvents` in `[run_stream_snapshot.go](client-apps/cli/cmd/stigmer/root/run_stream_snapshot.go)` so that resumed sessions show the todo block from stored execution data.

## Why

The streaming path (Step 1d in `streamToEvents`) already emits `TodoUpdateEvent` via `emitTodoEvents` when the proto todos map changes. But the snapshot path — used when resuming a session — never touches `status.GetTodos()`, so resumed sessions silently drop the planning block.

## Implementation

**One code change in `[run_stream_snapshot.go](client-apps/cli/cmd/stigmer/root/run_stream_snapshot.go)`:**

Inside `emitSnapshotEvents`, after the sub-agent block (line ~123) and before the `DoneEvent` block (line ~125), add:

```go
if todos := convertProtoTodos(status.GetTodos()); len(todos) > 0 {
    events <- executiontui.TodoUpdateEvent{Todos: todos}
}
```

This mirrors the streaming path's approach:

- Uses `convertProtoTodos` from `[run_stream_convert.go](client-apps/cli/cmd/stigmer/root/run_stream_convert.go)` (already exists, used by `emitTodoEvents`)
- Guard on `len(todos) > 0` skips executions without todos (zero-cost for the common case)
- No fingerprint diffing needed — snapshot has final state only, emitted once

**Placement rationale:** After messages, tool calls, and sub-agents; before `DoneEvent`. This matches the streaming path's Step 1d position and places the todo block at the natural end of execution content.

## Design note: multi-execution sessions

In the streaming path, `handleFollowUpStarted` resets `todoBlockIdx` to `-1` between executions, giving each follow-up its own todo block. In the snapshot path, there is no follow-up boundary event — events flow continuously through `snapshotToEvents`'s loop.

This means if multiple executions in a session have todos, the second execution's `TodoUpdateEvent` will **update the first block in-place** (because `todoBlockIdx` still points at it), showing the latest execution's todos. This is acceptable:

- Most common case is a single execution with todos — works perfectly
- "Latest state wins" is the right UX for replayed history — the user cares about current plan status, not historical snapshots of earlier plans
- Adding a boundary event between snapshot executions is scope creep beyond Task 5, and would need to be designed carefully for all state (not just todos)

No autonomous decision needed here — this is a natural consequence of the existing snapshot architecture.

## Tests

Add to `[run_stream_snapshot_test.go](client-apps/cli/cmd/stigmer/root/run_stream_snapshot_test.go)`:

- **TodoUpdateEvent emitted for execution with todos** — verify `TodoUpdateEvent` is present with correct items
- **No TodoUpdateEvent for execution without todos** — verify no `TodoUpdateEvent` is emitted
- **Ordering: TodoUpdateEvent before DoneEvent** — verify the todo event comes before the terminal event in the event sequence

## Files changed

- `[client-apps/cli/cmd/stigmer/root/run_stream_snapshot.go](client-apps/cli/cmd/stigmer/root/run_stream_snapshot.go)` — add todo emission (~4 lines)
- `[client-apps/cli/cmd/stigmer/root/run_stream_snapshot_test.go](client-apps/cli/cmd/stigmer/root/run_stream_snapshot_test.go)` — add 3 tests

