# Java/Cloud Backend Parity: Event Log Persistence, Streaming, and Typed Workflow Approvals

**Date**: May 13, 2026

## Summary

Completed the Java control plane support for workflow execution events and human_input task approvals. The Go workflow-runner already executes all 6 new task types (T13); this work adds the persistence layer, query/streaming RPCs, and a typed approval RPC in the Java stigmer-service so those task types are fully observable, queryable, and interactable through the platform APIs.

## Problem Statement

The Go workflow-runner (T13) implemented runtime execution for 6 new P0 task types (llm_call, transform, validate, emit_event, notification, human_input). However, the Java control plane lacked:

### Pain Points

- No event log persistence — workflow execution events defined in proto (T06) had no storage backend
- No `getEventLog` or `subscribeEvents` RPC handlers — the execution viewer (T09) handled UNIMPLEMENTED gracefully but couldn't show real event timelines
- No typed approval RPC for workflow-level human_input tasks — users would need to know Temporal signal naming conventions to approve/deny
- No Redis event streaming — real-time event delivery to the execution viewer was not wired

## Solution

Added event log persistence (MongoDB), event streaming (Redis), paginated event queries, real-time event subscription, and a typed workflow task approval RPC — all following existing handler patterns in the Java service.

## Implementation Details

### Proto Changes (OSS)
- `SubmitWorkflowTaskApprovalInput` message: execution_id, task_name, outcome, form_data, reviewer, comment
- `submitWorkflowTaskApproval` RPC on `WorkflowExecutionCommandController` with can_edit authorization
- Generated stubs across Go, Java, TypeScript, Python, Dart via `make codegen` + `make protos`

### Event Log Persistence (Cloud)
- `WorkflowExecutionEventRepo` — separate `workflow_execution_events` MongoDB collection
- Compound unique index on (executionId, sequenceNumber) for deduplication
- TTL index on occurredAt (90 days retention)
- Secondary index on (executionId, eventType) for filtered queries
- Append-only semantics with ordered:false insertMany for duplicate tolerance

### Event Ingestion Pipeline
- Extended `UpdateWorkflowExecutionStatusHandler` with `PersistEventsStep` and `PublishEventsToRedisStep`
- Events arrive alongside status updates via the existing `events` field on `UpdateStatusInput`
- Backward compatible — empty events list is a no-op

### Event Query & Streaming
- `WorkflowExecutionGetEventLogHandler` — cursor-based pagination (after_sequence), type/task filtering, hasMore detection
- `WorkflowExecutionSubscribeEventsHandler` — replay-from-MongoDB + live-tail-from-Redis pattern with terminal state closure
- `WorkflowExecutionEventRedisWriter` — publishes to per-execution Redis streams

### Typed Workflow Task Approval
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandler` — validates task exists, constructs Temporal signal (`human_input_{task_name}`), builds payload matching Go's `HumanInputSignalPayload`
- Signal payload: `{outcome, form_data, reviewer, responded_at}`

## Benefits

- Execution viewer (T09) can now display real event timelines instead of falling back to status snapshots
- Human_input approval flow is fully typed — callers don't need to know Temporal signal naming conventions
- Event log enables cost attribution, retry visibility, and approval audit trails
- Redis event streaming enables real-time timeline updates in the execution viewer

## Impact

- **Execution Viewer** — can switch from UNIMPLEMENTED fallback to live event streaming
- **SDK hooks** — `useWorkflowExecutionEventLog` and `useWorkflowExecutionEventStream` can now connect to real backends
- **Human_input tasks** — fully end-to-end: Go runner waits on signal, Java service sends signal via typed RPC, UI can render approval cards
- **Audit trail** — all approval decisions are logged with reviewer identity and timestamp

## Related Work

- T06: Execution Event Stream Model (proto definitions this work persists)
- T09: Execution Viewer (React UI that consumes these RPCs)
- T13: P0 Task Types Backend Implementation (Go runtime this work complements)
- T05: Budget Primitives (budget_checkpoint events now persistable)

---

**Status**: Production Ready
**Repos**: stigmer (proto), stigmer-cloud (Java implementation)
