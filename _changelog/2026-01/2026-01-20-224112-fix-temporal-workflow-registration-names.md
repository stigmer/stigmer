# Fix Temporal Workflow Registration Names

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: Temporal Workers  
**Impact**: Critical - Fixes "workflow type not found" errors in all three Temporal integrations

## Problem

All three Temporal workflows in stigmer-server were failing with "workflow type not found" errors:

```
unable to find workflow type: ValidateWorkflow. 
Supported types: [ValidateWorkflowWorkflowImpl]
```

**Root cause**: Workflows were registered using implicit naming (function/method names) but invoked using explicit workflow type names, causing mismatches.

## What Was Fixed

Fixed workflow registration in all three Temporal workers to use explicit names matching invocation:

### 1. Validation Worker

**File**: `backend/services/stigmer-server/pkg/domain/workflow/temporal/worker.go`

**Before**:
```go
w.RegisterWorkflow(ValidateWorkflowWorkflowImpl)
// Registered as: "ValidateWorkflowWorkflowImpl" (function name)
```

**After**:
```go
w.RegisterWorkflowWithOptions(ValidateWorkflowWorkflowImpl, workflow.RegisterOptions{
    Name: WorkflowValidationWorkflowType, // "ValidateWorkflow"
})
// Registered as: "ValidateWorkflow" ✅
```

**Invoked as**: `"ValidateWorkflow"` (via `WorkflowValidationWorkflowType`)

### 2. WorkflowExecution Worker

**File**: `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/worker_config.go`

**Before**:
```go
w.RegisterWorkflow(&workflows.InvokeWorkflowExecutionWorkflowImpl{})
// Registered as: "Run" (method name when registering struct)
```

**After**:
```go
w.RegisterWorkflowWithOptions(
    &workflows.InvokeWorkflowExecutionWorkflowImpl{},
    workflow.RegisterOptions{
        Name: workflows.InvokeWorkflowExecutionWorkflowName,
    },
)
// Registered as: "stigmer/workflow-execution/invoke" ✅
```

**Invoked as**: `"stigmer/workflow-execution/invoke"` (via `InvokeWorkflowExecutionWorkflowName`)

### 3. AgentExecution Worker

**File**: `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/worker_config.go`

**Before**:
```go
w.RegisterWorkflow(&workflows.InvokeAgentExecutionWorkflowImpl{})
// Registered as: "Run" (method name when registering struct)
```

**After**:
```go
w.RegisterWorkflowWithOptions(
    &workflows.InvokeAgentExecutionWorkflowImpl{},
    workflow.RegisterOptions{
        Name: workflows.InvokeAgentExecutionWorkflowName,
    },
)
// Registered as: "stigmer/agent-execution/invoke" ✅
```

**Invoked as**: `"stigmer/agent-execution/invoke"` (via `InvokeAgentExecutionWorkflowName`)

## Why This Matters

### Temporal Workflow Resolution

When Temporal receives a workflow start request:
1. Client calls: `ExecuteWorkflow(ctx, options, "workflow-name", args)`
2. Temporal looks up: Which worker registered `"workflow-name"`?
3. Match found: Route to that worker
4. Match not found: Return "workflow type not found" error

Without explicit registration names, Temporal uses:
- **Standalone functions**: Function name (e.g., `"ValidateWorkflowWorkflowImpl"`)
- **Struct methods**: Method name (e.g., `"Run"`)

This caused all three workflows to fail because:
- Registered name ≠ Invocation name
- Temporal couldn't route requests to workers

### Polyglot Architecture Preserved

This fix matches the Java pattern used in stigmer-cloud:

**Java (stigmer-service)**:
```java
@WorkflowInterface
public interface ValidateWorkflowWorkflow {
    @WorkflowMethod(name = "ValidateWorkflow")  // Explicit name
    ServerlessWorkflowValidation validate(WorkflowSpec spec);
}
```

**Go (stigmer-server)** - Now matches:
```go
w.RegisterWorkflowWithOptions(ValidateWorkflowWorkflowImpl, workflow.RegisterOptions{
    Name: "ValidateWorkflow",  // Explicit name (matches Java)
})
```

**Shared Components Unchanged**:
- ✅ `workflow-runner` (Go activities) - NO changes
- ✅ `agent-runner` (Python activities) - NO changes

Both cloud (Java→runners) and OSS (Go→runners) use identical runner implementations.

## Impact

### Before (Broken)

All three workflows failed immediately:
- ✅ Workflow validation: `ValidationException: unable to find workflow type: ValidateWorkflow`
- ⏳ Workflow execution: Would fail with `unable to find workflow type: stigmer/workflow-execution/invoke`
- ⏳ Agent execution: Would fail with `unable to find workflow type: stigmer/agent-execution/invoke`

### After (Fixed)

All three workflows register with correct names:
- ✅ Validation workflow: Registered as `"ValidateWorkflow"` → Matches invocation ✅
- ✅ WorkflowExecution workflow: Registered as `"stigmer/workflow-execution/invoke"` → Matches invocation ✅
- ✅ AgentExecution workflow: Registered as `"stigmer/agent-execution/invoke"` → Matches invocation ✅

