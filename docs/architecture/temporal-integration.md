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

### Three Worker Domains

Stigmer implements **three separate Temporal worker domains**, each with its own queue configuration and responsibilities:

| Domain | Purpose | Stigmer Queue | Runner Queue | Status |
|--------|---------|---------------|--------------|--------|
| **Workflow Execution** | Execute workflow definitions | `workflow_execution_stigmer` | `workflow_execution_runner` | ✅ Implemented |
| **Agent Execution** | Execute AI agent invocations | `agent_execution_stigmer` | `agent_execution_runner` | ✅ Implemented |
| **Workflow Validation** | Validate workflow syntax | `workflow_validation_stigmer` | `workflow_validation_runner` | ⏸️ Planned |

**Design Rationale:**
- **Separation of concerns**: Each domain has distinct workflows and activities
- **Independent scaling**: Scale agent execution separately from workflow execution
- **Resource isolation**: GPU-intensive agent work doesn't impact workflow orchestration
- **Clear observability**: Task queues map directly to feature domains

### Worker Initialization in stigmer-server

Workers are initialized during `main.go` startup following this sequence:

```go
// 1. Create Temporal Client (conditional - may be nil)
temporalClient, err := client.Dial(client.Options{
    HostPort:  cfg.TemporalHostPort,
    Namespace: cfg.TemporalNamespace,
})
// If connection fails: temporalClient = nil, proceed without Temporal

// 2. Create Workers and Workflow Creators (if client exists)
if temporalClient != nil {
    // Workflow Execution Worker
    workflowExecutionConfig := workflowexecutiontemporal.LoadConfig()
    workflowExecutionWorker = workflowExecutionWorkerConfig.CreateWorker(temporalClient)
    workflowExecutionCreator = workflows.NewInvokeWorkflowExecutionWorkflowCreator(...)
    
    // Agent Execution Worker
    agentExecutionConfig := agentexecutiontemporal.NewConfig()
    agentExecutionWorker = agentExecutionWorkerConfig.CreateWorker(temporalClient)
    agentExecutionCreator = agentexecutiontemporal.NewInvokeAgentExecutionWorkflowCreator(...)
    
    // Workflow Validation Worker
    workflowValidationConfig := workflowtemporal.NewConfig()
    workflowValidationWorker = workflowValidationWorkerConfig.CreateWorker(temporalClient)
    workflowValidator = workflowtemporal.NewServerlessWorkflowValidator(...)

}

// 3. Register gRPC Controllers

// 4. Start In-Process gRPC Server

// 5. Start Temporal Workers (if workers exist)
if workflowExecutionWorker != nil {
    workflowExecutionWorker.Start()
    defer workflowExecutionWorker.Stop()  // Graceful shutdown
}
if agentExecutionWorker != nil {
    agentExecutionWorker.Start()
    defer agentExecutionWorker.Stop()
}

// 6. Inject Workflow Creators into Controllers
workflowExecutionController.SetWorkflowCreator(workflowExecutionCreator)
agentExecutionController.SetWorkflowCreator(agentExecutionCreator)
```

**Key Design Decisions:**
- **Early Creation**: Workers created before gRPC services (fail fast on config errors)
- **Late Start**: Workers started after gRPC services (controllers must be ready)
- **Graceful Degradation**: Nil-safe injection allows running without Temporal
- **Deferred Cleanup**: `defer worker.Stop()` ensures clean shutdown

**Implementation Status:**
- ✅ Workflow Execution worker: Fully implemented and integrated
- ✅ Agent Execution worker: Fully implemented and integrated
- ✅ Workflow Validation worker: Fully implemented and integrated

**Critical Integration Fix (2026-01-20)**:
- Workers were implemented and running
- Controllers were NOT calling them (validation skipped, executions stuck)
- **Fix Applied**: All controller integrations now complete
  - Workflow validation: Controllers call validator before persist
  - Agent execution: Controllers start workflows after persist
  - Workflow execution: Already integrated (verified)

