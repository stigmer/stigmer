# T01 Execution Log: Event Sequence Continuation (TS Runner)

**Started**: 2026-06-01 14:44
**Completed**: 2026-06-01 15:10
**Commit**: `dd1a4e8cb fix(backend/runner): continue event sequence from high-water mark on recovery`

## What Was Done

1. Added `StigmerClient.getEventLogHighWaterMark(executionId)` — paginates `getEventLog` with `pageSize=500` until `has_more=false`, returning the global max `sequence_number`.

2. Replaced `resetSequenceCounter()` with `initSequenceFromEventLog(executionId)` in `workflow-event-activities.ts`. Empty `executionId` falls back to counter=0 (preserving first-run behavior). Non-empty queries the server for the high-water mark.

3. Updated `engine-core.ts:145` from `ResetEventSequence()` to `ResetEventSequence(executionId)`.

4. Updated unit tests: replaced imports, added 5 new test cases (empty id, zero events, continuation from 42, large numbers, error propagation). All 42 affected tests pass.

## Key Decision: Activity Key Not Renamed

Kept the Temporal activity registry key as `ResetEventSequence` rather than renaming to `InitEventSequence`. Renaming would break Temporal replay for any in-flight workflows during deployment. The key is a wire contract; the implementation swap is safe.

## Key Discovery: `latest_sequence` Is Per-Page

`GetEventLogResponse.latest_sequence` is the highest `sequence_number` in the returned page, NOT a global maximum. The Go server computes it from the returned records only. Using `pageSize=1` would incorrectly set the counter to 1. The fix is to paginate to the last page (or use a future dedicated `getMaxEventSequence` RPC).

## Test Results

- `workflow-event-activities.test.ts`: 32/32 pass (5 new + 27 existing)
- `execute-serverless-workflow.test.ts`: 10/11 pass (1 pre-existing failure unrelated to T01)

## Files Changed

| File | Lines | Change |
|------|-------|--------|
| `stigmer-client.ts` | +35 | Added `getEventLogHighWaterMark` method |
| `workflow-event-activities.ts` | +15, -3 | Replaced reset with event-log init |
| `engine-core.ts` | +1, -1 | Pass executionId to activity |
| `workflow-event-activities.test.ts` | +95, -14 | New tests + updated imports |
