# Agent Execution Temporal Integration

This package contains the Temporal workflow definitions and activities for agent execution in Stigmer OSS.

## Architecture

This implementation follows the **exact same polyglot pattern** as the Java (stigmer-cloud) implementation, with Go workflows orchestrating Python activities.

### Polyglot Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Temporal Server                              │
└─────────────────────────────────────────────────────────────────┘
                      │                    │
                      │                    │
         ┌────────────▼─────────┐  ┌──────▼──────────────┐
         │  Workflow Tasks       │  │  Activity Tasks     │
         │  (stigmer-server)     │  │  (agent-runner)     │
         └────────────┬─────────┘  └──────┬──────────────┘
                      │                    │
         ┌────────────▼─────────┐  ┌──────▼──────────────┐
         │  Go Worker            │  │  Python Worker      │
         │  agent_execution_     │  │  agent_execution_   │
         │  stigmer              │  │  runner             │
         │                       │  │                     │
         │  - InvokeWorkflow     │  │  - ExecuteGraphton  │
         │  - UpdateStatus       │  │  - EnsureThread     │
         │    (LOCAL)            │  │  - CleanupSandbox   │
         └───────────────────────┘  └─────────────────────┘
```

### Task Queue Separation

- **Go Workflow Queue**: `agent_execution_stigmer` (env: `TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE`)
  - Handles workflow orchestration
  - Routes activity calls to Python worker
  - Manages local activities (UpdateStatus)

- **Python Activity Queue**: `agent_execution_runner` (env: `TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE`)
  - Executes Graphton agents
  - Manages thread state
  - Processes agent events

### Why Polyglot?

1. **Language-Specific Strengths**:
   - Go: Fast, efficient workflow orchestration
   - Python: Rich AI/ML ecosystem (LangChain, LangGraph, OpenAI SDK)

2. **Clean Separation of Concerns**:
   - Go worker: Orchestration, persistence, system operations
   - Python worker: Agent execution, event processing, AI operations

3. **Independent Scaling**:
   - Scale workflow processing independently from agent execution
   - Different resource requirements (CPU vs GPU)

## Components

### Configuration

**`config.go`**: Environment-based configuration
- `StigmerQueue`: Task queue for Go workflows
- `RunnerQueue`: Task queue for Python activities
- Loaded from environment variables with defaults

### Workflows

**`workflows/invoke_workflow.go`**: Workflow interface
- Defines the contract for agent execution workflows
- Single method: `Run(execution)`

**`workflows/invoke_workflow_impl.go`**: Workflow implementation
- Orchestrates the execution flow:
  1. Ensure thread exists (Python activity)
  2. Execute Graphton agent (Python activity)
  3. Handle errors and update status (Go local activity)
- Retrieves activity queue from workflow memo
- Handles system errors with status updates

**`workflows/workflow_creator.go`**: Workflow starter
- Creates workflow options (ID, task queue, timeout, memo)
- Starts workflows asynchronously
- Called by AgentExecutionController after persistence

### Activities

#### Python Activities (Interfaces Only)

**`activities/ensure_thread.go`**: Thread management activity
- Interface for Python-implemented activity
- Ensures thread exists for conversation state
- Returns thread ID for agent invocation

**`activities/execute_graphton.go`**: Agent execution activity
- Interface for Python-implemented activity
- Executes Graphton agent at runtime
- Returns final status with messages, tool calls, etc.

#### Go Activities (Interface + Implementation)

**`activities/update_status.go`**: Status update activity interface
- Defines contract for persistence operations
- Used for system error recovery

**`activities/update_status_impl.go`**: Status update implementation
- Loads execution from BadgerDB
- Merges status updates (messages, tool_calls, phase, etc.)
- Updates audit timestamps
- Persists back to BadgerDB
- **Registered as LOCAL activity** (runs in-process, no task queue)

### Worker Configuration

**`worker_config.go`**: Worker setup and registration
- Creates Temporal worker on stigmer queue
- Registers Go workflow implementations
- Registers local activities (UpdateStatus)
- **Does NOT register Python activities** (critical for polyglot)
- Comprehensive documentation on polyglot rules

## Critical Polyglot Rules

### ✅ CORRECT

1. **Each worker registers ONLY what it implements**
   - Go worker: Workflows + Go activities
   - Python worker: Python activities only

2. **Activity calls specify target task queue**
   - Passed via workflow memo
   - Enables environment-specific configuration

3. **Local activities for in-process operations**
   - UpdateStatus runs in workflow process
   - Avoids task queue routing complexity

### ❌ WRONG

1. **Go registers Python activities**
   - Breaks load balancing
   - Activities sent to wrong worker

2. **Python registers workflows**
   - Causes workflow dispatch confusion
   - Violates separation of concerns

3. **Missing task queue in activity calls**
   - Activities routed to wrong worker
   - Runtime errors

## Activity Name Matching (ASK_UNAME Pattern)

**CRITICAL**: Activity names MUST match exactly between Go interfaces and Python implementations.

### Go Side (Interface)
```go
// activities/ensure_thread.go
const EnsureThreadActivityName = "EnsureThread"  // ← Must match Python

