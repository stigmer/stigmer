# ExecuteWorkflowActivity Implementation

## Overview

The `ExecuteWorkflowActivity` is a Temporal activity that bridges the Java orchestration layer with the Go execution layer. It queries the Stigmer backend for workflow definitions, converts them to Zigflow YAML, and executes them via the Zigflow interpreter.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  Java Temporal Workflow                       │
│         (InvokeWorkflowExecutionWorkflowImpl)                │
│              Queue: workflow_execution                        │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      │ Calls ExecuteWorkflow activity
                      │ (Polyglot activity call)
                      ▼
┌──────────────────────────────────────────────────────────────┐
│              ExecuteWorkflowActivity                          │
│              (Go Temporal Activity)                           │
│              Queue: workflow_execution                        │
│                                                               │
│  Flow:                                                        │
│  1. Resolve WorkflowInstance from execution                  │
│  2. Query WorkflowInstance (config + env bindings)           │
│  3. Query Workflow (template with tasks)                     │
│  4. Convert proto → YAML (Phase 2 converter)                 │
│  5. Start ExecuteServerlessWorkflow                          │
│  6. Wait for completion                                      │
│  7. Return status to Java                                    │
└─────────────────────┬────────────────────────────────────────┘
                      │
                      │ Starts workflow on execution queue
                      ▼
┌──────────────────────────────────────────────────────────────┐
│            ExecuteServerlessWorkflow                          │
│            (Generic Zigflow Workflow)                        │
│            Queue: zigflow_execution                          │
│                                                               │
│  - Parses YAML workflow definition                           │
│  - Builds task execution plan                                │
│  - Executes Zigflow activities                               │
│  - Progress interceptor reports to backend                   │
└──────────────────────────────────────────────────────────────┘
```

## Components

### 1. gRPC Clients

#### WorkflowClient
Location: `pkg/grpc_client/workflow_client.go`

Queries Workflow resources (templates) from Stigmer backend.

```go
client := NewWorkflowClient(cfg)
workflow, err := client.Get(ctx, workflowID)
```

Returns:
- `metadata`: Resource metadata (id, name, slug, labels, tags)
- `spec`: Workflow definition with tasks
- `status`: Audit info and default_instance_id

#### WorkflowInstanceClient
Location: `pkg/grpc_client/workflow_instance_client.go`

Queries WorkflowInstance resources (configured deployments) from Stigmer backend.

```go
client := NewWorkflowInstanceClient(cfg)
instance, err := client.Get(ctx, instanceID)
```

Returns:
- `metadata`: Resource metadata
- `spec`: workflow_id, description, env_refs
- `status`: Audit info

#### WorkflowExecutionClient
Location: `pkg/grpc_client/workflow_execution_client.go`

Updates WorkflowExecution status during execution.

```go
client := NewWorkflowExecutionClient(cfg)
_, err := client.UpdateStatus(ctx, executionID, status)
```

### 2. Proto→YAML Converter

Location: `pkg/converter/proto_to_yaml.go`

Converts structured WorkflowSpec proto to Zigflow YAML format.

**Pattern**: "kind + Struct" (like CloudResource in Planton Cloud)
- `WorkflowTask.kind` determines task type
- `WorkflowTask.task_config` contains dynamic configuration (google.protobuf.Struct)
- Converter unpacks and formats as YAML

**Supported Task Types**:
- `SET` → `set: {...}`
- `HTTP_CALL` → `call: http, with: {...}`
- `GRPC_CALL` → `call: grpc, with: {...}`
- `SWITCH` → `switch: {...}`
- `FOR` → `for: {...}`
- `FORK` → `fork: {...}`
- `TRY` → `try: {...}`
- `LISTEN` → `listen: {...}`
- `WAIT` → `wait: {...}`
- `RAISE` → `raise: {...}`
- `RUN` → `run: {...}`

**Example Transformation**:

Input (proto):
```protobuf
spec {
  document {
    dsl: "1.0.0"
    namespace: "acme"
    name: "customer-onboarding"
    version: "1.0"
  }
  tasks [
    {
      name: "validate_email"
      kind: HTTP_CALL
      task_config: {
        method: "POST"
        endpoint: { uri: "https://api.example.com/validate" }
        body: { email: "${trigger_message}" }
      }
      export: { as: "${.valid}" }
      flow: { then: "create_account" }
    }
  ]
}
```

Output (YAML):
```yaml
document:
  dsl: 1.0.0
  namespace: acme
  name: customer-onboarding
  version: "1.0"
do:
  - validate_email:
      call: http
      with:
        method: POST
        endpoint:
          uri: https://api.example.com/validate
        body:
          email: ${trigger_message}
      export:
        as: ${.valid}
      then: create_account