**Graceful Degradation:**

stigmer-server can operate without Temporal:
- If Temporal server is unavailable, client creation fails silently
- Workers and workflow creators remain `nil`
- Controllers receive `nil` workflow creators (nil-safe injection)
- gRPC endpoints work, but workflow/agent executions won't start
- Server logs warning: "Failed to connect to Temporal - workflows will not execute"

This allows:
- Development without Temporal dependency
- Service startup even if Temporal is down
- Non-workflow features remain functional
- Graceful error messages when workflows are attempted

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

### Controller Integration Pattern

**How Controllers Trigger Temporal Workflows**

Controllers integrate with Temporal through pipeline steps that call workflow creators or validators. This pattern enables clean separation between business logic (controllers) and workflow orchestration (Temporal).

**Three Integration Patterns**:

**1. Workflow Validation** (Synchronous Validation):
```go
// In WorkflowController.Create pipeline:
AddStep(newValidateWorkflowSpecStep(c.validator))  // Step 2, after proto validation

// The step:
func (s *validateWorkflowSpecStep) Execute(ctx *pipeline.RequestContext) error {
    // Skip if Temporal not available (nil-safe)
    if s.validator == nil {
        log.Warn().Msg("Skipping validation - Temporal not available")
        return nil
    }
    
    // Call Temporal workflow synchronously (blocks until validation complete)
    validation, err := s.validator.Validate(ctx.Context(), spec)
    if err != nil {
        return fmt.Errorf("validation failed: %w", err)
    }
    
    // Check validation state
    if validation.State == INVALID {
        return fmt.Errorf("invalid workflow: %s", validation.Errors[0])
    }
    
    // Store result in context for later steps
    ctx.Set("validation_result", validation)
    return nil
}
```

**2. Execution Triggering** (Asynchronous Start):
```go
// In WorkflowExecutionController.Create pipeline:
AddStep(c.newStartWorkflowStep())  // Step 9, after persist

// The step:
func (s *startWorkflowStep) Execute(ctx *pipeline.RequestContext) error {
    // Skip if Temporal not available (nil-safe)
    if s.workflowCreator == nil {
        log.Warn().Msg("Execution will remain PENDING - Temporal not available")
        return nil
    }
    
    execution := ctx.NewState()
    
    // Start Temporal workflow asynchronously (returns immediately)
    if err := s.workflowCreator.Create(execution); err != nil {
        // Mark execution as FAILED and persist
        execution.Status.Phase = FAILED
        execution.Status.Error = err.Error()
        s.store.SaveResource(ctx.Context(), kind, executionID, execution)
        return fmt.Errorf("failed to start workflow: %w", err)
    }
    
    return nil
}
```

**3. Agent Execution Triggering** (Same Pattern):
```go
// In AgentExecutionController.Create pipeline:
AddStep(c.newStartWorkflowStep())  // Step 9, after persist

// Implementation identical to WorkflowExecution pattern
// Uses InvokeAgentExecutionWorkflowCreator instead
```

**Key Design Principles**:
- **Nil-Safe**: All steps check if Temporal client available (graceful degradation)
- **Pipeline Steps**: Integration is a pipeline step (composable with other steps)
- **Error Handling**: Validation errors abort pipeline, workflow start errors mark execution FAILED
- **Timing**: Validation BEFORE persist, execution triggering AFTER persist

**Why After Persist?**
- Temporal activities query database for execution details
- Prevents race condition (workflow queries before persist completes)
- Consistent with Java Cloud implementation

### Two-Layer Validation Architecture (Workflows Only)

Workflows use a **two-layer validation pipeline** to catch errors early:

**Layer 1: Proto Validation** (Fast)
- **What**: Buf Validate rules on proto fields
- **When**: First pipeline step (before Temporal)
- **Performance**: <50ms
- **Catches**: Field constraints, required fields, enum values, string patterns
- **Example**: `replicas` must be >= 1, `name` must match regex

