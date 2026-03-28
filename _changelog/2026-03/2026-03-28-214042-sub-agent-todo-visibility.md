# Sub-Agent Todo Visibility

**Date**: March 28, 2026

## Summary

Sub-agent `write_todos` calls were silently dropped by the backend, leaving users with zero visibility into what sub-agents are planning or doing. This change adds a `todos` field to `SubAgentExecution`, routes sub-agent todo data through the backend, and renders todo progress directly in the sub-agent card — both as a collapsed live preview and a full checklist when expanded.

## Problem Statement

When a sub-agent called `write_todos`, the backend's `status_builder.py` explicitly discarded the data with a debug log ("skipping sub-agent write_todos"). The `SubAgentExecution` proto had no `todos` field, so there was nowhere to store the data even if the backend tried. Users monitoring complex executions with delegated sub-agents had no way to see what each sub-agent was working on.

### Pain Points

- Sub-agent task progress was invisible — users could only see messages and tool calls, not the plan
- The main agent's sidebar todo widget only showed the root execution's todos; there was no place for sub-agent todos
- `TodoItem` lived in `api.proto`, creating a circular import if `subagent.proto` tried to reference it

## Solution

Four-layer change following the proto → stubs → backend → SDK pipeline:

1. **Proto**: Extract `TodoItem` into its own `todo.proto` (breaking the circular import), add `map<string, TodoItem> todos = 14` to `SubAgentExecution`
2. **Stubs**: `make protos` to regenerate Go, Java, Python, TS stubs
3. **Backend**: Replace the "skip" logic with `_update_sub_agent_todos()` that populates `sub_agent.todos`
4. **React SDK**: Extract shared `TodoList` component, render it in `SubAgentSection` (collapsed preview + expanded checklist)

## Implementation Details

### Proto Layer

- Created `apis/.../todo.proto` containing `TodoItem` message (extracted from `api.proto`)
- `api.proto` now imports `todo.proto` instead of defining `TodoItem` inline
- `subagent.proto` imports `todo.proto` and adds `map<string, TodoItem> todos = 14`
- No circular imports — `todo.proto` only depends on `enum.proto`

### Backend (`status_builder.py`)

- Updated `TodoItem` import to reference new `todo_pb2` module
- Changed `write_todos` handler: when `sub_agent is not None`, calls `_update_sub_agent_todos(sub_agent, todos_data)` instead of returning early
- New `_update_sub_agent_todos` method mirrors `_update_todos` but targets `sub_agent.todos`
- Added integration test `test_sub_agent_write_todos_populates_sub_agent_todos` verifying data flows to the correct proto map
- Updated existing mock-based tests to verify `_update_sub_agent_todos` is called for sub-agent namespaces

### React SDK

**`TodoList.tsx`** (new shared component):
- `TodoList` — renders sorted checklist from a `todos` map prop
- `TodoInProgressIcon` — pulsing dot animation, exported for reuse
- `findActiveTodo()` / `todoCompletionSummary()` — utility functions for collapsed preview
- Same icons, sort order, and `--stgm-*` tokens as the main agent's sidebar widget

**`ExecutionProgress.tsx`** (refactored):
- Delegates to `TodoList` instead of maintaining its own `TodoRow` / icon code
- Reduced from 192 lines to 62 lines

**`SubAgentSection.tsx`** (enhanced):
- **Collapsed view**: Two-line card showing active todo with pulsing dot (running) or completion summary (completed)
- **Expanded view**: Full `TodoList` checklist at top of content, above messages and tool calls
- Visual weight difference between sub-agent cards (two lines) and tool call groups (one line) correctly signals the semantic difference

**Barrel exports**: `TodoList`, `TodoListProps`, `TodoInProgressIcon`, `findActiveTodo`, `todoCompletionSummary` exported from `@stigmer/react` for platform builders.

## Benefits

- Sub-agent task progress is now visible without expanding the card
- The two-line collapsed card visually differentiates sub-agents from tool calls — bigger semantic weight gets bigger visual footprint
- Shared `TodoList` component eliminates duplication between sidebar widget and sub-agent section
- Platform builders can import `TodoList` independently to render todo checklists in their own UI
- No changes needed to the CLI or main agent sidebar widget — both continue working as before

## Impact

- **Proto**: New `todo.proto` file, `TodoItem` extracted from `api.proto` (same package, no breaking change for Go/Java consumers)
- **Backend**: Sub-agent `write_todos` no longer silently dropped; existing tests updated
- **React SDK**: New component, refactored existing component, enhanced sub-agent card
- **Generated stubs**: All languages regenerated (Go, Java, Python, TS)
- **CLI**: Not affected — will benefit from proto/backend changes in a follow-up

## Related Work

- [Sub-agent UI visibility fix](_changelog/2026-03/2026-03-28-191432-fix-sub-agent-ui-visibility.md) — promoted sub-agents to standalone thread items
- [Sub-agent collapsible cards](_changelog/2026-03/2026-03-28-195822-sub-agent-collapsible-progressive-disclosure.md) — added the collapsible card pattern this feature builds on

---

**Status**: ✅ Production Ready
