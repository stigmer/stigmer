# Skill Controller

This package implements the gRPC handlers for Skill resources in Stigmer OSS.

## Architecture

The Skill controller follows the **pipeline pattern** for all operations, ensuring consistency, testability, and observability across the codebase.

### Package Structure

```
skill/
├── skill_controller.go      # Controller struct + constructor
├── create.go                # Create handler + pipeline
├── update.go                # Update handler + pipeline
├── delete.go                # Delete handler + pipeline
├── get.go                   # Get handler + pipeline
├── get_by_reference.go      # GetByReference handler + pipeline
├── apply.go                 # Apply handler + pipeline
└── README.md                # This file
```

### Handler Organization

Following Go best practices (inspired by Kubernetes, Docker, gRPC-Go):
- **Controller struct** in `skill_controller.go` - just struct definition and constructor
- **One file per handler** - each CRUD operation in its own file
- **Pipeline builders** - each handler has its own pipeline builder function
- **Generic steps** - reusable steps from `backend/libs/go/grpc/request/pipeline/steps/`

## Operations

### Create

**File**: `create.go`

Creates a new skill resource.

**Pipeline**:
1. ValidateProto - Validate proto field constraints
2. ResolveSlug - Generate slug from metadata.name
3. CheckDuplicate - Verify no duplicate exists
4. BuildNewState - Set defaults, generate ID, timestamps
5. Persist - Save to BadgerDB

**Example**:
```go
skill := &skillv1.Skill{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "my-skill",
        OwnerScope: apiresource.ApiResourceOwnerScope_platform,
    },
    Spec: &skillv1.SkillSpec{
        Description: "Custom skill",
    },
}
created, err := controller.Create(ctx, skill)
```

### Update

**File**: `update.go`

Updates an existing skill resource.

**Pipeline**:
1. ValidateProto - Validate proto field constraints
2. ResolveSlug - Generate slug (for fallback lookup)
3. LoadExisting - Load existing skill from repository
4. BuildUpdateState - Merge spec, preserve IDs, update timestamps
5. Persist - Save updated skill

**Example**:
```go
skill.Spec.Description = "Updated description"
updated, err := controller.Update(ctx, skill)
```

### Delete

**File**: `delete.go`

Deletes a skill by ID.

**Pipeline**:
1. ValidateProto - Validate skill ID
2. ExtractResourceId - Extract ID from wrapper
3. LoadExistingForDelete - Load skill (stores in context)
4. DeleteResource - Delete from database

Returns the deleted skill for audit purposes.

**Example**:
```go
skillId := &skillv1.SkillId{Value: "skill-123"}
deleted, err := controller.Delete(ctx, skillId)
```

### Get

**File**: `get.go`

Retrieves a skill by ID.

**Pipeline**:
1. ValidateProto - Validate skill ID
2. LoadTarget - Load skill from repository

**Example**:
```go
skillId := &skillv1.SkillId{Value: "skill-123"}
skill, err := controller.Get(ctx, skillId)
```

### GetByReference

**File**: `get_by_reference.go`

Retrieves a skill by slug-based reference.

**Pipeline**:
1. ValidateProto - Validate reference
2. LoadByReference - Load skill by slug (with optional org filtering)

**Reference Lookup**:
- If `ref.org` is provided: queries skills in that org with matching slug
- If `ref.org` is empty: queries platform-scoped skills with matching slug

**Example**:
```go
ref := &apiresource.ApiResourceReference{
    Slug: "my-skill",
    Org: "org-123", // optional
}
skill, err := controller.GetByReference(ctx, ref)
```

### Apply

**File**: `apply.go`

Declarative create-or-update operation (like `kubectl apply`).

**Pipeline** (minimal, for existence check only):
1. ValidateProto - Validate field constraints
2. ResolveSlug - Generate slug
3. LoadForApply - Check if resource exists

Then delegates to:
- `Create()` if resource doesn't exist
- `Update()` if resource exists

**Example**:
```go
skill := &skillv1.Skill{
    Metadata: &apiresource.ApiResourceMetadata{
        Name: "my-skill",
    },
    Spec: &skillv1.SkillSpec{
        Description: "Will create or update",
    },
}
result, err := controller.Apply(ctx, skill)
```

## Design Decisions

### Pipeline Pattern (Mandatory)

**All handlers use the pipeline pattern** - this is a core architectural principle.

**Benefits**:
- ✅ Consistency across all resources
- ✅ Observability (tracing, logging)
- ✅ Reusability (common steps)
- ✅ Testability (test steps in isolation)
- ✅ Extensibility (add/remove steps easily)

### Single RequestContext

Unlike Stigmer Cloud (Java) which uses specialized contexts, Stigmer OSS uses a single `RequestContext[T]` for all operations.

**Why**:
- Simpler for small team
- Easier evolution
- Go-idiomatic
- Flexible via metadata map

**Trade-off**: Runtime type assertions vs compile-time safety (acceptable for OSS use case).

### No Custom Steps (Yet)

Skills don't require custom business logic steps (unlike agents which need instance creation).

All steps are generic and reusable from `backend/libs/go/grpc/request/pipeline/steps/`.

If skill-specific logic is needed in the future, create a `steps/` subdirectory.

## Simplified from Stigmer Cloud

Compared to Stigmer Cloud (Java), OSS excludes:

| Feature | Cloud | OSS | Reason |
|---------|-------|-----|--------|
| Authorization | ✅ | ❌ | No multi-tenant auth in OSS |
| IAM Policies | ✅ | ❌ | No IAM/FGA system in OSS |
| Event Publishing | ✅ | ❌ | No event system in OSS |
| Response Transformations | ✅ | ❌ | No need for transformations in OSS |

**Result**: Simpler pipelines focused on core CRUD operations.

## File Size Guidelines

All files follow Go best practices:

| File | Lines | Status |
|------|-------|--------|
| `skill_controller.go` | 20 | ✅ Ideal |
| `create.go` | 45 | ✅ Ideal |
| `update.go` | 45 | ✅ Ideal |
| `delete.go` | 55 | ✅ Ideal |
| `get.go` | 50 | ✅ Ideal |
| `get_by_reference.go` | 55 | ✅ Ideal |
| `apply.go` | 70 | ✅ Ideal |

**Target**: All files < 100 lines (achieved ✅).

## Testing

Unit tests should be added in `skill_controller_test.go` covering:
- All CRUD operations
- Error cases (validation failures, not found, etc.)
- Pipeline step execution order

## Registration

The skill controller must be registered in `cmd/server/main.go`:

```go
// Create controller
skillCtrl := skill.NewSkillController(store)

// Register gRPC services
skillv1.RegisterSkillCommandControllerServer(server, skillCtrl)
skillv1.RegisterSkillQueryControllerServer(server, skillCtrl)
```

## Related Documentation

- Implementation rule: `backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/`
- Pipeline framework: `backend/libs/go/grpc/request/pipeline/`
- Common steps: `backend/libs/go/grpc/request/pipeline/steps/`
- Agent controller (reference): `backend/services/stigmer-server/pkg/controllers/agent/`
