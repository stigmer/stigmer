# Implement UpdateHandler with Pipeline Framework

**Date**: 2026-01-18  
**Type**: Feature  
**Scope**: Backend / Agent Controller  
**Impact**: Architecture improvement - enables proper update operations with audit tracking

## Summary

Implemented complete UpdateHandler for Stigmer OSS Agent controller using the pipeline framework. Created two new reusable pipeline steps (`LoadExistingStep` and `BuildUpdateStateStep`) that enable proper resource updates with audit trail preservation and immutable field protection.

## Motivation

The Update handler was previously a stub with only persistence logic. This implementation:
- Follows the pattern from Stigmer Cloud Java UpdateHandler (adapted for OSS)
- Enables proper merge of updates with existing resource state
- Preserves audit trail (created_by, created_at from existing; updated_by, updated_at updated)
- Protects immutable fields (ID, slug) from modification
- Provides foundation for update operations across all resource types

## Implementation Details

### 1. LoadExistingStep (`backend/libs/go/grpc/request/pipeline/steps/load_existing.go`)

**Purpose**: Load existing resource from database before update

**Key Features**:
- Loads resource by ID and kind
- Stores existing resource in context for merge step
- Returns gRPC NotFound error if resource doesn't exist
- Validates ID is provided in input

**Usage**:
```go
AddStep(steps.NewLoadExistingStep[*agentv1.Agent](c.store))
```

### 2. BuildUpdateStateStep (`backend/libs/go/grpc/request/pipeline/steps/build_update_state.go`)

**Purpose**: Merge input changes with existing resource and update audit fields

**Key Features**:
- Merges input spec with existing resource (full spec replacement strategy)
- Preserves immutable metadata fields:
  - `metadata.id` - Cannot be changed
  - `metadata.name` (slug) - Cannot be changed once set
- Clears status field (system-managed, not client-modifiable)
- Updates audit trail:
  - `spec_audit.created_by` and `created_at` - **Preserved** from existing
  - `spec_audit.updated_by` and `updated_at` - **Updated** to current
  - `status_audit` - Reset (status was cleared)
  - `event` - Set to "updated"

**Merge Strategy**:
- Full spec replacement (client sends complete desired state)
- Alternative strategies (field-by-field merge) can be added if needed

**Usage**:
```go
AddStep(steps.NewBuildUpdateStateStep[*agentv1.Agent]())
```

### 3. Updated Agent UpdateHandler (`backend/services/stigmer-server/pkg/controllers/agent/update.go`)

**Pipeline Steps**:
1. **ValidateProtoStep** - Validate proto field constraints using buf validate
2. **ResolveSlugStep** - Generate slug from metadata.name (for fallback lookup)
3. **LoadExistingStep** - Load existing agent from database by ID
4. **BuildUpdateStateStep** - Merge spec, preserve IDs, update timestamps
5. **PersistStep** - Save updated agent to database

**OSS Simplifications** (compared to Stigmer Cloud):
- ❌ Authorize step (no multi-tenant auth in OSS)
- ❌ CreateIamPolicies step (no IAM/FGA in OSS)
- ❌ Publish step (no event publishing in OSS)
- ❌ TransformResponse step (no response transformations in OSS)

### 4. Store Interface Alignment (`backend/libs/go/sqlite/store.go`)

Fixed SQLite store implementation to match the `store.Store` interface:

**Updated Signatures**:
- `GetResource(ctx, kind, id, msg)` - Added `kind` parameter
- `DeleteResource(ctx, kind, id)` - Added `kind` parameter
- `DeleteResourcesByKind(ctx, kind)` - Fixed return type to `error`

**Why**: The interface expected `(ctx, kind, id, msg)` but implementation had `(ctx, id, msg)`. This caused compilation errors when using the store through the interface.

### 5. Comprehensive Tests

