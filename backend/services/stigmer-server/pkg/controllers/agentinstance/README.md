# AgentInstance Controller

Go implementation of the AgentInstance gRPC controller for Stigmer OSS.

## Overview

The AgentInstance controller manages agent instance resources using a pipeline-based architecture. Each handler follows the same pattern as the Agent controller - composable pipeline steps for validation, persistence, and business logic.

## Architecture

**Pattern**: Pipeline-based handlers (ALL operations)  
**Storage**: BadgerDB for local persistence  
**Context**: Single `RequestContext[T]` for all operations  
**Error Handling**: `grpclib` helpers for consistent gRPC errors

## Handlers Implemented

| Handler | Purpose | Pipeline Steps |
|---------|---------|----------------|
| **Create** | Create new agent instance | ValidateProto → ResolveSlug → CheckDuplicate → SetDefaults → Persist |
| **Update** | Update existing instance | ValidateProto → ResolveSlug → LoadExisting → BuildUpdateState → Persist |
| **Delete** | Delete instance by ID | ValidateProto → ExtractResourceId → LoadExistingForDelete → DeleteResource |
| **Get** | Retrieve instance by ID | ValidateProto → ExtractResourceId → LoadTarget |
| **GetByReference** | Retrieve by slug/org reference | ValidateProto → LoadByReference (custom) |
| **GetByAgent** | List instances for agent | ValidateProto → LoadByAgent (custom) |
| **Apply** | Create or update based on existence | ValidateProto → ResolveSlug → LoadForApply (conditional) |

## Key Differences from Stigmer Cloud (Java)

The Go OSS implementation is **simplified** compared to the Java Cloud version:

### Steps EXCLUDED in OSS:
- ✅ **Authorize** - No multi-tenant authorization (local/single-user usage)
- ✅ **CreateIamPolicies** - No IAM/FGA system in OSS
- ✅ **CleanupIamPolicies** - No IAM policies to clean up
- ✅ **Publish** - No event publishing infrastructure
- ✅ **TransformResponse** - No response transformations needed

### Business Logic EXCLUDED in OSS:
- ✅ **LoadParentAgent** - Parent agent validation (OSS is simpler, no cross-org restrictions)
- ✅ **ValidateSameOrgBusinessRule** - No org-scoping restrictions in local usage
- ✅ **QueryAuthorizedIds** - No authorization filtering for list operations

### What's KEPT:
- ✅ All standard CRUD operations
- ✅ Validation using buf.validate
- ✅ Slug-based lookups (GetByReference)
- ✅ Agent-scoped queries (GetByAgent)
- ✅ Apply operation (idempotent create-or-update)

## File Organization

```
agentinstance/
├── agentinstance_controller.go   # Controller struct + constructor (18 lines)
├── create.go                      # Create handler + pipeline (42 lines)
├── update.go                      # Update handler (47 lines)
├── delete.go                      # Delete handler (59 lines)
├── get.go                         # Get handler (54 lines)
├── get_by_reference.go            # GetByReference handler + custom step (157 lines)
├── get_by_agent.go                # GetByAgent handler + custom step (115 lines)
├── apply.go                       # Apply handler (54 lines)
└── README.md                      # This file
```

All files are well under 200 lines, following Go best practices.

## Pipeline Steps Used

### Standard Steps (from `backend/libs/go/grpc/request/pipeline/steps/`)

| Step | Purpose | Used In |
|------|---------|---------|
| `ValidateProtoStep` | Validate buf.validate constraints | All handlers |
| `ResolveSlugStep` | Generate slug from metadata.name | Create, Update, Apply |
| `CheckDuplicateStep` | Verify no duplicate exists | Create |
| `SetDefaultsStep` | Set ID, kind, timestamps | Create |
| `PersistStep` | Save to database | Create, Update |
| `LoadExistingStep` | Load existing resource | Update |
| `BuildUpdateStateStep` | Merge spec, update timestamps | Update |
| `ExtractResourceIdStep` | Extract ID from wrapper | Get, Delete |
| `LoadTargetStep` | Load by ID | Get |
| `LoadExistingForDeleteStep` | Load before deletion | Delete |
| `DeleteResourceStep` | Delete from database | Delete |
| `LoadForApplyStep` | Conditional create/update | Apply |