// activities/execute_graphton.go
const ExecuteGraphtonActivityName = "ExecuteGraphton"  // ← Must match Python
```

### Python Side (Implementation)
```python
# agent-runner worker registration
@activity.defn(name="EnsureThread")  # ← Must match Go
async def ensure_thread(session_id: str, agent_id: str) -> str:
    ...

@activity.defn(name="ExecuteGraphton")  # ← Must match Go
async def execute_graphton(execution: AgentExecution, thread_id: str) -> AgentExecutionStatus:
    ...
```

**Why This Matters**:
- Temporal routes activities by name
- Mismatch = `ActivityNotRegistered` errors
- Case-sensitive matching required
- No runtime validation until first call

## Workflow Execution Flow

### 1. Create Execution (AgentExecutionController)
```go
// create.go
execution := &AgentExecution{...}
store.Put(execution)  // Persist first

// Start Temporal workflow
creator.Create(execution)
```

### 2. Workflow Starts (Go Worker)
```go
// workflows/invoke_workflow_impl.go
Run(ctx, execution) {
    // Get activity queue from memo
    activityQueue := getActivityTaskQueue(ctx)
    
    // Step 1: Ensure thread (Python)
    threadID := ensureThreadActivity.EnsureThread(sessionID, agentID)
    
    // Step 2: Execute agent (Python)
    status := executeGraphtonActivity.ExecuteGraphton(execution, threadID)
    
    return nil
}
```

### 3. Python Activities Execute (Python Worker)
```python
# agent-runner activities
@activity.defn(name="EnsureThread")
async def ensure_thread(session_id: str, agent_id: str) -> str:
    # Create/fetch thread
    return thread_id

@activity.defn(name="ExecuteGraphton")  
async def execute_graphton(execution: AgentExecution, thread_id: str) -> AgentExecutionStatus:
    # Execute Graphton agent
    # Send progressive updates via gRPC
    # Return final status
    return final_status
```

### 4. Error Handling (Go Workflow)
```go
// workflows/invoke_workflow_impl.go
if err := executeGraphtonFlow(ctx, execution); err != nil {
    // Update status to FAILED (local activity)
    updateStatusActivity.UpdateExecutionStatus(executionID, failedStatus)
    return err
}
```

## Environment Variables

```bash
# Go workflow queue (default: agent_execution_stigmer)
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=agent_execution_stigmer

