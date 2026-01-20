# WorkflowInstance Controller

This package implements the gRPC handlers for WorkflowInstance resources in Stigmer OSS.

## Architecture

WorkflowInstance is the "Instance" layer in the Template→Instance→Execution pattern:
- **Workflow** = Template (reusable orchestration blueprint)
- **WorkflowInstance** = Instance (configured with environments and secrets)
- **WorkflowExecution** = Runtime execution of an instance

A WorkflowInstance binds a Workflow template to specific Environments containing credentials, configuration, and secrets needed for execution.

## Pipeline-Based Implementation

ALL handlers use the pipeline pattern with composable steps. This ensures:
- ✅ Consistency across all operations
- ✅ Built-in tracing and logging
- ✅ Reusable validation and persistence logic
- ✅ Clear separation of concerns
- ✅ Easy to test and maintain

## Handlers

### Command Controller (Write Operations)

#### Create
Creates a new workflow instance with environment bindings.

**Pipeline:**
1. `ValidateProto` - Validate proto field constraints
2. `LoadParentWorkflow` - Load and validate workflow template exists
3. `ValidateSameOrgBusinessRule` - Verify same-org for org-scoped instances
4. `ResolveSlug` - Generate slug from metadata.name
5. `CheckDuplicate` - Verify no duplicate exists
6. `BuildNewState` - Generate ID, timestamps, audit fields
7. `Persist` - Save to BadgerDB

**Business Rules:**
- Org-scoped workflows can only create instances in the same organization
- This prevents cross-org instance creation which could leak configuration/secrets
- Platform and user-scoped instances skip this validation

#### Update
Updates an existing workflow instance configuration.

**Pipeline:**
1. `ValidateProto` - Validate proto field constraints
2. `Persist` - Save updated instance to BadgerDB

**What can be updated:**
- `spec.description` - Change descriptive text
- `spec.env_refs` - Add/remove/reorder environment bindings
- `metadata.labels`, `metadata.tags`, `metadata.annotations`

**What cannot be updated:**
- `spec.workflow_id` - Must delete and recreate to change template
- `metadata.id` - Immutable resource identifier
- `metadata.owner_scope` - Immutable after creation

#### Delete
Permanently removes a workflow instance.

**Pipeline:**
1. `ValidateProto` - Validate input ID
2. `ExtractResourceId` - Extract ID from wrapper
3. `LoadExistingForDelete` - Load instance from repository
4. `DeleteResource` - Remove from BadgerDB

**Important:**
- Deletion is permanent and cannot be undone
- Does NOT delete the referenced Workflow template (templates are reusable)
- Does NOT delete the referenced Environment resources (environments are reusable)

#### Apply
Creates or updates a workflow instance based on whether it already exists.

**Pipeline:**
1. `ValidateProto` - Validate proto field constraints
2. `ResolveSlug` - Generate slug from name
3. `LoadForApply` - Check if resource exists by slug
4. Delegates to `Create()` or `Update()` based on existence

### Query Controller (Read Operations)

#### Get
Retrieves a workflow instance by ID.

**Pipeline:**
1. `ValidateProto` - Validate input ID
2. `LoadTarget` - Load instance from BadgerDB

#### GetByReference
Retrieves a workflow instance by flexible reference (ID or slug).

**Pipeline:**
1. `ValidateProto` - Validate input reference
2. `LoadByReference` - Load instance by slug or ID

#### GetByWorkflow
Retrieves all instances of a specific workflow template.

**Pipeline:**
1. `ValidateProto` - Validate input workflow ID
2. `LoadByWorkflow` - Load instances filtered by workflow_id

**Note:** In OSS, this loads all instances and filters in-memory. This is acceptable for local usage. In Cloud (Java), this uses IAM Policy queries for authorization and MongoDB queries for efficient filtering.

## Differences from Stigmer Cloud (Java)

### Architecture Alignment
The Go implementation follows the same pipeline architecture as the Java version, with these simplifications:

| Aspect | Stigmer Cloud (Java) | Stigmer OSS (Go) |
|--------|---------------------|------------------|
| **Pipeline Pattern** | ✅ All handlers | ✅ All handlers |
| **Context** | Multiple contexts (CreateContextV2, UpdateContextV2, etc.) | Single RequestContext[T] |
| **Storage** | MongoDB | BadgerDB |
| **Authorization** | FGA with contextual tuples | None (local single-user) |
| **IAM Policies** | CreateIamPolicies step | Excluded |
| **Event Publishing** | Publish step | Excluded |
| **Response Transform** | TransformResponse step | Excluded |

### Pipeline Steps Excluded in OSS

Steps present in Cloud but excluded in OSS:

| Step | Purpose | Why Excluded in OSS |
|------|---------|-------------------|
| **Authorize** | Verify caller has permission with FGA contextual tuples | OSS is local/single-user - no multi-tenant auth |
| **CreateIamPolicies** | Establish ownership relationships in OpenFGA | OSS has no IAM/FGA system |
| **Publish** | Publish domain events to event bus | OSS has no event publishing infrastructure |
| **TransformResponse** | Apply response transformations/filtering | OSS returns full resource - no transformations |

