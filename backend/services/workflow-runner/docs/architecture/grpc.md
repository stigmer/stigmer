# Workflow Runner - gRPC Architecture

## Overview

The Workflow Runner is **BOTH** a gRPC server AND a gRPC client:

1. **gRPC Server**: Implements `WorkflowRunnerCommandController` - receives commands FROM Stigmer Service
2. **gRPC Client**: Calls `report_progress()` - reports progress TO Stigmer Service

## Architecture Diagram

```
                    Stigmer Service (Java)
                            |
                            | gRPC calls
                            | (execute, cancel, pause, resume)
                            ↓
┌──────────────────────────────────────────────────────────────┐
│              Workflow Runner (Go)                             │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  gRPC Server (Port 9090)                            │    │
│  │  Implements: WorkflowRunnerCommandController        │    │
│  │  - execute(input) → stream progress                 │    │
│  │  - execute_async(input) → execution_id              │    │
│  │  - cancel_execution(id)                             │    │
│  │  - pause_execution(id)                              │    │
│  │  - resume_execution(id)                             │    │
│  └─────────────────────────────────────────────────────┘    │
│                            ↓                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Workflow Executor                                  │    │
│  │  - Parses workflow YAML                             │    │
│  │  - Validates workflow                               │    │
│  │  - Executes tasks                                   │    │
│  │  - Manages execution lifecycle                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                            ↓                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  gRPC Client (Callback)                             │    │
│  │  Calls: report_progress()                           │    │
│  │  - Sends progress events                            │    │
│  │  - Automatic retry on failure                       │    │
│  │  - Bearer token authentication                      │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                            |
                            | gRPC callbacks
                            | (report_progress)
                            ↓
                    Stigmer Service (Java)
                    - Stores in MongoDB
                    - Publishes to Redis
                    - Broadcasts via WebSocket/SSE
```

## RPC Implementation Matrix

| RPC Method | Implemented By | Called By | Purpose |
|------------|----------------|-----------|---------|
| `execute()` | Workflow Runner (Go) | Stigmer Service (Java) | Sync execution with streaming |
| `execute_async()` | Workflow Runner (Go) | Stigmer Service (Java) | Async execution (fire & forget) |
| `cancel_execution()` | Workflow Runner (Go) | Stigmer Service (Java) | Cancel running workflow |
| `pause_execution()` | Workflow Runner (Go) | Stigmer Service (Java) | Pause workflow |
| `resume_execution()` | Workflow Runner (Go) | Stigmer Service (Java) | Resume paused workflow |
| `report_progress()` | Stigmer Service (Java) | Workflow Runner (Go) | Report progress events |

## Detailed Flow

### 1. Synchronous Execution (execute)

```
1. Stigmer Service → workflow-runner:9090
   gRPC: execute(WorkflowExecuteInput)

2. Workflow Runner creates stream, starts execution

3. During execution:
   Workflow Runner → stigmer-prod-api.planton.live:443
   gRPC: report_progress(WorkflowProgressEvent)
   
4. Workflow Runner streams progress back to caller
   stream.Send(WorkflowProgressEvent)

5. On completion, stream closes
```

**Use case**: Testing, short workflows (< 10 minutes), interactive execution

### 2. Asynchronous Execution (execute_async)

```
1. Stigmer Service → workflow-runner:9090
   gRPC: execute_async(WorkflowExecuteInput)

2. Workflow Runner immediately returns:
   Response{execution_id, status: "running"}

3. Execution continues in background

4. During execution:
   Workflow Runner → stigmer-prod-api.planton.live:443
   gRPC: report_progress(WorkflowProgressEvent)
   
5. Stigmer Service stores/publishes progress

6. Frontend subscribes to progress via WebSocket/SSE
```

**Use case**: Production, long workflows (hours/days/months), fire-and-forget

### 3. Cancel Execution

```
1. User clicks "Cancel" in UI

2. Frontend → Stigmer Service

3. Stigmer Service → workflow-runner:9090
   gRPC: cancel_execution(execution_id)

4. Workflow Runner cancels context, stops execution

5. Final progress event sent to Stigmer Service:
   report_progress(status: "cancelled")
```

