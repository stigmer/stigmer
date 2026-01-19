# Fix Workflow Runner Task Config Validation

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Area**: `backend/services/workflow-runner`  
**Scope**: Validation, Testing

## Summary

Fixed a critical validation gap in the workflow runner's task configuration unmarshaling process. The `UnmarshalTaskConfig` function was unmarshaling proto messages without validating them, allowing invalid configurations to pass through silently.

## Problem

The converter integration test `TestE2E_ValidationIntegration_InvalidConfig` was failing because validation was not being enforced during unmarshaling:

```go
// Test created intentionally invalid config
invalidConfig := &tasksv1.HttpCallTaskConfig{
    Method: "INVALID_METHOD",     // Invalid HTTP method
    Endpoint: &tasksv1.HttpEndpoint{
        Uri: "",                   // Empty URI - invalid
    },
    TimeoutSeconds: 500,           // Out of range (max 300)
}

// Expected: Converter should reject this
// Actual: No error thrown - validation not enforced
```

The test expected the converter's `ProtoToYAML` method to fail validation, but it succeeded because `UnmarshalTaskConfig` didn't validate.

## Root Cause

In `backend/services/workflow-runner/pkg/validation/unmarshal.go`:

**Before:**
```go
func UnmarshalTaskConfig(...) (proto.Message, error) {
    // ... unmarshal JSON to proto message
    err = protojson.Unmarshal(jsonBytes, protoMsg)
    if err != nil {
        return nil, fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
    }
    
    return protoMsg, nil  // ❌ No validation!
}
```

The function had a separate `ValidateTaskConfig` function available but never called it.

## Solution

**Modified:** `backend/services/workflow-runner/pkg/validation/unmarshal.go`

Added validation call immediately after unmarshaling:

```go
func UnmarshalTaskConfig(...) (proto.Message, error) {
    // ... unmarshal JSON to proto message
    err = protojson.Unmarshal(jsonBytes, protoMsg)
    if err != nil {
        return nil, fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
    }
    
    // ✅ Validate the unmarshaled proto message
    err = ValidateTaskConfig(protoMsg)
    if err != nil {
        return nil, fmt.Errorf("validation failed: %w", err)
    }
    
    return protoMsg, nil
}
```

This ensures all proto messages are validated using protovalidate rules immediately after unmarshaling, catching invalid configurations before they propagate through the system.

## Test Fixes

Validation now properly enforces proto constraints, which revealed that some tests had invalid configurations (missing required fields):

**Files Updated:**
1. `backend/services/workflow-runner/pkg/converter/integration_test.go`
2. `backend/services/workflow-runner/pkg/converter/proto_to_yaml_test.go`

**Issue:** Tests created `HttpCallTaskConfig` without `timeout_seconds`, which defaults to 0.

The proto validation rule requires:
```protobuf
int32 timeout_seconds = 5 [(buf.validate.field).int32 = {
    gte: 1    // Must be >= 1
    lte: 300  // Must be <= 300
}];
```

**Fixed Tests:**
- `TestE2E_EmptyOptionalFields` - Added `TimeoutSeconds: 30`
- `TestE2E_BodyAsStruct` - Added `TimeoutSeconds: 30`
- `TestProtoToYAML_HTTPCallTask` - Added `TimeoutSeconds: 30`

## Impact

### Positive
✅ **Invalid configurations now caught at unmarshal time** - Prevents bad configs from reaching the workflow engine  
✅ **Better error messages** - Users see validation errors with specific field paths and constraints  
✅ **Type safety enforced** - Proto validation rules (buf.validate) are now properly applied  
✅ **Test coverage improved** - Tests now use valid configurations that match real-world constraints

### What Validation Now Catches
- Invalid HTTP methods (must be GET, POST, PUT, DELETE, PATCH)
- Empty required fields (URIs, service names, etc.)
- Out-of-range values (timeout must be 1-300 seconds)
- Invalid enums
- Constraint violations (string patterns, numeric ranges, etc.)

## Test Results

**Before Fix:**
```
FAIL: TestE2E_ValidationIntegration_InvalidConfig
  Expected error but got nil - invalid config was not rejected
```

**After Fix:**
```
PASS: TestE2E_ValidationIntegration_InvalidConfig (0.00s)
PASS: All converter tests (16/16)
```

All converter package tests now pass with proper validation enforcement.

## Technical Details

### Validation Flow

```
User creates WorkflowSpec with task configs
         ↓
Converter.ProtoToYAML()
         ↓
convertTask() for each task
         ↓
UnmarshalTaskConfig(kind, struct)
         ↓
protojson.Unmarshal() → typed proto
         ↓
ValidateTaskConfig(proto)  ← NOW ENFORCED
         ↓
Return validated proto OR error
```

### Error Format

Validation errors now provide detailed information:

```
failed to unmarshal task 'httpTask' config: validation failed: 
validation failed for task '' (): 
  field 'timeout_seconds' value must be greater than or equal to 1 
  and less than or equal to 300
```

## Files Changed

```
M backend/services/workflow-runner/pkg/validation/unmarshal.go
M backend/services/workflow-runner/pkg/converter/integration_test.go
M backend/services/workflow-runner/pkg/converter/proto_to_yaml_test.go
```

## Why This Matters

The workflow runner processes user-defined workflow configurations. Without validation at unmarshal time:

1. **Silent failures** - Invalid configs could reach the workflow engine and fail mysteriously
2. **Poor user experience** - Errors occur during execution instead of at configuration time
3. **Security risk** - Constraints (like timeouts) could be bypassed
4. **Debug difficulty** - Hard to trace why a workflow fails when config was never validated

Now validation happens **early and explicitly**, providing clear feedback to users about configuration problems before workflow execution begins.

## Related Code

- `ValidateTaskConfig()` - Performs protovalidate validation (already existed)
- `ValidateTask()` - Convenience function that combines unmarshal + validate (already existed)
- Converter's `convertTask()` - Calls `UnmarshalTaskConfig` (now gets validation automatically)

## Follow-up Considerations

None - This is a complete fix. The validation pattern is now properly integrated into the unmarshal flow.

## Lessons Learned

1. **Validation should be explicit** - Having a `ValidateTaskConfig` function available isn't enough if it's not called
2. **Test quality matters** - Tests revealed the gap by expecting validation that wasn't happening
3. **Proto constraints need enforcement** - Proto validation rules (`buf.validate`) are only effective when actually invoked
4. **Fail fast** - Validation at unmarshal time (early) is better than validation at execution time (late)
