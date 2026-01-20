# WorkflowExecution Controller

**Package**: `backend/services/stigmer-server/pkg/controllers/workflowexecution`

This controller implements the "Execution" layer in the Template→Instance→Execution pattern for workflow orchestration.

## Architecture Overview

### Template → Instance → Execution Pattern

```
Workflow (Template)
  ├─ Defines: Task graph, orchestration logic, workflow definition
  └─ WorkflowInstance (Configuration)
      ├─ Binds: Environments, default values, instance-specific config
      └─ WorkflowExecution (Runtime)
          ├─ Executes: Single invocation with inputs
          ├─ Tracks: Phase, tasks, progress, outputs, errors
          └─ Lifecycle: PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED
```

**Example**:
```
Workflow: "customer-onboarding" (orchestration definition)
  → WorkflowInstance: "acme-onboarding" (prod environment bindings)
    → WorkflowExecution: "acme-onboarding-20250111-143022" (specific run)
      - Phase: IN_PROGRESS
      - Tasks: [validate_email: COMPLETED, create_account: IN_PROGRESS, ...]
      - Progress: 1/3 tasks completed
```

## Controller Structure

### Files

```
workflowexecution/
├── workflowexecution_controller.go  # Controller struct + constructor
├── create.go                         # Create handler + custom steps
├── update.go                         # Update handler (user config)
├── update_status.go                  # UpdateStatus handler (workflow-runner)
├── delete.go                         # Delete handler
├── get.go                            # Get by ID handler
├── list.go                           # List executions handler
└── README.md                         # This file
```

### Handler Overview

| Handler | Purpose | Pipeline Pattern |
|---------|---------|------------------|
| **Create** | Create and trigger execution | ✅ Pipeline (8 steps) |
| **Update** | Update execution configuration | ✅ Pipeline (5 steps) |
| **UpdateStatus** | Update status during execution | ❌ Direct (frequent updates) |
| **Delete** | Delete execution | ✅ Pipeline (4 steps) |
| **Get** | Retrieve by ID | ✅ Pipeline (2 steps) |
| **List** | List all executions | ❌ Direct (simple query) |

## Create Handler

### Pipeline Steps

**Source**: `create.go`

```
1. ValidateProto                    - Validate proto field constraints
2. ValidateWorkflowOrInstance       - Ensure workflow_id OR workflow_instance_id provided
3. CreateDefaultInstanceIfNeeded    - Auto-create default instance if workflow_id used
4. ResolveSlug                      - Generate slug from metadata.name
5. CheckDuplicate                   - Verify no duplicate exists
6. BuildNewState                    - Generate ID, set audit fields
7. SetInitialPhase                  - Set phase to EXECUTION_PENDING
8. Persist                          - Save to BadgerDB
```

### Instance Resolution (Matches AgentExecution Pattern)

**If `workflow_instance_id` provided:**
- Use it directly

**If `workflow_id` provided:**
1. Load Workflow by ID
2. Check if `workflow.status.default_instance_id` exists
3. If exists: Use default instance
4. If missing: Auto-create default instance (`{workflow_slug}-default`)
5. Update workflow status with `default_instance_id`
6. Update execution spec with resolved instance ID

**Validation:**
- At least one of `workflow_id` or `workflow_instance_id` must be provided
- Handler enforces this in `ValidateWorkflowOrInstanceStep`

### Custom Pipeline Steps

#### 1. ValidateWorkflowOrInstanceStep

**Purpose**: Validate that at least one of workflow_id or workflow_instance_id is provided

**Logic**:
```go
hasWorkflowInstanceID := execution.Spec.WorkflowInstanceId != ""
hasWorkflowID := execution.Spec.WorkflowId != ""

if !hasWorkflowInstanceID && !hasWorkflowID {
    return InvalidArgumentError("either workflow_id or workflow_instance_id must be provided")
}
```

**Error Cases**:
- `INVALID_ARGUMENT`: Neither workflow_id nor workflow_instance_id provided

#### 2. CreateDefaultInstanceIfNeededStep

**Purpose**: Auto-create default workflow instance if workflow_id is used without workflow_instance_id

**Dependencies**:
- `workflowClient`: Client for loading workflows
- `workflowInstanceClient`: Client for creating instances (in-process gRPC)
- `store`: BadgerDB store for persisting workflow status updates

**Logic**:
1. Skip if `workflow_instance_id` already provided
2. Load Workflow by `workflow_id`
3. Check if `workflow.status.default_instance_id` exists
4. If exists: Update execution with default instance ID
5. If missing:
   - Build default instance request: `{workflow_slug}-default`
   - Create instance via `workflowInstanceClient.CreateAsSystem()` (in-process gRPC)
   - Update workflow status with `default_instance_id`
   - Update execution spec with resolved instance ID

**Error Cases**:
- `NOT_FOUND`: Workflow not found by workflow_id
- `INTERNAL`: Failed to create default instance
- `INTERNAL`: Failed to update workflow status