### 4. Pause/Resume Execution

```
Pause:
1. Stigmer Service → workflow-runner:9090
   gRPC: pause_execution(execution_id)

2. Workflow Runner pauses execution (Phase 2+)

3. Status updated to "paused"

Resume:
1. Stigmer Service → workflow-runner:9090
   gRPC: resume_execution(execution_id)

2. Workflow Runner resumes execution

3. Status updated to "running"
```

## gRPC Server Implementation

**Location**: `pkg/grpc/server.go`

```go
// Server implements WorkflowRunnerCommandController
type Server struct {
    runnerv1.UnimplementedWorkflowRunnerCommandControllerServer
    
    grpcServer     *grpc.Server
    callbackClient *callback.Client
    
    // Track running executions for cancel/pause/resume
    executions     map[string]*ExecutionContext
    executionsMux  sync.RWMutex
}

// Start gRPC server
func (s *Server) Start(port int) error {
    lis, _ := net.Listen("tcp", fmt.Sprintf(":%d", port))
    s.grpcServer = grpc.NewServer()
    runnerv1.RegisterWorkflowRunnerCommandControllerServer(s.grpcServer, s)
    return s.grpcServer.Serve(lis)
}
```

## gRPC Client Implementation

**Location**: `pkg/callback/client.go`

```go
// Client is gRPC client for Stigmer Service callbacks
type Client struct {
    conn          *grpc.ClientConn
    commandClient runnerv1.WorkflowRunnerCommandControllerClient
    config        *config.StigmerConfig
}

// ReportProgress sends progress to Stigmer Service
func (c *Client) ReportProgress(ctx context.Context, event *runnerv1.WorkflowProgressEvent) (*runnerv1.ProgressAckResponse, error) {
    ctx = c.withAuth(ctx) // Add Bearer token
    return c.commandClient.ReportProgress(ctx, event)
}
```

## Configuration

### Workflow Runner Configuration

```bash
# gRPC Server (listens for commands FROM Stigmer Service)
GRPC_PORT=9090

# gRPC Client (reports progress TO Stigmer Service)
STIGMER_SERVICE_ENDPOINT=stigmer-prod-api.planton.live:443
STIGMER_SERVICE_API_KEY=<api-key>
STIGMER_SERVICE_USE_TLS=true
```

### Stigmer Service Configuration

The Java side needs to configure:

```yaml
# Workflow Runner endpoint (for sending commands)
workflow-runner:
  endpoint: workflow-runner-service:9090
  tls: false  # Internal Kubernetes communication
```

## Execution Lifecycle

### Phase 1.5 (Current)

1. ✅ Receive execute/execute_async command
2. ✅ Parse and validate workflow YAML
3. ✅ Report progress events via callback
4. ✅ Track executions for cancel/pause/resume
5. ✅ Return success/failure
6. 🚧 Actual task execution (validation only)
7. 🚧 Pause/resume logic (status only)

### Phase 2+ (Future)

1. Execute workflow tasks using Zigflow engine
2. Handle task retries and errors
3. Implement actual pause/resume
4. Support AI-specific tasks
5. Vector DB integration
6. Long-running workflow support (days/months)

## Testing

### Test Execute (Sync)

```bash
# Using grpcurl
grpcurl -plaintext \
  -d '{
    "workflow_execution_id": "test-exec-1",
    "workflow_yaml": "...",
    "metadata": {
      "name": "test-workflow",
      "version": "1.0.0"
    }
  }' \
  localhost:9090 \
  ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/Execute
```

### Test Execute Async

```bash
grpcurl -plaintext \
  -d '{
    "workflow_execution_id": "test-exec-2",
    "workflow_yaml": "...",
    "metadata": {
      "name": "test-workflow",
      "version": "1.0.0"
    }
  }' \
  localhost:9090 \
  ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/ExecuteAsync
```

### Test Cancel

