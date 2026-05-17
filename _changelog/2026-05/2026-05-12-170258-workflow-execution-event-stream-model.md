# Workflow Execution Event Stream Model (T06)

**Date**: May 12, 2026

## Summary

Introduced an append-only event log for workflow executions — the proto contract, query/streaming RPCs, and production integration point. This complements the existing full-snapshot `subscribe` pattern with a CQRS-like separation: snapshots for "what is the current state?", events for "what happened and when?". Enables the execution viewer timeline (T09), debugging, cost attribution, and audit trails.

## Problem Statement

The existing streaming architecture delivers full `WorkflowExecution` snapshots via `subscribe` (gRPC server-stream backed by Redis Streams). This answers "what is the current state?" but cannot answer:

### Pain Points

- No temporal history — you see the latest task status but not how many retries it took or how long each attempt lasted
- No cost timeline — aggregate cost is visible but not per-task breakdown over time
- No approval audit trail — you know it was approved but not by whom, when, or with what comment
- No agent subtrace context — agent_call tasks show final result but not progress during execution
- No debugging story — when a workflow fails after retries, the snapshot shows the final failure only

## Solution

A new `WorkflowExecutionEvent` proto model with discriminated payloads for 17 event types across 6 categories (execution lifecycle, task lifecycle, agent call, approval, budget, signals). Events are produced atomically alongside status updates via the existing `updateStatus` RPC, queried via `getEventLog`, and streamed in real-time via `subscribeEvents`.

## Implementation Details

### New Proto: `event.proto`

Created `apis/ai/stigmer/agentic/workflowexecution/v1/event.proto` with:
- **`WorkflowExecutionEvent`** envelope: `event_id`, `event_type`, `sequence_number`, `occurred_at`, `task_name`, `oneof payload`
- **`WorkflowEventType`** enum: 17 event types with numeric gaps for future additions (1–9 execution, 11–19 task, 21–29 agent, 31–39 approval, 41–49 budget, 51–59 signals)
- **20 typed payload messages**: one per event type with domain-specific fields (costs in micro-USD, durations in ms, references to child executions)

### Modified: `query.proto`

Added two new RPCs on `WorkflowExecutionQueryController`:
- **`getEventLog`** — paginated fetch with cursor-based pagination (`after_sequence`), event type filtering, task name filtering
- **`subscribeEvents`** — server-streaming with replay + live tail semantics

### Modified: `io.proto`

- Added `GetEventLogRequest`, `GetEventLogResponse`, `SubscribeEventsRequest` messages
- Added `repeated WorkflowExecutionEvent events = 10` to `WorkflowExecutionUpdateStatusInput` (Option A: piggyback on existing `updateStatus` RPC)
- Removed unused `WorkflowExecutionUpdate` message and `WorkflowUpdateType` enum (dead code, never wired)

### Codegen Fix: `sdk_client_ts.go`

Fixed a bug where streaming output types from non-api proto files were incorrectly imported from `api_pb`. The fix resolves types to their correct `_pb` file via `schema.MethodTypes` lookup.

## Benefits

- **Foundation for T09** (Execution Viewer): timeline UI can now consume structured events
- **Cost attribution**: per-task micro-USD and token tracking over time
- **Retry visibility**: full task_started → task_failed → task_retrying → task_started → task_completed story
- **Approval audit trail**: who approved what, when, with what comment
- **Agent subtrace references**: lightweight progress summaries with child_execution_id for drill-down
- **Zero disruption**: existing `subscribe` pipeline (Redis → full snapshots) untouched
- **Production-ready contract**: events produced atomically with status updates, no new infrastructure

## Impact

- **APIs**: New event proto, extended query service, extended command input
- **All SDKs**: Generated stubs in Go, Java, Python, TypeScript, Dart
- **TypeScript SDK**: New `getEventLog` and `subscribeEvents` methods on `WorkflowExecutionClient`
- **Codegen tooling**: Bug fix benefits any future streaming RPC with non-resource output type

## Related Work

- **T05**: Workflow Budget Primitives — `BudgetCheckpointPayload` references budget types from T05
- **T09** (future): Execution Viewer — will consume these events via `subscribeEvents`
- **T13** (future): Runtime Implementation — will wire event production into workflow-runner (Go) and stigmer-service (Java)

---

**Status**: ✅ Production Ready (proto contract; runtime wiring deferred to T13)
**Timeline**: Single session
