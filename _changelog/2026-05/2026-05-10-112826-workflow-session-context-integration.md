# Cursor Workflow: Migrate to Full Session Context Read

**Date**: May 10, 2026

## Summary

Replaced the `readSessionThreadId` call in the Cursor harness Temporal workflow with `readSessionContext`, which returns thread ID, session memory, and cursor mode in a single database read. This completes the workflow integration for the cursor-harness-durability project (Task 7 of 8) and prepares the data path for cloud agent mode dispatch.

## Problem Statement

The Cursor harness workflow in `InvokeAgentExecutionWorkflowImpl` called `readSessionThreadId(sessionId)` before each `ExecuteCursor` activity dispatch. This returned only the Cursor agent ID — no session memory, no cursor mode. While the cursor-runner loaded these values itself via `getSession()`, the workflow had no observability into what mode or memory state the session was in.

### Pain Points

- Workflow logs showed only `thread_id` — no visibility into cursor mode or memory state
- No foundation for future cloud mode dispatch logic (Task 4 requires `cursorMode` at the workflow level)
- The deprecated `readSessionThreadId` method was still the only session read in the workflow despite `readSessionContext` being available since Task 6

## Solution

Replace `readSessionThreadId` with `readSessionContext` in the workflow's Cursor harness path. The `SessionContext` record (added in Task 6) bundles `threadId`, `sessionMemory`, and `cursorMode` from a single database query. The activity interface is unchanged — only `threadId` is passed to `ExecuteCursor`. Memory and mode are logged for observability and ready for Task 4.

A `Workflow.getVersion` guard ensures in-flight workflows that have already executed `readSessionThreadId` replay safely through the legacy code path.

## Implementation Details

**Workflow changes** (`InvokeAgentExecutionWorkflowImpl.java`):
- `executeCursorWithHitl` now calls `readSessionContext(sessionId)` at both invocation sites (initial dispatch and post-approval reinvocation)
- The returned `SessionContext` provides `threadId()`, `sessionMemory()`, and `cursorMode()`
- `threadId()` is extracted and passed to the activity (same interface as before)
- `cursorMode` and memory presence are logged at both invocation sites

**Version guard** (`readSessionContext` helper):
- `Workflow.getVersion("session-context-read", DEFAULT_VERSION, 1)` routes in-flight workflows to the legacy `readSessionThreadId` path and new workflows to `readSessionContext`
- Legacy path wraps the thread ID in a `SessionContext` with default memory and mode, preserving the same behavior
- Can be removed once all in-flight Cursor workflows have drained

**Tests** (`InvokeAgentExecutionWorkflowCursorTest.java`):
- 5 tests covering the Cursor harness workflow path specifically
- First execution with `SessionContext.EMPTY` (agent creation)
- Subsequent execution with populated memory and thread ID
- Graceful degradation when context read throws
- Single HITL approval cycle with context re-read on reinvocation
- Multiple HITL cycles verifying N+1 context reads for N approval cycles

## Benefits

- **Observability**: Workflow logs now include `cursor_mode` and `has_memory` on every Cursor dispatch
- **Forward-compatibility**: `cursorMode` available at the workflow level for Task 4 cloud mode dispatch
- **Deprecation progress**: Workflow no longer calls `readSessionThreadId` (new workflows use `readSessionContext`)
- **Test coverage**: First dedicated tests for the Cursor harness workflow path

## Impact

- **Cursor harness workflow**: All new Cursor session executions use the richer context read
- **In-flight workflows**: Replay safely via version guard — no behavioral change
- **Activity interface**: Unchanged — no TS cursor-runner modifications needed
- **Graphton flow**: Unaffected — this change is isolated to the Cursor harness path

## Related Work

- Task 6: Added `SessionContext` record, `readSessionContext`, and `updateSessionMemory` activity methods
- Task 3: Cursor-runner graceful resume-or-create flow with `AgentResolution`
- Task 4 (next): Cloud agent mode dispatch using `cursorMode` from session context

---

**Status**: Production Ready
**Timeline**: 1 session (Task 7 of cursor-harness-durability project)
