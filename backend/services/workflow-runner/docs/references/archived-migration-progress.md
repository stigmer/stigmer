# ARCHIVED: Migration from WorkflowProgressEvent to WorkflowExecutionStatus Pattern

> **⚠️ ARCHIVED DOCUMENT**  
> This document is kept for historical reference only.  
> This migration was completed in January 2026.  
> See [archived-migration-complete.md](./archived-migration-complete.md) for completion report.  
> **Archived**: January 16, 2026

---

## Summary

Migrating workflow-runner from callback-based progress events to updateStatus RPC pattern matching agent-runner.

##Changes Made

### Proto Cleanup
- ✅ Removed `progress_events` references from api.proto
- ✅ Removed `progress_events` references from command.proto  
- ✅ Removed `progress_events` references from query.proto
- ✅ Removed `progress_events` references from enum.proto
- ✅ Removed `progress_events` references from spec.proto

### Go Code Cleanup  
- ✅ Deleted `pkg/callback/` directory (client.go, BUILD.bazel)
- ✅ Deleted `worker/activities/report_progress_activity.go`
- ⏳ TODO: Update `pkg/executor/workflow_executor.go` - remove reportProgress methods
- ⏳ TODO: Update `pkg/grpc/server.go` - remove progress event streaming
- ⏳ TODO: Update `worker/activities/execute_workflow_activity.go` - remove progress reporting
- ⏳ TODO: Create `pkg/grpc_client/workflow_execution_client.go` (like AgentExecutionClient)
- ⏳ TODO: Update BUILD.bazel files - remove callback deps

## New Pattern

Instead of:
```go
// OLD: Callback-based progress reporting
callback.NewProgressEvent(...)
callbackClient.ReportProgress(event)
```

Use:
```go
// NEW: Direct status updates
executionClient.UpdateStatus(executionID, status)
// where status.tasks[] is updated progressively
```

## Next Steps
1. Create WorkflowExecutionClient (similar to AgentExecutionClient)
2. Update executor to build status.tasks[] instead of sending events  
3. Call updateStatus RPC on task transitions
4. Regenerate proto stubs
5. Verify build
