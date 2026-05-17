# Workflow Runner: Event Emission and Budget Enforcement Wiring

**Date**: May 13, 2026

## Summary

Connected the event emitter and budget tracker — both built in T13 but never wired — into the workflow-runner's task execution loop, completing the event-to-persistence pipeline from Go runner through Java backend to MongoDB and Redis. Workflows now emit structured execution events at task boundaries and enforce cost/token/duration budgets with configurable policies.

## Problem Statement

The workflow execution event pipeline was designed end-to-end across T06 (proto contract), T13 (Go emitter + budget tracker), and T13b (Java persistence + Redis streaming), but the critical "last mile" was missing: the Go workflow-runner never populated the `events` field on `WorkflowExecutionUpdateStatusInput`. This meant:

### Pain Points

- The Execution Viewer (T09) and `stigmer execution logs` CLI had no events to display from actual workflow runs
- Budget limits declared in `WorkflowSpec.budget` were purely decorative — no enforcement at task boundaries
- The Java event log infrastructure (MongoDB collection, Redis streams, getEventLog/subscribeEvents RPCs) was ready but received zero events

## Solution

Wire the existing `pkg/events/Emitter` and `pkg/budget/Tracker` into `DoTaskBuilder.iterateTasks` — the central task execution loop — and flush events to the backend through a new Temporal activity that calls `UpdateStatusWithEvents`.

## Implementation Details

**Event emission in the task loop** (`task_builder_do.go`):
- `TaskStarted` emitted before each task runs, with task kind resolved via new `ResolveTaskKind` mapping
- `TaskCompleted` emitted after success, including duration, cost, and token metrics
- `TaskFailed` emitted on error with attempt info and retry metadata
- `TaskSkipped` emitted when conditional logic skips a task
- Events buffer in `DoTaskBuilder.eventBuffer` and flush after each task via activity

**Lifecycle events in the executor** (`temporal_workflow.go`):
- `ExecutionStarted` at workflow begin with total task count and workflow/instance IDs
- `ExecutionCompleted` at workflow end with aggregate duration, cost, and tokens from tracker
- `ExecutionFailed` on workflow error with duration and error message

**Budget enforcement** (`task_builder_do.go`):
- `Tracker.Record(cost, tokens)` called after each task using `__stigmer_cost_micros`/`__stigmer_tokens` convention
- `Tracker.Check(workflow.Now(ctx))` at task boundaries evaluates cost, token, and duration limits
- `BudgetCheckpoint` event emitted with consumed vs. remaining capacity
- Three policies: `terminate` (default — non-retryable error), `human_review` (signal-based approval gate), `warn` (log and continue)

**Budget data flow gap resolved** (`progress.go` + `execute_workflow_activity.go`):
- `WorkflowBudget` proto passed as separate field on `TemporalWorkflowInput` because the budget is a Stigmer extension that doesn't survive the proto -> YAML -> CNCF model round-trip
- `WorkflowID` and `WorkflowInstanceID` also carried for event metadata

**New gRPC method** (`workflow_execution_client.go`):
- `UpdateStatusWithEvents` populates the `events` field on `WorkflowExecutionUpdateStatusInput`, which the Java handler (T13b) already processes through PersistEventsStep and PublishEventsToRedisStep

**New files**:
- `task_kind_mapping.go` — maps CNCF model task types and call function constants to `WorkflowTaskKind` proto enum
- `flush_events_activity.go` — Temporal activity that sends buffered events via gRPC; registered in the activity registry

## Benefits

- **Execution Viewer comes alive**: The T09 timeline, T12 CLI `execution logs`, and `subscribeEvents` live stream now receive real events from workflow runs
- **Budget enforcement is operational**: Cost-incurring workflows respect declared limits instead of running unbounded
- **Observable cost attribution**: `budget_checkpoint` events enable the cost timeline chart in the Execution Viewer
- **Zero breaking changes**: Existing workflows without budgets or event consumers continue to work unchanged — the emitter is nil-safe and the events field is backward-compatible (empty list = no-op)

## Impact

- **Workflow runner** (`backend/services/workflow-runner`): 11 files changed (2 new, 9 modified), 508 lines added
- **End-to-end pipeline**: Go runner -> gRPC updateStatus (with events) -> Java handler -> MongoDB + Redis -> getEventLog/subscribeEvents RPCs -> Execution Viewer / CLI
- **No proto changes**: All proto contracts were defined in T06; this is purely Go-side wiring

## Related Work

- T06: Execution Event Stream Model (proto contract — `event.proto`, `io.proto` events field)
- T13: P0 Task Types Backend (built `pkg/events/emitter.go` and `pkg/budget/tracker.go`)
- T13b: Java Cloud Parity (built MongoDB event repo, Redis writer, getEventLog/subscribeEvents handlers)
- T09: Execution Viewer (consumes events via `useWorkflowExecutionEventStream` hook)
- T05: Budget Primitives (defined `WorkflowBudget`, `BudgetExceededPolicy` protos)

---

**Status**: Production Ready
**Timeline**: Single session
