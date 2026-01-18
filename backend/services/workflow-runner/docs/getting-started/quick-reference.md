# Workflow Runner - Quick Reference

## What Was Implemented

✅ **Proto Stubs**: Generated Go stubs from proto definitions
✅ **Config Package**: Load Stigmer Service configuration from environment
✅ **gRPC Server**: Implements command controller (execute, cancel, pause, resume)
✅ **gRPC Client**: Reports progress to Stigmer Service via callbacks
✅ **Executor**: Workflow executor that reports progress at each stage
✅ **Zigflow Enhancement**: Added `LoadFromString()` to load workflows from YAML strings
✅ **Kustomization**: Updated prod/local configs with server port and callback endpoint
✅ **Documentation**: Complete guides and references

## Key Concept: Dual gRPC Implementation

**Workflow Runner is BOTH**:
1. **gRPC Server** (Port 9090): Receives commands FROM Stigmer Service
2. **gRPC Client**: Sends callbacks TO Stigmer Service

---

## Environment Variables

```bash
# gRPC Server (receives commands FROM Stigmer Service)
GRPC_PORT=9090

# gRPC Client (sends callbacks TO Stigmer Service)
STIGMER_SERVICE_ENDPOINT=stigmer-prod-api.planton.live:443
STIGMER_SERVICE_API_KEY=<your-api-key>
STIGMER_SERVICE_USE_TLS=true

# Optional: Temporal (for Phase 2+)
TEMPORAL_SERVICE_ADDRESS=localhost:7233
TEMPORAL_NAMESPACE=default
```

---

## Quick Start

### 1. Generate Stubs

```bash
cd apis
make go-stubs
```

### 2. Build

```bash
cd backend/services/workflow-runner
bazel build //backend/services/workflow-runner/cmd/grpc-server
```

### 3. Run

```bash
# Set environment variables first
export GRPC_PORT=9090
export STIGMER_SERVICE_ENDPOINT=stigmer-prod-api.planton.live:443
export STIGMER_SERVICE_API_KEY=your-key
export LOG_LEVEL=debug

bazel run //backend/services/workflow-runner/cmd/grpc-server
```

---

## Usage Example

### From Stigmer Service (Java) - Call Workflow Runner

```java
// Create gRPC stub to workflow runner
ManagedChannel channel = ManagedChannelBuilder
    .forAddress("workflow-runner-service", 9090)
    .usePlaintext()
    .build();

WorkflowRunnerCommandControllerBlockingStub stub =
    WorkflowRunnerCommandControllerGrpc.newBlockingStub(channel);

// Execute workflow asynchronously
WorkflowExecuteInput input = WorkflowExecuteInput.newBuilder()
    .setWorkflowExecutionId("exec-123")
    .setWorkflowYaml(workflowYaml)
    .setMetadata(metadata)
    .build();

WorkflowExecuteResponse response = stub.executeAsync(input);
```

### From Workflow Runner (Go) - Report Progress

```go
// This happens automatically inside the executor
event := callback.NewProgressEvent(
    executionID,
    "workflow_started",
    workflowName,
    "running",
    "Workflow execution started",
    1,
)

// Callback client reports to Stigmer Service
response, err := callbackClient.ReportProgress(ctx, event)
```

---

## Progress Events

The workflow runner reports these events:

| Event | Status | When |
|-------|--------|------|
| `workflow_started` | `running` | Execution begins |
| `workflow_validating` | `running` | Validating YAML |
| `workflow_validated` | `running` | Validation passed |
| `task_started` | `running` | Task begins |
| `task_completed` | `completed` | Task succeeds |
| `workflow_completed` | `completed` | Workflow succeeds |
| `workflow_failed` | `failed` | Workflow fails |

---

## Files Created

### New Packages
- `pkg/config/` - Configuration management
- `pkg/callback/` - gRPC client for callbacks
- `pkg/executor/` - Workflow executor with progress reporting
- `pkg/grpc/` - gRPC server for commands
- `cmd/grpc-server/` - Main entry point

