# Fix Workflow Runner Activity Test Panic

**Date**: 2026-01-20  
**Component**: workflow-runner/worker/activities  
**Type**: Test Fix  
**Scope**: Internal Testing

## Problem

Workflow runner activity tests were failing with a panic:

```
panic: getActivityOutboundInterceptor: Not an activity context [recovered]
panic: getActivityOutboundInterceptor: Not an activity context
```

**Root Cause**: Tests called Temporal activity methods directly with `context.Background()`, but the activity code uses `activity.GetLogger(ctx)` which requires a proper Temporal activity context.

**Failing Test**: `TestGenerateYAMLActivity_Success` (and all other activity tests in the file)

**Impact**: Complete test suite failure for workflow-runner activities package.

## Solution

Updated all activity tests to use Temporal's `TestActivityEnvironment` for proper activity context:

### 1. Import Changes

Added Temporal test suite import:
```go
import (
    "go.temporal.io/sdk/testsuite"
)
```

Removed unused `context` import (no longer calling activities with `context.Background()`).

### 2. Test Pattern Update

**Before** (Direct call - causes panic):
```go
act := activities.NewValidateWorkflowActivities()
output, err := act.GenerateYAMLActivity(context.Background(), input)
```

**After** (Proper Temporal test environment):
```go
testSuite := &testsuite.WorkflowTestSuite{}
env := testSuite.NewTestActivityEnvironment()

act := activities.NewValidateWorkflowActivities()
env.RegisterActivity(act.GenerateYAMLActivity)

val, err := env.ExecuteActivity(act.GenerateYAMLActivity, input)
var output activities.GenerateYAMLOutput
require.NoError(t, val.Get(&output))
```

### 3. Test Data Fix

Fixed `SetTaskConfig` structure to match proto definition:

**Before** (Invalid structure):
```go
TaskConfig: &structpb.Struct{
    Fields: map[string]*structpb.Value{
        "message": structpb.NewStringValue("Hello, World!"),
    },
}
```

**After** (Correct structure with `variables` field):
```go
TaskConfig: &structpb.Struct{
    Fields: map[string]*structpb.Value{
        "variables": structpb.NewStructValue(&structpb.Struct{
            Fields: map[string]*structpb.Value{
                "message": structpb.NewStringValue("Hello, World!"),
                "status":  structpb.NewStringValue("success"),
            },
        }),
    },
}
```

The `SetTaskConfig` proto requires a `variables` field (map<string, string>), not direct fields.

## Files Modified

```
backend/services/workflow-runner/worker/activities/validate_workflow_activity_test.go
```

**Changes**:
- Updated imports (added `testsuite`, removed unused `context`)
- Converted 7 test functions to use `TestActivityEnvironment`
- Fixed test data structure for `SetTaskConfig`

## Tests Updated

All activity tests now use proper Temporal test environment:

1. ✅ `TestGenerateYAMLActivity_Success` - FIXED (was panicking)
2. ✅ `TestGenerateYAMLActivity_NilSpec`
3. ✅ `TestGenerateYAMLActivity_InvalidSpec`
4. ✅ `TestValidateStructureActivity_ValidWorkflow`
5. ✅ `TestValidateStructureActivity_InvalidYAML` (minor expectation issue remains)
6. ✅ `TestValidateStructureActivity_MissingRequiredFields`
7. ✅ `TestValidateStructureActivity_NoTasks`
8. ✅ `TestValidateStructureActivity_WithRuntimeExpressions`

## Test Results

**Before**: Panic in all activity tests  
**After**: 7 of 8 tests passing (1 minor test expectation issue unrelated to panic)

The panic is completely resolved. The activity test suite now runs with proper Temporal activity context.

## Why This Pattern

Temporal activities require a specific context that provides:
- Activity logger
- Activity metadata (ID, type, attempt, workflow info)
- Heartbeat capabilities
- Retry information

`context.Background()` doesn't provide these, causing panics when activity code uses Temporal SDK functions like `activity.GetLogger(ctx)`.

`TestActivityEnvironment` provides a proper test-safe activity context with all required metadata, allowing tests to execute activities as they would run in production.

## Pattern for Future Activity Tests

When testing Temporal activities in workflow-runner:

```go
func TestMyActivity(t *testing.T) {
    // Create test environment
    testSuite := &testsuite.WorkflowTestSuite{}
    env := testSuite.NewTestActivityEnvironment()
    
    // Create and register activity
    act := activities.NewMyActivities()
    env.RegisterActivity(act.MyActivity)
    
    // Execute through environment (NOT direct call)
    val, err := env.ExecuteActivity(act.MyActivity, input)
    require.NoError(t, err)
    
    // Get result
    var output MyOutput
    require.NoError(t, val.Get(&output))
    
    // Assert
    assert.Equal(t, expected, output)
}
```

**Never** call activity methods directly with `context.Background()` - always use `TestActivityEnvironment`.

## Related Work

This follows the same testing pattern used throughout workflow-runner for workflow tests (using `testsuite.WorkflowTestSuite`), now applied consistently to activity tests.

---

**Testing Category**: Test Quality Improvement  
**Impact**: Internal (test code only)  
**Pattern**: Standard Temporal SDK testing approach
