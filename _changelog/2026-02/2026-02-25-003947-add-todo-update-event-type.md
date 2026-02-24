# Add TodoUpdateEvent Type for CLI TUI

**Date**: February 25, 2026

## Summary

Added `TodoItem` domain type and `TodoUpdateEvent` to the CLI execution TUI event system. This is the foundational type that enables todo/planning item rendering during agent execution — the first step in wiring the existing backend todo data into the CLI output.

## Problem Statement

The backend already populates `AgentExecutionStatus.todos` via the `write_todos` tool (TodoListMiddleware), but the CLI TUI has no event type to carry todo state changes from the gRPC bridge into the rendering pipeline. Without a domain-level event, the TUI cannot display task progress during agent execution.

### Pain Points

- Users running agents with planning/todo tools see no task progress in the CLI
- The proto `TodoItem` type exists but has no domain counterpart in the TUI layer
- No event path exists between the gRPC stream bridge and the TUI model for todo data

## Solution

Defined a `TodoItem` domain type and `TodoUpdateEvent` in `executiontui/events.go`, following the established patterns used by tool call events and streaming AI messages.

## Implementation Details

**File**: `client-apps/cli/pkg/executiontui/events.go`

- `TodoItem` struct: domain type with `ID`, `Content`, and `Status` (string-typed, matching tool call status pattern)
- `TodoUpdateEvent` struct: carries `[]TodoItem` as a full-snapshot replacement
- `isEvent()` marker method: satisfies the `Event` interface

### Design Decisions

- **Full-snapshot over per-item deltas**: the event carries the complete todo list each time, mirroring `AIStreamDeltaEvent`. The bridge layer owns diffing; the TUI simply replaces.
- **Domain type over proto type**: follows the `toolrender.ToolCallInfo` vs `agentexecutionv1.ToolCall` separation pattern. Proto-to-domain conversion will live in the bridge layer.
- **Timestamps omitted**: `CreatedAt`/`UpdatedAt` are backend concerns, not needed for TUI rendering. Can be added later if a use case emerges.
- **Ordering is a renderer concern**: the slice is unordered; the rendering layer (future task) will sort for display.

## Benefits

- Establishes the type foundation for todo rendering in the CLI TUI
- Follows existing event system patterns — no new abstractions or dependencies
- Clean domain boundary: TUI code never touches proto types directly

## Impact

- **CLI TUI**: new event type available for handler wiring (subsequent tasks)
- **No runtime behavior change**: this is a type definition only; no existing code paths are affected

## Related Work

- Proto definitions: `apis/ai/stigmer/agentic/agentexecution/v1/api.proto` (TodoItem, TodoStatus)
- Backend population: `backend/services/agent-runner/worker/activities/graphton/status_builder.py` (write_todos handler)
- Project: `_projects/2026-02/20260225.01.cli-todo-blocks/` (Tasks 2-5 will wire rendering, bridge, and handler)

---

**Status**: ✅ Production Ready
**Timeline**: Task 1 of 6 in the cli-todo-blocks project
