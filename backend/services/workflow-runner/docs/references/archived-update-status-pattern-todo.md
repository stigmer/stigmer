# ARCHIVED: TODO: Implement updateStatus Pattern

> **⚠️ ARCHIVED DOCUMENT**  
> This document is kept for historical reference only.  
> All TODOs in this document have been completed.  
> Current implementation status: [implementation-status.md](../implementation/implementation-status.md)  
> **Archived**: January 16, 2026

---

## Status
Proto definitions cleaned up ✅  
Build errors fixed (removed callback code) ✅  
**Need implementation of updateStatus pattern** ⏳

## What Needs to Be Done

### 1. Update WorkflowExecutor 
File: `pkg/executor/workflow_executor.go`

Remove all `reportProgress` and `reportError` methods. Instead:

```go
// OLD:
e.reportProgress(ctx, input, "task_started", "validate_input", "running", "Validating input")

// NEW:
status := &workflowexecutionv1.WorkflowExecutionStatus{
    Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
    Tasks: []*workflowexecutionv1.WorkflowTask{
        {
            TaskId:     "task-1",
            TaskName:   "validate_input",
            TaskStatus: workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_IN_PROGRESS,
            StartedAt:  timestamppb.Now().String(),
        },
    },
}
executionClient.UpdateStatus(ctx, input.WorkflowExecutionId, status)
```

### 2. Build Tasks Array Progressively
As workflow executes:
- Add task to status.tasks[] when it starts
- Update task status/output when it completes  
- Update task error when it fails
- Call updateStatus RPC on each transition

### 3. Update Temporal Activity
File: `worker/activities/execute_workflow_activity.go`

Pass WorkflowExecutionClient to executor:

```go
executionClient, err := grpc_client.NewWorkflowExecutionClient(cfg)
if err != nil {
    return fmt.Errorf("failed to create execution client: %w", err)
}
defer executionClient.Close()

executor := executor.NewWorkflowExecutor(executionClient)
```

### 4. Remove gRPC Server Progress Streaming
File: `pkg/grpc/server.go`

The `execute` RPC no longer needs to stream progress events. 
UI gets updates via:
- Polling `get(execution_id)` 
- WebSocket subscriptions (handled by Stigmer backend)

### 5. Update Tests
- Remove callback mock/tests
- Add tests for updateStatus calls
- Verify status.tasks[] is built correctly

## Pattern Match: Agent Runner

Agent runner does this in `worker/activities/execute_graphton.py`:

```python
# Build status locally
status_builder = StatusBuilder(execution_id, execution.status)

# Process events and build status
for event in agent_events:
    await status_builder.process_event(event)

# Set final phase
status_builder.current_status.phase = ExecutionPhase.EXECUTION_COMPLETED

# Return to workflow (workflow persists via Java activity)
return status_builder.current_status
```

Workflow runner should do similar:
- Build status.tasks[] as workflow executes
- Call updateStatus RPC when tasks transition
- No separate progress events - just task state changes

## Testing Strategy

1. **Unit tests**: Verify status.tasks[] building logic
2. **Integration tests**: Golden tests should still work (just check final status, not events)
3. **E2E tests**: Create execution, poll status, verify tasks[] updates

## Estimated Effort
- Refactor executor: 2-3 hours
- Update activity: 1 hour  
- Remove/update tests: 1-2 hours
- Manual testing: 1 hour
- **Total: 5-7 hours**

## Files Changed Summary
```
pkg/callback/                          ✅ DELETED
worker/activities/report_progress_activity.go  ✅ DELETED
pkg/grpc_client/workflow_execution_client.go   ✅ CREATED

pkg/executor/workflow_executor.go      ⏳ TODO: Remove reportProgress methods
worker/activities/execute_workflow_activity.go ⏳ TODO: Pass executionClient
pkg/grpc/server.go                     ⏳ TODO: Remove progress streaming
```

## Next Steps
1. Update executor to build tasks[] array
2. Add updateStatus calls
3. Test with golden workflows
4. Verify UI shows real-time updates
