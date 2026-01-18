# Workflow Runner - Stigmer Service Callback Integration

## Overview

The workflow runner reports progress back to Stigmer Service via gRPC callbacks. This document explains how to use the callback mechanism in the workflow runner.

## Architecture

```
Workflow Runner (Go)
  ├─ Input 1: Temporal credentials
  ├─ Input 2: Stigmer Service endpoint + API key
  └─ Progress: gRPC callback → Stigmer Service
                                    ↓
                              Stigmer Service (Java)
                                ├─ MongoDB (store events)
                                ├─ Redis (pub/sub)
                                └─ WebSocket/SSE (broadcast)
```

## Configuration

The workflow runner requires three environment variables for Stigmer Service callback:

```bash
# Stigmer Service endpoint (production)
STIGMER_SERVICE_ENDPOINT=stigmer-prod-api.planton.live:443

# API key for authentication (stored in secrets)
STIGMER_SERVICE_API_KEY=<your-api-key>

# Enable TLS (should be true for production)
STIGMER_SERVICE_USE_TLS=true
```

These are configured in the Kustomization files:
- Production: `_kustomize/overlays/prod/service.yaml`
- Local: `_kustomize/overlays/local/service.yaml`

## Usage

### 1. Initialize Callback Client

```go
import (
    "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/config"
    "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/callback"
)

// Load configuration from environment
stigmerConfig, err := config.LoadStigmerConfig()
if err != nil {
    log.Fatal().Err(err).Msg("Failed to load Stigmer config")
}

// Create callback client
callbackClient, err := callback.NewClient(stigmerConfig)
if err != nil {
    log.Fatal().Err(err).Msg("Failed to create callback client")
}
defer callbackClient.Close()
```

### 2. Report Progress Events

```go
import runnerv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/workflow/runner/v1"

// Create a progress event
event := callback.NewProgressEvent(
    "wfexec-123",           // workflow execution ID
    "workflow_started",     // event type
    "my-workflow",          // workflow name
    "running",              // status
    "Workflow started successfully",  // message
    1,                      // sequence number
)

// Report to Stigmer Service
response, err := callbackClient.ReportProgress(ctx, event)
if err != nil {
    log.Error().Err(err).Msg("Failed to report progress")
}
```

### 3. Report Task Progress

```go
// Create task progress event
taskEvent := callback.NewTaskProgressEvent(
    "wfexec-123",           // workflow execution ID
    "task_started",         // event type
    "my-workflow",          // workflow name
    "process-data",         // task name
    "running",              // status
    "Processing data...",   // message
    2,                      // sequence number
)

// Report with retry
err := callbackClient.ReportProgressWithRetry(ctx, taskEvent, 3)
if err != nil {
    log.Error().Err(err).Msg("Failed to report task progress after retries")
}
```

### 4. Report Errors

```go
// Create error event
errorEvent := callback.NewErrorProgressEvent(
    "wfexec-123",           // workflow execution ID
    "my-workflow",          // workflow name
    "VALIDATION_ERROR",     // error code
    "Invalid input data",   // error message
    "stack trace...",       // stack trace
    5,                      // sequence number
)

// Report error
_, err := callbackClient.ReportProgress(ctx, errorEvent)
if err != nil {
    log.Error().Err(err).Msg("Failed to report error")
}
```

## Event Types

Common event types that should be reported:

- `workflow_started` - When workflow execution begins
- `workflow_completed` - When workflow completes successfully
- `workflow_failed` - When workflow fails
- `workflow_paused` - When workflow is paused
- `workflow_resumed` - When workflow is resumed
- `workflow_cancelled` - When workflow is cancelled
- `task_started` - When a task begins
- `task_completed` - When a task completes
- `task_failed` - When a task fails
- `task_retry` - When a task is being retried

## Status Values

Common status values:

- `pending` - Task/workflow is queued but not started
- `running` - Task/workflow is currently executing
- `completed` - Task/workflow completed successfully
- `failed` - Task/workflow failed
- `cancelled` - Task/workflow was cancelled
- `paused` - Task/workflow is paused