**Layer 2: Comprehensive Validation** (Temporal)
- **What**: Deep validation via Temporal workflow
- **When**: Second pipeline step (after Layer 1 passes)
- **Performance**: 50-200ms
- **Catches**:
  - Proto → YAML conversion errors
  - Serverless Workflow structure validation (Zigflow parser)
  - Semantic errors (invalid state references, transition logic, etc.)
- **Single Source of Truth**: workflow-runner validates (same code that executes)

**Why Two Layers?**
- **Fast feedback** for simple errors (Layer 1)
- **Comprehensive validation** for complex errors (Layer 2)
- **Single source of truth**: workflow-runner validates (consistency guaranteed)

**Validation Flow**:
```
User submits workflow
    ↓
[Layer 1] Proto Validation (buf validate) - <50ms
    ↓ (if valid)
[Layer 2] Temporal Validation (proto → YAML → Zigflow) - 50-200ms
    ↓ (if valid)
Persist workflow to database
    ↓
Workflow created successfully
```

**Error Handling**:
- **Layer 1 Fails**: Immediate error, no Temporal call
- **Layer 2 INVALID**: User error (bad structure) → `INVALID_ARGUMENT` gRPC error
- **Layer 2 FAILED**: System error (Temporal/activity failure) → `INTERNAL` gRPC error

**Example Error Messages**:
```
Layer 1: "Field validation failed: name must match pattern ^[a-z][a-z0-9-]*$"
Layer 2: "Workflow validation failed: State 'process_data' not defined in states array"
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

**Go Worker** (stigmer-server) - **Three Worker Domains**:
```bash
# Workflow Execution Domain
export TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE=workflow_execution_stigmer
export TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner

# Agent Execution Domain
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=agent_execution_stigmer
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner

# Workflow Validation Domain
export TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE=workflow_validation_stigmer
export TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner

# Temporal server connection
export TEMPORAL_HOST_PORT=localhost:7233
export TEMPORAL_NAMESPACE=default
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

**Go Workers** (stigmer-server) - **All Three Domains**:
```bash
# Set environment variables for all three worker domains
export TEMPORAL_HOST_PORT=localhost:7233
export TEMPORAL_NAMESPACE=default

# Workflow Execution Domain
export TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE=workflow_execution_stigmer
export TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner

# Agent Execution Domain
export TEMPORAL_AGENT_EXECUTION_STIGMER_TASK_QUEUE=agent_execution_stigmer
export TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner

# Workflow Validation Domain
export TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE=workflow_validation_stigmer
export TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner

# Start stigmer-server (all workers start automatically)
./bin/stigmer-server
```

**Expected Log Output:**
```
INFO Created workflow execution worker and creator stigmer_queue=workflow_execution_stigmer runner_queue=workflow_execution_runner
INFO Workflow execution worker started
INFO Created agent execution worker and creator stigmer_queue=agent_execution_stigmer runner_queue=agent_execution_runner
INFO Agent execution worker started
INFO Created workflow validation worker and validator stigmer_queue=workflow_validation_stigmer runner_queue=workflow_validation_runner
INFO Workflow validation worker started
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
# - workflow_execution_stigmer (Go workflows)
# - workflow_execution_runner (Go activities)
# - agent_execution_stigmer (Go workflows)
# - agent_execution_runner (Python activities)
# - workflow_validation_stigmer (Go workflows)
# - workflow_validation_runner (Go activities)
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

## Workflow Registration Patterns

### Critical Bug Fix (2026-01-20)

A critical bug in workflow registration was causing server crashes on startup. This section documents the correct patterns to prevent recurrence.

### The Problem

**Symptom**: Server crashed immediately after startup with:
```
panic: expected a func as input but was ptr

