# Fix Workflow Execution Activity Naming Convention

**Date**: 2026-01-21  
**Type**: Bug Fix  
**Scope**: workflow-runner  
**Impact**: Critical - Fixes workflow execution activity registration error

## Summary

Fixed activity name mismatch between Java interface and Go worker registration that was causing workflow execution failures with error: `"unable to find activityType=ExecuteWorkflow. Supported types: [executeWorkflow]"`.

Changed activity naming from **camelCase** (`executeWorkflow`) to **PascalCase** (`ExecuteWorkflow`) to align with agent execution activity naming convention.

## Problem

**Error encountered**:
```json
{
  "message": "unable to find activityType=ExecuteWorkflow. Supported types: [executeWorkflow]",
  "source": "GoSDK",
  "applicationFailureInfo": {
    "type": "ActivityNotRegisteredError"
  }
}
```

**Root cause**: Inconsistent activity naming between Java and Go
- Java side was using `executeWorkflow` (camelCase) in `@ActivityMethod` annotation
- Go side was registering as `executeWorkflow` (camelCase)
- But the pattern should have been **PascalCase** to match agent execution activities

**Inconsistency with existing patterns**:
- Agent execution activities use **PascalCase**: `ExecuteGraphton`, `EnsureThread`
- Workflow execution activity was incorrectly using **camelCase**: `executeWorkflow`
- This inconsistency made the codebase confusing and error-prone

## Changes Made

### Go Side (workflow-runner)

**File**: `backend/services/workflow-runner/worker/worker.go`

Changed activity registration from camelCase to PascalCase:

```go
// Before (incorrect):
w.orchestrationWorker.RegisterActivityWithOptions(w.executeWorkflowActivity.ExecuteWorkflow, activity.RegisterOptions{
    Name: "executeWorkflow", // Match Java interface method name (lowercase 'e')
})

// After (correct):
w.orchestrationWorker.RegisterActivityWithOptions(w.executeWorkflowActivity.ExecuteWorkflow, activity.RegisterOptions{
    Name: "ExecuteWorkflow", // Match Java @ActivityMethod name (PascalCase)
})
```

**File**: `backend/services/workflow-runner/worker/activities/execute_workflow_activity.go`

Updated comment to reflect correct annotation:

```go
// This method signature matches the Java interface:
//   @ActivityMethod(name = "ExecuteWorkflow")
//   WorkflowExecutionStatus executeWorkflow(WorkflowExecution execution);
```

## Why PascalCase?

**Consistency with agent execution pattern**:
- `ExecuteGraphton` - Agent execution activity (PascalCase)
- `EnsureThread` - Thread management activity (PascalCase)
- `ExecuteWorkflow` - Workflow execution activity (PascalCase) ✅

**Benefits**:
1. **Predictable naming**: All polyglot activities use PascalCase
2. **Easier debugging**: Consistent pattern across the codebase
3. **Better maintainability**: No need to remember which activities use which case
4. **Clearer contracts**: Java `@ActivityMethod` name matches exactly what Go registers

## Impact

**Before**: Workflow execution failed with `ActivityNotRegisteredError`  
**After**: Workflow execution succeeds - activity registration matches perfectly

**Affected components**:
- Java Temporal workflows (stigmer-service): `InvokeWorkflowExecutionWorkflowImpl`
- Go Temporal activities (workflow-runner): `ExecuteWorkflowActivity`

## Related Changes

This fix required coordinated changes in **stigmer-cloud** (Java side):
- Updated `@ActivityMethod(name = "ExecuteWorkflow")` annotation
- Updated README documentation to reflect PascalCase convention

See stigmer-cloud changelog for Java-side changes.

## Testing

**Manual testing**:
1. Java workflow starts and invokes `ExecuteWorkflow` activity
2. Go worker receives activity task on `workflow_execution_runner` queue
3. Activity executes successfully
4. No `ActivityNotRegisteredError` occurs

**Verification**:
- Activity name in Java: `ExecuteWorkflow` (PascalCase)
- Activity name in Go: `ExecuteWorkflow` (PascalCase)
- ✅ Perfect match

## Design Decision

**Why not keep camelCase?**

While Java method names conventionally use camelCase, Temporal's `@ActivityMethod` annotation allows explicit naming. We chose PascalCase for consistency:

1. **Agent execution established the pattern** - `ExecuteGraphton`, `EnsureThread` already use PascalCase
2. **Explicit naming is clearer** - `@ActivityMethod(name = "ExecuteWorkflow")` makes the Temporal contract obvious
3. **Cross-language consistency** - Polyglot systems benefit from predictable naming
4. **Future-proof** - All new activities should follow this pattern

## Lessons Learned

1. **Polyglot activity naming requires explicit coordination** - Don't assume Java method name equals Temporal activity name
2. **Establish patterns early** - Agent execution got it right; workflow execution should have matched from the start
3. **Document naming conventions** - This pattern should be documented for future activities
4. **Testing matters** - This would have been caught with integration tests

## Related Documentation

- Agent execution implementation: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/README.md`
- Workflow execution implementation: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/README.md`
- Polyglot Temporal pattern: Temporal docs on cross-language workers

---

**Migration note**: This is a **breaking change** for workflow-runner. If you're running an older stigmer-service (with camelCase), it won't work with this workflow-runner (PascalCase). Both sides must be updated together.
