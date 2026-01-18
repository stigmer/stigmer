# Day 4: Fix gRPC → Temporal Workflow Trigger

**Date**: 2026-01-08  
**Status**: 📋 READY TO IMPLEMENT  
**Priority**: 🔥 CRITICAL - Blocks all workflow testing

---

## Problem Identified ✅

The current `ExecuteAsync` implementation in gRPC mode does NOT start a Temporal workflow.

**Current (WRONG)**:
```go
func (s *Server) ExecuteAsync(ctx context.Context, input *runnerv1.WorkflowExecuteInput) {
    workflowExecutor := executor.NewWorkflowExecutor(s.callbackClient)
    go func() {
        err := workflowExecutor.Execute(execCtx, input) // ← Direct execution!
    }()
}
```

**What happens**: Workflow executes in a goroutine, bypassing Temporal entirely.

---

## Required Architecture ✅

**DUAL Mode Flow**:
```
gRPC Request → ExecuteAsync Handler → temporalClient.ExecuteWorkflow() 
   → Temporal Server → Temporal Worker (same process) → ExecuteServerlessWorkflow 
   → Activities Execute → Progress Reports
```

---

## Implementation Plan

### 1. Update gRPC Server Struct

**File**: `pkg/grpc/server.go`

Add Temporal client to server:
```go
type Server struct {
    runnerv1.UnimplementedWorkflowRunnerCommandControllerServer
    
    grpcServer      *grpc.Server
    healthServer    *health.Server
    callbackClient  *callback.Client
    temporalClient  client.Client  // ← ADD THIS (optional, nil in gRPC-only mode)
    taskQueue       string          // ← ADD THIS
    
    executions      map[string]*ExecutionContext
    executionsMux   sync.RWMutex
}
```

Update constructor:
```go
func NewServer(callbackClient *callback.Client, temporalClient client.Client, taskQueue string) *Server {
    return &Server{
        callbackClient: callbackClient,
        temporalClient: temporalClient,
        taskQueue:      taskQueue,
        executions:     make(map[string]*ExecutionContext),
    }
}
```

### 2. Update ExecuteAsync Implementation

**File**: `pkg/grpc/server.go`

Replace direct execution with Temporal workflow start:

```go
func (s *Server) ExecuteAsync(ctx context.Context, input *runnerv1.WorkflowExecuteInput) (*runnerv1.WorkflowExecuteResponse, error) {
    log.Info().
        Str("execution_id", input.WorkflowExecutionId).
        Str("workflow_name", input.Metadata.Name).
        Msg("ExecuteAsync: Starting workflow execution")

    // Check if Temporal client is available (DUAL/TEMPORAL mode)
    if s.temporalClient != nil {
        log.Info().
            Str("execution_id", input.WorkflowExecutionId).
            Msg("Starting Temporal workflow execution")
        
        // Start Temporal workflow
        workflowOptions := client.StartWorkflowOptions{
            ID:        input.WorkflowExecutionId,
            TaskQueue: s.taskQueue,
        }
        
        workflowRun, err := s.temporalClient.ExecuteWorkflow(
            ctx,
            workflowOptions,
            "ExecuteServerlessWorkflow",  // Workflow function name
            input,                         // Workflow input
        )
        
        if err != nil {
            log.Error().Err(err).Msg("Failed to start Temporal workflow")
            return nil, status.Errorf(codes.Internal, "failed to start workflow: %v", err)
        }
        
        log.Info().
            Str("execution_id", input.WorkflowExecutionId).
            Str("workflow_id", workflowRun.GetID()).
            Str("run_id", workflowRun.GetRunID()).
            Msg("Temporal workflow started successfully")
        
        return &runnerv1.WorkflowExecuteResponse{
            WorkflowExecutionId: input.WorkflowExecutionId,
            Status:              "running",
            Message:             "Workflow execution started in Temporal",
        }, nil
    }
    
    // Fallback to direct execution (gRPC-only mode)
    log.Info().
        Str("execution_id", input.WorkflowExecutionId).
        Msg("No Temporal client available - using direct execution (gRPC-only mode)")
    
    // ... existing direct execution code for gRPC-only mode ...
}
```

