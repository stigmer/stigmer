---
name: Agent Execution Lifecycle
overview: Extend pause/resume/cancel/terminate/recover lifecycle commands from workflow execution to agent execution, enabling full lifecycle control over agent runs.
todos:
  - id: proto-messages
    content: Add lifecycle input messages (Cancel, Terminate, Recover, Pause, Resume) to agentexecution/v1/io.proto
    status: completed
  - id: proto-rpcs
    content: Add lifecycle RPCs (cancel, terminate, recover, pause, resume) to agentexecution/v1/command.proto
    status: completed
  - id: regenerate-stubs
    content: Regenerate proto stubs (make generate-proto)
    status: completed
  - id: go-lifecycle-steps
    content: Create lifecycle_steps.go with pipeline steps for agent execution
    status: completed
  - id: go-temporal-client
    content: Add SetTemporalClient() to AgentExecutionController and workflow ID helper
    status: completed
  - id: go-cancel
    content: Implement cancel.go handler
    status: completed
  - id: go-terminate
    content: Implement terminate.go handler
    status: completed
  - id: go-recover
    content: Implement recover.go handler
    status: completed
  - id: go-pause
    content: Implement pause.go handler
    status: completed
  - id: go-resume
    content: Implement resume.go handler
    status: completed
  - id: java-interface
    content: Add pause() and resume() signal methods to InvokeAgentExecutionWorkflow interface
    status: completed
  - id: java-impl
    content: Implement pause/resume signal handlers in InvokeAgentExecutionWorkflowImpl
    status: completed
  - id: wire-up
    content: Register handlers in gRPC server and update BUILD.bazel
    status: completed
isProject: false
---

# Agent Execution Lifecycle Implementation

## Background

Workflow execution now has complete lifecycle control (cancel, terminate, recover, pause, resume) from Gap A3. Agent execution needs the same capabilities to provide full control over agent runs. The proto enum `EXECUTION_PAUSED` was already added to agent execution during A3 implementation.

## Current State

**Agent execution has:**

- `create`, `update`, `updateStatus`, `delete`, `submitApproval` RPCs
- `EXECUTION_PAUSED` phase enum (already added)
- StreamBroker for real-time updates
- WorkflowCreator for Temporal integration

**Agent execution is missing:**

- Lifecycle RPCs: `cancel`, `terminate`, `recover`, `pause`, `resume`
- Lifecycle input messages
- Pipeline steps for lifecycle operations
- Java workflow signal handlers for pause/resume

## Implementation Plan

### Phase 1: Proto & Stubs

Add lifecycle messages and RPCs to agent execution proto.

**Files to modify:**

- `[stigmer/proto/stigmer/agentic/agentexecution/v1/io.proto](stigmer/proto/stigmer/agentic/agentexecution/v1/io.proto)` - Add input messages
- `[stigmer/proto/stigmer/agentic/agentexecution/v1/command.proto](stigmer/proto/stigmer/agentic/agentexecution/v1/command.proto)` - Add RPCs

**New messages in `io.proto`:**

```protobuf
message CancelAgentExecutionInput {
  string id = 1;
  string reason = 2;
}

message TerminateAgentExecutionInput {
  string id = 1;
  string reason = 2;
}

message RecoverAgentExecutionInput {
  string id = 1;
}

message PauseAgentExecutionInput {
  string id = 1;
  string reason = 2;
}

message ResumeAgentExecutionInput {
  string id = 1;
}
```

**New RPCs in `command.proto`:**

```protobuf
rpc cancel(CancelAgentExecutionInput) returns (AgentExecution);
rpc terminate(TerminateAgentExecutionInput) returns (AgentExecution);
rpc recover(RecoverAgentExecutionInput) returns (AgentExecution);
rpc pause(PauseAgentExecutionInput) returns (AgentExecution);
rpc resume(ResumeAgentExecutionInput) returns (AgentExecution);
```

Then regenerate stubs: `make generate-proto`

### Phase 2: Go Pipeline Infrastructure

Create lifecycle pipeline steps for agent execution.

**New file:**

- `stigmer/backend/services/stigmer-server/internal/domain/agentic/agentexecution/controller/lifecycle_steps.go`

**Pipeline steps to implement (following workflow execution pattern):**