**Why In-Process gRPC?**
- Ensures all interceptors run (validation, api_resource_kind injection, logging)
- Maintains clean domain separation
- Migration-ready for microservices

#### 3. SetInitialPhaseStep

**Purpose**: Set execution phase to EXECUTION_PENDING

**Why?**
- Allows frontend to show "thinking" indicator immediately
- Before workflow runner picks up and starts processing
- Explicit pending state vs uninitialized state

**Logic**:
```go
if execution.Status == nil {
    execution.Status = &WorkflowExecutionStatus{}
}
execution.Status.Phase = EXECUTION_PENDING
```

## Update Handler

### Pipeline Steps

**Source**: `update.go`

```
1. ValidateProto       - Validate proto field constraints
2. ResolveSlug         - Generate slug (for fallback lookup)
3. LoadExisting        - Load existing execution by ID
4. BuildUpdateState    - Merge spec, preserve IDs, update timestamps
5. Persist             - Save updated execution
```

**Use Case**: User updates execution configuration (spec fields like trigger_message, runtime_env)

**Note**: For status updates from workflow-runner, use `UpdateStatus()` instead.

## UpdateStatus Handler

### Implementation Pattern

**Source**: `update_status.go`

**Pattern**: Direct implementation (NOT pipeline-based)

**Why Direct?**
- Optimized for frequent status updates from workflow runner
- Simple load → merge → save flow
- No need for validation/authorization steps (system caller)

### Logic Flow

```
1. Validate input (execution_id and status required)
2. Load existing execution from BadgerDB
3. Merge status fields:
   - status.phase (if provided)
   - status.tasks (replace entire array if provided)
   - status.output (if provided)
   - status.error (if provided)
   - status.started_at (if provided)
   - status.completed_at (if provided)
   - status.temporal_workflow_id (if provided)
4. Update status.audit.updated_at timestamp
5. Persist merged execution
6. Return updated execution
```

### What Can Be Updated

✅ **Allowed**:
- `status.phase`
- `status.tasks`
- `status.output`
- `status.error`
- `status.started_at`
- `status.completed_at`
- `status.temporal_workflow_id`

❌ **Not Allowed**:
- `spec.*` (user inputs are immutable)
- `metadata.id` (resource ID is immutable)
- `status.audit.created_at` (creation timestamp is immutable)

### Use Cases

1. **Task Started**: Workflow runner updates `status.tasks[i].status = IN_PROGRESS`
2. **Task Completed**: Workflow runner updates `status.tasks[i].status = COMPLETED`, sets `output`
3. **Task Failed**: Workflow runner updates `status.tasks[i].status = FAILED`, sets `error`
4. **Workflow Completed**: Workflow runner updates `status.phase = COMPLETED`, sets `output`
5. **Workflow Failed**: Workflow runner updates `status.phase = FAILED`, sets `error`
6. **Workflow Cancelled**: Workflow runner updates `status.phase = CANCELLED`

### Authorization

**Cloud**: Verifies caller is workflow runner service (system identity, not user)  
**OSS**: No authorization (single-user local environment)

## Delete Handler

### Pipeline Steps

**Source**: `delete.go`

```
1. ValidateProto           - Validate ApiResourceId wrapper
2. ExtractResourceId       - Extract ID from wrapper
3. LoadExistingForDelete   - Load execution (stores in context)
4. DeleteResource          - Delete from BadgerDB
```

**Returns**: Deleted execution (for audit trail)

## Get Handler

### Pipeline Steps

**Source**: `get.go`

```
1. ValidateProto    - Validate WorkflowExecutionId input
2. LoadTarget       - Load execution by ID
```

**Returns**: Execution from context (key: `targetResource`)

## List Handler

### Implementation Pattern

**Source**: `list.go`

**Pattern**: Direct implementation (NOT pipeline-based)

**Logic**:
```
1. List all executions from BadgerDB (kind: "WorkflowExecution")
2. Deserialize each execution (skip invalid entries)
3. Return WorkflowExecutionList with entries
```

### Differences from Cloud

**Cloud**:
- Uses IAM Policy to filter by authorized resource IDs
- Supports pagination
- Supports filtering by workflow_instance_id, phase, etc.

**OSS**:
- Returns all executions (single-user environment)
- No pagination (acceptable for local usage)
- No advanced filtering (can be added later)

## Differences from Stigmer Cloud

### Excluded Steps (Not in OSS)

| Step | Purpose | Why Excluded |
|------|---------|--------------|
| **Authorize** | Verify user permissions | No multi-tenant auth in OSS |
| **AuthorizeExecution** | Check can_execute on WorkflowInstance | No permission system in OSS |
| **CreateIamPolicies** | Create IAM ownership links | No IAM/FGA in OSS |
| **StartWorkflow** | Start Temporal workflow | No Temporal in OSS (stubbed) |
| **Publish** | Publish domain events | No event bus in OSS |
| **TransformResponse** | Apply response transformations | OSS returns full resource |
| **CleanupIamPolicies** | Remove IAM policies on delete | No IAM in OSS |

