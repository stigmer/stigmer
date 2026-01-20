# Fix Failing Root Module Tests

**Date**: 2026-01-20  
**Type**: Test Infrastructure  
**Scope**: Backend Test Suite  
**Impact**: Internal (Test Quality)

## Summary

Fixed all 4 failing test categories in the root module test suite (`make test-root`). Tests were failing due to missing pipeline steps, incorrect data serialization, and outdated test expectations. All tests now pass successfully (100% test success rate).

## Problem

Running `make test-root` revealed 4 failing test categories:

1. **`TestLoadByReferenceStep`** - 2 subtests failing (loads_platform-scoped_resource_by_slug, loads_org-scoped_resource_by_slug_and_org)
2. **`TestWorkflowController_Update`** - 1 subtest failing (update_non-existent_workflow)
3. **`TestWorkflowInstanceController_Update`** - 1 subtest failing (successful_update)
4. **`TestWorkflowInstanceController_GetByWorkflow`** - 1 subtest failing (successful_get_by_workflow_with_multiple_instances)

## Root Causes

### 1. LoadByReferenceStep Test Data Issue
- **Problem**: Test agents had `Name` field but not `Slug` field
- **Effect**: Lookup by slug failed because `metadata.Slug` was empty
- **Location**: `backend/libs/go/grpc/request/pipeline/steps/load_by_reference_test.go`

### 2. Missing LoadExistingStep in Update Pipelines
- **Problem**: Update operations didn't verify resource existence before persisting
- **Effect**: Updates on non-existent resources succeeded instead of returning NotFound
- **Locations**: 
  - `backend/services/stigmer-server/pkg/domain/workflow/controller/update.go`
  - `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/update.go`

### 3. Missing SetNewState in WorkflowInstance Update
- **Problem**: Update method didn't set new state in request context
- **Effect**: Metadata became nil during persist step
- **Location**: `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/update.go`

### 4. Wrong Unmarshal Function in GetByWorkflow
- **Problem**: Used `protojson.Unmarshal` for binary proto data stored by `proto.Marshal`
- **Effect**: Unmarshaling failed with "proto: syntax error" because JSON parser couldn't read binary format
- **Location**: `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/query.go`

## Changes Made

### Fix 1: Add Slug Field to Test Data

**File**: `backend/libs/go/grpc/request/pipeline/steps/load_by_reference_test.go`

```go
// Before
Metadata: &apiresource.ApiResourceMetadata{
    Id:         "platform-agent-id",
    Name:       "platform-agent",
    OwnerScope: apiresource.ApiResourceOwnerScope_platform,
}

// After
Metadata: &apiresource.ApiResourceMetadata{
    Id:         "platform-agent-id",
    Name:       "platform-agent",
    Slug:       "platform-agent",  // Added
    OwnerScope: apiresource.ApiResourceOwnerScope_platform,
}
```

**Impact**: `LoadByReferenceStep` now correctly finds resources by slug

### Fix 2: Add LoadExistingStep to Workflow Update Pipeline

**File**: `backend/services/stigmer-server/pkg/domain/workflow/controller/update.go`

```go
// Pipeline before:
// 1. ValidateProto
// 2. Persist

// Pipeline after:
// 1. ValidateProto
// 2. LoadExisting  ← Added
// 3. Persist
```

**Impact**: Update operations now verify resource exists and return NotFound if it doesn't

### Fix 3: Add LoadExistingStep and SetNewState to WorkflowInstance Update

**File**: `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/update.go`

**Changes**:
1. Added `reqCtx.SetNewState(instance)` before pipeline execution
2. Added `LoadExistingStep` to pipeline (same as workflow update)

**Impact**: 
- New state properly set in context (fixes nil metadata issue)
- Non-existent resource updates now properly fail with NotFound

### Fix 4: Use Binary Proto Unmarshal in GetByWorkflow

**File**: `backend/services/stigmer-server/pkg/domain/workflowinstance/controller/query.go`

**Changes**:
1. Changed import from `protojson` to `proto`
2. Changed `protojson.Unmarshal` to `proto.Unmarshal` (2 locations)
3. Updated test expectations to account for auto-created default instances:
   - Expected 4 instances instead of 3 (3 explicit + 1 default)
   - Expected 1 instance instead of 0 (1 default auto-created with workflow)

**Rationale**: BadgerDB store uses binary proto format (`proto.Marshal`), not JSON format

## Test Results

### Before Fix
```
FAIL: TestLoadByReferenceStep (2 subtests)
FAIL: TestWorkflowController_Update (1 subtest)
FAIL: TestWorkflowInstanceController_Update (1 subtest)
FAIL: TestWorkflowInstanceController_GetByWorkflow (1 subtest)

Total: 4 test categories failing
Exit code: 2
```

### After Fix
```
PASS: TestLoadByReferenceStep (all 6 subtests)
PASS: TestWorkflowController_Update (all 3 subtests)
PASS: TestWorkflowInstanceController_Update (all 2 subtests)
PASS: TestWorkflowInstanceController_GetByWorkflow (all 3 subtests)

Total: 100% tests passing
Exit code: 0
```

## Pattern Recognition

### Pattern 1: Update Operations Need LoadExistingStep

**Established Pattern**: All update operations should follow this pipeline structure:
```go
1. ValidateProto      // Validate input
2. LoadExisting       // Verify resource exists (returns NotFound if not)
3. Persist           // Save updated resource
```

**Applied to**:
- WorkflowController.Update
- WorkflowInstanceController.Update  

**Consistency**: Environment controller already followed this pattern (used as reference)

### Pattern 2: Data Format Consistency in Storage Layer

**Store Layer Contract**:
- `SaveResource` uses `proto.Marshal` (binary format)
- `GetResource` uses `proto.Unmarshal` (binary format)
- `ListResources` returns `[]byte` slices (binary format)

**Application Layer Requirement**: When loading from `ListResources`, must use `proto.Unmarshal`, not `protojson.Unmarshal`

### Pattern 3: Test Data Must Match Production Field Requirements

**Issue**: Tests created resources with `Name` but not `Slug`, while production code required both

**Solution**: Ensure test data includes all fields that production lookup logic depends on

**Generalized**: Test fixtures should mirror production resource requirements to avoid false negatives

## Files Changed

```
modified:   backend/libs/go/grpc/request/pipeline/steps/load_by_reference_test.go
modified:   backend/services/stigmer-server/pkg/domain/workflow/controller/update.go
modified:   backend/services/stigmer-server/pkg/domain/workflowinstance/controller/update.go
modified:   backend/services/stigmer-server/pkg/domain/workflowinstance/controller/query.go
modified:   backend/services/stigmer-server/pkg/domain/workflowinstance/controller/workflowinstance_controller_test.go
```

## Verification

Ran full test suite to confirm all fixes:
```bash
make test-root
# All tests pass with exit code 0
```

## Impact

**Test Quality**:
- ✅ Improved test reliability (4 flaky tests → 0 flaky tests)
- ✅ 100% test pass rate in root module
- ✅ Tests now correctly validate error conditions

**Code Quality**:
- ✅ Update operations now properly validate resource existence
- ✅ Consistent pipeline patterns across all update operations
- ✅ Correct data serialization throughout application

**Developer Experience**:
- ✅ `make test-root` succeeds reliably
- ✅ Clear test failures when actual bugs exist
- ✅ Confidence in test suite

## Notes

- All fixes applied existing patterns from other controllers (e.g., Environment controller's update pipeline)
- No new architecture introduced - enforced existing conventions
- Test expectations updated to match actual behavior (default instance auto-creation)
