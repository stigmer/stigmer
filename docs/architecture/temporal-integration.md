# Temporal Integration Architecture

## Overview

Stigmer uses **Temporal** for durable workflow orchestration, enabling reliable, long-running agent and workflow executions with built-in retry logic, error handling, and observability.

The architecture follows a **polyglot pattern** where:
- **Go** (stigmer-server) orchestrates workflows
- **Python** (agent-runner) executes AI/agent activities
- **Temporal** routes tasks between workers based on task queues

This enables each language to focus on its strengths: Go for efficient orchestration, Python for rich AI/ML ecosystem integration.

## Why Temporal?

**Problem**: Agent executions can take minutes, involve external API calls, and require robust error handling.

**Traditional approach**:
- Direct RPC calls (no retry on failure)
- Manual timeout management
- Complex error recovery logic
- No execution history or observability

**Temporal approach**:
- Automatic retries with configurable policies
- Built-in timeout management
- Durable state across failures
- Complete execution history
- Workflow versioning for safe deployments

**Result**: Reliable agent executions that survive process crashes, network issues, and temporary failures.

## Architecture

### Polyglot Workflow Pattern

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
         │  Queue:               │  │  Queue:             │
         │  agent_execution_     │  │  agent_execution_   │
         │  stigmer              │  │  runner             │
         │                       │  │                     │
         │  Workflows:           │  │  Activities:        │
         │  - InvokeAgent        │  │  - ExecuteGraphton  │
         │  - InvokeWorkflow     │  │  - EnsureThread     │
         │                       │  │  - CleanupSandbox   │
         │  Local Activities:    │  │                     │
         │  - UpdateStatus       │  │                     │
         └───────────────────────┘  └─────────────────────┘
```

### Task Queue Separation

**Critical Design Principle**: Each worker listens to its own task queue and registers ONLY what it implements.

**Go Worker** (stigmer-server):
- **Queue**: `agent_execution_stigmer` (configurable via env var)
- **Registers**: 
  - Workflows (InvokeAgentExecutionWorkflow, InvokeWorkflowExecutionWorkflow)
  - Local activities (UpdateExecutionStatusActivity - runs in-process)
- **Does NOT register**: Python activities (critical for polyglot routing)

**Python Worker** (agent-runner):
- **Queue**: `agent_execution_runner` (configurable via env var)
- **Registers**:
  - Activities (ExecuteGraphton, EnsureThread, CleanupSandbox)
- **Does NOT register**: Workflows (Go handles orchestration)

**Why separate queues?**
- Independent scaling (workflow orchestration vs agent execution)
- Language-specific resource requirements (CPU vs GPU)
- Clear separation of concerns
- Simplified debugging (task types map to workers)

### Workflow Execution Flow

**Example: Agent Execution**

1. **User creates execution** via gRPC
   - AgentExecutionController validates and persists execution
   - Triggers Temporal workflow asynchronously

2. **Go workflow starts** (on `agent_execution_stigmer` queue)
   - Workflow: `InvokeAgentExecutionWorkflow`
   - Retrieves Python activity queue from workflow memo
   - Orchestrates activity execution

3. **Workflow calls Python activities** (routed to `agent_execution_runner` queue)
   - Step 1: `EnsureThread` - Creates/fetches LangGraph thread for state
   - Step 2: `ExecuteGraphton` - Runs Graphton agent with thread_id
   - Activities send progressive status updates via gRPC (real-time)
   - Final status returned to workflow (for observability)

4. **On success**: Workflow completes, execution status is COMPLETED

5. **On failure**: Workflow calls local activity to update status to FAILED

### Activity Name Matching (Critical)

**Polyglot Requirement**: Activity names MUST match exactly (case-sensitive) between Go interfaces and Python implementations.

**Go Side** (interface):
```go
// backend/services/stigmer-server/.../activities/ensure_thread.go
const EnsureThreadActivityName = "EnsureThread"  // ← MUST match Python
```

**Python Side** (implementation):
```python
# backend/services/agent-runner/worker/activities/ensure_thread.py
@activity.defn(name="EnsureThread")  # ← MUST match Go
async def ensure_thread(session_id: str, agent_id: str) -> str:
    ...