### Modified
- `pkg/zigflow/loader.go` - Added `LoadFromString()`
- `_kustomize/overlays/prod/service.yaml` - Added GRPC_PORT and callback config
- `_kustomize/overlays/local/service.yaml` - Added GRPC_PORT and callback config

### Documentation
- `README-PHASE-1.5.md` - Complete implementation guide
- `docs/grpc-architecture.md` - gRPC architecture (server + client)
- `docs/callback-integration.md` - Callback integration guide
- `ARCHITECTURE-SUMMARY.md` - Complete architecture summary
- `QUICK-REFERENCE.md` - This file

---

## Next Steps

### For Testing
1. Generate stubs: `cd apis && make go-stubs`
2. Build: `bazel build //backend/services/workflow-runner/cmd/grpc-server`
3. Run gRPC server: `bazel run //backend/services/workflow-runner/cmd/grpc-server`
4. Test with grpcurl:
   ```bash
   grpcurl -plaintext localhost:9090 list
   grpcurl -plaintext -d '{"workflow_execution_id":"test-1",...}' \
     localhost:9090 \
     ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/ExecuteAsync
   ```
5. Verify callbacks are sent to Stigmer Service

### For Production
1. Create Kubernetes secret with API key
2. Deploy updated kustomization
3. Verify workflow runner connects to Stigmer Service
4. Test end-to-end workflow execution

### Java Side (Stigmer Service)
1. Generate Java stubs: `cd apis && make java-stubs`
2. Implement `WorkflowRunnerCommandService`
3. Handle `reportProgress()` RPC
4. Store events in MongoDB
5. Publish to Redis
6. Broadcast via WebSocket/SSE

---

## Architecture

```
Stigmer Service (Java)
    ↓ (gRPC call)
    execute_async(input)
    ↓
Workflow Runner (Go) - gRPC SERVER :9090
    ↓ (execute workflow)
Workflow Executor
    ↓ (report progress)
Workflow Runner (Go) - gRPC CLIENT
    ↓ (gRPC callback)
    report_progress(event)
    ↓
Stigmer Service (Java) - gRPC SERVER
    ↓ (store/publish)
MongoDB + Redis + WebSocket/SSE
    ↓
Frontend UI
```

---

## Configuration Locations

**Production**: `_kustomize/overlays/prod/service.yaml`
```yaml
STIGMER_SERVICE_ENDPOINT: stigmer-prod-api.planton.live:443
STIGMER_SERVICE_API_KEY: $secrets-group/workflow-runner-secrets/stigmer-api-key
```

**Local**: `_kustomize/overlays/local/service.yaml`
```yaml
STIGMER_SERVICE_ENDPOINT: stigmer-prod-api.planton.live:443
STIGMER_SERVICE_API_KEY: $secrets-group/workflow-runner-secrets/stigmer-api-key-local
```

---

## Important Notes

1. **No Database Dependencies**: Workflow runner does NOT connect to MongoDB
2. **Complete Input**: All data comes from `WorkflowExecuteInput` proto
3. **Resilient Reporting**: Progress failures don't stop workflow execution
4. **Retry Logic**: Automatic retry with exponential backoff (3 attempts)
5. **TLS by Default**: Production uses TLS, only disable for local testing

---

## Troubleshooting

**Can't connect to Stigmer Service?**
- Check `STIGMER_SERVICE_ENDPOINT` is correct
- Verify network connectivity
- Check TLS setting matches environment

**Authentication errors?**
- Verify `STIGMER_SERVICE_API_KEY` is set
- Check API key has correct permissions
- Ensure Bearer token format is correct

**Progress not appearing?**
- Check Stigmer Service logs
- Verify callback service is running
- Check MongoDB/Redis connections

---

For detailed information, see:
- `README-PHASE-1.5.md` - Complete guide
- `docs/callback-integration.md` - Integration details
- `IMPLEMENTATION-SUMMARY-PHASE-1.5.md` - Implementation summary
