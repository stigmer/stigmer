# Agent-Runner Pattern Migration

**Date**: 2026-01-15
**Status**: ✅ Complete

## Overview

Migrated workflow-runner to follow the same execution pattern as agent-runner for consistency and architectural alignment.

## What Changed

### 1. Simplified WorkflowExecuteInput Proto

**Before** (Runner Contract Pattern):
```protobuf
message WorkflowExecuteInput {
  string workflow_execution_id = 1;
  string workflow_yaml = 2;                    // Complete YAML from MongoDB
  map<string, string> env_vars = 3;            // Pre-merged environment variables
  WorkflowMetadata metadata = 4;               // Pre-built metadata
  google.protobuf.Struct workflow_input = 5;   // Workflow input parameters
  WorkflowExecutionConfig config = 6;          // Execution configuration
}
```

**After** (Agent-Runner Pattern):
```protobuf
message WorkflowExecuteInput {
  string workflow_execution_id = 1;  // Just the execution ID
  string workflow_yaml = 2;          // Optional for testing
}
```

**Why**: Following agent-runner pattern where runner queries Stigmer service for data, ensuring single source of truth (MongoDB) and fresh data at execution time.

### 2. Created Stigmer gRPC Client

**Location**: `pkg/stigmer_client/`

**Files**:
- `client.go` - Query WorkflowExecution, WorkflowInstance, and Workflow
- `status_updater.go` - Send progressive status updates

**Key Methods**:
```go
// Query methods
GetWorkflowExecution(ctx, executionID) (*WorkflowExecution, error)
GetWorkflowInstance(ctx, instanceID) (*WorkflowInstance, error)
GetWorkflow(ctx, workflowID) (*Workflow, error)
GetCompleteWorkflowContext(ctx, executionID) (execution, instance, workflow, error)

// Status update methods
UpdateStatus(ctx, execution) error
SendProgressEvent(ctx, executionID, event) error
UpdatePhase(ctx, executionID, phase) error
```

### 3. Updated Workflow Execution Activity

**Location**: `worker/activities/execute_workflow_activity.go`

**Flow**:
1. Check if `workflow_yaml` provided (backward compatibility)
2. If not, query Stigmer service:
   - Get WorkflowExecution by execution_id
   - Get WorkflowInstance from execution.spec.workflow_instance_id
   - Get Workflow from instance.spec.workflow_id
3. Convert WorkflowSpec proto → YAML (using Phase 2 converter)
4. Execute via Zigflow engine
5. Report progressive status via callback client

### 4. Integration with Phase 2 Converter

**Uses**: `pkg/converter/proto_to_yaml.go`

**Conversion**:
```go
// WorkflowSpec proto (from Workflow.spec)
workflowSpec := workflow.GetSpec()

// Convert to Zigflow YAML
workflowYAML, err := converter.ProtoToYAML(workflowSpec)

// Execute
workflowDef, err := zigflow.LoadFromString(workflowYAML)
```

## Architecture Comparison

### Before (Runner Contract)

```
Stigmer Service
    ↓ (builds complete input)
    ├─ Fetches Workflow from MongoDB
    ├─ Fetches WorkflowInstance for environments
    ├─ Merges env vars
    ├─ Builds metadata
    └─ Packages everything in WorkflowExecuteInput
    ↓
Temporal Workflow (Java)
    ↓ (passes complete payload)
workflow-runner Activity (Go)
    ↓
Execute directly (no queries needed)
```

### After (Agent-Runner Pattern)

```
Stigmer Service
    ↓ (creates WorkflowExecution)
    └─ Saves to MongoDB
    ↓
Temporal Workflow (Java)
    ↓ (passes execution_id only)
workflow-runner Activity (Go)
    ├─ Queries WorkflowExecution (gRPC)
    ├─ Queries WorkflowInstance (gRPC)
    ├─ Queries Workflow (gRPC)
    ├─ Converts proto → YAML
    └─ Executes via Zigflow
    ↓
Progressive status updates (gRPC)
```