## Files Modified

### Core Fixes (3 workers)
1. `backend/services/stigmer-server/pkg/domain/workflow/temporal/worker.go`
   - Added explicit workflow registration with `WorkflowValidationWorkflowType`
   - Added `workflow` package import

2. `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/worker_config.go`
   - Added explicit workflow registration with `InvokeWorkflowExecutionWorkflowName`
   - Added `workflow` package import

3. `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/worker_config.go`
   - Added explicit workflow registration with `InvokeAgentExecutionWorkflowName`
   - Added `workflow` package import

### Build Files (Gazelle auto-updated)
4. `backend/services/stigmer-server/pkg/domain/workflow/temporal/BUILD.bazel`
   - Added `@io_temporal_go_sdk//workflow` dependency

5. `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/BUILD.bazel`
   - Added `@io_temporal_go_sdk//workflow` dependency

6. `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/BUILD.bazel`
   - Added `@io_temporal_go_sdk//workflow` dependency

7. `backend/services/stigmer-server/cmd/server/BUILD.bazel`
   - Added `@io_temporal_go_sdk//log` dependency (suppresses Temporal SDK warnings)

### Other Changes (Pre-existing from branch)
8. `backend/services/stigmer-server/pkg/domain/agentexecution/controller/BUILD.bazel`
9. `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/BUILD.bazel`
10. `client-apps/cli/cmd/stigmer/root/BUILD.bazel`
11. `client-apps/cli/cmd/stigmer/root/server_logs.go`
12. `client-apps/cli/internal/cli/daemon/BUILD.bazel`

## Testing

### Build Verification
```bash
bazel build //backend/services/stigmer-server/cmd/server:server
```
✅ **Result**: Build completed successfully

### Runtime Testing

**Prerequisites**:
1. Temporal server running: `temporal server start-dev`
2. stigmer-server running: `stigmer server`
3. workflow-runner running: `bazel run //backend/services/workflow-runner/cmd/worker:worker`

**Test validation workflow**:
```bash
stigmer apply  # Deploy workflow with validation
```

**Expected**: Validation workflow executes successfully, workflow is persisted

## Technical Details

### How Temporal Workflow Registration Works

**Method 1: Implicit naming (what we had - BROKEN)**
```go
// Registers with function/method name
w.RegisterWorkflow(MyWorkflowFunc)
// Temporal uses: "MyWorkflowFunc" as workflow type
```

**Method 2: Explicit naming (what we fixed to - CORRECT)**
```go
// Registers with explicit name
w.RegisterWorkflowWithOptions(MyWorkflowFunc, workflow.RegisterOptions{
    Name: "my-workflow",
})
// Temporal uses: "my-workflow" as workflow type
```

### Why All Three Had This Bug

All three workflows used different implementation patterns but had the same underlying issue:

**Validation**: Standalone function
```go
func ValidateWorkflowWorkflowImpl(ctx workflow.Context, ...) {...}
// Without explicit name: Registered as "ValidateWorkflowWorkflowImpl"
// Invoked as: "ValidateWorkflow"
// Result: MISMATCH ❌
```

**WorkflowExecution/AgentExecution**: Struct with method
```go
type WorkflowImpl struct{}
func (w *WorkflowImpl) Run(ctx workflow.Context, ...) {...}

w.RegisterWorkflow(&WorkflowImpl{})
// Without explicit name: Registered as "Run" (method name)
// Invoked as: "stigmer/workflow-execution/invoke"
// Result: MISMATCH ❌
```

### Matching Java Pattern

This fix aligns Go registration with Java's explicit naming:

**Java**:
```java
@WorkflowMethod(name = "ValidateWorkflow")
ServerlessWorkflowValidation validate(WorkflowSpec spec);
```

**Go** (now matches):
```go
w.RegisterWorkflowWithOptions(ValidateWorkflowWorkflowImpl, workflow.RegisterOptions{
    Name: "ValidateWorkflow",
})
```

Both cloud (Java) and OSS (Go) now use identical explicit workflow naming.

## Benefits

1. **Immediate**: Fixes "workflow type not found" errors preventing workflow/agent execution
2. **Consistency**: Go registration now matches Java pattern (explicit names)
3. **Polyglot Safety**: Ensures workflow names are consistent across Java and Go workers
4. **Preventive**: Fixed all three workers before execution/agent bugs were discovered
5. **No Breaking Changes**: Runner services (workflow-runner, agent-runner) unchanged

## Related

- Project: `_projects/2026-01/20260120.01.implement-temporal-workflow-execution`
- Task: Manual Runtime Testing (next step after this fix)
- Error: Reported via browser screenshot showing validation failure
- Polyglot Docs: `backend/services/stigmer-server/pkg/domain/workflow/temporal/README.md`

## Next Steps

1. Test validation workflow with `stigmer apply`
2. Verify workflow execution triggers correctly
3. Verify agent execution triggers correctly
4. Update project checkpoint if all tests pass
