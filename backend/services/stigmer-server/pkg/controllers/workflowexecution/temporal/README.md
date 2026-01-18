# Workflow Execution Temporal Integration

This package contains the Temporal workflow infrastructure for workflow execution, implementing a polyglot pattern where Go handles orchestration and Go activities (in workflow-runner) handle execution.

## Architecture

The implementation follows the **polyglot Temporal pattern** established by agent execution:

- **Go (stigmer-server)**: Workflow orchestration on "workflow_execution_stigmer" task queue
- **Go (workflow-runner)**: Activity implementations for Zigflow execution logic on "workflow_execution_runner" task queue
- **Separate Task Queues**: Workers use different queues for workflows vs activities

```
┌─────────────────────────────────────────────────────────────────┐
│                        Temporal Server                           │
├──────────────────────────────┬──────────────────────────────────┤
│ Queue: workflow_execution_   │ Queue: workflow_execution_       │
│        stigmer               │        runner                    │
└───────────┬──────────────────┴──────────────┬───────────────────┘
            │                                  │
            │ Workflow Tasks                   │ Activity Tasks
            ▼                                  ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│  Go Worker               │      │  Go Worker                    │
│  (stigmer-server)        │      │  (workflow-runner)            │
│                          │      │                               │
│  - Orchestration only    │      │  - ExecuteWorkflow            │
│  - Workflow logic        │      │  - Query Stigmer service      │
│  - UpdateStatus (LOCAL)  │      │  - Proto → YAML converter     │
└──────────────────────────┘      └──────────────────────────────┘
```

## Components

### Workflows

#### `InvokeWorkflowExecutionWorkflow`
- **Interface**: Defines the workflow contract
- **Implementation**: `InvokeWorkflowExecutionWorkflowImpl`
- **Workflow ID Format**: `stigmer/workflow-execution/invoke/{execution-id}`
- **Task Queue**: `workflow_execution_stigmer`
- **Timeout**: 30 minutes per execution
- **Purpose**: Orchestrates Zigflow workflow execution with state persistence

**Flow:**
1. Execute Zigflow workflow (via `ExecuteWorkflow` activity)
   - Go activity queries Stigmer service for full context
   - Converts WorkflowSpec proto → YAML (Phase 2 converter)
   - Executes via Zigflow engine
   - Sends progressive status updates via gRPC
   - Returns final status

### Activities

Activities are **defined in Go** as interfaces, but **implemented in Go** (workflow-runner):

#### `ExecuteWorkflowActivity`
- **Name**: `ExecuteWorkflow`
- **Implementation**: `workflow-runner/worker/activities/execute_workflow_activity.go`
- **Purpose**: 
  - Receives WorkflowExecution proto (containing execution_id)
  - Queries Stigmer service via gRPC (Agent-Runner Pattern):
    - GetWorkflowExecution by execution_id
    - GetWorkflowInstance from execution.spec.workflow_instance_id
    - GetWorkflow from instance.spec.workflow_id
  - Converts WorkflowSpec proto → YAML (Phase 2 converter)
  - Executes via Zigflow engine
  - Reports progressive status via gRPC callbacks
  - Returns final WorkflowExecutionStatus

**Agent-Runner Pattern Benefits:**
- Single source of truth: Always queries fresh data from BadgerDB
- Simplified Temporal interface: Just pass execution_id
- Type-safe conversion: Proto → YAML converter (Phase 2)
- Progressive updates: Real-time status via gRPC callbacks

#### `UpdateWorkflowExecutionStatusActivity`
- **Name**: `UpdateWorkflowExecutionStatus`
- **Implementation**: `activities/update_status_impl.go` (LOCAL activity)
- **Purpose**:
  - Handles persistence for system error recovery
  - Loads execution from BadgerDB
  - Applies status updates (phase, error, tasks)
  - Updates audit timestamps
  - Persists back to BadgerDB
- **Note**: Registered as LOCAL activity (runs in-process, no task queue)

### Workflow Creator

#### `InvokeWorkflowExecutionWorkflowCreator`
- Called by `WorkflowExecutionController` after persisting execution
- Starts workflow asynchronously using Temporal client
- Sets workflow ID, task queue, and timeout
- Passes activity queue via memo for polyglot routing

### Temporal Configuration

#### `Config`
- Loads configuration from environment variables
- `StigmerQueue`: Queue for Go workflows (default: `workflow_execution_stigmer`)
- `RunnerQueue`: Queue for Go activities (default: `workflow_execution_runner`)

#### `WorkerConfig`
- Registers `InvokeWorkflowExecutionWorkflowImpl` on stigmer queue
- Registers `UpdateWorkflowExecutionStatusActivity` as LOCAL activity
- **CRITICAL**: Does NOT register ExecuteWorkflow (to avoid task queue collision)
- ExecuteWorkflow is handled by Go worker in workflow-runner

## Integration with WorkflowExecutionController

The workflow should be started after persisting the execution:

```go
// In create.go
func (c *WorkflowExecutionController) Create(ctx context.Context, req *CreateRequest) (*WorkflowExecution, error) {
    // 1. Validate and build execution
    execution := buildExecution(req)
    
    // 2. Persist to BadgerDB
    if err := c.store.Put(ctx, execution.GetMetadata().GetId(), execution); err != nil {
        return nil, err
    }
    
    // 3. Start Temporal workflow
    if err := c.workflowCreator.Create(ctx, execution); err != nil {
        log.Error().Err(err).Msg("Failed to start workflow")
        // Don't fail the create - workflow can be retried
    }
    
    return execution, nil
}
```

## Workflow Constants

#### `workflow_types.go`
- `WorkflowExecutionInvoke = "stigmer/workflow-execution/invoke"`
- `DefaultWorkflowExecutionTaskQueue = "workflow_execution"`
- Consistent workflow type naming across the system

## Task Queue Design

### Configuration via Environment Variables

Task queue names are configurable via environment variables:

**Go Service (stigmer-server):**
- `TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE` - Default: "workflow_execution_stigmer"

**Go Worker (workflow-runner):**
- `TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE` - Default: "workflow_execution_runner"
- Must match the stigmer-server configuration

### Polyglot Pattern: Separate Task Queues

The workflow execution system uses dedicated task queues:
- **Agent Execution**: `agent_execution_stigmer` / `agent_execution_runner` (agent-runner worker)
- **Workflow Execution**: `workflow_execution_stigmer` / `workflow_execution_runner` (workflow-runner worker)
- **stigmer-server worker**: Polls for workflow tasks ONLY (no activities registered)
- **workflow-runner worker**: Polls for activity tasks ONLY (no workflows registered)

**Why this works:**
- Temporal separates workflow tasks and activity tasks internally
- stigmer-server worker only processes workflow decisions
- workflow-runner worker only processes activity executions
- No collision because they process different task types

**Critical Rule:**
- ❌ **NEVER** register activities on the stigmer-server worker
- ❌ This would cause stigmer-server to poll for activity tasks
- ❌ Temporal would load-balance activities between stigmer-server and workflow-runner
- ❌ Go activities routed to stigmer-server → "Activity not registered" error

## Proto Redesign Integration (Phases 1-3.5)

This implementation is part of the **workflow orchestration proto redesign** project.

### Phase 1-1.5: Proto Schema Design ✅
- Created structured WorkflowSpec proto (replaced synthesized_yaml)
- Defined 12 task type configs with validation rules
- Generated type-safe stubs for all languages

### Phase 2: Proto → YAML Converter ✅
- Created `pkg/converter/proto_to_yaml.go` in workflow-runner
- Converts WorkflowSpec proto → Zigflow YAML
- Support for all 12 task types (SET, HTTP_CALL, SWITCH, FOR, etc.)
- Integrated with existing Zigflow engine

### Phase 3: Agent-Runner Pattern Migration ✅
- Simplified WorkflowExecuteInput proto (just execution_id + optional workflow_yaml)
- Created Stigmer gRPC client in workflow-runner
- Updated execute_workflow_activity.go to query Stigmer service
- Progressive status updates via gRPC callbacks

### Phase 3.5: Status Pattern Alignment ✅
- Aligned WorkflowExecutionStatus with AgentExecutionStatus pattern
- Transform streaming events into structured state (tasks[] array)
- Single source of truth: tasks[] for progress tracking

### Phase 4: THIS IMPLEMENTATION ✅
- Created Go Temporal workflow infrastructure (OSS version)
- Follows same polyglot pattern as agent execution
- Simplified: Just pass WorkflowExecution proto to Go activity
- Go activity handles all complexity (query, convert, execute)

## Polyglot Pattern Benefits

1. **Language Strengths**: Go for orchestration and Zigflow execution
2. **Independent Scaling**: Scale workflow and activity workers separately
3. **Separation of Concerns**: Orchestration logic vs execution logic
4. **Shared Context**: Both access same Temporal server and task queues
5. **Type Safety**: Proto-first design with validation

## Key Design Decisions

### 1. Go Workflow, Go Activities
- **Why?** Both Go for consistency in OSS version; Java version uses Java workflows + Go activities
- **Trade-off**: Simpler stack but polyglot pattern still needed for separation

### 2. Separate Task Queues
- **Why?** Clear separation between workflow orchestration and activity execution
- **Trade-off**: More complex than single queue but better isolation and scaling

### 3. Activity Interfaces in stigmer-server
- **Why?** Type safety for workflow code, clear contracts
- **Implementation:** workflow-runner activities use matching interface names

### 4. No Activity Registration in stigmer-server Worker
- **Why?** Prevents task queue collision with workflow-runner worker
- **Critical:** stigmer-server worker must ONLY register workflows on "stigmer" queue

### 5. Agent-Runner Pattern (Query vs Pre-built Payload)
- **Why?** Single source of truth (BadgerDB), fresh data at execution time
- **Before**: Java built complete payload (workflow YAML, env vars, metadata)
- **After**: Go passes execution_id, workflow-runner queries Stigmer service
- **Benefits**: Simpler interface, consistent with agent-runner, type-safe