### Business Rules Retained in OSS

Important business rules implemented in both Cloud and OSS:

✅ **Same-Org Validation** - Org-scoped workflows can only create instances in the same organization
✅ **Parent Workflow Loading** - Validate workflow template exists before creating instance
✅ **Slug Resolution** - Generate slug from metadata.name
✅ **Duplicate Check** - Verify no duplicate exists before creation
✅ **Default Values** - Set ID, kind, api_version, timestamps

## Custom Pipeline Steps

### LoadParentWorkflow
Loads the workflow template and stores it in context for validation.

**Purpose:**
- Validate workflow template exists
- Provide workflow data for business rule validation
- Fail early if workflow is invalid

**Context:**
- Stores workflow in `ParentWorkflowKey`
- Used by `ValidateSameOrgBusinessRule` step

### ValidateSameOrgBusinessRule
Validates that org-scoped workflows can only create instances in the same organization.

**Business Rule:**
- If workflow is org-scoped AND instance is org-scoped
- Then workflow.metadata.org MUST equal instance.metadata.org
- This prevents cross-org instance creation which could leak secrets

**Skipped for:**
- Platform-scoped instances
- User-scoped instances
- Platform-scoped workflows with org-scoped instances

### LoadByWorkflow
Loads all workflow instances filtered by workflow_id.

**Implementation:**
- Lists all workflow instances from BadgerDB
- Filters in-memory by `spec.workflow_id`
- Returns filtered list

**Note:** In-memory filtering is acceptable for local OSS usage. Cloud (Java) uses combined MongoDB query with authorized IDs AND workflow_id for scale.

## Dependencies

The controller requires:
- `*badger.Store` - For persistence
- `*workflow.Client` - For loading parent workflows

## Usage

```go
// Create controller
store := badger.NewStore(...)
workflowClient := workflow.NewClient(conn)
controller := workflowinstance.NewWorkflowInstanceController(store, workflowClient)

// Register with gRPC server
workflowinstancev1.RegisterWorkflowInstanceCommandControllerServer(server, controller)
workflowinstancev1.RegisterWorkflowInstanceQueryControllerServer(server, controller)
```

## Testing

To test the controller:

```go
// Setup
store := setupTestStore(t)
workflowClient := setupTestWorkflowClient(t)
controller := NewWorkflowInstanceController(store, workflowClient)

// Test create
instance := &workflowinstancev1.WorkflowInstance{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "prod-deploy",
        OwnerScope: apiresource.ApiResourceOwnerScope_organization,
        Org: "org-123",
    },
    Spec: &workflowinstancev1.WorkflowInstanceSpec{
        WorkflowId: "wfl-123",
        EnvRefs: []*apiresource.ApiResourceReference{
            {Slug: "aws-prod-env"},
        },
    },
}

result, err := controller.Create(context.Background(), instance)
assert.NoError(t, err)
assert.NotEmpty(t, result.Metadata.Id)
```

## Key Implementation Points

1. **Parent Workflow Validation** - Always load and validate workflow template exists
2. **Same-Org Business Rule** - Enforce org-scoped instance restrictions
3. **Environment References** - Support layered environment configuration
4. **Pipeline Pattern** - All handlers use composable pipeline steps
5. **Error Handling** - Use grpclib helpers for consistent gRPC errors
6. **Logging** - Structured logging with zerolog throughout

## Migration Path to Cloud

If migrating to multi-tenant Cloud deployment:

1. Add FGA authorization steps:
   - `AuthorizeCreation` - Check can_create_instance with contextual tuples
   - `Authorize` (update/delete) - Check can_edit/can_delete permissions
2. Add IAM policy management:
   - `CreateIamPolicies` - Establish scope links and ownership
   - `CleanupIamPolicies` (delete) - Remove IAM policies
3. Add event publishing:
   - `Publish` - Publish domain events to event bus
4. Add response transformations:
   - `TransformResponse` - Apply filtering/transformations
5. Replace in-memory filtering with MongoDB queries:
   - `GetByWorkflow` - Query with authorized IDs AND workflow_id

## Files

```
workflowinstance/
├── workflowinstance_controller.go  # Controller struct + constructor
├── create.go                       # Create handler + custom steps
├── update.go                       # Update handler
├── delete.go                       # Delete handler
├── query.go                        # Query handlers (Get, GetByReference, GetByWorkflow)
├── apply.go                        # Apply handler (create or update)
├── README.md                       # This file
└── BUILD.bazel                     # Build configuration (managed by Gazelle)
```

## Related Documentation

- [Pipeline Architecture](../../libs/go/grpc/request/pipeline/README.md)
- [Common Pipeline Steps](../../libs/go/grpc/request/pipeline/steps/README.md)
- [Agent Controller](../agent/README.md) - Similar pattern
- [Workflow Controller](../workflow/README.md) - Parent resource