```

### 3. ExecuteWorkflowActivity

Location: `worker/activities/execute_workflow_activity.go`

The main activity that orchestrates the workflow execution.

**Key Methods**:

#### ExecuteWorkflow(ctx, execution) → status
Main execution method called from Java workflow.

**Inputs**:
- `WorkflowExecution` proto with:
  - `metadata.id`: Execution ID
  - `spec.workflow_instance_id` OR `spec.workflow_id`: Instance/workflow reference
  - `spec.trigger_message`: Input payload
  - `spec.runtime_env`: Execution-scoped environment variables

**Returns**:
- `WorkflowExecutionStatus` with:
  - `phase`: EXECUTION_COMPLETED or EXECUTION_FAILED
  - `error`: Error message if failed

**Flow**:

1. **Resolve Instance**:
   - If `workflow_instance_id` provided → Query directly
   - If `workflow_id` provided → Resolve to default instance

2. **Query WorkflowInstance**:
   ```go
   instance, err := a.workflowInstanceClient.Get(ctx, instanceID)
   ```
   Get configuration and environment bindings.

3. **Query Workflow**:
   ```go
   workflow, err := a.workflowClient.Get(ctx, instance.Spec.WorkflowId)
   ```
   Get template with task definitions.

4. **Convert to YAML**:
   ```go
   converter := converter.NewConverter()
   yaml, err := converter.ProtoToYAML(workflow.Spec)
   ```
   Transform proto → Zigflow YAML.

5. **Execute Workflow**:
   ```go
   run, err := a.temporalClient.ExecuteWorkflow(
       ctx,
       workflowOptions,
       "ExecuteServerlessWorkflow",
       workflowInput,
   )
   ```
   Start Zigflow interpreter on execution queue.

6. **Wait for Completion**:
   ```go
   err = run.Get(ctx, &workflowOutput)
   ```
   Block until workflow finishes.

7. **Return Status**:
   Return final status to Java workflow (never throw errors).

#### Close() → error
Cleanup method to close all gRPC connections.

## Instance Resolution Logic

The activity supports two modes for specifying which workflow to execute:

### Direct Instance Reference
```protobuf
execution.spec {
  workflow_instance_id: "wfi-prod-onboarding"
  trigger_message: "john@example.com"
}
```

**Flow**:
1. Query WorkflowInstance directly
2. Extract workflow_id from instance
3. Query Workflow template

**Use Cases**:
- Executing specific configured instances
- Production deployments with custom environments
- Multi-tenant scenarios (each tenant has own instance)

### Default Instance Resolution
```protobuf
execution.spec {
  workflow_id: "wf-customer-onboarding"
  trigger_message: "john@example.com"
}
```

**Flow**:
1. Query Workflow by ID
2. Check `workflow.status.default_instance_id`
3. If found → Query that instance
4. If missing → Error (backend should auto-create)

**Use Cases**:
- Quick workflow execution without instance setup
- Development and testing
- Simple workflows without custom configuration

**Future Enhancement**:
Backend handler should auto-create default instance when missing.

## Error Handling

All errors are handled gracefully to prevent Java workflow failures:

1. **Query Errors** (Instance, Workflow):
   - Log error with context
   - Update execution status to FAILED
   - Return error status (not throw)

2. **Conversion Errors** (proto→YAML):
   - Log conversion failure
   - Update status with error message
   - Return error status

3. **Workflow Start Errors**:
   - Log Temporal error
   - Update status to FAILED
   - Return error status

4. **Workflow Execution Errors**:
   - Captured from `run.Get()`
   - Status updated to FAILED
   - Error message stored in status
   - Return error status (no throw)

**Pattern**: Always return status, never throw errors.

Why? Java workflow should complete successfully even if execution fails.
Execution failures are tracked in WorkflowExecution.status, not Temporal history.

## Status Updates

The activity sends progressive status updates to Stigmer backend:

### 1. IN_PROGRESS (Start)
```go
a.workflowExecutionClient.UpdateStatus(ctx, executionID, &WorkflowExecutionStatus{
    Phase: EXECUTION_IN_PROGRESS,
})
```

Sent when activity starts, before querying backend.

### 2. IN_PROGRESS (Tasks)
Task-level updates sent by `ProgressReportingInterceptor` (not activity).

### 3. COMPLETED (Success)
```go
a.workflowExecutionClient.UpdateStatus(ctx, executionID, &WorkflowExecutionStatus{
    Phase: EXECUTION_COMPLETED,
})
```

Sent when workflow completes successfully.

### 4. FAILED (Error)
```go
a.workflowExecutionClient.UpdateStatus(ctx, executionID, &WorkflowExecutionStatus{
    Phase: EXECUTION_FAILED,
    Error: "error message",
})
```

Sent at any point where execution fails.

## Configuration

The activity requires:

### Stigmer Config
```go
type StigmerConfig struct {
    Endpoint string // Stigmer gRPC endpoint
    APIKey   string // Authentication token
    UseTLS   bool   // Enable TLS
}
```

Loaded from environment:
- `STIGMER_GRPC_ENDPOINT`
- `STIGMER_API_KEY`
- `STIGMER_USE_TLS`

### Temporal Config
- `temporalClient`: Temporal client for starting workflows
- `executionTaskQueue`: Queue name for Zigflow execution ("zigflow_execution")

## Testing

### Unit Tests
Location: `pkg/converter/proto_to_yaml_test.go`

Tests proto→YAML conversion:
- Simple SET tasks
- HTTP_CALL with exports
- Flow control (then: ...)
- Error cases (missing document, no tasks)

Run tests:
```bash
bazel test //backend/services/workflow-runner/pkg/converter:converter_test
```

### Integration Tests
Future: End-to-end tests with real backend.

**Test Scenarios**:
1. Direct instance reference execution
2. Default instance resolution
3. Query errors (not found, unauthorized)
4. Conversion errors (invalid proto)
5. Workflow execution errors (task failures)

## Future Enhancements

### 1. Environment Merging
Merge environment variables from multiple sources:
1. Workflow defaults (`workflow.spec.env_spec`)
2. Instance environments (`instance.spec.env_refs[]`)
3. Runtime overrides (`execution.spec.runtime_env`)

**Priority**: HIGH (required for environment support)

### 2. Execution Context
Create ExecutionContext resource to store merged environment:
- Resolves secret references
- Provides unified environment to tasks
- Deleted after execution (ephemeral secrets)

**Priority**: HIGH (required for B2B SaaS)

### 3. Execution ID Propagation
Pass execution ID to activities via:
- Temporal Search Attributes, OR
- Activity Heartbeat, OR
- Workflow Memo

**Priority**: LOW (progress interceptor can work without it)

### 4. Backend Auto-Create Instance
When `workflow_id` provided without instance:
- Backend should auto-create default instance
- Store in `workflow.status.default_instance_id`
- Simplify UX for common cases

**Priority**: MEDIUM (improves developer experience)

### 5. Workflow Caching
Cache Workflow definitions to reduce backend queries:
- Cache by workflow_id
- TTL-based invalidation
- Significant performance improvement for repeated executions

**Priority**: LOW (optimization)

## Related Documentation

- Architecture Overview: `docs/architecture/overview.md`
- Two-Queue Architecture: `../IMPLEMENTATION_STATUS.md`
- Progress Interceptor: `docs/architecture/progress-reporting.md`
- gRPC Clients: `pkg/grpc_client/README.md` (to be created)
- Proto→YAML Converter: `pkg/converter/README.md` (to be created)

## Troubleshooting

### "Workflow has no default instance configured"
**Cause**: Workflow referenced by `workflow_id` has no `status.default_instance_id`.

**Solution**:
1. Create a WorkflowInstance for the workflow
2. Set it as default in workflow status
3. OR use `workflow_instance_id` directly in execution

### "Failed to query workflow instance: NOT_FOUND"
**Cause**: Instance ID doesn't exist or user lacks permissions.

**Solution**:
1. Verify instance ID is correct
2. Check user has `can_view` permission on instance
3. Ensure instance is in same organization as user

### "Failed to convert workflow to YAML"
**Cause**: WorkflowSpec proto has invalid structure.

**Solution**:
1. Check proto has valid `document` section
2. Ensure all tasks have valid `kind` and `task_config`
3. Review conversion logs for specific error

### "ExecuteServerlessWorkflow failed"
**Cause**: Zigflow interpreter encountered an error during execution.

**Solution**:
1. Check Zigflow execution logs
2. Review workflow YAML for syntax errors
3. Verify all referenced tasks are supported
4. Check environment variables are properly set

## Summary

The ExecuteWorkflowActivity successfully bridges the Java orchestration layer with the Go execution layer by:

1. ✅ Querying Stigmer backend for workflow context
2. ✅ Supporting both direct instance and default instance resolution
3. ✅ Converting structured proto definitions to Zigflow YAML
4. ✅ Starting Zigflow workflows on dedicated execution queue
5. ✅ Handling all errors gracefully without failing Java workflow
6. ✅ Sending progressive status updates to backend

**Next Steps**:
- Environment merging implementation
- ExecutionContext resource creation
- End-to-end integration tests
- Production deployment
