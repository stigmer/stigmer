---
name: Add TodoUpdateEvent
overview: Define the TodoUpdateEvent type and its TodoItem data carrier in events.go, following the existing event system patterns. This is the foundation that Tasks 2-5 build upon.
todos:
  - id: verify-handle-events-typo
    content: Verify whether the `m.blocks = blocks = append(...)` in handle_events.go is a real bug or a transcription artifact
    status: completed
  - id: add-todo-item-type
    content: Add TodoItem struct to events.go (ID, Content, Status fields)
    status: completed
  - id: add-todo-update-event
    content: Add TodoUpdateEvent struct and isEvent() marker to events.go
    status: completed
  - id: verify-build
    content: Run go build to confirm the new types compile cleanly
    status: completed
isProject: false
---

# Task 1: Add TodoUpdateEvent to events.go

## Context

The proto layer already defines `TodoItem` (id, content, status, timestamps) and stores them in `AgentExecutionStatus.todos` as a `map<string, TodoItem>`. The backend populates this via the `write_todos` tool in `status_builder.py`. The CLI event system needs a domain-level event to carry todo state changes from the gRPC bridge into the TUI.

**Proto source**: `[apis/ai/stigmer/agentic/agentexecution/v1/api.proto](apis/ai/stigmer/agentic/agentexecution/v1/api.proto)` (TodoItem message, lines 207-224)
**Target file**: `[client-apps/cli/pkg/executiontui/events.go](client-apps/cli/pkg/executiontui/events.go)`

## Design Decisions

### 1. Full-snapshot event, not per-item deltas

`TodoUpdateEvent` carries the **complete current todo list** each time, not individual item changes. This mirrors how `AIStreamDeltaEvent` carries the full accumulated content. Rationale:

- The bridge layer (Task 3) owns the diffing logic to decide *when* to emit the event
- The TUI handler (Task 4) simply replaces the todo block content with the new state
- No partial-state bugs, no reconciliation logic in the TUI
- The todo list is small (typically 3-10 items) so full replacement is cheap

### 2. Domain TodoItem type, not proto types

Following the pattern of `toolrender.ToolCallInfo` (domain type) vs `agentexecutionv1.ToolCall` (proto type), define a plain Go struct with string-typed status. The bridge layer (Task 3, `run_stream_convert.go`) will handle proto-to-domain conversion.

Fields to include:

- `ID` (string) -- identity, used for stable ordering and future block-level tracking
- `Content` (string) -- task description
- `Status` (string) -- "pending", "in_progress", "completed", "cancelled" (matches tool call status string pattern)

Fields intentionally **omitted**:

- `CreatedAt`, `UpdatedAt` -- timestamps are storage/backend concerns, not needed for TUI rendering. Can be added later if a use case emerges.

### 3. TodoItem lives in events.go

The struct is a simple 3-field data carrier with no methods or behavior. This follows the precedent of `ApprovalResponse` being defined alongside events in the same file. If rendering logic is needed later, it will live in `render_blocks.go` functions that accept `TodoItem` as input (same pattern as `toolrender` functions).

### 4. Ordering is a renderer concern

`TodoUpdateEvent.Todos` is an unordered `[]TodoItem`. The rendering layer (Task 2) will sort items for display (e.g., in-progress first, then pending, then completed). The event just carries data.

## Changes

**File**: `client-apps/cli/pkg/executiontui/events.go`

Add after the existing event types (before `ApprovalResponse`):

```go
// TodoItem represents a single todo/planning item from the agent's task list.
// This is the domain type used within the TUI — the bridge layer converts
// proto TodoItem messages into this type.
type TodoItem struct {
	// ID is the unique identifier for this todo item.
	ID string

	// Content is the task description.
	Content string

	// Status is the current state: "pending", "in_progress", "completed",
	// or "cancelled". Matches the string-based status pattern used by
	// tool call lifecycle tracking.
	Status string
}

// TodoUpdateEvent carries the full current todo list. Emitted when the
// bridge layer detects any change in the execution's todos map. The TUI
// replaces the todo block content entirely with the new state — no
// per-item diffing is needed on the TUI side.
type TodoUpdateEvent struct {
	Todos []TodoItem
}

func (TodoUpdateEvent) isEvent() {}
```

## Potential Issue Noticed

In `handle_events.go` line ~97, there appears to be a typo:

```go
m.blocks = blocks = append(m.blocks, ...)
```

`blocks` is not a defined variable in this scope. This might be a transcription artifact from the explore agent, but should be verified before editing the file. If real, it should be fixed as a separate commit.

## What This Does NOT Include

- Block type / rendering (Task 2)
- Bridge diffing logic and proto-to-domain conversion (Task 3)
- TUI event handler (Task 4)
- Snapshot bridge (Task 5)

These are intentionally deferred to subsequent tasks.