goroutine 1 [running]:
go.temporal.io/sdk/internal.(*registry).RegisterWorkflowWithOptions(...)
```

**Root Cause**: Temporal SDK expects a **function reference**, but we were passing a **struct instance**:

```go
// ❌ WRONG - Causes panic
w.RegisterWorkflowWithOptions(
    &workflows.InvokeWorkflowExecutionWorkflowImpl{},  // Struct pointer
    workflow.RegisterOptions{Name: "..."},
)
```

Temporal tried to call the struct as a function, resulting in the panic.

### The Solution

Pass the workflow **method reference** explicitly:

```go
// ✅ CORRECT - Passes method
w.RegisterWorkflowWithOptions(
    (&workflows.InvokeWorkflowExecutionWorkflowImpl{}).Run,  // Method reference
    workflow.RegisterOptions{Name: "..."},
)
```

### Two Registration Patterns

Temporal SDK supports two workflow patterns:

**Pattern 1: Standalone Functions**
```go
// Define workflow as standalone function
func MyWorkflow(ctx workflow.Context, input *Input) error {
    // Workflow logic
    return nil
}

// Register directly (function reference)
w.RegisterWorkflowWithOptions(MyWorkflow, workflow.RegisterOptions{
    Name: "my-workflow",
})
```

**Pattern 2: Struct Methods** (More complex, requires explicit method reference)
```go
// Define workflow as struct with Run method
type MyWorkflowImpl struct{}

func (w *MyWorkflowImpl) Run(ctx workflow.Context, input *Input) error {
    // Workflow logic  
    return nil
}

// ✅ CORRECT: Register method reference
w.RegisterWorkflowWithOptions(
    (&MyWorkflowImpl{}).Run,  // Get instance, then reference Run method
    workflow.RegisterOptions{
        Name: "my-workflow",
    },
)

// ❌ WRONG: Register struct instance  
w.RegisterWorkflowWithOptions(
    &MyWorkflowImpl{},  // Temporal can't call this as a function
    workflow.RegisterOptions{
        Name: "my-workflow",
    },
)
```

### When to Use Each Pattern

**Use Pattern 1 (Standalone Function) when:**
- ✅ Simple workflow with no state
- ✅ No helper methods needed
- ✅ Single workflow per file

**Example**: `ValidateWorkflowWorkflow` - Simple validation, no state

**Use Pattern 2 (Struct Methods) when:**
- ✅ Workflow needs helper methods
- ✅ Complex orchestration logic
- ✅ Multiple related functions
- ✅ Better code organization

**Example**: `InvokeWorkflowExecutionWorkflow`, `InvokeAgentExecutionWorkflow` - Complex orchestration with helpers

### Registration in Stigmer

**Three Workers, Three Workflows:**

1. **Workflow Execution** (Pattern 2 - Struct Method):
```go
// backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/worker_config.go
w.RegisterWorkflowWithOptions(
    (&workflows.InvokeWorkflowExecutionWorkflowImpl{}).Run,  // ✅ Method reference
    workflow.RegisterOptions{
        Name: workflows.InvokeWorkflowExecutionWorkflowName,
    },
)
```

2. **Agent Execution** (Pattern 2 - Struct Method):
```go
// backend/services/stigmer-server/pkg/domain/agentexecution/temporal/worker_config.go
w.RegisterWorkflowWithOptions(
    (&workflows.InvokeAgentExecutionWorkflowImpl{}).Run,  // ✅ Method reference
    workflow.RegisterOptions{
        Name: workflows.InvokeAgentExecutionWorkflowName,
    },
)
```

3. **Workflow Validation** (Pattern 1 - Standalone Function):
```go
// backend/services/stigmer-server/pkg/domain/workflow/temporal/worker.go
w.RegisterWorkflowWithOptions(
    ValidateWorkflowWorkflowImpl,  // ✅ Function reference
    workflow.RegisterOptions{
        Name: WorkflowValidationWorkflowType,
    },
)
```

### Why This Bug Occurred

When we initially implemented workflow execution and agent execution workers, we copied the registration pattern from the validation worker:

```go
// Validation worker (Pattern 1 - worked fine)
w.RegisterWorkflowWithOptions(ValidateWorkflowWorkflowImpl, ...)