# Python activity queue (default: agent_execution_runner)
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner
```

## Integration with AgentExecutionController

The controller needs to be updated to start workflows after persistence:

```go
// agentexecution/create.go
func (c *AgentExecutionController) buildCreatePipeline() *pipeline.Pipeline[*AgentExecution] {
    return pipeline.NewPipeline[*AgentExecution]("agent-execution-create").
        AddStep(steps.NewValidateProtoStep()).
        AddStep(newValidateSessionOrAgentStep()).
        AddStep(steps.NewResolveSlugStep()).
        AddStep(steps.NewBuildNewStateStep()).
        AddStep(newCreateDefaultInstanceIfNeededStep()).
        AddStep(newCreateSessionIfNeededStep()).
        AddStep(newSetInitialPhaseStep()).
        AddStep(steps.NewPersistStep(c.store)).
        AddStep(newStartWorkflowStep(c.workflowCreator)).  // ← Add this
        Build()
}
```

## Testing

### Unit Tests (TODO)
- [ ] Workflow logic (mocked activities)
- [ ] Activity implementations
- [ ] Config loading from environment
- [ ] Error handling paths

### Integration Tests (TODO)
- [ ] Full workflow execution with test Temporal server
- [ ] Polyglot communication (Go ↔ Python)
- [ ] Activity task queue routing
- [ ] Error recovery scenarios

## Comparison with Java Implementation

This Go implementation is **functionally equivalent** to the Java implementation in stigmer-cloud:

| Component | Java (stigmer-cloud) | Go (stigmer OSS) |
|-----------|---------------------|------------------|
| Config | `AgentExecutionTemporalConfig` | `temporal.Config` |
| Worker Config | `AgentExecutionTemporalWorkerConfig` | `temporal.WorkerConfig` |
| Workflow Interface | `InvokeAgentExecutionWorkflow` | `workflows.InvokeAgentExecutionWorkflow` |
| Workflow Impl | `InvokeAgentExecutionWorkflowImpl` | `workflows.InvokeAgentExecutionWorkflowImpl` |
| Workflow Creator | `InvokeAgentExecutionWorkflowCreator` | `workflows.InvokeAgentExecutionWorkflowCreator` |
| Ensure Thread Activity | `EnsureThreadActivity` (interface) | `activities.EnsureThreadActivity` (interface) |
| Execute Graphton Activity | `ExecuteGraphtonActivity` (interface) | `activities.ExecuteGraphtonActivity` (interface) |
| Update Status Activity | `UpdateExecutionStatusActivityImpl` | `activities.UpdateExecutionStatusActivityImpl` |

### Key Differences

1. **Language Idioms**:
   - Java: Annotations (`@ActivityInterface`, `@WorkflowMethod`)
   - Go: Interfaces and explicit registration

2. **Configuration**:
   - Java: Spring `@ConfigurationProperties`
   - Go: Environment variables + struct

3. **Logging**:
   - Java: SLF4J + Lombok
   - Go: zerolog

4. **Activity Stubs**:
   - Java: `Workflow.newActivityStub()` with builder
   - Go: Helper functions (`NewEnsureThreadActivityStub()`)

5. **Local Activities**:
   - Java: `Workflow.newLocalActivityStub()`
   - Go: `workflow.WithLocalActivityOptions()` + `ExecuteLocalActivity()`

## Future Enhancements

1. **Metrics & Observability**
   - Workflow execution metrics
   - Activity duration tracking
   - Error rate monitoring

2. **Advanced Error Handling**
   - Retry policies per activity type
   - Circuit breakers for external calls
   - Dead letter queues for failed workflows

3. **Testing Infrastructure**
   - Mock Temporal server
   - Integration test suite
   - Performance benchmarks

4. **Configuration Flexibility**
   - Dynamic queue assignment
   - Environment-specific timeouts
   - Feature flags for experimental workflows

## Resources

- [Temporal Go SDK Documentation](https://docs.temporal.io/dev-guide/go)
- [Polyglot Workflows Guide](https://docs.temporal.io/dev-guide/polyglot)
- [Java Implementation Reference](stigmer-cloud: `ai.stigmer.domain.agentic.agentexecution.temporal`)