## Integration with Temporal Activities

Here's an example of how to integrate the callback client with a Temporal activity:

```go
package activities

import (
    "context"
    
    "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/callback"
    runnerv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/workflow/runner/v1"
    "go.temporal.io/sdk/activity"
)

// ExecuteWorkflowActivity executes a workflow and reports progress
func ExecuteWorkflowActivity(ctx context.Context, input *runnerv1.WorkflowExecuteInput) error {
    // Get activity info
    activityInfo := activity.GetInfo(ctx)
    
    // Get callback client from context (passed during worker setup)
    callbackClient := getCallbackClientFromContext(ctx)
    
    // Report workflow started
    startEvent := callback.NewProgressEvent(
        input.WorkflowExecutionId,
        "workflow_started",
        input.Metadata.Name,
        "running",
        "Workflow execution started",
        1,
    )
    callbackClient.ReportProgress(ctx, startEvent)
    
    // Execute workflow tasks...
    // Report progress for each task...
    
    // Report workflow completed
    completeEvent := callback.NewProgressEvent(
        input.WorkflowExecutionId,
        "workflow_completed",
        input.Metadata.Name,
        "completed",
        "Workflow execution completed successfully",
        10,
    )
    callbackClient.ReportProgress(ctx, completeEvent)
    
    return nil
}
```

## Error Handling

The callback client includes built-in retry logic:

```go
// Report with automatic retry (3 attempts with exponential backoff)
err := callbackClient.ReportProgressWithRetry(ctx, event, 3)
if err != nil {
    // Log but don't fail workflow execution
    log.Error().Err(err).Msg("Failed to report progress after retries")
    // Workflow continues even if progress reporting fails
}
```

**Important**: Progress reporting failures should NOT cause workflow execution to fail. The workflow should continue executing even if it cannot report progress to Stigmer Service.

## Testing

For local testing without Stigmer Service:

1. Set environment variables:
   ```bash
   export STIGMER_SERVICE_ENDPOINT=localhost:9090
   export STIGMER_SERVICE_API_KEY=test-key
   export STIGMER_SERVICE_USE_TLS=false
   ```

2. Mock the callback client:
   ```go
   // Use a mock implementation for testing
   mockClient := &MockCallbackClient{}
   ```

3. Run tests:
   ```bash
   go test ./pkg/callback/...
   ```

## Security

- API keys are stored in Kubernetes secrets and injected as environment variables
- TLS is enabled by default for production
- API keys are sent as Bearer tokens in the Authorization header
- Never log or expose API keys in code or logs

## Troubleshooting

### Connection Issues

If the workflow runner cannot connect to Stigmer Service:

1. Check endpoint configuration:
   ```bash
   echo $STIGMER_SERVICE_ENDPOINT
   ```

2. Verify API key is set:
   ```bash
   # Don't actually echo the key, just check it's set
   [ -z "$STIGMER_SERVICE_API_KEY" ] && echo "API key not set" || echo "API key is set"
   ```

3. Check network connectivity:
   ```bash
   # Test if endpoint is reachable
   nc -zv stigmer-prod-api.planton.live 443
   ```

### Authentication Errors

If you get authentication errors:

1. Verify the API key is correct
2. Check if the API key has expired
3. Ensure the API key has the necessary permissions

### Progress Not Appearing in UI

If progress is reported but not appearing in the Stigmer Service UI:

1. Check Stigmer Service logs for errors
2. Verify MongoDB connection
3. Check Redis pub/sub is working
4. Verify WebSocket/SSE connections are active

## Related Documentation

- [Proto Structure](../../../_projects/2026-01-08-workflow-orchestration-engine/proto-structure.md)
- [Async Execution Pattern](../../../_projects/2026-01-08-workflow-orchestration-engine/async-execution-callback-pattern.md)
- [Phase 1.5 Architecture](../../../_projects/2026-01-08-workflow-orchestration-engine/phase-1.5-runtime-execution-architecture.md)