// Execution workers (Pattern 2 - copied incorrectly)
w.RegisterWorkflowWithOptions(&WorkflowImpl{}, ...)  // ❌ Should be (&WorkflowImpl{}).Run
```

**Key Difference**: Validation uses a standalone function; execution workflows use struct methods.

The registration syntax looks similar, but struct methods require the explicit method reference.

### Testing Workflow Registration

**Verify correct registration**:

1. **Start stigmer-server**:
```bash
$ stigmer server start
✓ Ready! Stigmer server is running
  PID:  50609
```

2. **Check server doesn't crash** (wait 5+ seconds):
```bash
$ stigmer server status
  Status: ✓ Running  # ✅ Still running = registration worked
```

3. **Check logs for successful registration**:
```bash
$ tail -50 ~/.stigmer/data/logs/stigmer-server.err | grep "Registered"
✅ [POLYGLOT] Registered InvokeWorkflowExecutionWorkflow (Go)
✅ [POLYGLOT] Registered InvokeAgentExecutionWorkflow (Go)  
✅ [POLYGLOT] Registered ValidateWorkflowWorkflow (Go)
```

**If registration fails**:
```bash
# Server crashes with panic
panic: expected a func as input but was ptr

# Check registration - likely missing .Run method reference
```

### Impact

**Before fix**:
- ❌ Server crashed on startup
- ❌ No Temporal workflows available
- ❌ Local mode completely broken

**After fix**:
- ✅ Server starts successfully
- ✅ All three workflows register correctly
- ✅ Workflows execute reliably

## Daemon Health Checks

### Critical Bug Fix (2026-01-20)

CLI connection failures occurred even when the server was starting. This section documents the proper health check implementation.

### The Problem

**Symptom**: CLI reported "Cannot connect to stigmer-server" even though:
- Server process had started (PID file existed)
- Server was initializing
- Server would become ready shortly after

**Root Cause**: Daemon manager had a placeholder health check:

```go
func WaitForReady(ctx context.Context, endpoint string) error {
    // TODO: Implement health check
    // For now, just wait a moment
    time.Sleep(1 * time.Second)  // ❌ Arbitrary wait
    return nil
}
```

**Race Condition**:
1. Daemon process starts
2. CLI waits 1 second (arbitrary)
3. CLI assumes daemon is ready
4. CLI tries to connect
5. gRPC server not yet initialized → failure

### The Solution

Implemented proper health check that polls the gRPC server:

```go
func WaitForReady(ctx context.Context, endpoint string) error {
    ticker := time.NewTicker(500 * time.Millisecond)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return errors.Wrap(ctx.Err(), "daemon did not become ready in time")
            
        case <-ticker.C:
            // Try to connect to the gRPC server
            dialCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
            conn, err := grpc.DialContext(dialCtx, endpoint,
                grpc.WithTransportCredentials(insecure.NewCredentials()),
                grpc.WithBlock(),
            )
            cancel()

            if err != nil {
                // Server not ready yet, continue polling
                log.Debug().Err(err).Msg("Daemon not ready yet, retrying...")
                continue
            }

            // Successfully connected - server is ready
            conn.Close()
            log.Debug().Msg("Daemon is ready to accept connections")
            return nil
        }
    }
}
```

### Health Check Design Principles

**1. Poll, Don't Assume**

Never assume readiness based on:
- ❌ Arbitrary time delays
- ❌ PID file existence
- ❌ Process start signal

Always verify actual service availability:
- ✅ Actual connection attempts
- ✅ Service-specific health endpoints
- ✅ Real protocol handshakes

**2. Appropriate Polling Frequency**

**Too fast** (< 100ms):
- Wastes CPU resources
- Spams logs
- No practical benefit

**Too slow** (> 1s):
- User perceives delay
- Poor UX for fast startups

**Goldilocks zone** (500ms):
- ✅ Responsive (< 1s latency for fast systems)
- ✅ Efficient (minimal CPU usage)
- ✅ Reliable (catches startup issues)

**3. Timeout Protection**

Always set an upper bound:
```go
// Caller sets 10-second timeout
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
defer cancel()

