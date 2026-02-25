# Wire Todo Events in Snapshot Bridge for Session Resume

**Date**: February 25, 2026

## Summary

Added `TodoUpdateEvent` emission to the snapshot bridge so that resumed sessions reconstruct the todo planning block from stored execution state. This completes the data path: todos now render identically whether the user is watching a live execution or resuming a previous session.

## Problem Statement

The streaming path (`streamToEvents`) already emitted `TodoUpdateEvent` via fingerprint-based diffing (committed in `3590bef4`), and the TUI handler created expandable blocks from those events (committed in `25d20bd1`). However, the snapshot path (`emitSnapshotEvents`) — used when resuming a session — never touched `status.GetTodos()`, silently dropping the planning block on resume.

### Pain Points

- Users who resumed a session lost visibility into the agent's planning state
- The todo block appeared during live execution but vanished on resume — inconsistent experience
- No error or indication that data was being dropped

## Solution

Emit a single `TodoUpdateEvent` from `emitSnapshotEvents` using the existing `convertProtoTodos` converter. Placed after sub-agent events and before `DoneEvent`, matching the streaming path's Step 1d position.

## Implementation Details

**Production code** (4 lines in `run_stream_snapshot.go`):

```go
if todos := convertProtoTodos(status.GetTodos()); len(todos) > 0 {
    events <- executiontui.TodoUpdateEvent{Todos: todos}
}
```

Key design choices:
- **Reuses `convertProtoTodos`** from `run_stream_convert.go` — no new conversion logic
- **`len > 0` guard** skips executions without todos at zero cost
- **No fingerprint diffing** — snapshot has final state only, emitted once per execution
- **Placement after sub-agents, before DoneEvent** — mirrors streaming path structure

**Tests** (3 new tests in `run_stream_snapshot_test.go`):
- `TestEmitSnapshotEvents_EmitsTodoUpdateEvent` — verifies event emission with correct items and status mappings
- `TestEmitSnapshotEvents_NoTodoEvent_WhenNoTodos` — verifies suppression for todo-free executions
- `TestEmitSnapshotEvents_TodoEventBeforeDoneEvent` — verifies ordering invariant

## Benefits

- Session resume now shows the same todo planning block as live execution
- Consistent user experience across all entry points (live stream, resume, reconnect)
- Zero overhead for executions without todos (guard condition)

## Impact

- **Users**: Resumed sessions now display the agent's planning state, matching the live execution experience
- **Files changed**: 2 files, 117 lines added
- **Risk**: Minimal — additive change using existing conversion infrastructure, no changes to event handling or rendering

## Related Work

- `2026-02-25-003947-add-todo-update-event-type.md` — Task 1: domain types
- `2026-02-25-010414-wire-todo-stream-diffing.md` — Task 3: streaming path
- `2026-02-25-011547-handle-todoupdateevent-in-tui.md` — Task 4: TUI handler
- `2026-02-24-233112-unify-session-resume-rendering-path.md` — snapshot bridge foundation

---

**Status**: ✅ Production Ready
**Commit**: `7a3d40e0` on `fix/cli-agent-execution-ux`
