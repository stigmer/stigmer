# Add Environment Controller Tests and Fix Controller Bugs

**Date**: 2026-01-20 03:17:24  
**Type**: Test Infrastructure + Bug Fixes  
**Scope**: `backend/services/stigmer-server/pkg/domain/environment/controller`  
**Impact**: Internal - Test coverage and controller reliability

## Summary

Created comprehensive test coverage for the Environment controller, following the same pattern as AgentInstance controller tests. During test implementation, discovered and fixed critical bugs in the Environment controller's Create, Update, and Delete methods that would have caused runtime failures.

## What Was Done

### 1. Created Comprehensive Test Suite

**File Created**: `environment_controller_test.go`

Implemented 17 test cases covering all CRUD operations:

**Create Tests (6 cases)**:
- ✅ Successful creation with environment data (config + secrets)
- ✅ Successful creation with empty data
- ✅ Validation error - missing metadata
- ✅ Validation error - missing name
- ✅ Validation error - invalid owner scope (platform not allowed)
- ✅ Validation error - empty environment value

**Get Tests (3 cases)**:
- ✅ Successful retrieval by ID
- ✅ Get non-existent environment (NotFound error)
- ✅ Get with empty ID (validation error)

**Update Tests (4 cases)**:
- ✅ Successful update - description change
- ✅ Successful update - add new data entries
- ✅ Successful update - modify existing data
- ✅ Update non-existent environment (NotFound error)

**Delete Tests (4 cases)**:
- ✅ Successful deletion
- ✅ Delete non-existent environment (NotFound error)
- ✅ Delete with empty ID (validation error)
- ✅ Verify deleted environment returns correct data
- ✅ Delete environment with secrets

### 2. Fixed Critical Controller Bugs

**Bug 1: Missing `SetNewState` in Create**

**File**: `environment/controller/create.go`  
**Problem**: Pipeline's `NewState()` returned nil because `SetNewState()` was never called  
**Symptom**: "resource metadata is nil" error in ResolveSlug step  
**Fix**: Added `reqCtx.SetNewState(environment)` after creating request context

```go
// Before (BROKEN)
func (c *EnvironmentController) Create(ctx context.Context, environment *environmentv1.Environment) (*environmentv1.Environment, error) {
    reqCtx := pipeline.NewRequestContext(ctx, environment)
    // Missing SetNewState!
    p := c.buildCreatePipeline()
    ...
}

// After (FIXED)
func (c *EnvironmentController) Create(ctx context.Context, environment *environmentv1.Environment) (*environmentv1.Environment, error) {
    reqCtx := pipeline.NewRequestContext(ctx, environment)
    reqCtx.SetNewState(environment)  // ← CRITICAL FIX
    p := c.buildCreatePipeline()
    ...
}
```

**Bug 2: Missing `SetNewState` in Update**

**File**: `environment/controller/update.go`  
**Problem**: Same as Create - pipeline couldn't access resource metadata  
**Fix**: Added `reqCtx.SetNewState(environment)` after creating request context

**Bug 3: Incompatible Delete Input Type**

**File**: `environment/controller/delete.go`  
**Problem**: Environment uses `ApiResourceDeleteInput` (with `ResourceId` field) but pipeline's `ExtractResourceIdStep` expects `HasValue` interface (with `Value` field)  
**Symptom**: "input does not implement HasValue interface" error  
**Root Cause**: AgentInstance uses custom `AgentInstanceId` type with `Value` field, but Environment uses generic `ApiResourceDeleteInput` with `ResourceId` field

**Fix**: Manually extract and set resource ID before pipeline execution

```go
// Fixed implementation
func (c *EnvironmentController) Delete(ctx context.Context, input *apiresource.ApiResourceDeleteInput) (*environmentv1.Environment, error) {
    reqCtx := pipeline.NewRequestContext(ctx, input)
    
    // Manually extract and store resource ID since ApiResourceDeleteInput uses
    // ResourceId field instead of Value field (which ExtractResourceIdStep expects)
    reqCtx.Set(steps.ResourceIdKey, input.ResourceId)  // ← WORKAROUND
    
    p := c.buildDeletePipeline()
    ...
}

// Updated pipeline (removed ExtractResourceIdStep)
func (c *EnvironmentController) buildDeletePipeline() *pipeline.Pipeline[*apiresource.ApiResourceDeleteInput] {
    return pipeline.NewPipeline[*apiresource.ApiResourceDeleteInput]("environment-delete").
        AddStep(steps.NewValidateProtoStep[*apiresource.ApiResourceDeleteInput]()).
        // ExtractResourceIdStep removed - ID extracted manually in Delete method
        AddStep(steps.NewLoadExistingForDeleteStep[*apiresource.ApiResourceDeleteInput, *environmentv1.Environment](c.store)).
        AddStep(steps.NewDeleteResourceStep[*apiresource.ApiResourceDeleteInput](c.store)).
        Build()
}
```

