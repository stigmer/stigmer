# Fix Event Sequence Reset on Workflow Execution Recovery

**Date**: June 1, 2026

## Summary

Fixed a critical bug where workflow execution recovery events were silently dropped because the TS runner reset its event sequence counter to 1 on every engine start, colliding with already-persisted events from the failed run. The runner now queries the server for the persisted high-water mark before emitting new events, ensuring recovery events continue from the correct sequence number.

## Problem Statement

When a user clicks "Recover" on a failed workflow execution, the Go/Java orchestrator starts a fresh Temporal child workflow with the same `execution_id`. The TS runner's `runWorkflowEngine` unconditionally called `ResetEventSequence()`, which set the in-memory `sequenceCounter` back to 0. The first recovery event received `sequence_number = 1`, colliding with the original run's events already stored in the database.

### Pain Points

- **SQLite (OSS)**: `AppendWorkflowExecutionEvents` enforced monotonic sequence ordering and rejected the entire batch. The failure was non-fatal (logged as a warning), so status updates succeeded but events were dropped.
- **MongoDB (Cloud)**: The unique index on `(executionId, sequenceNumber)` caused `insertMany` to silently skip duplicates (error code 11000). Events were dropped with no error surfaced.
- **UI impact**: The execution viewer showed no progress after recovery — no events were persisted, so neither `getEventLog` nor `subscribeEvents` returned anything new.

## Solution

Replace the blind counter reset with an initialization that reads the highest persisted event sequence number from the server before emitting any new events.

The proto documentation at `event.proto:65` already specified this pattern ("If the runner crashes and restarts, it queries getEventLog to recover the last sequence number before emitting new events") — it was simply never implemented.

## Implementation Details

### `StigmerClient.getEventLogHighWaterMark(executionId)`

New method on the runner's gRPC client that paginates `getEventLog` with `pageSize=500` (the maximum) until `has_more=false`, returning the global maximum `sequence_number` across all persisted events. For a typical workflow execution with fewer than 500 events, this is a single RPC call. Returns `BigInt(0)` for new executions with no prior events.

A subtle but critical detail: `GetEventLogResponse.latest_sequence` is the highest sequence number **in the returned page**, not a global maximum. Using `pageSize=1` would incorrectly return `1` (the first event), not the actual high-water mark.

### `initSequenceFromEventLog(executionId)` replaces `resetSequenceCounter()`

The new function queries the high-water mark when `executionId` is non-empty, or falls back to `counter = 0` when empty (preserving first-run behavior for direct `executeServerlessWorkflow` calls without a persisted execution).

The Temporal activity registry key remains `ResetEventSequence` (not renamed) to maintain replay compatibility with any in-flight workflows during deployment. The underlying implementation is the only change.

### Files changed

| File | Change |
|------|--------|
| `backend/services/runner/src/client/stigmer-client.ts` | Added `getEventLogHighWaterMark` method |
| `backend/services/runner/src/activities/workflow-event-activities.ts` | Replaced `resetSequenceCounter` with `initSequenceFromEventLog`; kept activity key `ResetEventSequence` |
| `backend/services/runner/src/workflows/engine-core.ts` | Pass `executionId` to `ResetEventSequence(executionId)` |
| `backend/services/runner/src/activities/__tests__/workflow-event-activities.test.ts` | Updated imports, added 5 new tests for high-water-mark initialization |

## Benefits

- Recovery events are now persisted correctly — no more silent drops from sequence collisions
- The UI execution viewer shows live progress after recovery
- First-run behavior is unchanged (zero regression risk)
- No proto changes, no server-side changes, no cross-repo coordination required

## Impact

- **Workflow Execution Recovery (RC1)**: This was the highest-severity root cause in the recovery bug cluster. Without sequence continuation, none of the other recovery improvements (task-level resume, Cursor error classification, React store reset) would produce visible results — their events would also be dropped.
- **Scope**: TS runner only. No changes to the Go server, Java cloud service, or React SDK.
- **Part of project**: `20260601.01.fix-workflow-execution-recovery` (T01 of 9 tasks)

## Related Work

- T02 (Task-Level Resume in TS Engine) depends on T01 — it needs events to be persisted before task skip logic can work
- T05 (React Event Store Reset) complements T01 — the client-side store resets on phase transitions so the UI replays the full event history including recovery events
- T07 (Integration Tests) will add end-to-end verification that post-recovery events have monotonically increasing sequence numbers

---

**Status**: Production Ready
**Timeline**: T01 complete, remaining tasks (T02-T09) in progress
