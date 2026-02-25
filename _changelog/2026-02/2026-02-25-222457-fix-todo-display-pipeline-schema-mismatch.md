# Fix Todo Display Pipeline: Schema Mismatch Between LangChain and StatusBuilder

**Date**: February 25, 2026

## Summary

Fixed a critical schema mismatch in the agent-runner's `StatusBuilder._update_todos()` that silently dropped every todo item emitted by LangChain's `TodoListMiddleware`. The LLM was calling `write_todos` correctly, but no todos ever reached `AgentExecutionStatus.todos` because the handler required an `id` field that the middleware's schema does not include.

## Problem Statement

The CLI todo blocks project (5 commits on `fix/cli-agent-execution-ux`) correctly implemented todo rendering in the TUI -- domain types, fingerprint-based change detection, block rendering, and snapshot bridge emission. However, running `stigmer draft skill` (or any agent execution) produced no visible todo blocks.

### Pain Points

- `TodoListMiddleware` (LangChain) defines `Todo` as `{content: str, status: str}` with no `id` field
- `StatusBuilder._update_todos()` called `todo_dict.get("id", "")` and silently skipped every item when `id` was empty
- Upsert-by-ID without clearing meant stale todos from prior `write_todos` calls would persist across snapshots
- Zero observability -- no log, no error, no metric when items were dropped

## Solution

Two fixes in `StatusBuilder._update_todos()`:

1. **Clear before apply**: `self.current_status.todos.clear()` before processing the new snapshot, matching `TodoListMiddleware`'s full-replacement semantics.
2. **Auto-generate IDs**: `todo_dict.get("id") or f"todo-{idx}"` generates stable, position-based keys when the middleware omits `id`, preserving the proto `map<string, TodoItem>` contract.

## Implementation Details

Single method change in `backend/services/agent-runner/worker/activities/graphton/status_builder.py`, `_update_todos()` (lines 1762-1803).

Key design decisions:
- **Position-based IDs** (`todo-0`, `todo-1`) are stable within a single `write_todos` call and work correctly with the CLI's fingerprint diffing (which compares `{content, status}` tuples keyed by ID)
- **Clear-then-apply** mirrors `TodoListMiddleware`'s `Command(update={"todos": todos})` semantics where each call replaces the entire list
- **Backward compatible**: if a future version of `TodoListMiddleware` adds `id`, the `or` fallback is bypassed and the provided ID is used directly
- Added `self.logger.info()` for snapshot-level observability

## Benefits

- Todo blocks now appear in the CLI TUI when the LLM calls `write_todos` during agent execution
- Stale todos from prior calls no longer persist after a snapshot replacement
- Observability: info-level log on every todo snapshot update with item count
- No changes to CLI, proto, gRPC streaming, Go backend, or agent YAML definitions

## Impact

- **Agent-runner**: `StatusBuilder._update_todos()` -- single method, ~40 lines changed
- **CLI users**: Todo blocks now render correctly for `stigmer run`, `stigmer draft skill`, and any command using `streamAgentExecution()`
- **Note**: Whether the LLM calls `write_todos` is non-deterministic. `TodoListMiddleware` instructs the LLM to skip planning for simple tasks. This is expected behavior, not a bug.

## Related Work

- [CLI Todo Blocks project](_projects/2026-02/20260225.01.cli-todo-blocks/) -- the 6-task project that built the TUI rendering
- [Wire Todo Stream Diffing](_changelog/2026-02/2026-02-25-010414-wire-todo-stream-diffing.md) -- fingerprint-based change detection in the stream bridge
- [Handle TodoUpdateEvent in TUI](_changelog/2026-02/2026-02-25-011547-handle-todoupdateevent-in-tui.md) -- event dispatcher wiring
- [Wire Snapshot Todo Events](_changelog/2026-02/2026-02-25-013140-wire-snapshot-todo-events.md) -- snapshot bridge emission

---

**Status**: Production Ready
**Timeline**: Analysis + fix in a single session