### Custom Steps (in this package)

| Step | Purpose | Handler |
|------|---------|---------|
| `loadByReferenceStep` | Load by slug/org reference | GetByReference |
| `loadByAgentStep` | Load instances for agent | GetByAgent |

## Handler Details

### Create Handler

**Purpose**: Create a new agent instance.

**Pipeline**:
1. ValidateProto - Validate field constraints
2. ResolveSlug - Generate slug from metadata.name
3. CheckDuplicate - Verify no duplicate exists by slug
4. SetDefaults - Set ID, kind, api_version, timestamps
5. Persist - Save to database

**Business Logic**: Standard create with no special validation (OSS is local/single-user).

### Update Handler

**Purpose**: Update an existing agent instance.

**Pipeline**:
1. ValidateProto - Validate field constraints
2. ResolveSlug - Generate slug (for fallback lookup)
3. LoadExisting - Load current instance from database
4. BuildUpdateState - Merge spec, preserve IDs, update timestamps
5. Persist - Save updated instance

**Business Logic**: Full spec replacement (no field-by-field merge).

### Delete Handler

**Purpose**: Delete an agent instance by ID.

**Pipeline**:
1. ValidateProto - Validate ID wrapper
2. ExtractResourceId - Extract ID from wrapper
3. LoadExistingForDelete - Load instance (for audit trail)
4. DeleteResource - Delete from database

**Returns**: Deleted instance (gRPC convention for audit trail).

### Get Handler

**Purpose**: Retrieve an agent instance by ID.

**Pipeline**:
1. ValidateProto - Validate ID wrapper
2. ExtractResourceId - Extract ID from wrapper
3. LoadTarget - Load instance from database

**Returns**: Agent instance or NotFound error.

### GetByReference Handler

**Purpose**: Retrieve an agent instance by ApiResourceReference (slug-based lookup).

**Pipeline**:
1. ValidateProto - Validate reference
2. LoadByReference - Load by slug/org (custom step)

**Custom Step - LoadByReference**:
- Platform-scoped: lookup by `ownerScope=platform` + `slug`
- Org-scoped: lookup by `org` + `slug`
- User-scoped: lookup by `org` + `slug` (org contains user ID)

**Note**: Slug is NOT globally unique. Must be qualified by scope.

### GetByAgent Handler

**Purpose**: List all agent instances for a specific agent template.

**Pipeline**:
1. ValidateProto - Validate request
2. LoadByAgent - Load instances filtered by agent_id (custom step)

**Custom Step - LoadByAgent**:
- Lists all agent instances
- Filters by `spec.agent_id`
- Returns list with total count

**Note**: In OSS (local usage), no authorization filtering. All instances returned.

### Apply Handler

**Purpose**: Create or update based on existence (idempotent operation).

**Pipeline**:
1. ValidateProto - Validate field constraints
2. ResolveSlug - Generate slug from metadata.name
3. LoadForApply - Check if exists by org + slug, then conditionally:
   - If NOT exists: Execute Create pipeline
   - If exists: Execute Update pipeline

**Behavior**:
- Deterministic: Same input always produces same result
- Safe for retries: Can be called multiple times
- Upsert semantics: Create if new, update if exists

## Error Handling

All errors use `grpclib` helpers for consistent gRPC responses:

```go
// Invalid input
grpclib.InvalidArgumentError("agent_id is required")

// Resource not found
grpclib.NotFoundError("AgentInstance", id)

// Internal errors
grpclib.InternalError(err, "failed to list instances")
```

## Context Metadata

Pipeline steps communicate via context metadata:

| Key | Type | Purpose | Set By | Used By |
|-----|------|---------|--------|---------|
| `TargetResourceKey` | `*AgentInstance` | Loaded resource | LoadTarget, LoadByReference | Get, GetByReference |
| `ExistingResourceKey` | `*AgentInstance` | Existing resource before delete | LoadExistingForDelete | Delete |
| `"instanceList"` | `*AgentInstanceList` | List of instances | LoadByAgent | GetByAgent |

