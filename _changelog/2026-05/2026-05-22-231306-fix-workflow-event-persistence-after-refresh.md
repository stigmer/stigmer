# Fix Workflow Execution Event Persistence After Refresh

**Date**: May 22, 2026

## Summary

Fixed workflow execution events disappearing after page refresh in the web console. Events were visible during live streaming (via Redis) but "No events recorded" appeared on refresh because MongoDB persistence was silently failing due to protobuf JSON type mismatches. Added a resilient SDK fallback that reconstructs task status from the execution snapshot when events are unavailable.

## Problem Statement

When viewing a workflow execution in the web console, the execution timeline showed events correctly during live execution (via Redis live-tail streaming), but after refreshing or navigating away, the page showed "No events recorded" and "No tasks started". This made it impossible to review historical execution progress.

### Pain Points

- Workflow executions showed no historical timeline after completion
- The TASKS panel showed "No tasks started" for executions that clearly ran tasks
- Users had to be watching live to see execution progress — no replay capability
- The issue was systemic across all workflow executions on the cloud deployment

## Solution

Three-layer fix addressing root cause, resilience, and observability:

1. **Root cause fix**: Corrected BSON type mismatches in MongoDB event persistence (uint64 stored as string, ISO timestamps stored as string instead of Date)
2. **Resilience layer**: Added SDK fallback that synthesizes task states from `execution.status.tasks` when the event log is empty
3. **Reliability improvement**: Added retry logic and Micrometer metrics to the persist step

## Implementation Details

### Cloud Java Service (`stigmer-cloud`)

**`WorkflowExecutionEventRepo.java`** — Fixed `appendEvents()`:
- `sequenceNumber`: Proto JSON serializes `uint64` as a JSON string (`"1"` not `1`). `Document.parse()` stored this as a BSON string, causing lexicographic sort ("10" < "2") and broken `$gt` comparisons. Now explicitly overridden with `event.getSequenceNumber()` (numeric Long).
- `occurredAt`: Stored as ISO string by proto JSON, but MongoDB TTL indexes require Date type. Now converted via `Date.from(Instant.parse(...))`.
- `docToEvent()`: Added reverse conversion (Long→string, Date→ISO) when reading documents back for proto JSON parsing.

**`WorkflowExecutionUpdateStatusHandler.PersistEventsStep`** — Added retry and metrics:
- 2-attempt retry with 100ms backoff before giving up
- Micrometer counter `stigmer.workflow.events.persist` with `outcome=success|failure` tags

**`WorkflowExecutionGetEventLogHandler.FetchEventsStep`** — Added diagnostic logging:
- WARN-level log when returning empty events for a first-page request (signals persistence gap)

### React SDK (`sdk/react`)

**`WorkflowExecutionViewer.tsx`** — Added task-status fallback:
- When event log is empty and stream is complete, derives `DerivedTaskState` entries from `execution.status.tasks`
- Maps `WorkflowTaskStatus` enum to the viewer's status model
- Computes duration from task timestamps
- Passes effective task states to both timeline and task panel

**`WorkflowExecutionTimeline.tsx`** — Improved empty state:
- When fallback task states are available, shows "Task status available in the panel" hint below the "No events recorded" message

## Benefits

- Historical workflow execution timeline is now visible after page refresh
- Task panel always shows meaningful data even if event persistence failed
- Micrometer metrics enable alerting on event persistence failures
- Diagnostic logging makes future persistence issues immediately visible in logs
- Retry logic reduces transient failure impact

## Impact

- **Users**: Can now review completed workflow executions without watching live
- **Operators**: Micrometer metrics + WARN logs for monitoring event persistence health
- **SDK consumers**: `WorkflowExecutionViewer` is more resilient — shows degraded data rather than blank state

## Related Work

- T13b: Java/Cloud Backend Parity (introduced the event persistence pipeline)
- T09: Execution Viewer (React component consuming these events)

---

**Status**: Production Ready
**Repos**: stigmer (SDK), stigmer-cloud (Java backend)
