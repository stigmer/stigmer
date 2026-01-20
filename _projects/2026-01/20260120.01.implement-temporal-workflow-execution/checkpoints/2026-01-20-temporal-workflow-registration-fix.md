# Checkpoint: Temporal Workflow Registration Bug Fix

**Date**: 2026-01-20  
**Status**: ✅ Complete  
**Type**: Critical Bug Fix

## What Was Accomplished

Fixed critical workflow registration bug affecting all three Temporal workers in stigmer-server.

### Bug Impact

All workflows were failing with "workflow type not found" errors:
- Validation: `unable to find workflow type: ValidateWorkflow`
- WorkflowExecution: Would fail with `unable to find workflow type: stigmer/workflow-execution/invoke`
- AgentExecution: Would fail with `unable to find workflow type: stigmer/agent-execution/invoke`

### Root Cause

Workflows registered with implicit names (function/method names) but invoked with explicit workflow type names:

| Worker | Registered As | Invoked As | Result |
|--------|--------------|------------|--------|
| Validation | `ValidateWorkflowWorkflowImpl` | `ValidateWorkflow` | ❌ MISMATCH |
| WorkflowExecution | `Run` | `stigmer/workflow-execution/invoke` | ❌ MISMATCH |
| AgentExecution | `Run` | `stigmer/agent-execution/invoke` | ❌ MISMATCH |

### Solution Applied

Updated all three workers to use explicit workflow registration:

```go
w.RegisterWorkflowWithOptions(workflow, workflow.RegisterOptions{
    Name: "explicit-workflow-name",
})
```

This matches the Java pattern used in stigmer-cloud:
```java
@WorkflowMethod(name = "ValidateWorkflow")
```

## Files Modified

**Core Fixes (3 workers)**:
1. `backend/services/stigmer-server/pkg/domain/workflow/temporal/worker.go`
2. `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/worker_config.go`
3. `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/worker_config.go`

**Build Files** (Gazelle auto-updated):
4-6. Corresponding BUILD.bazel files with `@io_temporal_go_sdk//workflow` dependency

## Verification

✅ Build successful: `bazel build //backend/services/stigmer-server/cmd/server:server`

## Next Steps

1. Test validation workflow with real workflow deployment
2. Test workflow execution triggering
3. Test agent execution triggering
4. Complete Task 5: Manual Runtime Testing

## Impact on Polyglot Architecture

✅ **NO changes to shared runners**:
- workflow-runner (Go) - unchanged
- agent-runner (Python) - unchanged

Both cloud (Java) and OSS (Go) continue using identical runner implementations.

## Changelog Reference

See: `_changelog/2026-01/2026-01-20-224112-fix-temporal-workflow-registration-names.md`
