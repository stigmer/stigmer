# Wire Todo Change Detection in CLI Stream Bridge

**Date**: February 25, 2026

## Summary

Added todo change detection to the gRPC-to-TUI bridge so the CLI can detect when the agent's todo list changes during execution and emit `TodoUpdateEvent` to the TUI. This completes the bridge layer for todo rendering — the pipeline from proto status updates to domain events is now wired.

## Problem Statement

The backend populates `AgentExecutionStatus.todos` via the `write_todos` tool during agent execution, but the CLI stream bridge (`streamToEvents`) ignored this field entirely. Even though Task 1 added the `TodoUpdateEvent` type and Task 2 added the block rendering functions, there was no mechanism to detect todo changes in the stream and emit events to the TUI.

### Pain Points

- The CLI had no way to observe todo list changes during a live execution stream
- No conversion existed from the proto `TodoStatus` enum to the domain string representation
- No change detection logic existed to avoid flooding the TUI with redundant events when the todo map hasn't changed

## Solution

Extended the stream bridge with a fingerprint-based change detection system that follows the existing `emitToolCallStateEvents` pattern. On each stream update, the `status.todos` map is fingerprinted and compared against the previous snapshot. Changes trigger a `TodoUpdateEvent` with the full converted snapshot.

## Implementation Details

### Proto-to-domain conversion (`run_stream_convert.go`)

- `mapTodoStatus`: Converts `TodoStatus` enum to string (`"pending"`, `"in_progress"`, `"completed"`, `"cancelled"`). `UNSPECIFIED` defaults to `"pending"`.
- `convertProtoTodos`: Converts `map[string]*TodoItem` proto map to `[]executiontui.TodoItem` domain slice.

### Change detection (`run_stream_events.go`)

- `todoFingerprint` struct: Comparable `{content, status}` pair — Go's `!=` operator handles structural comparison without reflection or string concatenation.
- `emitTodoEvents`: Builds fingerprints, compares against previous snapshot, emits `TodoUpdateEvent` on change, returns updated snapshot.
- `buildTodoFingerprints`: Creates the fingerprint map from proto.
- `todoFingerprintsChanged`: Length check + per-key comparison.

### Stream loop wiring

Inserted as **Step 1d** in `streamToEvents`, between sub-agent processing (Step 1c) and phase change detection (Step 2). A guard condition (`len(todos) > 0 || len(prevTodos) > 0`) skips the function entirely for executions that never use todos.

### Tests

9 new tests covering: status mapping (all enum values), proto conversion (populated + empty maps), and change detection (first appearance, no-change suppression, status change, content change, item removal, item addition).

## Benefits

- Completes the proto-to-event pipeline for todo rendering
- Zero cost for executions that don't use todos (guard condition)
- Follows established patterns (same diff-and-emit approach as tool call state tracking)
- Fingerprint-based comparison avoids proto reflection and handles all change types (add, remove, status change, content edit)

## Impact

- **CLI users**: This is an invisible infrastructure change — todo blocks will appear in the TUI once Task 4 (handle the event) is completed
- **Maintainers**: The `convertProtoTodos` and `mapTodoStatus` functions will also be used by Task 5 (snapshot bridge for session resume)

## Related Work

- Task 1: `TodoUpdateEvent` and `TodoItem` domain types (`456b4fb9`)
- Task 2: Todo block type and rendering (`80f81724`)
- Task 4 (next): Handle `TodoUpdateEvent` in `handle_events.go`
- Task 5 (next): Wire todo handling in `run_stream_snapshot.go`

---

**Status**: ✅ Production Ready
**Timeline**: ~20 minutes implementation