```

**Mismatch consequences**:
- Runtime error: `ActivityNotRegistered`
- No compile-time validation (polyglot limitation)
- Workflow fails immediately on activity call

**Naming Convention**: PascalCase (e.g., `EnsureThread`, `ExecuteGraphton`, `UpdateExecutionStatus`)

### Workflow Memo for Queue Routing

**Problem**: How does the Go workflow know which queue to send Python activities to?

**Solution**: Activity queue passed via workflow memo (metadata attached to workflow).

**Workflow Creator** (when starting workflow):
```go
options := client.StartWorkflowOptions{
    TaskQueue: config.StigmerQueue,  // Go workflow queue
    Memo: map[string]interface{}{
        "activityTaskQueue": config.RunnerQueue,  // Python activity queue
    },
}
```

**Workflow Implementation** (retrieving queue):
```go
func (w *InvokeWorkflowImpl) getActivityTaskQueue(ctx workflow.Context) string {
    info := workflow.GetInfo(ctx)
    if taskQueue, ok := info.Memo.GetValue("activityTaskQueue"); ok {
        var taskQueueStr string
        if err := taskQueue.Get(&taskQueueStr); err == nil && taskQueueStr != "" {
            return taskQueueStr
        }
    }
    return "agent_execution_runner" // Default fallback
}
```

**Benefits**:
- Environment-specific configuration (dev, staging, prod)
- No hardcoded queue names in workflow code
- Testable with different queues

### Local Activities for In-Process Operations

**Local Activities** run in the workflow worker process (not routed via Temporal task queues).

**Use Cases**:
- Fast operations (< 1 second)
- Direct database access (BadgerDB in stigmer-server)
- System error recovery (updating status on workflow failure)

**Example**: `UpdateExecutionStatusActivity`

**Why local?**
- Avoids task queue routing complexity
- Direct access to BadgerDB store
- Only used for error recovery (not normal flow)
- No need for Python worker communication

**Implementation**:
```go
// Workflow calls local activity
err := workflow.ExecuteLocalActivity(localCtx, 
    activities.UpdateExecutionStatusActivityName, 
    executionID, 
    failedStatus).Get(localCtx, nil)
```

**Worker registration**:
```go
// Registered as local activity (not on task queue)
worker.RegisterActivity(updateStatusActivityImpl.UpdateExecutionStatus)
```

### Status Update Strategy

**Two mechanisms for status updates**:

1. **Real-time updates** (normal flow):
   - Python activity sends progressive updates via gRPC to stigmer-server
   - Controller: `AgentExecutionController.UpdateStatus()`
   - Updates persisted to BadgerDB immediately
   - Frontend receives real-time progress

2. **Final status** (observability):
   - Python activity returns final status to workflow
   - Workflow logs final state for Temporal observability
   - Not persisted via workflow (already persisted via gRPC)

3. **Error recovery** (failure path):
   - Workflow catches errors
   - Calls local activity: `UpdateExecutionStatusActivity`
   - Persists FAILED status with error details
   - Ensures execution status always reflects reality

**Why this design?**
- Real-time updates: Frontend responsiveness
- Final status: Temporal workflow history and debugging
- Error recovery: Workflow failures handled gracefully

## Configuration

### Environment Variables

**Go Worker** (stigmer-server):
```bash
# Go workflow queue (default: agent_execution_stigmer)
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=agent_execution_stigmer

# Python activity queue (passed to workflows via memo)
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner

# Temporal server connection
export TEMPORAL_HOST_PORT=localhost:7233
```

**Python Worker** (agent-runner):
```bash
# Python activity queue (must match Go's runner queue)
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner

# Temporal server connection
export TEMPORAL_HOST_PORT=localhost:7233
```

### Environment-Specific Configuration

**Development**:
```bash
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=dev-agent-stigmer
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=dev-agent-runner
```

**Staging**:
```bash
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=staging-agent-stigmer
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=staging-agent-runner
```

**Production**:
```bash
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=prod-agent-stigmer
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=prod-agent-runner
```

**Benefits**:
- Isolated task queues per environment
- Prevents cross-environment workflow execution
- Simplified multi-tenant deployment

## Integration Guide

### Starting Temporal Server

**Local Development** (Docker):
```bash
docker run -d \
  --name temporal \
  -p 7233:7233 \
  temporalio/auto-setup:latest
```

**Temporal UI** (optional, for debugging):
```bash
docker run -d \
  --name temporal-ui \
  -p 8080:8080 \
  --env TEMPORAL_ADDRESS=host.docker.internal:7233 \
  temporalio/ui:latest
```

Access UI: http://localhost:8080

### Starting Workers

**Go Worker** (stigmer-server):
```bash
# Set environment variables
export TEMPORAL_HOST_PORT=localhost:7233
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=agent_execution_stigmer
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner

# Start stigmer-server (worker starts automatically)
./bin/stigmer-server
```

**Python Worker** (agent-runner):
```bash
# Set environment variables
export TEMPORAL_HOST_PORT=localhost:7233
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner

# Start agent-runner worker
python -m backend.services.agent-runner.worker.main
```

### Verifying Setup

**Check worker registration**:
```bash
# Temporal CLI (if installed)
temporal workflow list --namespace default

