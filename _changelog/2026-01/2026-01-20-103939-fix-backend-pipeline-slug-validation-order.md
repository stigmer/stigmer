# Fix Backend Pipeline - Slug Validation Order

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: Backend Controllers (Go)  
**Impact**: Critical - Fixes validation errors preventing resource creation

## Problem

CLI users encountered validation errors when creating resources:

```
Error: pipeline step ValidateProtoConstraints failed: 
validation error: slug: value length must be at least 1 characters
```

This happened even though users provided a `name` field and the system should auto-generate the `slug`.

## Root Cause

All Go backend controllers had an incorrect pipeline step order:

```go
// ❌ WRONG ORDER - Validation before slug resolution
.AddStep(steps.NewValidateProtoStep())  // Validates empty slug
.AddStep(steps.NewResolveSlugStep())    // Generates slug AFTER validation
```

The validation step ran **before** the slug resolution step, causing:
1. User sends request with `name` but no `slug` (expects auto-generation)
2. ValidateProto runs first, sees empty `slug` field
3. Proto validation constraint `[(buf.validate.field).string.min_len = 1]` fails
4. Request rejected before `ResolveSlug` can populate the slug from name

## Why Java Worked

This issue only affected the Go backend (stigmer-server). The Java backend (stigmer-cloud) already had the correct order, which is why the same operations worked when calling Java services directly.

## Solution

Reordered pipeline steps in **all 19 controller files** to match Java implementation:

### Create Operations (10 controllers)

**New order**:
```go
.AddStep(steps.NewResolveSlugStep())    // 1. Generate slug from name FIRST
.AddStep(steps.NewValidateProtoStep())  // 2. THEN validate (with populated slug)
.AddStep(steps.NewCheckDuplicateStep()) // 3. Check duplicate (needs slug)
.AddStep(steps.NewBuildNewStateStep())  // 4. Build new state
.AddStep(steps.NewPersistStep())        // 5. Persist
```

**Controllers fixed**:
- `agent/controller/create.go`
- `workflow/controller/create.go`
- `skill/controller/create.go`
- `environment/controller/create.go`
- `agentinstance/controller/create.go`
- `workflowinstance/controller/create.go`
- `session/controller/create.go`
- `executioncontext/controller/create.go`
- `agentexecution/controller/create.go`
- `workflowexecution/controller/create.go`

### Update Operations (9 controllers)

**New order**:
```go
.AddStep(steps.NewResolveSlugStep())    // 1. Generate slug from name FIRST
.AddStep(steps.NewValidateProtoStep())  // 2. THEN validate (with populated slug)
.AddStep(steps.NewLoadExistingStep())   // 3. Load existing resource
.AddStep(steps.NewBuildUpdateStateStep()) // 4. Build updated state
.AddStep(steps.NewPersistStep())        // 5. Persist
```

**Additional fixes for update controllers**:
1. **Added ResolveSlug** to `workflow/update.go` and `workflowinstance/update.go` (was missing entirely)
2. **Added BuildUpdateStateStep** to `workflow/update.go` and `workflowinstance/update.go` (was missing - jumped straight from LoadExisting to Persist)

**Controllers fixed**:
- `agent/controller/update.go`
- `workflow/controller/update.go` (+ added ResolveSlug, + added BuildUpdateState)
- `skill/controller/update.go`
- `environment/controller/update.go`
- `agentinstance/controller/update.go`
- `workflowinstance/controller/update.go` (+ added ResolveSlug, + added BuildUpdateState)
- `session/controller/update.go`
- `agentexecution/controller/update.go`
- `workflowexecution/controller/update.go`

## Impact

**Before**:
- ❌ `stigmer apply` failed with slug validation error
- ❌ Users had to manually provide `metadata.slug` field (duplicating the name)
- ❌ Inconsistent with Java backend behavior

**After**:
- ✅ Users can provide only `name` field
- ✅ System auto-generates `slug` from name before validation
- ✅ Matches Java backend behavior exactly
- ✅ All create and update operations work correctly

## Technical Details

### What ResolveSlug Does

The `ResolveSlugStep` (in `backend/libs/go/grpc/request/pipeline/steps/resolve_slug.go`):
1. Reads `metadata.name` from the input
2. Generates slug by slugifying the name (lowercase, replace spaces with hyphens, etc.)
3. Sets `metadata.slug` in the request
4. Stores resolved slug in request context for subsequent steps

### What BuildUpdateState Does

The `BuildUpdateStateStep` (in `backend/libs/go/grpc/request/pipeline/steps/build_update_state.go`):
1. Merges `spec` from input request with existing state
2. Preserves `metadata` (IDs, org, scope) from existing state
3. Preserves `status` from existing state (doesn't clear it)
4. Updates audit fields (timestamps, modified_by)
5. Clears computed fields that need recalculation

This matches Java's `UpdateOperationSteps.buildNewState` behavior.

### Why Order Matters

**Slug must be resolved before validation**:
- Proto validation rules check field constraints (including `min_len = 1` for slug)
- If slug is empty when validation runs, it fails
- If slug is populated first, validation passes

**Slug must be resolved before duplicate check**:
- Duplicate checking uses the slug to query existing resources
- Without resolved slug, duplicate check cannot work correctly

**LoadExisting must be after validation** (for updates):
- We validate the input request first (structure and constraints)
- Then load the existing state from DB
- Then merge the two in BuildUpdateState

## Testing

This fix enables the following workflow to work correctly:

```yaml
# stigmer.yaml - User only provides 'name', not 'slug'
name: stigmer-project
runtime: go
version: 1.0.0
description: AI-powered PR review demo
```

```bash
$ stigmer apply

✓ Agent deployed: stigmer-project (ID: agt-xyz)  # Works! Slug auto-generated
```

## Files Changed

**Backend controllers (19 files)**:
- `backend/services/stigmer-server/pkg/domain/*/controller/create.go` (10 files)
- `backend/services/stigmer-server/pkg/domain/*/controller/update.go` (9 files)

**Changes**:
- Swapped pipeline step order: `ResolveSlug` before `ValidateProto`
- Added missing `ResolveSlug` step to 2 update controllers
- Added missing `BuildUpdateStateStep` to 2 update controllers
- Updated pipeline documentation comments in all files

## Consistency Achieved

All Go backend controllers now match the Java implementation pattern:

**Create**: ResolveSlug → Validate → CheckDuplicate → BuildNewState → Persist  
**Update**: ResolveSlug → Validate → LoadExisting → BuildUpdateState → Persist

This ensures Go and Java backends behave identically when processing the same requests.