Created tests for both new steps:
- `load_existing_test.go` - Tests for LoadExistingStep
  - Success case (existing resource loaded)
  - Not found case (resource doesn't exist)
  - Validation cases (empty ID, nil metadata)
- `build_update_state_test.go` - Tests for BuildUpdateStateStep
  - Audit preservation (created_by/created_at preserved)
  - Audit updates (updated_by/updated_at set to current)
  - Immutable field protection (ID, slug preserved)
  - Spec merge (input spec replaces existing)
  - No existing audit fallback (creates audit if missing)

### 6. Updated Existing Tests

Fixed all existing tests to use updated API signatures:
- `duplicate_test.go` - Updated for new API
- `persist_test.go` - Updated for new API
- `integration_test.go` - Updated for new API

## Testing

All code compiles successfully:
```bash
go build ./backend/libs/go/grpc/request/pipeline/steps/...
go build ./backend/services/stigmer-server/pkg/controllers/agent/...
```

## Design Decisions

### Single RequestContext for All Operations

**Decision**: Use `RequestContext[T]` for all operations (create, update, delete)  
**Rationale**: Simpler than Java's specialized contexts (CreateContext, UpdateContext, DeleteContext)
- Easier to evolve (add data via metadata map)
- Less ceremony (fewer types to maintain)
- Go-idiomatic (flexible over strict)

**Trade-off**: Runtime type assertions vs compile-time safety
- Acceptable for OSS scope (small team, rapid iteration)
- Can add type-safe helpers if needed

### Full Spec Replacement Strategy

**Decision**: Input spec completely replaces existing spec  
**Rationale**: Client sends complete desired state (common pattern)
- Simpler than field-by-field merge
- Clear semantics (what you send is what you get)
- Immutable fields protected separately

**Alternative**: Field-by-field merge (can add if needed)

### Audit Trail Design

**Decision**: Preserve creation audit, update modification audit  
**Rationale**: Track who created vs who last modified
- `spec_audit.created_by` + `created_at` - Never change
- `spec_audit.updated_by` + `updated_at` - Update on every change
- `status_audit` - Reset (status is cleared on update)

**Benefit**: Complete audit trail for compliance and debugging

## Migration Impact

### For Other Resource Controllers

These steps are now available for all resource types:

```go
// Update handler for any resource
func (c *ResourceController) Update(ctx context.Context, resource *pb.Resource) (*pb.Resource, error) {
    reqCtx := pipeline.NewRequestContext(ctx, resource)
    
    p := pipeline.NewPipeline[*pb.Resource]("resource-update").
        AddStep(steps.NewValidateProtoStep[*pb.Resource]()).
        AddStep(steps.NewResolveSlugStep[*pb.Resource]()).
        AddStep(steps.NewLoadExistingStep[*pb.Resource](c.store)).
        AddStep(steps.NewBuildUpdateStateStep[*pb.Resource]()).
        AddStep(steps.NewPersistStep[*pb.Resource](c.store)).
        Build()
    
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }
    
    return reqCtx.NewState(), nil
}
```

### For Store Implementations

All store implementations must now include `kind` parameter:
```go
// Before
GetResource(ctx, id, msg)
DeleteResource(ctx, id)

// After
GetResource(ctx, kind, id, msg)
DeleteResource(ctx, kind, id)
```

## Future Enhancements

1. **Field-by-field merge** - If needed, add `MergeChangesStep` with selective field merging
2. **Optimistic locking** - Add version checking to prevent concurrent modification conflicts
3. **Change detection** - Add step to detect what actually changed (for efficient event publishing)
4. **Partial updates** - Support field masks for partial resource updates

## Files Changed

**New Files**:
- `backend/libs/go/grpc/request/pipeline/steps/load_existing.go` - LoadExistingStep implementation
- `backend/libs/go/grpc/request/pipeline/steps/load_existing_test.go` - LoadExistingStep tests
- `backend/libs/go/grpc/request/pipeline/steps/build_update_state.go` - BuildUpdateStateStep implementation
- `backend/libs/go/grpc/request/pipeline/steps/build_update_state_test.go` - BuildUpdateStateStep tests

**Modified Files**:
- `backend/services/stigmer-server/pkg/controllers/agent/update.go` - Implemented complete update pipeline
- `backend/libs/go/sqlite/store.go` - Fixed method signatures to match interface
- `backend/libs/go/grpc/request/pipeline/steps/duplicate_test.go` - Updated for new API
- `backend/libs/go/grpc/request/pipeline/steps/persist_test.go` - Updated for new API
- `backend/libs/go/grpc/request/pipeline/steps/integration_test.go` - Updated for new API

## Related Work

This implementation completes the CRUD pipeline for Agent resources:
- ✅ **Create** - Validation, duplicate check, defaults, persistence (already implemented)
- ✅ **Update** - Load existing, merge changes, update audit, persistence (this implementation)
- ⏳ **Delete** - Load existing, delete from store (pending)
- ✅ **Get/Query** - Simple database lookups (already implemented)

## Lessons Learned

1. **Interface-Implementation Alignment** - Discovered mismatch between `store.Store` interface and SQLite implementation
2. **Proto Field Validation** - AgentSpec has `Description` field, not `Title` (important for test writing)
3. **Context-with-Kind Pattern** - Tests need `contextWithKind()` helper to inject api_resource_kind
4. **Audit Trail Complexity** - Preserving creation audit while updating modification audit requires careful proto reflection
5. **Immutable Field Protection** - Critical to preserve ID and slug to prevent resource identity issues

## References

- Java UpdateHandler: `stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agent/request/handler/AgentUpdateHandler.java`
- Pipeline Framework: `backend/libs/go/grpc/request/pipeline/`
- Store Interface: `backend/libs/go/store/interface.go`