```bash
grpcurl -plaintext \
  -d '{
    "execution_id": "test-exec-1",
    "reason": "User requested cancellation"
  }' \
  localhost:9090 \
  ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController/CancelExecution
```

## Security

### gRPC Server (Receives Commands)

**Option 1: Internal Kubernetes** (Recommended for Production)
- No TLS (internal cluster communication)
- Network policies restrict access
- Service mesh (Istio/Linkerd) for encryption

**Option 2: TLS with mTLS** (If exposed externally)
- TLS certificates for encryption
- Client certificates for authentication
- API key in metadata for authorization

### gRPC Client (Sends Callbacks)

- TLS enabled by default
- Bearer token authentication
- API key passed in Authorization header
- Certificate verification enabled

## Monitoring

### Metrics

The gRPC server exposes metrics:

- Active executions: `workflow_runner_active_executions`
- Execution duration: `workflow_runner_execution_duration_seconds`
- RPC calls: Standard gRPC metrics

### Health Checks

```bash
# Check if server is running
grpcurl -plaintext localhost:9090 list

# Should show:
# ai.stigmer.workflow.runner.v1.WorkflowRunnerCommandController
# grpc.reflection.v1alpha.ServerReflection
```

### Logging

Structured logs include:

- Execution ID
- Workflow name
- RPC method
- Request/response details
- Error traces

## Deployment

### Kubernetes Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: workflow-runner-service
spec:
  selector:
    app: workflow-runner
  ports:
    - name: grpc
      port: 9090
      targetPort: 9090
  type: ClusterIP
```

### Pod Configuration

See `_kustomize/overlays/prod/service.yaml` for complete configuration.

Key settings:
- `GRPC_PORT=9090` - Server port
- `STIGMER_SERVICE_ENDPOINT` - Callback endpoint
- `STIGMER_SERVICE_API_KEY` - Authentication

## Integration with Stigmer Service (Java)

### Calling Workflow Runner

```java
// Create gRPC channel to workflow runner
ManagedChannel channel = ManagedChannelBuilder
    .forAddress("workflow-runner-service", 9090)
    .usePlaintext() // Internal Kubernetes
    .build();

WorkflowRunnerCommandControllerGrpc.WorkflowRunnerCommandControllerBlockingStub stub =
    WorkflowRunnerCommandControllerGrpc.newBlockingStub(channel);

// Execute workflow asynchronously
WorkflowExecuteInput input = WorkflowExecuteInput.newBuilder()
    .setWorkflowExecutionId("exec-123")
    .setWorkflowYaml(workflowYaml)
    .setMetadata(metadata)
    .build();

WorkflowExecuteResponse response = stub.executeAsync(input);
```

### Receiving Progress Callbacks

```java
@Override
public void reportProgress(WorkflowProgressEvent request,
                            StreamObserver<ProgressAckResponse> responseObserver) {
    // Store in MongoDB
    // Publish to Redis
    // Broadcast via WebSocket/SSE
    
    responseObserver.onNext(ProgressAckResponse.newBuilder()
        .setSuccess(true)
        .build());
    responseObserver.onCompleted();
}
```

## Troubleshooting

### Server Won't Start

```bash
# Check port is available
netstat -an | grep 9090

# Check logs
kubectl logs -f deployment/workflow-runner
```

### Commands Not Working

```bash
# Test with grpcurl
grpcurl -plaintext localhost:9090 list

# Check service endpoint
kubectl get svc workflow-runner-service
```

### Callbacks Failing

```bash
# Check Stigmer Service endpoint
curl -v https://stigmer-prod-api.planton.live:443

# Verify API key is set
kubectl get secret workflow-runner-secrets -o yaml
```

## Related Documentation

- [Callback Integration](callback-integration.md)
- [README Phase 1.5](../README-PHASE-1.5.md)
- [Proto Structure](../../../_projects/2026-01-08-workflow-orchestration-engine/proto-structure.md)
- [Async Execution Pattern](../../../_projects/2026-01-08-workflow-orchestration-engine/async-execution-callback-pattern.md)