- `LoadExecutionByIdStep` - Load agent execution by ID
- `ValidateCancellableStep` - Validates IN_PROGRESS or PENDING phase
- `ValidateTerminableStep` - Validates non-terminal phase
- `ValidateRecoverableStep` - Validates FAILED or CANCELLED phase
- `ValidatePausableStep` - Validates PENDING or IN_PROGRESS phase
- `ValidateResumableStep` - Validates PAUSED phase
- `CancelTemporalWorkflowStep` - Cancel via Temporal API
- `TerminateTemporalWorkflowStep` - Terminate via Temporal API
- `ResetTemporalWorkflowStep` - Reset via Temporal API
- `SignalPauseToTemporalStep` - Send "pause" signal
- `SignalResumeToTemporalStep` - Send "resume" signal
- `UpdateExecutionPhaseStep` - Update phase in database
- `LifecyclePersistStep` - Save execution
- `LifecycleBroadcastStep` - Broadcast update via StreamBroker

**Also add to controller:**

- `SetTemporalClient()` method (reference: [workflow execution controller](stigmer/backend/services/stigmer-server/internal/domain/agentic/workflowexecution/controller/controller.go))
- Workflow ID helper function

### Phase 3: Go Handlers

Implement lifecycle handlers using the pipeline steps.

**New files:**

- `stigmer/backend/services/stigmer-server/internal/domain/agentic/agentexecution/controller/cancel.go`
- `stigmer/backend/services/stigmer-server/internal/domain/agentic/agentexecution/controller/terminate.go`
- `stigmer/backend/services/stigmer-server/internal/domain/agentic/agentexecution/controller/recover.go`
- `stigmer/backend/services/stigmer-server/internal/domain/agentic/agentexecution/controller/pause.go`
- `stigmer/backend/services/stigmer-server/internal/domain/agentic/agentexecution/controller/resume.go`

Each handler follows the same pipeline pattern:

```go
// Example: pause.go
func (c *AgentExecutionController) Pause(ctx context.Context, input *agentexecutionv1.PauseAgentExecutionInput) (*agentexecutionv1.AgentExecution, error) {
    return pipeline.New[*agentexecutionv1.AgentExecution]().
        Add(LoadExecutionByIdStep(c.store, input.Id)).
        Add(ValidatePausableStep()).
        Add(SignalPauseToTemporalStep(c.temporalClient, input.Reason)).
        Add(UpdateExecutionPhaseStep(agentexecutionv1.ExecutionPhase_EXECUTION_PAUSED)).
        Add(LifecyclePersistStep(c.store)).
        Add(LifecycleBroadcastStep(c.streamBroker)).
        Execute(ctx)
}
```

### Phase 4: Java Workflow

Add signal handlers to the Java workflow implementation.

**Files to modify:**

- `[stigmer-cloud/.../agentexecution/temporal/workflow/InvokeAgentExecutionWorkflow.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflow.java)` - Add signal methods to interface
- `[stigmer-cloud/.../agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java)` - Implement signal handlers

**Add to interface:**

```java
@SignalMethod
void pause(String reason);

@SignalMethod
void resume();
```

**Implementation pattern:**

- Add `paused` boolean state and `pauseReason` string
- In `executeAgentTask()`, wrap activity in CancellationScope
- On pause signal, cancel scope gracefully
- On resume signal, restart activity with same checkpoint
- Python activity already handles graceful cancellation (done in A3)

### Phase 5: Wire Up & Test

1. Register new RPC handlers in gRPC server
2. Add Temporal client initialization in server startup
3. Update BUILD.bazel files as needed
4. Compile and verify no errors

## Key Design Decisions

1. **Reuse Python activity cancellation handling** - Already implemented in A3 for workflow execution
2. **Same phase transitions as workflow execution** - PAUSED is non-terminal, can resume
3. **Idempotent operations** - Pause on PAUSED returns current state, resume on IN_PROGRESS returns current state
4. **Temporal signals for pause/resume** - Same pattern as workflow execution

## Files Summary


| Layer | New Files                                                                                | Modified Files                                                               |
| ----- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Proto | -                                                                                        | `io.proto`, `command.proto`                                                  |
| Go    | `lifecycle_steps.go`, `cancel.go`, `terminate.go`, `recover.go`, `pause.go`, `resume.go` | `controller.go`                                                              |
| Java  | -                                                                                        | `InvokeAgentExecutionWorkflow.java`, `InvokeAgentExecutionWorkflowImpl.java` |
| Stubs | -                                                                                        | Regenerated (Go, Python)                                                     |


## Scope Note

This implementation focuses on agent execution lifecycle. The Python activity cancellation handling implemented in A3 is shared code and will work for both workflow and agent execution.