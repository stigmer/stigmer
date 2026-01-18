# Execution ID Propagation Implementation

## Overview

This document describes how the WorkflowExecutionID is propagated from the Java orchestration workflow to Go Zigflow activities, enabling automatic progress reporting without modifying activity signatures.

## The Problem

**Challenge**: Activities need to report progress to stigmer-service, but they need the `WorkflowExecutionID` to do so. However:

1. Activities are defined by the CNCF Serverless Workflow spec (we don't control their signatures)
2. Adding execution ID to every activity input would break the spec
3. Workflow state is not accessible from activity context

**Requirements**:
- Activities must report progress with execution ID
- Activity signatures must remain unchanged
- Solution must work with activity interceptor pattern
- No code duplication or boilerplate

## The Solution: Temporal Search Attributes

We use Temporal's built-in Search Attributes feature to propagate the execution ID:

```
┌─────────────────────────────────────────────────────────┐
│  ExecuteServerlessWorkflow (Workflow)                   │
│  ┌────────────────────────────────────────────┐         │
│  │ workflow.UpsertSearchAttributes(ctx, {     │         │
│  │   "WorkflowExecutionID": executionID         │         │
│  │ })                                         │         │
│  └────────────────────────────────────────────┘         │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ Search attributes propagate to activities
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Activity Interceptor                                    │
│  ┌────────────────────────────────────────────┐         │
│  │ activityInfo := activity.GetInfo(ctx)      │         │
│  │ searchAttrs := activityInfo.               │         │
│  │   WorkflowExecution.SearchAttributes       │         │
│  │ executionID := searchAttrs["WorkflowExecutionID"] │   │
│  └────────────────────────────────────────────┘         │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ Use execution ID for progress reporting
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Progress Reporting (gRPC to stigmer-service)           │
└─────────────────────────────────────────────────────────┘
```

### Why Search Attributes?

**Advantages**:
1. ✅ Native Temporal feature (well-supported)
2. ✅ Accessible from activity context
3. ✅ No activity signature changes
4. ✅ No workflow input structure changes
5. ✅ Clean separation of concerns
6. ✅ Works with interceptor pattern

**Alternatives Considered**:
- ❌ **Workflow State**: Activities can't access workflow state
- ❌ **Activity Input**: Would require changing all activity signatures
- ❌ **Workflow Memo**: Set at workflow start time, harder to update
- ❌ **Activity Heartbeat**: Activities would need to know execution ID first

## Implementation Details

### 1. Setting Search Attribute (Workflow Side)

**File**: `pkg/executor/temporal_workflow.go`

```go
func ExecuteServerlessWorkflow(ctx workflow.Context, input *types.TemporalWorkflowInput) (*types.TemporalWorkflowOutput, error) {
    // ... initialization ...
    
    // Set WorkflowExecutionID as a search attribute
    err := workflow.UpsertSearchAttributes(ctx, map[string]interface{}{
        "WorkflowExecutionID": input.WorkflowExecutionID,
    })
    if err != nil {
        logger.Warn("Failed to set WorkflowExecutionID search attribute (non-critical)", "error", err)
    }
    
    // ... continue workflow execution ...
}
```

**Key Points**:
- Called at workflow start (before any activities execute)
- Uses `WorkflowExecutionID` (Temporal's default custom text field)
- Failure is non-critical (logged as warning)
- Sets once, available to all activities

### 2. Reading Search Attribute (Activity Side)

**File**: `pkg/interceptors/progress_interceptor.go`

```go
func extractWorkflowExecutionID(ctx context.Context) string {
    activityInfo := activity.GetInfo(ctx)
    
    // Get WorkflowExecutionID from search attributes
    if searchAttrs := activityInfo.WorkflowExecution.SearchAttributes; searchAttrs != nil {
        if indexedFields := searchAttrs.IndexedFields; indexedFields != nil {
            if val, ok := indexedFields["WorkflowExecutionID"]; ok {
                var executionID string
                if err := val.Get(&executionID); err == nil && executionID != "" {
                    return executionID
                }
            }
        }
    }
    
    // Fallback: Try heartbeat details
    if details := activityInfo.HeartbeatDetails; len(details) > 0 {
        var executionID string
        if err := details[0].Get(&executionID); err == nil && executionID != "" {
            return executionID
        }
    }
    
    return ""
}
```

**Key Points**:
- Reads from `WorkflowExecution.SearchAttributes`
- Handles missing search attributes gracefully
- Fallback to heartbeat details (for future extensibility)
- Returns empty string if not found (skip progress reporting)

### 3. Progress Reporting Flow

```go
func (a *activityInterceptor) ExecuteActivity(
    ctx context.Context,
    in *interceptor.ExecuteActivityInput,
) (interface{}, error) {
    activityInfo := activity.GetInfo(ctx)
    
    // Skip internal activities
    if shouldSkipProgressReporting(activityInfo.ActivityType.Name) {
        return a.Next.ExecuteActivity(ctx, in)
    }
    
    // Extract execution ID
    executionID := extractWorkflowExecutionID(ctx)
    if executionID == "" {
        // No execution ID, skip progress reporting
        return a.Next.ExecuteActivity(ctx, in)
    }
    
    // Report task started
    a.reportTaskProgress(ctx, executionID, activityInfo.ActivityType.Name, "started", nil)
    
    // Execute activity
    result, err := a.Next.ExecuteActivity(ctx, in)
    
    // Report task completed/failed
    if err != nil {
        a.reportTaskProgress(ctx, executionID, activityInfo.ActivityType.Name, "failed", err)
    } else {
        a.reportTaskProgress(ctx, executionID, activityInfo.ActivityType.Name, "completed", nil)
    }
    
    return result, err
}
```

## Temporal Setup Requirements

### Search Attribute Registration

The `WorkflowExecutionID` search attribute must be registered with Temporal before use.

#### Production Setup (One-Time)

```bash
# Register search attribute
temporal operator search-attribute create \
  --namespace stigmer \
  --name WorkflowExecutionID \
  --type Text

# Verify registration
temporal operator search-attribute list --namespace stigmer
```

Expected output:
```
+---------------------+--------+
|        NAME         |  TYPE  |
+---------------------+--------+
| WorkflowExecutionID   | Text   |
| CustomKeywordField  | Keyword|
| ...                 | ...    |
+---------------------+--------+
```

#### Development Setup

For local Temporal (docker-compose):

```bash
# Temporal 1.20+ includes WorkflowExecutionID by default
# No manual registration needed

# Verify after workflow execution
temporal workflow describe --workflow-id <workflow-id>
```

#### Alternative Search Attributes

If `WorkflowExecutionID` is unavailable:

1. List available attributes:
   ```bash
   temporal operator search-attribute list --namespace <namespace>
   ```

2. Choose a `Text` type attribute

3. Update both files:
   ```go
   // In temporal_workflow.go
   workflow.UpsertSearchAttributes(ctx, map[string]interface{}{
       "YourChosenField": input.WorkflowExecutionID,
   })
   
   // In progress_interceptor.go
   if val, ok := indexedFields["YourChosenField"]; ok {
       // ...
   }
   ```

## Verification

### Test Progress Reporting

1. **Start a workflow execution**:
   ```bash
   # Trigger workflow via stigmer-service API
   curl -X POST http://stigmer-service/api/v1/workflow-executions/execute \
     -d '{"workflow_id": "test-workflow"}'
   ```

2. **Check Temporal UI**:
   - Navigate to workflow execution
   - Verify search attributes show execution ID
   - Confirm activities are executing

3. **Check stigmer-service logs**:
   ```bash
   # Look for progress updates
   kubectl logs -f deployment/stigmer-service | grep "task progress"
   ```

   Expected output:
   ```
   Task progress reported: execution_id=wfexec-123 task=CallHTTP status=started
   Task progress reported: execution_id=wfexec-123 task=CallHTTP status=completed
   ```

4. **Query WorkflowExecution status**:
   ```bash
   curl http://stigmer-service/api/v1/workflow-executions/wfexec-123/status
   ```

   Expected response:
   ```json
   {
     "execution_id": "wfexec-123",
     "phase": "EXECUTION_IN_PROGRESS",
     "tasks": [
       {
         "task_id": "CallHTTP",
         "task_name": "CallHTTP",
         "status": "WORKFLOW_TASK_COMPLETED"
       }
     ]
   }
   ```

### Debugging

If progress reports are not appearing:

1. **Check search attribute registration**:
   ```bash
   temporal operator search-attribute list --namespace stigmer
   ```

2. **Check workflow-runner logs**:
   ```bash
   kubectl logs -f deployment/workflow-runner | grep "search attribute"
   ```

   Look for:
   - ✅ "WorkflowExecutionID stored in search attributes"
   - ❌ "Failed to set WorkflowExecutionID search attribute"

3. **Check interceptor logs**:
   ```bash
   kubectl logs -f deployment/workflow-runner | grep "progress reporting"
   ```

   Look for:
   - ✅ "Task progress reported successfully"
   - ❌ "No WorkflowExecutionID found, skipping progress reporting"

4. **Verify activity info**:
   Add debug logging to interceptor:
   ```go
   log.Debug().
       Interface("search_attrs", activityInfo.WorkflowExecution.SearchAttributes).
       Msg("Activity search attributes")
   ```

## Trade-offs and Limitations

### Advantages
- ✅ Clean: No activity signature changes
- ✅ Native: Uses Temporal's built-in features
- ✅ Reliable: Search attributes are durable
- ✅ Scalable: Works with any number of activities
- ✅ Maintainable: Isolated in interceptor

### Limitations
- ⚠️ **Requires Temporal Admin**: Search attribute must be registered
- ⚠️ **Temporal Version**: Requires Temporal 1.13+ for UpsertSearchAttributes
- ⚠️ **Namespace Scope**: Each namespace needs registration
- ⚠️ **Search Attribute Quota**: Limited to 100 custom search attributes per namespace

### Error Handling
- Search attribute upsert failure is **non-critical** (logged as warning)
- If execution ID not found, interceptor skips progress reporting
- Activities continue executing normally regardless of progress reporting status

## Future Enhancements

### 1. Multiple Execution ID Storage

If we need to track multiple IDs (workflow execution, agent execution, etc.):

```go
// Workflow side
workflow.UpsertSearchAttributes(ctx, map[string]interface{}{
    "WorkflowExecutionID":  input.WorkflowExecutionID,
    "CustomKeywordField": input.AgentExecutionID,
})

// Interceptor side
workflowExecID := searchAttrs["WorkflowExecutionID"]
agentExecID := searchAttrs["CustomKeywordField"]
```

### 2. Rich Context Propagation

Store JSON metadata in search attribute:

```go
// Workflow side
contextJSON, _ := json.Marshal(map[string]string{
    "workflow_execution_id": input.WorkflowExecutionID,
    "agent_execution_id":    input.AgentExecutionID,
    "org_id":                input.OrgID,
})
workflow.UpsertSearchAttributes(ctx, map[string]interface{}{
    "CustomTextField": string(contextJSON),
})

// Interceptor side
var ctx ExecutionContext
json.Unmarshal([]byte(searchAttr), &ctx)
```

### 3. Dynamic Search Attribute Selection

Auto-detect available search attributes:

```go
func findAvailableSearchAttribute(activityInfo activity.Info) string {
    candidates := []string{"WorkflowExecutionID", "CustomKeywordField", "CustomTextField"}
    for _, field := range candidates {
        if _, ok := activityInfo.WorkflowExecution.SearchAttributes.IndexedFields[field]; ok {
            return field
        }
    }
    return ""
}
```

## Related Documentation

- **Activity Interceptor**: `docs/architecture/interceptors.md`
- **Progress Reporting**: `docs/architecture/progress-reporting.md`
- **Temporal Best Practices**: `docs/guides/temporal-best-practices.md`
- **Troubleshooting**: `docs/guides/troubleshooting.md`

## Summary

Execution ID propagation using Temporal Search Attributes provides a clean, reliable way to enable automatic progress reporting without polluting activity signatures. The implementation is:

- **Transparent**: Activities don't know about execution ID
- **Automatic**: Interceptor handles everything
- **Robust**: Graceful degradation if not available
- **Maintainable**: Isolated in two locations

This enables the workflow-runner to provide rich progress updates to stigmer-service while keeping the Temporal UI clean and maintaining CNCF Serverless Workflow spec compliance.
