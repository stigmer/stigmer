# Checkpoint: T13b — Java/Cloud Backend Parity

**Date**: 2026-05-13
**Task**: T13b — Java/Cloud Backend Parity
**Status**: COMPLETE
**Scope**: Java stigmer-service (Cloud) + Proto changes (OSS)

## Accomplishments

Implemented Java control plane support for the 6 new P0 task types (llm_call,
transform, validate, emit_event, notification, human_input) by adding event log
persistence, event query/stream RPCs, and a typed workflow-level approval RPC.

5 new Java files, 2 modified Java files, 2 new test files, 2 proto files changed,
generated stubs updated across Go/Java/TypeScript/Python/Dart.

## Critical Architecture Insight

T13b is NOT about reimplementing task execution in Java. The polyglot Temporal
architecture means Go (workflow-runner) handles execution; Java (stigmer-service)
handles orchestration, persistence, and API serving. T13b completes the control
plane so the new task types are fully observable, queryable, and interactable.

## New Files (Cloud repo)

### Event Persistence
- `domain/agentic/workflowexecution/event/WorkflowExecutionEventRepo.java`
  — MongoDB repo with `workflow_execution_events` collection, compound unique
    index on (executionId, sequenceNumber), TTL index (90 days), type filter index

### Event Streaming
- `domain/agentic/workflowexecution/redis/WorkflowExecutionEventRedisWriter.java`
  — publishes events to per-execution Redis streams (`wfx_events:{id}`)

### RPC Handlers
- `WorkflowExecutionGetEventLogHandler.java` — cursor-based paginated event fetch
- `WorkflowExecutionSubscribeEventsHandler.java` — replay-from-MongoDB + live-tail-from-Redis
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandler.java` — typed human_input approval

### Tests
- `WorkflowExecutionGetEventLogHandlerTest.java` — pagination, hasMore, cursor, NOT_FOUND
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandlerTest.java` — task validation, phase, response

## Modified Files

### Cloud repo
- `WorkflowExecutionUpdateStatusHandler.java` — added PersistEventsStep + PublishEventsToRedisStep
- `BUILD.bazel` — 2 new test targets

### OSS repo
- `apis/.../workflowexecution/v1/io.proto` — added SubmitWorkflowTaskApprovalInput message
- `apis/.../workflowexecution/v1/command.proto` — added submitWorkflowTaskApproval RPC
- Generated stubs in Go, Java, TypeScript, Python, Dart (via make codegen + make protos)

## Key Design Decisions

### DD-T13b-001: Separate MongoDB Collection for Events
Events stored in `workflow_execution_events` collection (not embedded in
WorkflowExecution document) to support unbounded growth and efficient pagination.

### DD-T13b-002: Task Validation by Name Only
The approval handler validates task existence by name but not kind. The execution-side
WorkflowTask uses `task_type` (WorkflowTaskType enum) not `kind` (WorkflowTaskKind).
The signal naming convention (`human_input_{task_name}`) is the real discriminator.

### DD-T13b-003: Backward-Compatible Event Ingestion
Empty events list in status updates is a no-op. Older Go runners that don't emit
events continue to work unchanged.

### DD-T13b-004: Proto Events Field Already Existed
The `repeated WorkflowExecutionEvent events = 10` field on UpdateStatusInput was
already defined in T06. No proto change needed for event ingestion.

## Verification

- `bazelw build //backend/services/stigmer-service/...` — 85 targets, all pass
- `bazelw test` — 2/2 new tests pass
- `go build ./backend/services/workflow-runner/...` — clean

## Open Items

- Go-side event emission wiring (`pkg/events/emitter.go` built, not wired to updateStatus)
- Budget enforcement integration at task boundaries
- Event TTL configurability (hardcoded at 90 days)