## Configuration

### Environment Variables

**stigmer-server (Go):**
```bash
TEMPORAL_NAMESPACE=default
TEMPORAL_SERVICE_ADDRESS=localhost:7233
TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE=workflow_execution_stigmer
```

**workflow-runner (Go):**
```bash
TEMPORAL_NAMESPACE=default
TEMPORAL_SERVICE_ADDRESS=localhost:7233
TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner  # Must match stigmer-server!
STIGMER_SERVICE_ENDPOINT=localhost:8080
STIGMER_SERVICE_API_KEY=<api-key>
STIGMER_SERVICE_USE_TLS=false
```

## Testing

To test the integration:

1. **Start Temporal server** (local or cloud)
2. **Configure task queues** via environment variables
3. **Start Go worker** (stigmer-server with temporal config)
4. **Start Go worker** (workflow-runner with same namespace)
5. **Create workflow execution** via gRPC
6. **Verify workflow** starts and activities execute

## Troubleshooting

### "Unknown workflow type" error
- **Error**: `Unknown workflow type "stigmer/workflow-execution/invoke". Known types are [InvokeWorkflowExecutionWorkflow, ...]`
- **Cause**: Workflow type name mismatch between registration and invocation
- **Explanation**: 
  - Workflow name in interface constant must match registration
- **Fix**: Ensure `InvokeWorkflowExecutionWorkflowName` matches workflow registration

### "Activity not registered" error
- **Cause**: stigmer-server worker registered activities, causing task collision
- **Fix**: Remove activity registration from `WorkerConfig`

### Workflow not starting
- **Check**: Temporal client is configured and connected
- **Check**: Task queue name matches ("workflow_execution_stigmer")
- **Check**: Temporal server is accessible

### Activity timeout
- **Check**: workflow-runner worker is running and connected
- **Check**: Activity timeout is sufficient (currently 30 minutes)
- **Check**: Activity logs for execution errors

### Query errors in Go activity
- **Check**: STIGMER_SERVICE_ENDPOINT is correct
- **Check**: STIGMER_SERVICE_API_KEY is valid
- **Check**: WorkflowExecution, WorkflowInstance, and Workflow exist in BadgerDB

### Proto conversion errors
- **Check**: WorkflowSpec proto is valid
- **Check**: Phase 2 converter supports all task types used
- **Check**: Generated proto stubs are up-to-date

## Comparison with Java Implementation

This Go implementation is **functionally equivalent** to the Java implementation in stigmer-cloud:

| Component | Java (stigmer-cloud) | Go (stigmer OSS) |
|-----------|---------------------|------------------|
| Config | `WorkflowExecutionTemporalConfig` | `temporal.Config` |
| Worker Config | `WorkflowExecutionTemporalWorkerConfig` | `temporal.WorkerConfig` |
| Workflow Interface | `InvokeWorkflowExecutionWorkflow` | `workflows.InvokeWorkflowExecutionWorkflow` |
| Workflow Impl | `InvokeWorkflowExecutionWorkflowImpl` | `workflows.InvokeWorkflowExecutionWorkflowImpl` |
| Workflow Creator | `InvokeWorkflowExecutionWorkflowCreator` | `workflows.InvokeWorkflowExecutionWorkflowCreator` |
| Execute Activity | `ExecuteWorkflowActivity` (interface) | `activities.ExecuteWorkflowActivity` (interface) |
| Update Status Activity | `UpdateExecutionStatusActivityImpl` | `activities.UpdateWorkflowExecutionStatusActivityImpl` |

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
   - Go: Helper functions (`NewExecuteWorkflowActivityStub()`)

5. **Local Activities**:
   - Java: `Workflow.newLocalActivityStub()`
   - Go: `workflow.WithLocalActivityOptions()` + `ExecuteLocalActivity()`

6. **Persistence**:
   - Java: MongoDB + Redis
   - Go: BadgerDB (embedded key-value store)

## Files in this Package

- `config.go` - Configuration for task queues
- `workflow_types.go` - Workflow type constants
- `workflows/invoke_workflow.go` - Workflow interface
- `workflows/invoke_workflow_impl.go` - Workflow implementation
- `workflows/workflow_creator.go` - Workflow starter
- `activities/execute_workflow.go` - ExecuteWorkflow activity interface
- `activities/update_status.go` - UpdateStatus activity interface
- `activities/update_status_impl.go` - UpdateStatus implementation
- `worker_config.go` - Worker configuration and registration

## References

- **Java Implementation**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/`
- **Agent Execution**: `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/` (same pattern!)
- **workflow-runner**: `backend/services/workflow-runner/`
- **Phase 2 Converter**: `backend/services/workflow-runner/pkg/converter/README.md`
- **Temporal Documentation**: https://docs.temporal.io/
- **Polyglot Pattern**: https://docs.temporal.io/encyclopedia/polyglot-worker