## Why These Bugs Existed

**Context**: The Environment controller was created before AgentInstance controller tests existed. When AgentInstance tests were written, the pattern of calling `SetNewState()` was established, but Environment controller was never updated.

**Discovery Process**:
1. Copied AgentInstance test pattern to Environment
2. Tests failed with "resource metadata is nil"
3. Compared AgentInstance and Environment Create methods
4. Found missing `SetNewState()` call - a critical initialization step
5. Fixed Create and Update
6. Delete tests revealed `ApiResourceDeleteInput` incompatibility
7. Implemented workaround for Delete method

## Test Results

All 17 tests pass:

```
=== RUN   TestEnvironmentController_Create
    --- PASS: TestEnvironmentController_Create (0.06s)
=== RUN   TestEnvironmentController_Get
    --- PASS: TestEnvironmentController_Get (0.04s)
=== RUN   TestEnvironmentController_Update
    --- PASS: TestEnvironmentController_Update (0.05s)
=== RUN   TestEnvironmentController_Delete
    --- PASS: TestEnvironmentController_Delete (0.05s)
PASS
ok      github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller    0.931s
```

## Environment-Specific Test Coverage

### Data Map Testing
- Validates environment variables with both secret and non-secret values
- Tests data map initialization behavior (protobuf nil vs empty)
- Verifies data preservation through CRUD operations
- Confirms secret flags are maintained

### Owner Scope Validation
- Validates Environment's CEL constraint: only `organization` or `identity_account` scopes allowed
- Tests rejection of `platform` scope (invalid for Environment)
- Ensures proper validation error messages

### Environment Value Constraints
- Tests minimum length validation (1 character minimum)
- Validates empty value rejection
- Verifies `is_secret` flag behavior

## Impact

**Before**:
- ❌ Environment controller had no tests
- ❌ Critical bugs in Create, Update, Delete would cause runtime failures
- ❌ No validation of pipeline integration
- ❌ Unknown if Environment-specific proto constraints worked

**After**:
- ✅ 17 comprehensive test cases
- ✅ All controller CRUD operations tested
- ✅ Pipeline framework integration validated
- ✅ Critical bugs fixed (would have caused production failures)
- ✅ Environment-specific validations tested (owner scope, data values, secrets)
- ✅ Test pattern established for future controllers

## Files Modified

**Created**:
- `backend/services/stigmer-server/pkg/domain/environment/controller/environment_controller_test.go` (17 test cases, ~630 lines)

**Fixed**:
- `backend/services/stigmer-server/pkg/domain/environment/controller/create.go` (added `SetNewState`)
- `backend/services/stigmer-server/pkg/domain/environment/controller/update.go` (added `SetNewState`)
- `backend/services/stigmer-server/pkg/domain/environment/controller/delete.go` (manual ID extraction workaround)

## Technical Insights

### Pipeline Framework Requirements

**Critical Pattern Discovered**: Controllers using the pipeline framework MUST call `SetNewState()` after creating the request context, otherwise the pipeline cannot access resource metadata for slug resolution and other operations.

**Correct Pattern**:
```go
func (c *Controller) Create(ctx context.Context, resource *Resource) (*Resource, error) {
    reqCtx := pipeline.NewRequestContext(ctx, resource)
    reqCtx.SetNewState(resource)  // ← CRITICAL - don't forget!
    p := c.buildCreatePipeline()
    if err := p.Execute(reqCtx); err != nil {
        return nil, err
    }
    return reqCtx.NewState(), nil
}
```

### Delete Input Type Inconsistency

**Problem**: Not all resources use the same delete input type:
- **AgentInstance**: Uses custom `AgentInstanceId` type with `Value` field (implements `HasValue`)
- **Environment**: Uses generic `ApiResourceDeleteInput` with `ResourceId` field (does NOT implement `HasValue`)

**Current Workaround**: Manually extract and set resource ID in Delete method

**Potential Future Improvement**: Create a generic step that handles both `GetValue()` and `GetResourceId()`, or standardize delete input types across all resources.

## Learning Value

**High**: Discovered critical initialization pattern for pipeline framework and identified delete input type inconsistency that affects all resources using `ApiResourceDeleteInput`.

This test implementation serves as:
1. **Validation** - Proves Environment controller works correctly
2. **Documentation** - Shows how to test pipeline-based controllers
3. **Regression Protection** - Prevents reintroduction of these bugs
4. **Pattern Reference** - Template for future controller tests

## Next Steps

**No immediate action required** - All tests pass, bugs are fixed.

**Potential Future Work**:
- Consider creating a unified delete input type or generic extraction step
- Add similar test coverage to other controllers (ExecutionContext, etc.)
- Document the `SetNewState()` requirement in pipeline framework docs
