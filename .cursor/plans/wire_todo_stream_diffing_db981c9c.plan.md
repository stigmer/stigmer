---
name: Wire Todo Stream Diffing
overview: Add todo change detection to the gRPC-to-TUI bridge in run_stream_events.go. On each stream update, fingerprint status.todos and compare to previous state; emit TodoUpdateEvent when anything changes.
todos:
  - id: convert-fns
    content: Add mapTodoStatus and convertProtoTodos to run_stream_convert.go
    status: completed
  - id: diff-emit
    content: Add todoFingerprint type, emitTodoEvents, buildTodoFingerprints, todoFingerprintsChanged to run_stream_events.go
    status: completed
  - id: wire-loop
    content: Wire emitTodoEvents into streamToEvents as Step 1d (prevTodos state + guard + call)
    status: completed
  - id: tests
    content: Add tests for mapTodoStatus, convertProtoTodos, emitTodoEvents (change/no-change/edge cases)
    status: completed
  - id: build-verify
    content: Run go build and go test to confirm everything compiles and passes
    status: completed
isProject: false
---

# Task 3: Wire Todo Diffing in Stream Bridge

## Scope

Three files in the bridge layer (`client-apps/cli/cmd/stigmer/root/`). Explicitly **not in scope**: TUI handler for `TodoUpdateEvent` (Task 4), snapshot bridge (Task 5), model fields.

## Design

### Change detection strategy

Follow the same pattern as tool call state tracking (`toolCallStates map[string]string`), adapted for the fact that todos have two mutable fields (content + status) instead of just one (status).

Track previous state as `map[string]todoFingerprint` where `todoFingerprint` is a comparable struct:

```go
type todoFingerprint struct {
	content string
	status  string
}
```

On each stream update:

1. Build fingerprint map from `execution.Status.GetTodos()`
2. Compare against previous fingerprint map (length check + per-key struct equality)
3. If different: convert proto map to `[]executiontui.TodoItem`, emit `TodoUpdateEvent`, update snapshot
4. If same: return previous snapshot unchanged (zero allocation)

This avoids the string-concatenation-with-separator pattern and gets free structural comparison from Go (`fp1 != fp2` on comparable structs).

### Why not a simpler comparison?

- Can't compare proto map pointers (same map object is mutated in place by gRPC)
- Can't use `reflect.DeepEqual` on proto messages (proto v2 API discourages this)
- `len()` alone misses status/content changes within existing items
- The fingerprint approach follows the existing `toolCallStates` pattern and costs one map allocation per update (todo lists are typically 3-10 items -- negligible)

### Proto-to-domain conversion

The proto `TodoStatus` enum needs mapping to the string values the domain `TodoItem` uses. This follows the exact pattern of `mapToolCallStatus` and `mapPhaseToString` in [run_stream_convert.go](client-apps/cli/cmd/stigmer/root/run_stream_convert.go):

```go
func mapTodoStatus(status agentexecutionv1.TodoStatus) string {
	switch status {
	case agentexecutionv1.TodoStatus_TODO_PENDING:
		return "pending"
	case agentexecutionv1.TodoStatus_TODO_IN_PROGRESS:
		return "in_progress"
	case agentexecutionv1.TodoStatus_TODO_COMPLETED:
		return "completed"
	case agentexecutionv1.TodoStatus_TODO_CANCELLED:
		return "cancelled"
	default:
		return "pending"
	}
}
```

Default maps to `"pending"` (safe fallback for `TODO_STATUS_UNSPECIFIED` -- the renderer shows an open circle, which is the least misleading state for an unknown item).

### Placement in stream loop

Insert as **Step 1d** in [streamToEvents](client-apps/cli/cmd/stigmer/root/run_stream_events.go), between sub-agent processing (Step 1c, line 103) and phase change detection (Step 2, line 113):

```
Step 1:  Tool call state transitions
Step 1b: New messages to events
Step 1c: Sub-agent activity
Step 1d: Todo list changes        <-- NEW
Step 2:  Phase change events
Step 3:  Approval detection
Step 5:  Terminal check
```

Guard condition: `len(todos) > 0 || len(prevTodos) > 0` -- skips the function entirely for executions that never use todos (zero cost).

## Changes

### 1. [run_stream_convert.go](client-apps/cli/cmd/stigmer/root/run_stream_convert.go)

Add two functions at the end of the file:

- `mapTodoStatus(agentexecutionv1.TodoStatus) string` -- enum-to-string mapping (6 cases + default)
- `convertProtoTodos(map[string]*agentexecutionv1.TodoItem) []executiontui.TodoItem` -- converts the entire proto map to a domain slice. Returns nil for empty/nil maps.

These sit alongside the existing `mapPhaseToString`, `mapToolCallStatus`, and `convertToolCalls`.

### 2. [run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)

**Add type and functions** (after `isTrackedToolMessage`, before `emitAndWaitApproval`):

- `todoFingerprint` struct -- `{content, status string}`, unexported, comparable
- `emitTodoEvents(events, protoTodos, prevFingerprints) map[string]todoFingerprint` -- the diff-and-emit function. Includes a `log.Debug` trace when an event is emitted.
- `buildTodoFingerprints(map[string]*agentexecutionv1.TodoItem) map[string]todoFingerprint` -- builds the fingerprint map from proto
- `todoFingerprintsChanged(prev, current map[string]todoFingerprint) bool` -- length check + per-key comparison

**Wire into `streamToEvents`:**

- Add `prevTodos = make(map[string]todoFingerprint)` to the var block (line 48 area)
- Add Step 1d call after the sub-agent block (after line 105):

```go
// --- Step 1d: Todo list changes ---
if todos := execution.Status.GetTodos(); len(todos) > 0 || len(prevTodos) > 0 {
    prevTodos = emitTodoEvents(cfg.events, todos, prevTodos)
}
```

### 3. [run_stream_events_test.go](client-apps/cli/cmd/stigmer/root/run_stream_events_test.go)

Add test functions:

- `TestMapTodoStatus_AllValues` -- verify all 4 enum values + UNSPECIFIED default
- `TestConvertProtoTodos_ConvertsMapToSlice` -- verify proto map converts to domain slice
- `TestConvertProtoTodos_EmptyMap` -- verify nil return for empty/nil input
- `TestEmitTodoEvents_EmitsOnChange` -- verify event emitted when fingerprints differ
- `TestEmitTodoEvents_SuppressesOnNoChange` -- verify no event when fingerprints match
- `TestEmitTodoEvents_EmitsOnFirstTodo` -- verify event emitted when transitioning from empty to non-empty
- `TestEmitTodoEvents_DetectsStatusChange` -- verify status change within same ID is detected
- `TestEmitTodoEvents_DetectsContentChange` -- verify content change within same ID is detected
- `TestEmitTodoEvents_DetectsItemRemoved` -- verify removal of an item is detected

## Edge Cases Handled

- **Nil todos map**: `GetTodos()` returns nil -> `len(nil) == 0` -> guard skips the call. Correct.
- **First appearance**: `prevTodos` is empty, fingerprints differ -> emit. Correct.
- **Status change only**: Fingerprint includes status -> detected. Correct.
- **Content change only**: Fingerprint includes content -> detected. Correct.
- **Item removed**: Map length changes -> detected. Correct.
- **Item added**: New key in fingerprint map -> detected. Correct.
- **Unspecified status**: Maps to "pending" (safe default, shows open circle in TUI).
- **Map iteration order**: Comparison is by key, not iteration order. Correct.

## Build Verification

`go build ./client-apps/cli/...` and `go test ./client-apps/cli/cmd/stigmer/root/...` must pass.