# Workflow Execution Temporal Integration

This package contains the Temporal workflow infrastructure for workflow execution.

## Architecture

The system uses a two-level Temporal workflow pattern:

- **Outer orchestrator workflow** (Java or Go): Runs on `workflow_execution_stigmer` queue, handles lifecycle signals and status persistence
- **TS child workflow** (`stigmer/workflow/execute-from-execution`): Runs on `stigmer_runner` queue, executes the actual workflow tasks via the TS runner

```
┌─────────────────────────────────────────────────────────────────┐
│                        Temporal Server                          │
├──────────────────────────────┬──────────────────────────────────┤
│ Queue: workflow_execution_   │ Queue: stigmer_runner            │
│        stigmer               │                                  │
└───────────┬──────────────────┴──────────────┬───────────────────┘
            │                                  │
            │ Orchestrator Workflow            │ Child Workflow
            ▼                                  ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│  Orchestrator Worker     │      │  TS Runner                    │
│  (stigmer-server)        │      │  (unified runner)             │
│                          │      │                               │
│  - Lifecycle signals     │      │  - stigmer/workflow/           │
│  - Signal relay to child │      │    execute-from-execution     │
│  - Status persistence    │      │  - Task-by-task execution     │
│    (local activities)    │      │  - Progressive gRPC updates   │
└──────────────────────────┘      └──────────────────────────────┘
```

## Signal-Based Pause/Resume

Pause and resume use Temporal signals relayed from the outer orchestrator to the TS child workflow:

1. **Pause**: gRPC handler sends a pause signal to the outer orchestrator, which forwards it to the child workflow. The child blocks at the next task boundary.
2. **Resume**: gRPC handler sends a resume signal to the outer orchestrator, which forwards it to the child workflow. The child unblocks its `condition()` and continues execution from the next task.

Completed tasks are preserved in Temporal workflow history and are not re-executed on resume.

## Signal Relay for LISTEN/human_input Tasks

When a LISTEN or human_input task requires external input, the outer orchestrator relays the signal to the child workflow. This uses the same signal forwarding mechanism as pause/resume.

## Status Updates

Status updates flow through two paths:

- **Progressive updates**: The TS runner sends real-time task progress via gRPC streaming to the stigmer-server
- **Lifecycle transitions**: The orchestrator handles failure, cancellation, pause, and resume status updates via local activities that persist directly to the database

## Components

### Workflows

#### `InvokeWorkflowExecutionWorkflow`
- **Workflow ID Format**: `stigmer/workflow-execution/invoke/{execution-id}`
- **Task Queue**: `workflow_execution_stigmer`
- **Timeout**: 30 minutes per execution
- **Purpose**: Orchestrates workflow execution lifecycle, starts TS child workflow, relays signals

### Activities

#### `UpdateWorkflowExecutionStatusActivity`
- **Name**: `UpdateWorkflowExecutionStatus`
- **Implementation**: `activities/update_status_impl.go` (LOCAL activity)
- **Purpose**: Handles status persistence for lifecycle transitions (failure, cancellation, pause, resume)
- **Note**: Registered as LOCAL activity (runs in-process, no task queue)

### Workflow Creator

#### `InvokeWorkflowExecutionWorkflowCreator`
- Called by `WorkflowExecutionController` after persisting execution
- Starts workflow asynchronously using Temporal client
- Sets workflow ID, task queue, and timeout

## Worker Configuration

- Registers `InvokeWorkflowExecutionWorkflowImpl` on `workflow_execution_stigmer` queue
- Registers `UpdateWorkflowExecutionStatusActivity` as LOCAL activity
- Does NOT register any remote activities (execution happens in the TS runner)

## Configuration

### Environment Variables

**stigmer-server:**
```bash
TEMPORAL_NAMESPACE=default
TEMPORAL_SERVICE_ADDRESS=localhost:7233
TEMPORAL_WORKFLOW_EXECUTION_STIGMER_TASK_QUEUE=workflow_execution_stigmer
```

## Integration with WorkflowExecutionController

The workflow is started after persisting the execution:

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
    }
    
    return execution, nil
}
```

## Troubleshooting

### "Unknown workflow type" error
- **Cause**: Workflow type name mismatch between registration and invocation
- **Fix**: Ensure `InvokeWorkflowExecutionWorkflowName` matches workflow registration

### Workflow not starting
- **Check**: Temporal client is configured and connected
- **Check**: Task queue name matches (`workflow_execution_stigmer`)
- **Check**: Temporal server is accessible

### Child workflow not executing
- **Check**: TS runner is running and connected to the `stigmer_runner` queue
- **Check**: Child workflow type `stigmer/workflow/execute-from-execution` is registered

### Signal not reaching child workflow
- **Check**: Outer orchestrator is running and has an active child workflow
- **Check**: Signal name matches between sender and receiver

## Files in this Package

- `config.go` - Configuration for task queues
- `workflow_types.go` - Workflow type constants
- `workflows/invoke_workflow.go` - Workflow interface
- `workflows/invoke_workflow_impl.go` - Workflow implementation
- `workflows/workflow_creator.go` - Workflow starter
- `activities/update_status.go` - UpdateStatus activity interface
- `activities/update_status_impl.go` - UpdateStatus implementation
- `worker_config.go` - Worker configuration and registration

## References

- **Java Implementation**: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/`
- **Agent Execution**: `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/` (same pattern)
- **TS Runner**: `backend/services/runner/`
- **Temporal Documentation**: https://docs.temporal.io/