## Comparison: Java vs Go

### Java (Stigmer Cloud)
```java
// Create Handler (with IAM)
pipeline()
    .addStep(commonSteps.validateFieldConstraints)   // 1
    .addStep(loadParentAgent)                        // 2 - Custom
    .addStep(validateSameOrgBusinessRule)            // 3 - Custom
    .addStep(authorizeCreation)                      // 4 - Custom (FGA)
    .addStep(commonSteps.resolveSlug)                // 5
    .addStep(createSteps.checkDuplicate)             // 6
    .addStep(createSteps.buildNewState)              // 7
    .addStep(createSteps.persist)                    // 8
    .addStep(createIamPolicies)                      // 9 - Custom (IAM)
    .addStep(commonSteps.publish)                    // 10 - Event bus
    .addStep(commonSteps.transformResponse)          // 11
    .addStep(commonSteps.sendResponse)               // 12
```

### Go (Stigmer OSS)
```go
// Create Handler (simplified)
pipeline.NewPipeline[*AgentInstance]("agent-instance-create").
    AddStep(steps.NewValidateProtoStep()).           // 1
    AddStep(steps.NewResolveSlugStep()).             // 2
    AddStep(steps.NewCheckDuplicateStep(store)).     // 3
    AddStep(steps.NewSetDefaultsStep()).             // 4
    AddStep(steps.NewPersistStep(store)).            // 5
    Build()
```

**Result**: Go version is **50% simpler** (5 steps vs 12 steps) due to local/single-user usage model.

## Testing

### Manual Testing Flow

```bash
# 1. Create agent instance
grpcurl -d '{"metadata":{"name":"test-instance","ownerScope":"platform"},"spec":{"agentId":"agent-123"}}' \
  localhost:50051 ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController/Create

# 2. Get by ID
grpcurl -d '{"value":"instance-456"}' \
  localhost:50051 ai.stigmer.agentic.agentinstance.v1.AgentInstanceQueryService/Get

# 3. Get by reference (slug)
grpcurl -d '{"kind":"agent_instance","slug":"test-instance"}' \
  localhost:50051 ai.stigmer.agentic.agentinstance.v1.AgentInstanceQueryService/GetByReference

# 4. List instances for agent
grpcurl -d '{"agentId":"agent-123"}' \
  localhost:50051 ai.stigmer.agentic.agentinstance.v1.AgentInstanceQueryService/GetByAgent

# 5. Update instance
grpcurl -d '{"metadata":{"id":"instance-456","name":"test-instance"},"spec":{"agentId":"agent-123","description":"Updated"}}' \
  localhost:50051 ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController/Update

# 6. Apply (create or update)
grpcurl -d '{"metadata":{"name":"test-instance","ownerScope":"platform"},"spec":{"agentId":"agent-123"}}' \
  localhost:50051 ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController/Apply

# 7. Delete instance
grpcurl -d '{"value":"instance-456"}' \
  localhost:50051 ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController/Delete
```

## Quality Checklist

- [x] All handlers implemented (Create, Update, Delete, Get, GetByReference, GetByAgent, Apply)
- [x] Pipeline pattern used for ALL operations
- [x] All files under 200 lines
- [x] Standard steps reused where possible
- [x] Custom steps implemented for special logic
- [x] Error handling uses grpclib helpers
- [x] Documentation complete (this README)
- [x] Follows Agent controller patterns
- [x] No authorization/IAM steps (OSS simplification)
- [x] No event publishing (OSS simplification)

## Next Steps

1. **Registration**: Register controller in `cmd/server/main.go`
2. **Testing**: Add unit tests for custom steps
3. **Integration**: Ensure Agent.Create can call AgentInstance.Create (already implemented)
4. **Validation**: Test end-to-end agent + instance creation flow

## References

- **Agent Controller**: `../agent/` - Pattern reference for handlers
- **Pipeline Library**: `backend/libs/go/grpc/request/pipeline/` - Reusable steps
- **Java Implementation**: `stigmer-cloud/backend/.../agentinstance/request/handler/` - Business logic reference
- **Implementation Rule**: `backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/` - Architecture guide