err := WaitForReady(ctx, endpoint)
// Returns after max 10 seconds, even if server never starts
```

**4. Clear Error Messages**

**Bad**:
```go
return errors.New("timeout")  // What timed out? Why?
```

**Good**:
```go
return errors.Wrap(ctx.Err(), "daemon did not become ready in time")
// Clear: daemon health check timed out
```

### When Health Checks Are Needed

**Daemon/Server Management**:
- ✅ Auto-starting background services
- ✅ Restart operations
- ✅ Readiness verification

**Kubernetes Deployments**:
- ✅ Readiness probes
- ✅ Liveness probes
- ✅ Startup probes

**Service-to-Service Communication**:
- ✅ Service mesh health checks
- ✅ Load balancer health checks
- ✅ Circuit breaker integration

### Testing Health Checks

**Test 1: Fast Startup**
```bash
# Server starts quickly
$ time stigmer server start
✓ Ready! Stigmer server is running

real    0m1.5s  # Health check returns as soon as ready
```

**Test 2: Slow Startup**
```bash
# Simulate slow startup (first boot, database initialization)
$ rm -rf ~/.stigmer/data/*
$ time stigmer server start
✓ Ready! Stigmer server is running

real    0m3.2s  # Health check waits longer, but still succeeds
```

**Test 3: Startup Failure**
```bash
# Server fails to start (port already in use)
$ stigmer server start & sleep 0.1 && stigmer server start
Error: daemon did not become ready in time

# Health check times out after 10 seconds, provides clear error
```

### Impact

**Before fix**:
- ❌ Connection failures on slow startup
- ❌ Inconsistent behavior (worked sometimes)
- ❌ User frustration
- ❌ Required manual waiting

**After fix**:
- ✅ Reliable connection every time
- ✅ CLI waits exactly as long as needed
- ✅ Works on fast and slow systems
- ✅ Clear debug logging
- ✅ Proper error handling

### Related Components

**Daemon Manager** (`client-apps/cli/internal/cli/daemon/daemon.go`):
- `EnsureRunning()` - Auto-starts daemon if not running
- `WaitForReady()` - Health check implementation
- `IsRunning()` - Process check (different from health check)

**Process vs Health Check**:
- **Process check**: Is the daemon process alive? (PID file + signal check)
- **Health check**: Is the gRPC server accepting connections? (Connection attempt)

Both are needed - process running ≠ service ready.

## Future Enhancements

### Planned

1. **Child Workflows**
   - Sub-agent executions as child workflows
   - Parallel agent execution orchestration

2. **Saga Pattern**
   - Compensating transactions for failed executions
   - Rollback workflows for cleanup

3. **Structured Health Check Endpoint**
   - Implement proto-based health check RPC
   - Include component status (Temporal, database, workers)
   - Support Kubernetes probes

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

**Code Locations:**
- Worker Infrastructure: `backend/services/stigmer-server/cmd/server/main.go`
- Workflow Execution: `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/`
- Agent Execution: `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/`
- Workflow Validation: `backend/services/stigmer-server/pkg/domain/workflow/temporal/`
- Agent Runner (Python): `backend/services/agent-runner/worker/`

**External Resources:**
- Temporal Go SDK: https://docs.temporal.io/dev-guide/go
- Polyglot Workflows: https://docs.temporal.io/dev-guide/polyglot
- Worker Configuration: https://docs.temporal.io/dev-guide/go/features#worker-configuration

---

**Remember**: The polyglot pattern requires strict adherence to activity name matching and worker registration rules. Any deviation will cause runtime errors.
