# Fix: GetByReference Slug Lookup Not Finding Resources

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: Backend Pipeline Steps  
**Impact**: Critical - GetByReference operations were broken for all resources

## Problem

The `LoadByReferenceStep` was comparing `metadata.Name` with the slug parameter instead of `metadata.Slug`, causing all slug-based lookups to fail.

**Symptom**: Tests failing with "Resource not found" errors even though resources existed:
- `TestWorkflowController_GetByReference/successful_get_by_slug` - FAIL
- `TestWorkflowInstanceController_GetByReference/successful_get_by_slug` - FAIL

**Root Cause**: Mismatch between field comparison in `load_by_reference.go`:
- `metadata.Name` contains the original name (e.g., "Reference Test Workflow")
- `metadata.Slug` contains the normalized slug (e.g., "reference-test-workflow")  
- The code was comparing `metadata.Name == slug`, which always failed

## Solution

Fixed line 159 in `backend/libs/go/grpc/request/pipeline/steps/load_by_reference.go`:

```diff
- // Match by name (slug is stored in metadata.name)
- if metadata.Name == slug {
+ // Match by slug
+ if metadata.Slug == slug {
```

## Impact

**Fixed**:
- ✅ `TestWorkflowController_GetByReference/successful_get_by_slug` - Now passing
- ✅ `TestWorkflowInstanceController_GetByReference/successful_get_by_slug` - Now passing
- ✅ All GetByReference operations for all resource types (uses shared pipeline step)

**Benefits**:
- Slug-based resource lookups now work correctly
- GetByReference API operations functional
- Tests provide regression protection

## Technical Details

**How slug resolution works**:
1. `ResolveSlugStep` generates normalized slug from `metadata.Name` during resource creation
2. Slug is stored in `metadata.Slug` field (lowercase, hyphens, URL-friendly)
3. `LoadByReferenceStep` queries resources and compares slug parameter with `metadata.Slug`

**The bug**: Step 3 was comparing with `metadata.Name` instead of `metadata.Slug`

## Testing

Ran targeted tests to verify fix:
```bash
# Workflow GetByReference - Now passing
go test -v -run TestWorkflowController_GetByReference

# WorkflowInstance GetByReference - Now passing  
go test -v -run TestWorkflowInstanceController_GetByReference
```

Both tests now pass, confirming slug lookup works correctly.

## Files Changed

- `backend/libs/go/grpc/request/pipeline/steps/load_by_reference.go` - Fixed slug comparison logic

## Category of Remaining Test Failures

After this fix, 3 test failures remain (different categories):

**Update Validation Issues** (2 tests):
- `TestWorkflowController_Update/update_non-existent_workflow` - Update doesn't validate resource exists
- `TestWorkflowInstanceController_Update/successful_update` - Metadata nil error

**Serialization Issues** (1 test):
- `TestWorkflowInstanceController_GetByWorkflow/successful_get_by_workflow_with_multiple_instances` - Proto unmarshaling errors

## Next Steps

This fix resolves the GetByReference category completely. Remaining failures are in different categories (Update validation and Serialization) and will be addressed separately.
