---
name: Handle TodoUpdateEvent
overview: Add a `TodoUpdateEvent` case to the TUI event dispatcher that creates or updates a single todo block in-place, tracking its position with a `todoBlockIdx` field on Model. Reset the field on follow-up execution boundaries.
todos:
  - id: model-field
    content: Add todoBlockIdx field to Model struct and initialize to -1 in New()
    status: completed
  - id: followup-reset
    content: Reset todoBlockIdx to -1 in handleFollowUpStarted
    status: completed
  - id: handle-event
    content: Add case TodoUpdateEvent to handleExecutionEvent switch
    status: completed
  - id: tests
    content: "Add 3 tests: creates block, updates in-place, preserves expand/collapse state"
    status: completed
  - id: build-verify
    content: Run go build and go test to verify everything compiles and passes
    status: completed
isProject: false
---

# Handle TodoUpdateEvent in handle_events.go

## Design

There is exactly one todo block per execution. The first `TodoUpdateEvent` appends it; subsequent events update it in-place (same pattern as `streaming.blockIdx` for AI stream blocks). A `todoBlockIdx` field on `Model` (sentinel `-1`) tracks the block's position.

Key design decision: **use a plain `int` field, not a map**. Unlike `runningTools` which tracks N independent tool calls by ID, there is only ever one todo block per execution. A single int is the right shape for this — simpler, cheaper, and communicates the 1:1 relationship clearly.

### In-place update preserves expand/collapse state

When updating, the user's current `expanded` state is read from the existing block and restored on the replacement. This matters because the block starts expanded by default, but the user may have collapsed it (Tab + Enter) to reduce visual noise — we must not undo that.

## Changes

### 1. Add `todoBlockIdx` field to Model ([model.go](client-apps/cli/pkg/executiontui/model.go))

Add after `runningTools` (line ~106):

```go
// todoBlockIdx is the index into blocks of the current execution's todo
// block. -1 means no todo block exists yet. Set on the first
// TodoUpdateEvent; updated in-place on subsequent events. Reset to -1
// when a follow-up execution starts.
todoBlockIdx int
```

Initialize to `-1` in `New()` (line ~215, alongside `focusedBlockIndex: -1`).

### 2. Reset `todoBlockIdx` in follow-up transition ([followup.go](client-apps/cli/pkg/executiontui/followup.go))

Add `m.todoBlockIdx = -1` to `handleFollowUpStarted` (line ~66, alongside `m.runningTools = make(map[string]int)`). Each follow-up execution gets its own todo block.

### 3. Add `case TodoUpdateEvent` in handleExecutionEvent ([handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go))

Add the case after `StreamErrorEvent` (line ~161), before the closing `}`:

```go
case TodoUpdateEvent:
    preview := renderTodoPreview(e.Todos)
    full := renderTodoExpanded(e.Todos)
    if m.todoBlockIdx >= 0 && m.todoBlockIdx < len(m.blocks) {
        wasExpanded := m.blocks[m.todoBlockIdx].expanded
        m.blocks[m.todoBlockIdx] = newTodoBlock(preview, full)
        m.blocks[m.todoBlockIdx].expanded = wasExpanded
    } else {
        m.blocks = append(m.blocks, newTodoBlock(preview, full))
        m.todoBlockIdx = len(m.blocks) - 1
    }
```

This mirrors `updateToolBadge`'s pattern: check-and-update-in-place vs. append-and-track.

### 4. Add tests in update_test.go ([update_test.go](client-apps/cli/pkg/executiontui/update_test.go))

Three tests following the existing naming convention (`TestUpdate_<EventType>_<Behavior>`):

- `TestUpdate_TodoUpdateEvent_CreatesBlock` -- first event appends a todo block, verifies blockType, expandable, and expanded-by-default
- `TestUpdate_TodoUpdateEvent_UpdatesInPlace` -- second event replaces in-place at same index, block count stays the same, content reflects new state
- `TestUpdate_TodoUpdateEvent_PreservesExpandCollapseState` -- manually collapse the block, send a new event, verify it stays collapsed

## Files Changed


| File               | Change                        |
| ------------------ | ----------------------------- |
| `model.go`         | +1 field, +1 init line        |
| `followup.go`      | +1 reset line                 |
| `handle_events.go` | +10 lines (case block)        |
| `update_test.go`   | +3 test functions (~50 lines) |


## What This Does NOT Do (Task 5 and 6 scope)

- Does **not** touch `run_stream_snapshot.go` -- wiring `TodoUpdateEvent` into session resume is Task 5
- Does **not** add snapshot-path emission of `TodoUpdateEvent` from `emitSnapshotEvents`
- Build verification is Task 6

## Risk Assessment

- **Zero architectural risk** -- follows established patterns exactly (`streamingState.blockIdx`, `updateToolBadge`)
- **No new dependencies or abstractions**
- **Forward-compatible with Task 5** -- `snapshotToEvents` just needs to emit `TodoUpdateEvent` using `convertProtoTodos` (already exists from Task 3); the handling in the TUI is identical regardless of whether the event came from a live stream or a snapshot replay

