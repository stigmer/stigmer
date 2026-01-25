# Skill Controller

This package implements the gRPC handlers for Skill resources in Stigmer OSS.

## Architecture

The Skill controller follows the **pipeline pattern** for all operations, ensuring consistency, testability, and observability across the codebase.

### Package Structure

```
skill/
├── skill_controller.go      # Controller struct + constructor
├── push.go                  # Push handler (create/update via artifact upload)
├── delete.go                # Delete handler + pipeline
├── get.go                   # Get handler + pipeline
├── get_by_reference.go      # GetByReference handler + pipeline
└── README.md                # This file
```

### Handler Organization

Following Go best practices (inspired by Kubernetes, Docker, gRPC-Go):
- **Controller struct** in `skill_controller.go` - just struct definition and constructor
- **One file per handler** - each CRUD operation in its own file
- **Pipeline builders** - each handler has its own pipeline builder function
- **Generic steps** - reusable steps from `backend/libs/go/grpc/request/pipeline/steps/`

## Operations

### Push

**File**: `push.go`

Uploads a skill artifact (ZIP file) and creates or updates the skill resource.
This is the primary way to create and update skills.

The operation:
1. Extracts SKILL.md from the artifact
2. Calculates SHA256 hash as version identifier
3. Creates skill if it doesn't exist, or creates new version if it does
4. Stores the artifact (deduplicated by hash)
5. Archives previous versions

**Example**:
```go
req := &skillv1.PushSkillRequest{
    Name: "my-skill",
    Org: "org-123", // optional, empty for platform scope
    Artifact: artifactBytes, // ZIP file bytes
}
skill, err := controller.Push(ctx, req)
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

### Artifact-Based Operations

Unlike other resources, skills use an artifact-based approach:
- **Push** handles both create and update by uploading a ZIP artifact
- The artifact must contain SKILL.md with skill definition
- Version control is based on SHA256 hash of artifact content
- Previous versions are automatically archived

Generic CRUD operations (Create/Update/Apply) have been removed in favor of Push.

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
| `skill_controller.go` | 24 | ✅ Ideal |
| `push.go` | ~500 | ⚠️ Complex (artifact handling) |
| `delete.go` | 55 | ✅ Ideal |
| `get.go` | 50 | ✅ Ideal |
| `get_by_reference.go` | 55 | ✅ Ideal |

**Note**: `push.go` is larger due to artifact extraction and version management logic.

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
