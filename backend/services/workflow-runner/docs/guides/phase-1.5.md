# Workflow Runner - Phase 1.5 Implementation

## Overview

The Workflow Runner is a Go service that executes CNCF Serverless Workflow specifications with Temporal for durability and reports progress back to Stigmer Service via gRPC callbacks.

## Architecture

### High-Level Flow

```
Stigmer Service (Java)
    ↓
Fetch workflow YAML from MongoDB
    ↓
Build complete WorkflowExecuteInput proto
    ↓
Start Temporal workflow
    ↓
Temporal routes to Workflow Runner (Go)
    ↓
Workflow Runner executes workflow
    ↓
Workflow Runner → gRPC callback → Stigmer Service
    ↓
Stigmer Service stores events in MongoDB
Stigmer Service publishes to Redis
Stigmer Service broadcasts via WebSocket/SSE
```

### Key Principles

1. **Independence**: Workflow Runner has NO database dependencies
2. **Complete Input**: All data needed is in the WorkflowExecuteInput proto
3. **Progress Callbacks**: Uses gRPC to report progress back to Stigmer Service
4. **Resilience**: Progress reporting failures don't cause workflow execution to fail

## Components

### 1. Proto Definitions

Location: `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/apis/ai/stigmer/workflow/runner/v1/`

- `command.proto` - Command RPCs (execute, report_progress, cancel, pause, resume)
- `query.proto` - Query RPCs (get_status, get_events, subscribe)
- `io.proto` - Input/output messages

Generated stubs:
```bash
cd apis && make go-stubs
```

Output: `apis/stubs/go/github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/workflow/runner/v1/`

### 2. Configuration Package

Location: `pkg/config/`

```go
type StigmerConfig struct {
    Endpoint string  // stigmer-prod-api.planton.live:443
    APIKey   string  // From secrets
    UseTLS   bool    // true for production
}
```

Environment variables:
- `STIGMER_SERVICE_ENDPOINT`
- `STIGMER_SERVICE_API_KEY`
- `STIGMER_SERVICE_USE_TLS`

### 3. Callback Client Package

Location: `pkg/callback/`

Features:
- gRPC client for Stigmer Service
- Automatic retry with exponential backoff
- Authentication via Bearer token
- Helper functions for creating progress events

Usage:
```go
callbackClient, err := callback.NewClient(stigmerConfig)
defer callbackClient.Close()

event := callback.NewProgressEvent(
    executionID, "workflow_started", workflowName,
    "running", "Workflow started", 1,
)
callbackClient.ReportProgress(ctx, event)
```

### 4. Executor Package

Location: `pkg/executor/`

Features:
- Executes workflows from proto input
- Reports progress at each stage
- Handles errors gracefully
- Phase 1.5: Validation only (full execution in Phase 2+)

Usage:
```go
executor := executor.NewWorkflowExecutor(callbackClient)
err := executor.Execute(ctx, input)
```

### 5. Zigflow Package

Location: `pkg/zigflow/`

Features:
- CNCF Serverless Workflow parser
- Workflow validation
- Task execution (Phase 2+)

New additions:
- `LoadFromString(yamlContent string)` - Load workflow from YAML string (not file)

## Configuration

### Production (Kubernetes)

File: `_kustomize/overlays/prod/service.yaml`

```yaml
env:
  variables:
    # Temporal Configuration
    TEMPORAL_SERVICE_ADDRESS:
      value: $variables-group/stigmer-temporal-config/prod.kube-endpoint
    TEMPORAL_NAMESPACE:
      value: default
    
    # Stigmer Service Callback Configuration
    STIGMER_SERVICE_ENDPOINT:
      value: stigmer-prod-api.planton.live:443
    STIGMER_SERVICE_API_KEY:
      value: $secrets-group/workflow-runner-secrets/stigmer-api-key
    STIGMER_SERVICE_USE_TLS:
      value: "true"
```

### Local Development

File: `_kustomize/overlays/local/service.yaml`

```yaml
env:
  variables:
    TEMPORAL_SERVICE_ADDRESS:
      value: $variables-group/stigmer-temporal-config/prod.external-endpoint
    STIGMER_SERVICE_ENDPOINT:
      value: stigmer-prod-api.planton.live:443
    STIGMER_SERVICE_API_KEY:
      value: $secrets-group/workflow-runner-secrets/stigmer-api-key-local
    STIGMER_SERVICE_USE_TLS:
      value: "true"
    LOG_LEVEL:
      value: debug
```

## Building

```bash
# Generate proto stubs
cd apis
make go-stubs

# Build workflow runner
cd backend/services/workflow-runner
bazel build //backend/services/workflow-runner:workflow_runner
```

## Running

### With Temporal

```bash
export TEMPORAL_SERVICE_ADDRESS=localhost:7233
export TEMPORAL_NAMESPACE=default
export STIGMER_SERVICE_ENDPOINT=localhost:9090
export STIGMER_SERVICE_API_KEY=test-key
export STIGMER_SERVICE_USE_TLS=false

bazel run //backend/services/workflow-runner:workflow_runner
```

### Docker