### Included Steps (Same as Cloud)

| Step | Purpose | Implementation |
|------|---------|---------------|
| **ValidateProto** | Validate buf validate constraints | Same |
| **ResolveSlug** | Generate slug from metadata.name | Same |
| **CheckDuplicate** | Verify no duplicate exists | Same |
| **BuildNewState** | Generate ID, timestamps, audit fields | Same |
| **Persist** | Save to database | Different storage (BadgerDB vs MongoDB) |

## Dependencies

### Downstream Clients

**Workflow Client** (`workflow.Client`):
- Used in: `CreateDefaultInstanceIfNeededStep`
- Purpose: Load Workflow to check for default_instance_id

**WorkflowInstance Client** (`workflowinstance.Client`):
- Used in: `CreateDefaultInstanceIfNeededStep`
- Purpose: Auto-create default instance via in-process gRPC
- Method: `CreateAsSystem()` - bypasses user auth, system context

### Storage

**BadgerDB Store** (`badger.Store`):
- All persistence operations
- CRUD operations on WorkflowExecution resources
- ListResources for query operations

## Error Handling

All errors use `grpclib` helpers for consistent gRPC status codes:

```go
// Invalid input
grpclib.InvalidArgumentError("message")

// Resource not found
grpclib.NotFoundError("WorkflowExecution", id)

// Internal server error
grpclib.InternalError(err, "message")
```

## Best Practices

1. **Pipeline for Most Operations**: Create, Update, Delete, Get use pipeline pattern
2. **Direct for Frequent Updates**: UpdateStatus uses direct pattern (optimized for performance)
3. **In-Process gRPC for Cross-Domain**: WorkflowInstance creation via in-process client
4. **Domain Separation**: Clear boundaries between workflow, workflowinstance, workflowexecution
5. **Context Keys**: Use constants for inter-step communication
6. **Error Context**: Wrap errors with specific context messages
7. **Logging**: Structured logging with zerolog (Str, Bool, Int, Msg)

## Future Enhancements

### When OSS Grows

**If Temporal Integration Added**:
- Add `StartWorkflowStep` in create pipeline
- Trigger Temporal workflow after persist
- Store `temporal_workflow_id` in status

**If Multi-User Auth Added**:
- Add `AuthorizeStep` to create/update/delete pipelines
- Add `AuthorizeExecutionStep` to verify can_execute on WorkflowInstance
- Filter List results by user permissions

**If Event Bus Added**:
- Add `PublishStep` to create/update/delete pipelines
- Publish `WorkflowExecutionCreated`, `WorkflowExecutionUpdated` events

**If Pagination Needed**:
- Add pagination support to List handler
- Support page_size, page_token in request
- Return next_page_token in response

**If Advanced Filtering Needed**:
- Support filtering by workflow_instance_id, phase, date ranges
- Add query DSL or filter predicates

## Testing

### Unit Tests

Test each pipeline step independently:

```go
func TestValidateWorkflowOrInstanceStep(t *testing.T) {
    // Test: Both missing → error
    // Test: workflow_id provided → success
    // Test: workflow_instance_id provided → success
    // Test: Both provided → success
}

func TestCreateDefaultInstanceIfNeededStep(t *testing.T) {
    // Test: workflow_instance_id provided → skip
    // Test: workflow has default_instance_id → use it
    // Test: workflow missing default_instance_id → create one
    // Test: workflow not found → error
}

func TestSetInitialPhaseStep(t *testing.T) {
    // Test: Sets phase to EXECUTION_PENDING
    // Test: Preserves existing status fields
}
```

### Integration Tests

Test end-to-end workflows:

```go
func TestCreateWorkflowExecution_WithWorkflowID(t *testing.T) {
    // 1. Create Workflow
    // 2. Create WorkflowExecution with workflow_id
    // 3. Verify default instance created
    // 4. Verify workflow status updated with default_instance_id
    // 5. Verify execution spec has workflow_instance_id
    // 6. Verify execution phase is PENDING
}

func TestUpdateStatus_ProgressiveUpdates(t *testing.T) {
    // 1. Create execution
    // 2. UpdateStatus: phase = IN_PROGRESS, task-1 = IN_PROGRESS
    // 3. UpdateStatus: task-1 = COMPLETED, output
    // 4. UpdateStatus: task-2 = IN_PROGRESS
    // 5. UpdateStatus: task-2 = COMPLETED, phase = COMPLETED, output
    // 6. Verify final state
}
```

## Related Documentation

- **Agent Execution Controller**: Similar execution tracking pattern
- **Agent Controller**: Similar default instance creation pattern
- **Pipeline Framework**: Standard steps and context patterns
- **Java WorkflowExecutionCreateHandler**: Original implementation (with IAM, Temporal, events)
