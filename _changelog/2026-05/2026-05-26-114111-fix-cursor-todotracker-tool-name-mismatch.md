# Fix Cursor TodoTracker Tool Name and Schema Mismatch

**Date**: May 26, 2026

## Summary

Fixed a silent tool name mismatch in the Cursor harness's `TodoTracker` that caused all todo events to be dropped. The tracker checked for `event.name === "TodoWrite"` but the Cursor SDK emits `"updateTodos"` with a different args schema (camelCase statuses, no per-item `id`). Added comprehensive test coverage (37 tests) for a previously untested component.

## Problem Statement

The `TodoTracker` was implemented on May 2, 2026 to extract structured todo data from Cursor SDK stream events and populate `AgentExecutionStatus.todos`. However, the tracker was filtering on the wrong tool name, causing every Cursor harness execution to have an empty `status.todos` map.

### Pain Points

- **Empty TodoList in all Cursor executions**: The React `TodoList` component and CLI `emitTodoEvents` rendered nothing for Cursor harness runs despite the agent actively creating todos.
- **Silent failure**: No errors, no warnings — the name check simply never matched, so events were silently skipped.
- **Schema drift**: The Cursor SDK uses `"inProgress"` (camelCase) for status values, while the tracker only mapped `"in_progress"` (snake_case). Even if the name had matched, in-progress todos would have defaulted to `TODO_PENDING`.

## Solution

Three targeted fixes to `TodoTracker`, plus comprehensive test coverage:

1. **Tool name matching**: Replaced single-name check with a `Set`-based lookup accepting both `"TodoWrite"` (legacy) and `"updateTodos"` (current Cursor SDK).
2. **Status mapping**: Added `"inprogress"` to `STATUS_MAP` so the SDK's camelCase `"inProgress"` (after `.toLowerCase()`) correctly maps to `TODO_IN_PROGRESS`.
3. **Diagnostic logging**: Added a `console.log` after successful processing for production traceability.

## Implementation Details

### Tool Name Set

```typescript
const TODO_TOOL_NAMES = new Set(["TodoWrite", "updateTodos"]);
// ...
if (!TODO_TOOL_NAMES.has(event.name)) return;
```

Accepting both names provides resilience across SDK versions without breaking backward compatibility.

### Extended Status Map

```typescript
const STATUS_MAP: Record<string, TodoStatus> = {
  pending: TodoStatus.TODO_PENDING,
  in_progress: TodoStatus.TODO_IN_PROGRESS,
  inprogress: TodoStatus.TODO_IN_PROGRESS,  // Cursor SDK camelCase
  completed: TodoStatus.TODO_COMPLETED,
  cancelled: TodoStatus.TODO_CANCELLED,
};
```

The existing `.toLowerCase()` call on status strings means `"inProgress"` becomes `"inprogress"`, which now hits the correct map entry.

### Evidence: SDK Type Definition

Confirmed via `@cursor/sdk/dist/esm/types/conversation-types.d.ts`:

```typescript
type: z.ZodLiteral<"updateTodos">;
args: {
    todos: {
        status: "cancelled" | "completed" | "pending" | "inProgress";
        content: string;
    }[];
};
```

No `id` field (handled by existing `todo-{index}` fallback), no `merge` field (handled by existing default-to-replace behavior).

### Test Coverage

Added `todo-tracker.test.ts` with 37 tests covering:
- Both tool names (`updateTodos` and `TodoWrite`)
- Event type/status filtering
- All status string variants (camelCase, snake_case, unknown, missing)
- ID handling (provided, absent, empty string)
- Snapshot replace vs merge semantics
- Dirty flag lifecycle
- Args parsing (object, JSON string, null, undefined, malformed)
- Timestamps
- Diagnostic log verification

## Benefits

- **Todo visibility restored**: Cursor harness executions now populate `status.todos`, enabling the React `TodoList`, Ink `TodoList`, and CLI `emitTodoEvents` to render task progress.
- **No downstream changes needed**: All consumers already handle the `TodoItem` proto — they just never received data from Cursor executions.
- **SDK version resilience**: Accepting both tool names ensures the tracker works across Cursor SDK versions.
- **Test safety net**: 37 tests prevent future regressions if the SDK schema evolves again.

## Impact

- **cursor-runner**: `todo-tracker.ts` (3 targeted edits), `__tests__/todo-tracker.test.ts` (new, 37 tests)
- **Users**: All Cursor harness executions will now show todo progress in web console, desktop app, Ink terminal, and CLI output.

## Related Work

- `2026-05-02-151851-cursor-runner-todowrite-capture.md`: Original `TodoTracker` implementation (introduced the name that is now fixed)
- Sub-agent todo routing: Still not implemented for Cursor harness (noted as future work)

---

**Status**: Production Ready
**Timeline**: Single session
