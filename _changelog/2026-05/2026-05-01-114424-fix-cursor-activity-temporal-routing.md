# fix(backend,cursor-runner): deterministic Temporal routing for ExecuteCursor activity

**Date**: May 1, 2026

## Summary

Fixed a non-deterministic Temporal activity routing bug where `ExecuteCursor` tasks could be dispatched to the Python agent-runner (which doesn't handle them), causing permanent execution failures. The fix introduces a derived task queue (`{baseQueue}:cursor`) for the cursor-runner, ensuring activities are always routed to the correct worker.

## Problem Statement

When a user selected a Cursor model (harness = CURSOR), the Go/Java workflow correctly dispatched the `ExecuteCursor` activity to the runner's task queue. However, both the Python agent-runner and the TypeScript cursor-runner polled the same queue. Temporal Server dispatches activity tasks to any worker on a queue without regard to registered activity types — it is effectively round-robin.

### Pain Points

- `ExecuteCursor` could be received by the Python worker, which fails it with `ApplicationError: NotFoundError`
- `MaximumAttempts: 1` means the first wrong dispatch is a permanent failure
- The failure is non-deterministic — sometimes it works (TypeScript gets it), sometimes it doesn't (Python gets it)
- The design document incorrectly assumed "Temporal routes activities by activity type name"

## Solution

Separate the cursor-runner onto a **derived task queue**. The convention is `{baseQueue}:cursor` — applied identically by both the workflow (when dispatching) and the cursor-runner (when polling).

## Implementation Details

**TypeScript cursor-runner** (`backend/services/cursor-runner/src/`):
- Added `CURSOR_QUEUE_SUFFIX = ":cursor"` constant in `config.ts`
- Worker now creates with `taskQueue: config.taskQueue + CURSOR_QUEUE_SUFFIX`
- Startup log shows the actual derived queue being polled

**Go workflow** (`backend/services/stigmer-server/`):
- Added `CursorQueueSuffix = ":cursor"` constant in `execute_cursor.go`
- `NewExecuteCursorActivityStub` dispatches to `taskQueue + CursorQueueSuffix`
- Updated doc comments on workflow impl and worker config

**Java workflow** (`stigmer-cloud`):
- Added `CURSOR_QUEUE_SUFFIX = ":cursor"` constant in `InvokeAgentExecutionWorkflowImpl.java`
- Cursor activity stub dispatches to `getActivityTaskQueue() + CURSOR_QUEUE_SUFFIX`

**Design document** corrected to reflect the derived-queue architecture and document why shared-queue polyglot was unreliable.

## Benefits

- Deterministic routing — no probabilistic dispatch, no wasted retries
- Backward-compatible — Python activities continue on the base queue unchanged
- Convention-based — no proto changes, no runner registration changes
- Scales to future harness types (e.g., `:devin`) with the same pattern

## Impact

- **Desktop app / CLI runners**: Cursor harness executions will route reliably to the TypeScript worker
- **Cloud runners**: Same fix via the Java workflow change
- **Existing sessions**: No impact — HARNESS_NATIVE sessions continue using the base queue

---

**Status**: Production Ready