```bash
docker build -t workflow-runner:latest .
docker run \
  -e TEMPORAL_SERVICE_ADDRESS=temporal:7233 \
  -e STIGMER_SERVICE_ENDPOINT=stigmer-api:9090 \
  -e STIGMER_SERVICE_API_KEY=your-key \
  workflow-runner:latest
```

## Testing

### Unit Tests

```bash
# Test callback client
go test ./pkg/callback/...

# Test executor
go test ./pkg/executor/...

# Test zigflow
go test ./pkg/zigflow/...
```

### Integration Tests

```bash
# Start Temporal
temporal server start-dev

# Start mock Stigmer Service
# (Create mock gRPC server implementing WorkflowRunnerCommandController)

# Run workflow runner
bazel run //backend/services/workflow-runner:workflow_runner
```

## Progress Event Types

The workflow runner reports the following event types:

| Event Type | When | Status |
|------------|------|--------|
| `workflow_started` | Workflow execution begins | `running` |
| `workflow_validating` | Validating workflow definition | `running` |
| `workflow_validated` | Validation passed | `running` |
| `task_started` | Task begins execution | `running` |
| `task_completed` | Task completes successfully | `completed` |
| `task_failed` | Task fails | `failed` |
| `workflow_completed` | Workflow completes successfully | `completed` |
| `workflow_failed` | Workflow fails | `failed` |
| `workflow_cancelled` | Workflow is cancelled | `cancelled` |

## Error Handling

### Progress Reporting Failures

Progress reporting failures are logged but DO NOT cause workflow execution to fail:

```go
if err := callbackClient.ReportProgress(ctx, event); err != nil {
    log.Error().Err(err).Msg("Failed to report progress (execution continues)")
    // Workflow continues executing
}
```

### Workflow Execution Failures

Workflow execution failures are reported and then returned as errors:

```go
if err := executor.Execute(ctx, input); err != nil {
    // Error event already reported to Stigmer Service
    return err
}
```

## Security

### API Key Management

- API keys are stored in Kubernetes secrets
- Keys are injected as environment variables
- Keys are sent as Bearer tokens in Authorization header
- Keys are NEVER logged or exposed in code

Example secret:
```bash
kubectl create secret generic workflow-runner-secrets \
  --from-literal=stigmer-api-key=your-api-key \
  -n stigmer-prod
```

### TLS/Transport Security

- TLS is enabled by default for production
- Certificate verification is always enabled
- Use `STIGMER_SERVICE_USE_TLS=false` only for local testing

## Monitoring

### Metrics

Prometheus metrics available at `:9090/metrics`:

- Temporal worker metrics
- gRPC client metrics (callback)
- Workflow execution metrics

### Health Checks

Health endpoint at `:3000/health`:

```bash
curl http://localhost:3000/health
```

### Logging

Structured logging using zerolog:

```bash
# Set log level
export LOG_LEVEL=debug  # trace, debug, info, warn, error
```

## Phase 1.5 Limitations

Current implementation (Phase 1.5):

✅ Proto definitions complete
✅ Go stub generation working
✅ Configuration package
✅ Callback client with retry
✅ Workflow executor skeleton
✅ Progress reporting
✅ Workflow YAML parsing
✅ Workflow validation

🚧 Not yet implemented (future phases):

- ❌ Actual task execution (Phase 2+)
- ❌ Activity registration (Phase 2+)
- ❌ AI primitives (Phase 3+)
- ❌ Stigmer DSL compiler (Phase 5+)

Phase 1.5 proves the architecture works by:
1. Loading workflow from runtime input (not file)
2. Validating workflow structure
3. Reporting progress via gRPC callbacks
4. NO database dependencies in Go service

## Next Steps

### Immediate

1. ✅ Generate proto stubs
2. ✅ Create configuration package
3. ✅ Implement callback client
4. ✅ Create executor with progress reporting
5. ✅ Update kustomization files
6. ✅ Add LoadFromString to zigflow

### Phase 2 (Task Execution)

1. Implement actual task execution
2. Register Temporal activities
3. Execute workflow states
4. Handle task retries and errors

### Phase 3 (AI Primitives)

1. Add AI-specific task types
2. Integrate with vector databases
3. Add context management

### Phase 4 (Java Side)

1. Implement callback service in Stigmer Service
2. Store events in MongoDB
3. Publish to Redis
4. Broadcast via WebSocket/SSE
5. Provide query APIs for frontend

## Documentation

- [Callback Integration Guide](docs/callback-integration.md)
- [Architecture](docs/architecture.md)
- [Proto Structure](../../../_projects/2026-01-08-workflow-orchestration-engine/proto-structure.md)
- [Async Execution Pattern](../../../_projects/2026-01-08-workflow-orchestration-engine/async-execution-callback-pattern.md)
- [Phase 1.5 Architecture](../../../_projects/2026-01-08-workflow-orchestration-engine/phase-1.5-runtime-execution-architecture.md)

## Support

For questions or issues:

1. Check the documentation in `docs/`
2. Review project planning documents in `_projects/2026-01-08-workflow-orchestration-engine/`
3. Check workflow runner logs
4. Verify Stigmer Service is receiving callbacks

## License

Apache License 2.0 - See LICENSE file for details