### 3. Update main.go Dual Mode

**File**: `main.go`

Pass Temporal client when creating gRPC server in dual mode:

```go
func startBothModes(port int) error {
    log.Info().Msg("Starting in dual mode (gRPC + Temporal)")
    
    // Load configurations
    stigmerConfig, err := config.LoadStigmerConfig()
    if err != nil {
        return fmt.Errorf("failed to load Stigmer config: %w", err)
    }
    
    temporalConfig, err := workerConfig.LoadFromEnv()
    if err != nil {
        return fmt.Errorf("failed to load Temporal config: %w", err)
    }
    
    // Create Temporal worker
    zigflowWorker, err := worker.NewZigflowWorker(temporalConfig)
    if err != nil {
        return fmt.Errorf("failed to create worker: %w", err)
    }
    defer zigflowWorker.Stop()
    
    // Register workflows and activities
    zigflowWorker.RegisterWorkflowsAndActivities()
    
    // Get Temporal client from worker
    temporalClient := zigflowWorker.GetTemporalClient()  // ← Need to add this method
    
    // Create callback client
    callbackClient, err := callback.NewClient(stigmerConfig)
    if err != nil {
        return fmt.Errorf("failed to create callback client: %w", err)
    }
    defer callbackClient.Close()
    
    // Create gRPC server WITH Temporal client
    server := grpcserver.NewServer(
        callbackClient,
        temporalClient,      // ← Pass Temporal client
        temporalConfig.TaskQueue,  // ← Pass task queue
    )
    
    // Start both services...
}
```

### 4. Add GetTemporalClient Method to Worker

**File**: `worker/worker.go`

```go
// GetTemporalClient returns the Temporal client for workflow execution
func (w *ZigflowWorker) GetTemporalClient() client.Client {
    return w.temporalClient
}
```

---

## Implementation Steps (In Order)

1. [ ] Update `worker/worker.go` - Add `GetTemporalClient()` method
2. [ ] Update `pkg/grpc/server.go` - Add Temporal client field and update constructor
3. [ ] Update `pkg/grpc/server.go` - Modify `ExecuteAsync` to start Temporal workflows
4. [ ] Update `main.go` - Pass Temporal client in `startBothModes()`
5. [ ] Update `main.go` - Fix `startGrpcServer()` to pass nil for Temporal client (gRPC-only mode)
6. [ ] Build and test

---

## Testing Steps

After implementation:

1. Set `EXECUTION_MODE=dual` in `.env_export` ✅ (already done)
2. Restart workflow-runner
3. Call gRPC `execute_async` endpoint
4. Verify in logs:
   - "Starting Temporal workflow execution"
   - "Temporal workflow started successfully"
   - Workflow ID and Run ID logged
5. Check Temporal UI:
   - Workflow Type: `ExecuteServerlessWorkflow`
   - Workflow status: Running → Completed
   - Activities visible in history

---

## Expected Logs (After Fix)

```
INF Starting in dual mode (gRPC + Temporal)
INF Connected to Temporal server
INF Temporal worker started task_queue=stigmer-workflows
INF gRPC server started port=9090
INF ExecuteAsync: Starting workflow execution execution_id=test-123
INF Starting Temporal workflow execution execution_id=test-123
INF Temporal workflow started successfully workflow_id=test-123 run_id=019b...
```

Then in Temporal Worker logs:
```
DEBUG WorkflowExecutionStarted workflow_type=ExecuteServerlessWorkflow
INFO  Starting serverless workflow execution
DEBUG ActivityTaskScheduled activity=ReportProgress
...
```

---

## Estimated Implementation Time

**2-3 hours** for all changes, build, and testing

---

## Current Status

✅ Problem identified  
✅ Architecture designed  
✅ Implementation plan created  
⏳ Waiting for approval to implement  
⏳ Code changes pending  
⏳ Testing pending

---

**Next**: Implement the 4 code changes above and test with your running service.

Would you like me to proceed with the implementation?
