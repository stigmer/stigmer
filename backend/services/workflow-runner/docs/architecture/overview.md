# Workflow Runner - Complete Architecture Summary

**Date**: January 8, 2026  
**Status**: ✅ Complete Implementation

---

## Core Concept: Dual gRPC Implementation

The Workflow Runner is **BOTH**:

### 1. gRPC **SERVER** 🎙️
- **Listens on**: Port 9090
- **Called by**: Stigmer Service (Java)
- **Implements**: Command RPCs
  - `execute()` - Sync execution with streaming
  - `execute_async()` - Async execution (fire & forget)
  - `cancel_execution()` - Cancel workflow
  - `pause_execution()` - Pause workflow
  - `resume_execution()` - Resume workflow

### 2. gRPC **CLIENT** 📞
- **Connects to**: `stigmer-prod-api.planton.live:443`
- **Calls**: `report_progress()` RPC
- **Reports**: Progress events TO Stigmer Service
  - Workflow started/completed/failed
  - Task started/completed/failed
  - Validation events
  - Error events

---

## Complete Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Stigmer Service (Java)                      │
│  - Fetches workflow YAML from MongoDB                           │
│  - Builds WorkflowExecuteInput proto                            │
│  - Calls workflow runner gRPC service                           │
└─────────────────────────────────────────────────────────────────┘
                             |
                             | gRPC call
                             | execute_async(input)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              Workflow Runner (Go) - gRPC SERVER                  │
│              Listening on :9090                                  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Command Handler                                       │    │
│  │  - execute()                                           │    │
│  │  - execute_async() ← RECEIVES THIS                    │    │
│  │  - cancel_execution()                                  │    │
│  │  - pause_execution()                                   │    │
│  │  - resume_execution()                                  │    │
│  └────────────────────────────────────────────────────────┘    │
│                             ↓                                    │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Workflow Executor                                     │    │
│  │  - Parses workflow YAML from input                     │    │
│  │  - Validates workflow structure                        │    │
│  │  - Executes tasks (Phase 1.5: validation only)        │    │
│  │  - Tracks execution state                              │    │
│  └────────────────────────────────────────────────────────┘    │
│                             ↓                                    │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Callback Client - gRPC CLIENT                         │    │
│  │  Connects to: stigmer-prod-api.planton.live:443       │    │
│  │  Calls: report_progress()                              │    │
│  │  - Sends progress events                               │    │
│  │  - Automatic retry (3 attempts)                        │    │
│  │  - Bearer token auth                                   │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                             |
                             | gRPC callback
                             | report_progress(event)
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              Stigmer Service (Java) - gRPC SERVER                │
│              Implements report_progress()                        │
│                                                                  │
│  - Stores events in MongoDB                                     │
│  - Publishes to Redis (pub/sub)                                 │
│  - Broadcasts to WebSocket/SSE subscribers                      │
│  - Updates execution status                                     │
└─────────────────────────────────────────────────────────────────┘
                             |
                             ↓
                      Frontend (React/Flutter)
                      - Subscribes to progress
                      - Displays real-time updates
```

---

## Who Implements What?

### Workflow Runner (Go)

**gRPC Server Implementation**:
```go
// Location: pkg/grpc/server.go
func (s *Server) Execute(input, stream) error
func (s *Server) ExecuteAsync(ctx, input) (*Response, error)
func (s *Server) CancelExecution(ctx, req) (*emptypb.Empty, error)
func (s *Server) PauseExecution(ctx, req) (*emptypb.Empty, error)
func (s *Server) ResumeExecution(ctx, req) (*emptypb.Empty, error)
```

**gRPC Client Usage**:
```go
// Location: pkg/callback/client.go
func (c *Client) ReportProgress(ctx, event) (*ProgressAckResponse, error)
```

### Stigmer Service (Java)

**gRPC Client Usage**:
```java
// Call workflow runner to execute workflow
WorkflowRunnerCommandControllerGrpc.WorkflowRunnerCommandControllerBlockingStub stub;
stub.executeAsync(input);
stub.cancelExecution(request);
```

**gRPC Server Implementation**:
```java
// Receive progress callbacks from workflow runner
@Override
public void reportProgress(WorkflowProgressEvent request,
                            StreamObserver<ProgressAckResponse> responseObserver) {
    // Store, publish, broadcast
}
```

---

## Configuration

### Workflow Runner Environment Variables

```bash
# === gRPC SERVER (for receiving commands) ===
GRPC_PORT=9090                                    # Server listens on this port

# === gRPC CLIENT (for sending callbacks) ===
STIGMER_SERVICE_ENDPOINT=stigmer-prod-api.planton.live:443  # Where to send progress
STIGMER_SERVICE_API_KEY=<from-kubernetes-secret>            # Authentication
STIGMER_SERVICE_USE_TLS=true                                # Use TLS for callbacks

# === Temporal (optional, for Phase 2+) ===
TEMPORAL_SERVICE_ADDRESS=temporal:7233
TEMPORAL_NAMESPACE=default

# === Logging ===
LOG_LEVEL=info  # debug, info, warn, error
ENV=prod        # local, staging, prod
```

---

## Files Created

### New Packages

```
pkg/
├── config/
│   ├── stigmer_config.go       ✨ Stigmer Service configuration
│   └── BUILD.bazel
├── callback/
│   ├── client.go               ✨ gRPC client for callbacks
│   └── BUILD.bazel
├── executor/
│   ├── workflow_executor.go    ✨ Workflow execution logic
│   └── BUILD.bazel
└── grpc/
    ├── server.go               ✨ gRPC server for commands
    └── BUILD.bazel
```

### New Entry Point

```
cmd/
└── grpc-server/
    ├── main.go                 ✨ Main entry point
    └── BUILD.bazel
