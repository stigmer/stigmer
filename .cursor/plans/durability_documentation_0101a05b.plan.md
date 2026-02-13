---
name: Durability Documentation
overview: Create comprehensive documentation for the durability features implemented in Phase 1, including fixing a broken documentation reference and adding new guides for wait task duration syntax, crash recovery, and event deduplication.
todos:
  - id: durable-execution-guide
    content: Create docs/guides/durable-execution.md - Fix broken reference, document crash recovery and durability guarantees
    status: completed
  - id: wait-task-duration
    content: Update docs/sdk/workflow/README.md - Document new Duration syntax with days/hours/minutes/seconds and absolute timestamps
    status: completed
  - id: event-deduplication
    content: Create docs/guides/event-deduplication.md - Document idempotency_key usage and best practices
    status: completed
  - id: agent-lifecycle
    content: Create docs/architecture/agent-execution-lifecycle.md - Document phases, operations, state transitions
    status: completed
  - id: update-index
    content: Update docs/README.md - Add links to new documentation files
    status: completed
isProject: false
---

# Durability Documentation Plan

## Background

Phase 1 of durable agentic workflows is complete with these features implemented:

- Gap A1: Durable agent sessions (crash recovery with heartbeat + checkpoint resume)
- Gap A3: Pause/resume propagation (workflow + agent execution lifecycle)
- Gap B1: Signal-with-start (race-proof event delivery)
- Gap B2: Event deduplication (24-hour TTL idempotency keys)
- Gap B6: ISO 8601 wait semantics (structured Duration + absolute timestamps)
- Agent Execution Lifecycle: 5 operations (cancel, terminate, recover, pause, resume)

## Documentation Locations

- Main docs: `[docs/](stigmer/docs/)`
- SDK docs: `[docs/sdk/workflow/README.md](stigmer/docs/sdk/workflow/README.md)`
- Architecture docs: `[docs/architecture/](stigmer/docs/architecture/)`
- Existing workflow lifecycle: `[docs/architecture/workflow-execution-lifecycle.md](stigmer/docs/architecture/workflow-execution-lifecycle.md)`

## Tasks

### 1. Create `docs/guides/durable-execution.md` (Priority: High)

**Fix broken reference** - This file is referenced in `workflow-execution-lifecycle.md` (line 340) but doesn't exist.

Content to include:

- Overview of Stigmer's durability guarantees
- The 5 durability layers concept
- How crash recovery works (heartbeat + checkpoint resume)
- LangGraph automatic checkpointing
- Temporal activity retries (3 attempts, exponential backoff)

Reference implementation in:

- `[execute_graphton.py](stigmer/backend/services/agent-runner/worker/activities/execute_graphton.py)` - heartbeat with thread_id, retry detection

### 2. Document Wait Task Duration Syntax (Priority: High)

**Update** `[docs/sdk/workflow/README.md](stigmer/docs/sdk/workflow/README.md)` to document the new Duration syntax.

Current WAIT example (lines 131-134) uses old string format:

```go
workflow.WaitTask("delay", workflow.WithDuration("5s"))
```

Document the new structured Duration:

```yaml
# Relative: wait with duration
- waitForApproval:
    wait:
      duration:
        days: 7
        hours: 2
        minutes: 30

# Absolute: wait until specific time
- waitUntilMarketOpen:
    wait:
      until: "2026-03-02T09:30:00Z"
```

Reference proto definition in:

- `[apis/stigmer/workflowexecution/v1/model.proto](stigmer/apis/stigmer/workflowexecution/v1/model.proto)` - Duration message, WaitTaskConfig

### 3. Document Event Deduplication (Priority: Medium)

**Create** `docs/guides/event-deduplication.md`

Content:

- What is idempotency and why it matters for events
- How to use `idempotency_key` in SendSignalInput
- 24-hour TTL window
- Per-organization key scoping
- Best practices (client-generated UUIDs, request-based keys)

Reference implementation:

- Go: `[backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe/](stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe/)`
- Proto: `idempotency_key` field in SendSignalInput

### 4. Document Agent Execution Lifecycle (Priority: Medium)

**Create** `docs/architecture/agent-execution-lifecycle.md`

Mirror the workflow execution lifecycle doc but for agent executions:

- Lifecycle phases (PENDING, IN_PROGRESS, PAUSED, COMPLETED, FAILED, CANCELLED, TERMINATED)
- Lifecycle operations: cancel, terminate, recover, pause, resume
- State transition diagram
- How pause/resume interacts with HITL approval

Reference implementation:

- Go handlers: `[backend/services/stigmer-server/pkg/domain/agentexecution/controller/](stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/controller/)`
  - `cancel.go`, `terminate.go`, `recover.go`, `pause.go`, `resume.go`
- Java workflow: `InvokeAgentExecutionWorkflowImpl.java` - pause/resume signals

### 5. Update Docs Index (Priority: Low)

**Update** `[docs/README.md](stigmer/docs/README.md)` to include new documentation:

- Add `guides/durable-execution.md` under Guides
- Add `guides/event-deduplication.md` under Guides
- Add `architecture/agent-execution-lifecycle.md` under Architecture

## File Summary


| Action | File                                             | Priority |
| ------ | ------------------------------------------------ | -------- |
| Create | `docs/guides/durable-execution.md`               | High     |
| Update | `docs/sdk/workflow/README.md`                    | High     |
| Create | `docs/guides/event-deduplication.md`             | Medium   |
| Create | `docs/architecture/agent-execution-lifecycle.md` | Medium   |
| Update | `docs/README.md`                                 | Low      |


## Not In Scope

- Phase 2 features (Human Task Management, Workflow Versioning, Saga/Compensation)
- API reference documentation (auto-generated from protos)
- Video tutorials or interactive guides

