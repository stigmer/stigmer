# Workflow Runner

## Overview

The **WorkflowRunner** package defines both the API resource for registering workflow execution services and the service interface that those services must implement.

## Package Structure

```
apis/ai/stigmer/agentic/workflowrunner/v1/
├── api.proto       (future: WorkflowRunner resource)
├── command.proto   (future: CRUD operations for runner resources)
├── query.proto     (future: Read operations for runner resources)
├── io.proto        (I/O messages for execution service)
├── spec.proto      (future: WorkflowRunnerSpec)
└── service.proto   (Service interface that runners must implement)
```

## Current State

Currently, this package contains:
- **`service.proto`** - The `WorkflowExecutionService` interface that workflow runners must implement
- **`io.proto`** - Input/output messages for workflow execution

## Future State

When workflow runner registration is implemented, this package will also contain:
- **`api.proto`** - `WorkflowRunner` API resource (people can register their execution services)
- **`command.proto`** - `WorkflowRunnerCommandController` with CRUD operations
- **`query.proto`** - `WorkflowRunnerQueryController` for listing/searching runners
- **`spec.proto`** - `WorkflowRunnerSpec` defining runner configuration

## Distinction

| Concept | Purpose | File |
|---------|---------|------|
| **WorkflowRunner** | API resource representing a registered execution service | `api.proto` (future) |
| **WorkflowRunnerCommandController** | CRUD operations for managing runner resources | `command.proto` (future) |
| **WorkflowExecutionService** | Service interface that runners must implement | `service.proto` (current) |

## WorkflowExecutionService Interface

The `WorkflowExecutionService` defines 5 RPCs that all workflow execution engines must implement:

### Execution RPCs

1. **`execute`** - Synchronous execution with streaming progress
   - Use for testing and short-lived workflows (< 10 minutes)
   - Returns a stream of `WorkflowProgressEvent` messages
   - Progress updates streamed via gRPC

2. **`execute_async`** - Asynchronous execution (fire and forget)
   - Use for long-running workflows (hours/days/months)
   - Returns immediately with execution ID and status URLs
   - Progress tracking happens through Temporal/flows, not gRPC

### Lifecycle Control RPCs

3. **`cancel_execution`** - Cancel a running execution
4. **`pause_execution`** - Pause a running execution
5. **`resume_execution`** - Resume a paused execution

## Progress Tracking

### Synchronous Execution (`execute`)

Progress is streamed via gRPC as `WorkflowProgressEvent` messages:

```protobuf
message WorkflowProgressEvent {
  string workflow_execution_id = 1;
  string event_type = 2;           // "workflow_started", "task_completed", etc.
  string status = 5;               // "running", "completed", "failed", etc.
  string message = 6;              // Human-readable description
  int64 timestamp_ms = 7;
  int64 sequence_number = 10;      // For ordering
  int32 task_progress = 11;        // 0-100
  ErrorDetails error = 9;          // If failed
}
```

### Asynchronous Execution (`execute_async`)

Progress tracking happens through Temporal/flows:
- Runner reports progress to Temporal workflow
- Stigmer backend queries Temporal for status
- No gRPC streaming involved

This allows:
- Long-running workflows (days/months)
- Workflow continuity across runner restarts
- Temporal's built-in retry and persistence

## Implementation

Workflow runner implementations should:

1. Implement `WorkflowExecutionService` service
2. Accept `WorkflowExecuteInput` with complete workflow YAML and context
3. Stream progress events for synchronous execution
4. Return execution ID and status URLs for async execution
5. Support lifecycle control (cancel/pause/resume)

## Relationship to API Resources

| Concept | API Resource | Service Interface |
|---------|-------------|-------------------|
| Workflow definition | `Workflow` | Not applicable |
| Workflow instance | `WorkflowInstance` | Not applicable |
| Workflow execution | `WorkflowExecution` | Delegates to `WorkflowExecutionService` |
| Workflow runner | `WorkflowRunner` (future) | Implements `WorkflowExecutionService` |

- **`Workflow`** - Template definition (stored in Stigmer)
- **`WorkflowInstance`** - Configured instance with environment
- **`WorkflowExecution`** - Runtime execution (delegates to runner)
- **`WorkflowRunner`** - Registered execution service (future)

## Example: Temporal Runner

A Temporal-based workflow runner would:

1. Register as a `WorkflowRunner` resource (future):
   ```yaml
   apiVersion: workflowrunner.stigmer.ai/v1
   kind: WorkflowRunner
   metadata:
     name: temporal-runner-prod
   spec:
     type: temporal
     endpoint: grpc://temporal-runner.svc.cluster.local:9090
   ```

2. Implement `WorkflowExecutionService` as a gRPC service:
   ```go
   type TemporalRunnerService struct {
       temporalClient client.Client
   }
   
   func (s *TemporalRunnerService) ExecuteAsync(ctx context.Context, input *WorkflowExecuteInput) (*WorkflowExecuteResponse, error) {
       // Start Temporal workflow
       // Return execution ID
   }
   ```

3. Handle execution lifecycle:
   - `execute_async` - Start Temporal workflow
   - `cancel_execution` - Signal Temporal workflow to cancel
   - `pause_execution` - Signal Temporal workflow to pause
   - `resume_execution` - Signal Temporal workflow to resume

## Future Runners

Other execution engines can implement this interface:
- **Airflow** - For DAG-based workflows
- **Prefect** - For Python-based workflows
- **Custom runners** - For specialized execution needs

Each runner:
1. Registers as a `WorkflowRunner` resource
2. Implements `WorkflowExecutionService` interface
3. Receives complete workflow YAML and executes according to its execution model

## Why This Structure?

This structure follows the Stigmer API resource pattern:

✅ **Consistent with other resources** - Uses `{name}/v1/` pattern (not nested `workflow/runner/v1/`)
✅ **First-class package** - `workflowrunner` is a top-level package under `agentic`
✅ **Clear separation** - Service interface (`service.proto`) separate from resource definition (`api.proto` future)
✅ **Future-proof** - Room for CRUD operations when runner registration is implemented

## Summary

The workflow runner package:
- ✅ Defines the service interface for workflow execution engines
- ✅ Will contain the API resource for registering runners (future)
- ✅ Provides sync and async execution models
- ✅ Supports lifecycle control (cancel/pause/resume)
- ✅ Allows pluggable execution engines (Temporal, Airflow, custom)
- ✅ Follows consistent Stigmer API resource patterns