```

### Updated Configuration

```
_kustomize/overlays/
├── prod/
│   └── service.yaml            ✏️ Added GRPC_PORT + callback config
└── local/
    └── service.yaml            ✏️ Added GRPC_PORT + callback config
```

### Documentation

```
docs/
├── grpc-architecture.md        ✨ Complete gRPC architecture guide
└── callback-integration.md     ✨ Callback integration guide

README-PHASE-1.5.md            ✨ Implementation guide
ARCHITECTURE-SUMMARY.md        ✨ This file
QUICK-REFERENCE.md             ✨ Quick reference
```

---

## RPC Implementation Matrix

| RPC Method | Server | Client | Purpose |
|------------|--------|--------|---------|
| `execute()` | Workflow Runner (Go) | Stigmer Service (Java) | Sync execution with streaming |
| `execute_async()` | Workflow Runner (Go) | Stigmer Service (Java) | Async execution |
| `cancel_execution()` | Workflow Runner (Go) | Stigmer Service (Java) | Cancel workflow |
| `pause_execution()` | Workflow Runner (Go) | Stigmer Service (Java) | Pause workflow |
| `resume_execution()` | Workflow Runner (Go) | Stigmer Service (Java) | Resume workflow |
| `report_progress()` | Stigmer Service (Java) | Workflow Runner (Go) | Report progress |

---

## Building & Running

### Generate Stubs

```bash
cd apis
make go-stubs
```

### Build

```bash
cd backend/services/workflow-runner
bazel build //backend/services/workflow-runner/cmd/grpc-server
```

### Run Locally

```bash
# Set environment variables
export GRPC_PORT=9090
export STIGMER_SERVICE_ENDPOINT=localhost:9091
export STIGMER_SERVICE_API_KEY=test-key
export STIGMER_SERVICE_USE_TLS=false
export LOG_LEVEL=debug
export ENV=local

# Run
bazel run //backend/services/workflow-runner/cmd/grpc-server
```

### Run in Kubernetes

```bash
# Deploy with kubectl
kubectl apply -k _kustomize/overlays/prod/

# Check status
kubectl get pods -l app=workflow-runner -n stigmer-prod

# View logs
kubectl logs -f deployment/workflow-runner -n stigmer-prod
```

---

## Testing

### Test Execute Async

```bash
grpcurl -plaintext \
  -d '{
    "workflow_execution_id": "test-123",
    "workflow_yaml": "document:\n  dsl: 1.0.0\n  name: test\n  namespace: test\n  version: 1.0.0\ndo:\n  - step:\n      set:\n        message: \"Hello\"",
    "metadata": {
      "name": "test-workflow",
      "version": "1.0.0",
      "namespace": "test"
    }
  }' \
  localhost:9090 \
  ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/ExecuteAsync
```

**Expected Response**:
```json
{
  "workflowExecutionId": "test-123",
  "status": "running",
  "message": "Workflow execution started in background"
}
```

### Test Cancel

```bash
grpcurl -plaintext \
  -d '{
    "execution_id": "test-123",
    "reason": "Testing cancellation"
  }' \
  localhost:9090 \
  ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/CancelExecution
```

---

## Integration Points

### Stigmer Service → Workflow Runner

**When**: User triggers workflow execution

**Flow**:
1. Stigmer Service fetches workflow YAML from MongoDB
2. Stigmer Service builds `WorkflowExecuteInput` proto
3. Stigmer Service calls workflow runner gRPC:
   ```java
   WorkflowExecuteResponse response = workflowRunnerStub.executeAsync(input);
   ```
4. Stigmer Service stores execution record in MongoDB
5. Stigmer Service returns execution ID to frontend

### Workflow Runner → Stigmer Service

**When**: During workflow execution

**Flow**:
1. Workflow runner executes workflow
2. At each stage, workflow runner reports progress:
   ```go
   callbackClient.ReportProgress(ctx, event)
   ```
3. Stigmer Service receives callback
4. Stigmer Service stores event in MongoDB
5. Stigmer Service publishes to Redis
6. Stigmer Service broadcasts to WebSocket/SSE subscribers
7. Frontend receives real-time update

---

## Key Differences from Initial Implementation

### What Changed?

Initially I implemented **only the callback client** (gRPC client side).

You correctly identified that workflow runner should **also be a gRPC server** to receive commands.

### Current Complete Implementation

✅ **gRPC Server**: Receives execute/cancel/pause/resume commands  
✅ **gRPC Client**: Sends progress callbacks  
✅ **Executor**: Executes workflows and reports progress  
✅ **Configuration**: Both server port and callback endpoint  
✅ **Documentation**: Complete architecture guide  

---

## Next Steps

### Immediate

1. ⏳ Test gRPC server with grpcurl
2. ⏳ Test callback to mock Stigmer Service
3. ⏳ Deploy to staging
4. ⏳ End-to-end test

### Java Side (Stigmer Service)

1. ⏳ Generate Java stubs
2. ⏳ Implement gRPC client to call workflow runner
3. ⏳ Implement gRPC server to receive callbacks
4. ⏳ Store events in MongoDB
5. ⏳ Publish to Redis
6. ⏳ Broadcast via WebSocket/SSE

### Phase 2 (Task Execution)

1. ⏳ Implement actual task execution
2. ⏳ Temporal integration
3. ⏳ Activity registration
4. ⏳ Error handling and retries

---

## Summary

The Workflow Runner now has a **complete dual gRPC implementation**:

1. **Server** (Port 9090): Receives commands from Stigmer Service
   - execute, execute_async, cancel, pause, resume

2. **Client** (Connects to Stigmer Service): Reports progress
   - report_progress with retry and authentication

This follows the exact architecture you described in the proto definitions and design documents.

**Status**: ✅ Complete and ready for integration testing
