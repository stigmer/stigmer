# Checkpoint: Go Event Emission + Budget Enforcement Wiring

**Date**: 2026-05-13
**Task**: Go Event/Budget Wiring (post-T13, pre-T14)
**Status**: COMPLETE
**Scope**: Go workflow-runner only

## Accomplishments

Wired the existing event emitter (`pkg/events/emitter.go`, built in T13)
and budget tracker (`pkg/budget/tracker.go`, built in T13) into the task
execution loop (`DoTaskBuilder.iterateTasks`), completing the event-to-
persistence pipeline. The full chain — Go emitter -> gRPC `events` field
on `UpdateStatusInput` -> Java `PersistEventsStep` (MongoDB) +
`PublishEventsToRedisStep` (Redis) -> `getEventLog`/`subscribeEvents` RPCs
— is now connected end-to-end.

2 new files, 9 modified files. Zero test regressions.

## New Files

- `pkg/zigflow/tasks/task_kind_mapping.go` — Maps CNCF model task types
  and call function constants (`customCallFunctionLlm`, etc.) to
  `WorkflowTaskKind` proto enum values. Used by emitter to populate
  `task_kind` in task lifecycle events.

- `pkg/zigflow/tasks/flush_events_activity.go` — Temporal activity that
  sends buffered events to the backend via `UpdateStatusWithEvents`.
  Registered in `activitiesRegistry` via `init()`. Called from
  `DoTaskBuilder.flushEvents` with 10s timeout and 2 retry attempts.

## Modified Files

- `pkg/types/progress.go` — Added `Budget *WorkflowBudget`,
  `WorkflowID`, `WorkflowInstanceID` to `TemporalWorkflowInput`
- `worker/activities/execute_workflow_activity.go` — Populates budget
  and IDs from resolved workflow/instance protos
- `pkg/grpc_client/workflow_execution_client.go` — Added
  `UpdateStatusWithEvents` method (populates `events` field)
- `pkg/zigflow/tasks/task_builder_do.go` — Core wiring: emitter +
  tracker in DoTaskOpts, eventBuffer, bufferEvent/flushEvents helpers,
  extractCostFromOutput, checkBudget with policy enforcement
- `pkg/zigflow/tasks/task_builder_call_llm_activities.go` — Added
  `__stigmer_cost_micros` and `__stigmer_tokens` to LLM output
- `pkg/executor/temporal_workflow.go` — Creates emitter + tracker,
  emits ExecutionStarted/Completed/Failed lifecycle events
- 3 BUILD.bazel files (types, tasks, executor)

## Key Design Decisions

### DD: Event flush strategy — per-task
Flush events after every task via Temporal activity. The progress
interceptor already sends one gRPC call per task; one additional call
for events is tolerable. Can batch later if needed.

### DD: Cost extraction via output convention
LLM tasks inject `__stigmer_cost_micros` and `__stigmer_tokens` into
the output map (same pattern as `__stigmer_branch_override`). Stripped
before the output reaches downstream task processing.

### DD: Budget data flow — separate field on TemporalWorkflowInput
The `WorkflowBudget` proto is a Stigmer extension that doesn't survive
the proto -> YAML -> CNCF model round-trip. Carried as a separate field
on `TemporalWorkflowInput` alongside the YAML.

### DD: Budget human_review — dedicated signal channel
Budget-exceeded approval uses `budget_review_{execution_id}` signal
(not the `human_input_{task_name}` pattern) to avoid collision with
workflow-authored human_input tasks.

### DD: Agent cost attribution — deferred
Agent_call uses Temporal async completion; cost data comes back through
the Java callback, not through Go task output. Budget tracker records 0
for agent_call tasks. Accurate agent cost attribution is a follow-up.

## Verification

- `go build ./...` — clean
- `go vet ./...` — clean
- `go test ./pkg/...` — all pass, zero regressions

## Open Items

- OSS stigmer-server updateStatus handler does not yet persist events
- Agent cost attribution through async completion callback
- Event TTL configurability (hardcoded at 90 days in Java handler)
- `CheckBudgetWarnings()` (T05) not yet wired into `ValidateWorkflow()`