## Benefits

✅ **Consistent Architecture** - Same pattern as agent-runner (polyglot workflows)
✅ **Single Source of Truth** - Always queries fresh data from MongoDB
✅ **Simple Interface** - Just pass execution_id to Temporal
✅ **Type-Safe** - Uses proto → YAML converter (Phase 2)
✅ **Progressive Updates** - Real-time status via gRPC callbacks
✅ **Backward Compatible** - Still supports direct workflow_yaml for testing

## Testing Strategy

### Production Path (Full Flow)
```bash
# 1. Create WorkflowExecution via Stigmer service
# 2. Temporal workflow starts with execution_id
# 3. workflow-runner queries Stigmer service
# 4. Fetches WorkflowExecution → WorkflowInstance → Workflow
# 5. Converts proto → YAML
# 6. Executes and reports progress
```

### Testing Path (Direct YAML)
```bash
# Pass workflow_yaml directly for testing
# Skips Stigmer query, uses provided YAML
```

## Configuration

**Environment Variables** (already existed):
```bash
STIGMER_SERVICE_ENDPOINT=stigmer-prod-api.planton.live:443
STIGMER_SERVICE_API_KEY=<api-key>
STIGMER_SERVICE_USE_TLS=true
```

## Implementation Checklist

- [x] Simplify WorkflowExecuteInput proto
- [x] Create Stigmer gRPC client
- [x] Create status updater client
- [x] Update workflow execution activity
- [x] Integrate with Phase 2 converter
- [x] Maintain backward compatibility
- [ ] Generate proto stubs (blocked by network issue)
- [ ] Update Temporal workflow (Java side)
- [ ] Integration testing
- [ ] Update deployment configs

## Next Steps

1. **Java Workflow Update**: Modify `InvokeWorkflowExecutionWorkflow` to pass just execution_id
2. **Proto Stubs**: Re-run `make go-stubs` once network is available
3. **Integration Testing**: Test full flow with Stigmer service
4. **Documentation**: Update API docs and deployment guides

## Related Documentation

- Agent execution workflow: `backend/services/agent-runner/docs/architecture/agent-execution-workflow.md`
- Phase 2 converter: `pkg/converter/README.md`
- Stigmer client: `pkg/stigmer_client/client.go`
- Proto changes: `apis/ai/stigmer/agentic/workflowrunner/v1/io.proto`

## Migration Guide

### For Java Developers (Temporal Workflow)

**Before**:
```java
// Build complete WorkflowExecuteInput
WorkflowExecuteInput input = WorkflowExecuteInput.newBuilder()
    .setWorkflowExecutionId(executionId)
    .setWorkflowYaml(workflowYaml)  // Fetched from MongoDB
    .putAllEnvVars(envVars)         // Merged from environments
    .setMetadata(metadata)          // Built from resources
    .setWorkflowInput(input)
    .setConfig(config)
    .build();

// Start activity
executeWorkflowActivity.execute(input);
```

**After**:
```java
// Just pass execution ID
WorkflowExecuteInput input = WorkflowExecuteInput.newBuilder()
    .setWorkflowExecutionId(executionId)
    .build();

// Start activity (Go side queries everything)
executeWorkflowActivity.execute(input);
```

### For Testing (Direct YAML)

```go
// Testing with direct YAML (bypass Stigmer query)
input := &runnerv1.WorkflowExecuteInput{
    WorkflowExecutionId: "wfx-test-123",
    WorkflowYaml:        testYAML,  // Provide YAML directly
}

err := ExecuteWorkflow(ctx, input)
```

## Summary

✅ **Migration Complete**: workflow-runner now follows agent-runner pattern
✅ **Architecture Aligned**: Consistent polyglot workflow approach
✅ **Ready for Integration**: Pending Java workflow update and proto stub generation

**Key Insight**: By following the agent-runner pattern, we get cleaner separation of concerns, single source of truth, and simpler Temporal interfaces while maintaining backward compatibility for testing.
