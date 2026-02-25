# Handle TodoUpdateEvent in CLI TUI Event Dispatcher

**Date**: February 25, 2026

## Summary

Wired `TodoUpdateEvent` handling into the TUI's event dispatcher so the CLI renders and live-updates the agent's todo block during execution. The first event appends an expandable todo block; subsequent events update it in-place, preserving the user's expand/collapse preference.

## Problem Statement

Tasks 1-3 built the full pipeline from proto status updates to domain events: the `TodoUpdateEvent` type (Task 1), block rendering functions (Task 2), and stream bridge change detection (Task 3). But the TUI's event dispatcher (`handleExecutionEvent`) had no case for `TodoUpdateEvent`, so the events were emitted but silently ignored.

### Pain Points

- Todo events from the stream bridge had no handler — the TUI never created or updated a todo block
- No mechanism existed to track the todo block's position for in-place updates across the block slice
- Follow-up executions (conversational mode) needed the tracking state reset so each execution gets its own block

## Solution

Added a `todoBlockIdx int` field to the Model (sentinel `-1`) and a `case TodoUpdateEvent` in the event dispatch switch. The pattern mirrors `updateToolBadge`: first event appends and tracks the index; subsequent events replace in-place with bounds checking. The user's expand/collapse preference is captured before replacement and restored after.

## Implementation Details

### Model field (`model.go`)

- `todoBlockIdx int` — index into `blocks` of the current execution's todo block. `-1` when no block exists yet.
- Initialized to `-1` in `New()`, reset to `-1` in `handleFollowUpStarted` (follow-up execution boundary).

### Event handler (`handle_events.go`)

- Renders preview and expanded content via existing `renderTodoPreview`/`renderTodoExpanded` (Task 2).
- Bounds check (`todoBlockIdx >= 0 && todoBlockIdx < len(m.blocks)`) guards against stale indices.
- `wasExpanded` capture/restore preserves user's collapse preference across updates.

### Follow-up reset (`followup.go`)

- `m.todoBlockIdx = -1` alongside existing `m.runningTools = make(map[string]int)` reset.

### Tests (`update_test.go`)

3 tests following established `TestUpdate_<EventType>_<Behavior>` convention:
- `CreatesBlock`: verifies block type, expandable, expanded-by-default, index tracking
- `UpdatesInPlace`: second event replaces at same index (block count stable), content reflects new state
- `PreservesExpandCollapseState`: user collapses block, update arrives, block stays collapsed

## Benefits

- Completes the live rendering pipeline: proto -> stream bridge -> TUI event -> block
- Zero new abstractions — uses existing `newTodoBlock`, `renderTodoPreview`, `renderTodoExpanded`
- Plain `int` field (not map) correctly models the 1:1 relationship between execution and todo block
- Expand/collapse preservation respects user intent during rapid todo updates

## Impact

- **CLI users**: Agent todo/planning items now appear as a live-updating expandable block during execution
- **Maintainers**: The handling pattern is identical for both live stream and snapshot resume (Task 5), so no special-casing is needed

## Related Work

- Task 1: `TodoUpdateEvent` and `TodoItem` domain types (`456b4fb9`)
- Task 2: Todo block type and rendering (`80f81724`)
- Task 3: Stream bridge change detection (`3590bef4`)
- Task 5 (next): Wire todo handling in `run_stream_snapshot.go` for session resume

---

**Status**: ✅ Production Ready
**Timeline**: ~15 minutes implementation
