# Fix Controller Pipeline Validation Order

**Date**: 2026-01-20  
**Type**: Refactor  
**Scope**: Backend Domain Controllers  
**Impact**: Internal pipeline execution order correction

## Summary

Fixed the pipeline step order in all backend domain controller create and update operations. Changed from incorrect "ResolveSlug before ValidateProto" to correct "ValidateProto before ResolveSlug" order across 19 controller files.

This ensures proper validation happens before slug resolution in all resource creation and update flows.

## Context

The backend controllers use a pipeline framework to process resource creation and updates. Each pipeline has ordered steps that execute sequentially. Recently, a change was made that incorrectly placed slug resolution before validation, which was the wrong order.

**Problem**: The previous implementation had:
1. ResolveSlug - Generate slug from metadata.name (marked as "must be before validation")
2. ValidateProto - Validate proto field constraints

**Correct order**: Validation should always happen first:
1. ValidateProto - Validate proto field constraints using buf validate
2. ResolveSlug - Generate slug from metadata.name

This follows the principle that input validation should occur before any processing or transformations.

## Changes Made

### Controllers Fixed (19 files)

**Create Operations (10 files)**:
1. `agent/controller/create.go`
2. `agentexecution/controller/create.go`
3. `workflowexecution/controller/create.go`
4. `session/controller/create.go`
5. `executioncontext/controller/create.go`
6. `workflowinstance/controller/create.go`
7. `agentinstance/controller/create.go`
8. `environment/controller/create.go`
9. `skill/controller/create.go`
10. `workflow/controller/create.go`

**Update Operations (9 files)**:
1. `agent/controller/update.go`
2. `agentexecution/controller/update.go`
3. `workflowexecution/controller/update.go`
4. `session/controller/update.go`
5. `workflowinstance/controller/update.go`
6. `agentinstance/controller/update.go`
7. `environment/controller/update.go`
8. `skill/controller/update.go`
9. `workflow/controller/update.go`

### Specific Changes Per File

For each controller file:

**1. Swapped Pipeline Steps**:
```go
// Before (INCORRECT)
return pipeline.NewPipeline[*Type]("name").
    AddStep(steps.NewResolveSlugStep[*Type]()).    // 1. Resolve slug (must be before validation)
    AddStep(steps.NewValidateProtoStep[*Type]()).  // 2. Validate field constraints
    // ... rest

// After (CORRECT)
return pipeline.NewPipeline[*Type]("name").
    AddStep(steps.NewValidateProtoStep[*Type]()).  // 1. Validate field constraints
    AddStep(steps.NewResolveSlugStep[*Type]()).    // 2. Resolve slug
    // ... rest
```

**2. Updated Pipeline Documentation Comments**:

Removed the incorrect "(must be before validation)" note and updated step numbering:

```go
// Before:
// 1. ResolveSlug - Generate slug from metadata.name (must be before validation)
// 2. ValidateProto - Validate proto field constraints using buf validate

// After:
// 1. ValidateProto - Validate proto field constraints using buf validate
// 2. ResolveSlug - Generate slug from metadata.name
```

**3. Updated Inline Step Comments**:

Updated step comments to reflect new numbering:

```go
// Before:
AddStep(steps.NewResolveSlugStep[*Type]()).    // 1. Resolve slug (must be before validation)
AddStep(steps.NewValidateProtoStep[*Type]()).  // 2. Validate field constraints

// After:
AddStep(steps.NewValidateProtoStep[*Type]()).  // 1. Validate field constraints
AddStep(steps.NewResolveSlugStep[*Type]()).    // 2. Resolve slug
```

## Why This Matters

### Validation-First Principle

**Correct behavior** (ValidateProto first):
- Invalid input is caught immediately before any processing
- Malformed requests fail fast with clear validation errors
- No resources are partially processed or modified
- Consistent with input validation best practices
- Proto validation rules (buf validate) are enforced first

**Previous incorrect behavior** (ResolveSlug first):
- Slug generation happened before validation
- Potentially processing invalid input
- Could mask validation errors with slug-related errors
- Inconsistent with validation-first principles

### Real-World Impact

While this was a recent mistake that was quickly caught, it could have caused:

1. **Confusing error messages**: If validation failed after slug resolution, users might see slug-related errors before validation errors
2. **Wasted processing**: System would perform slug resolution work before validating if the request is even valid
3. **Inconsistent behavior**: Different failure modes depending on whether validation or slug resolution failed first

### Pattern Consistency

All 19 controller files now follow the same correct pattern:
1. Validate input first (ValidateProto)
2. Process validated input (ResolveSlug)
3. Continue with remaining steps

This consistency makes the codebase easier to understand and maintain.

## Testing Impact

**No functional changes to tests needed** - The pipeline steps execute the same logic, just in the correct order. Existing tests continue to work as the validation still happens and slug resolution still happens, just in the proper sequence.

**What changed**:
- Order of execution
- Error message ordering (validation errors now appear before slug errors)
- Step numbers in pipeline logging

**What didn't change**:
- Validation logic
- Slug resolution logic
- Final state of created/updated resources
- API behavior from user perspective

## Files Modified

**Backend Controllers** (19 files):
```
backend/services/stigmer-server/pkg/domain/agent/controller/create.go
backend/services/stigmer-server/pkg/domain/agent/controller/update.go
backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go
backend/services/stigmer-server/pkg/domain/agentexecution/controller/update.go
backend/services/stigmer-server/pkg/domain/agentinstance/controller/create.go
backend/services/stigmer-server/pkg/domain/agentinstance/controller/update.go
backend/services/stigmer-server/pkg/domain/environment/controller/create.go
backend/services/stigmer-server/pkg/domain/environment/controller/update.go
backend/services/stigmer-server/pkg/domain/executioncontext/controller/create.go
backend/services/stigmer-server/pkg/domain/session/controller/create.go
backend/services/stigmer-server/pkg/domain/session/controller/update.go
backend/services/stigmer-server/pkg/domain/skill/controller/create.go
backend/services/stigmer-server/pkg/domain/skill/controller/update.go
backend/services/stigmer-server/pkg/domain/workflow/controller/create.go
backend/services/stigmer-server/pkg/domain/workflow/controller/update.go
backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go
backend/services/stigmer-server/pkg/domain/workflowexecution/controller/update.go
backend/services/stigmer-server/pkg/domain/workflowinstance/controller/create.go
backend/services/stigmer-server/pkg/domain/workflowinstance/controller/update.go
```

## Migration Notes

**No migration required** - This is an internal implementation change with no API or data format changes.

**For developers**:
- All new controller implementations should follow ValidateProto → ResolveSlug order
- Pipeline step order is now consistent across all controllers
- Refer to any controller create/update file as reference implementation

## Lessons Learned

1. **Validation-first is a fundamental principle** - Always validate input before any processing
2. **Comments matter** - The "(must be before validation)" comment led to confusion; clear rationale in comments prevents errors
3. **Pattern consistency** - Having 19 files follow the same pattern makes it easy to spot deviations
4. **Quick correction** - Catching and fixing this quickly prevented any production impact

## Related Changes

This fix is part of the backend domain refactoring work documented in:
- `_changelog/2026-01/20260119-185951-refactor-backend-domain-structure.md`

The refactoring introduced the incorrect pipeline order, and this changelog documents the correction.

---

**Impact**: Internal refactoring, no user-facing changes  
**Breaking Changes**: None  
**Migration Required**: None