# Or check Temporal UI
# Navigate to: http://localhost:8080
# Look for workers on task queues:
# - agent_execution_stigmer
# - agent_execution_runner
```

**Test workflow execution**:
```bash
# Create an agent execution via gRPC
# Check Temporal UI for workflow execution
# Verify activities executed on correct workers
```

## Common Issues and Solutions

### Issue: `ActivityNotRegistered` Error

**Symptom**: Workflow fails with "activity not registered" error

**Cause**: Activity name mismatch between Go and Python

**Solution**: Verify exact name match (case-sensitive):
- Go: `const EnsureThreadActivityName = "EnsureThread"`
- Python: `@activity.defn(name="EnsureThread")`

### Issue: Activities Sent to Wrong Worker

**Symptom**: Go worker receives Python activities (or vice versa)

**Cause**: Both workers registered the same activities

**Solution**: Verify worker registration:
- Go worker: Only workflows + local activities
- Python worker: Only Python activities
- No overlap

### Issue: Workflow Can't Find Activity Queue

**Symptom**: Activities timeout or fail to start

**Cause**: Memo not passed correctly or not retrieved

**Solution**: Verify:
1. Workflow creator sets memo: `Memo: map[string]interface{}{"activityTaskQueue": ...}`
2. Workflow retrieves memo: `info.Memo.GetValue("activityTaskQueue")`
3. Activity stub uses correct queue: `NewEnsureThreadActivityStub(ctx, taskQueue)`

### Issue: Workers Not Polling

**Symptom**: Workflows/activities never execute

**Cause**: Worker not started or connected to wrong Temporal server

**Solution**:
- Check `TEMPORAL_HOST_PORT` is correct
- Verify Temporal server is running
- Check worker logs for connection errors
- Verify task queue names match configuration

## Performance Considerations

### Workflow Timeouts

- **Workflow Run Timeout**: 10 minutes (agent executions)
- **EnsureThread Activity**: 30 seconds (fast operation)
- **ExecuteGraphton Activity**: 10 minutes (long-running agent)
- **UpdateStatus Local Activity**: 30 seconds (database write)

**Rationale**: 
- Most agents complete in < 5 minutes
- 10-minute timeout provides buffer for complex agents
- Local activities fast (direct DB access)

### Retry Policies

- **EnsureThread**: Max 3 attempts, 5s initial interval
  - Recovers from transient gRPC/database errors
  
- **ExecuteGraphton**: Max 1 attempt (no retries)
  - Agent execution is not idempotent
  - Retry could duplicate actions or API calls
  
- **UpdateStatus**: Max 3 attempts, 2s initial interval
  - Ensures status persisted even on DB contention

### Scaling Considerations

**Go Worker** (workflow orchestration):
- Lightweight, CPU-bound
- Scale based on workflow creation rate
- Typical: 1-5 workers for most deployments

**Python Worker** (agent execution):
- Heavyweight, may need GPU
- Scale based on concurrent agent executions
- Typical: 2-10 workers, depending on load

**Independent Scaling**: Each worker type scales independently based on queue depth.

## Future Enhancements

### Planned

1. **Workflow Validation**
   - Validate workflow definitions before execution
   - Temporal activity for zigflow syntax checking

2. **Child Workflows**
   - Sub-agent executions as child workflows
   - Parallel agent execution orchestration

3. **Saga Pattern**
   - Compensating transactions for failed executions
   - Rollback workflows for cleanup

### Under Consideration

1. **Metrics & Observability**
   - Workflow execution metrics (Prometheus)
   - Activity duration tracking
   - Error rate monitoring

2. **Advanced Retry Logic**
   - Exponential backoff with jitter
   - Circuit breakers for external calls
   - Dead letter queues for failed workflows

3. **Multi-Tenancy**
   - Organization-specific task queues
   - Resource isolation per org
   - Rate limiting per tenant

## Related Documentation

- [Agent Runner Local Mode](../agent-runner-local-mode.md) - How agent-runner operates locally
- [Backend Abstraction](backend-abstraction.md) - Backend interface design
- [Workflow Runner Config ADR](../adr/20260119-011111-workflow-runner-config.md) - Workflow runner architecture

## References

- Code: `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/`
- Code: `backend/services/stigmer-server/pkg/controllers/workflowexecution/temporal/`
- Temporal Go SDK: https://docs.temporal.io/dev-guide/go
- Polyglot Workflows: https://docs.temporal.io/dev-guide/polyglot

---

**Remember**: The polyglot pattern requires strict adherence to activity name matching and worker registration rules. Any deviation will cause runtime errors.
