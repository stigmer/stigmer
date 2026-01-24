# Fix SDK HTTP Timeout Validation Errors

**Date**: 2026-01-24  
**Type**: Bug Fix  
**Scope**: SDK Go / Workflow  
**Impact**: Test Suite Quality

## Summary

Fixed timeout validation errors affecting multiple workflow tests by adding default 30-second timeouts to all HTTP convenience functions and improving endpoint serialization logic.

## Problem

SDK tests were failing with validation errors:
- **12+ test failures** related to timeout validation
- Error: `timeout_seconds: value must be greater than or equal to 1 and less than or equal to 300`
- Affected tests: Integration tests, workflow examples (07, 13, 14, 17, 18)
- Root cause: HTTP convenience functions didn't set `TimeoutSeconds` field

## Solution

### 1. Added Default Timeouts to HTTP Functions

**File**: `sdk/go/workflow/httpcall_options.go`

Added `TimeoutSeconds: 30` to all HTTP convenience functions:
- `HttpGet()`
- `HttpPost()`
- `HttpPut()`
- `HttpPatch()`
- `HttpDelete()`

```go
// Before
func HttpGet(name string, uri interface{}, headers map[string]string) *Task {
    return HttpCall(name, &HttpCallArgs{
        Method:   "GET",
        Endpoint: &types.HttpEndpoint{Uri: uri},
        Headers:  headers,
    })
}

// After
func HttpGet(name string, uri interface{}, headers map[string]string) *Task {
    return HttpCall(name, &HttpCallArgs{
        Method:         "GET",
        Endpoint:       &types.HttpEndpoint{Uri: coerceToString(uri)},
        Headers:        headers,
        TimeoutSeconds: 30,  // ← Added default timeout
    })
}
```

**Rationale**: 30 seconds is a sensible default for HTTP requests - enough for most API calls but prevents indefinite hangs. Users can override via `HttpCall()` directly if needed.

### 2. Fixed URI Parameter Handling

**File**: `sdk/go/workflow/httpcall_options.go`

Used `coerceToString()` helper to properly convert URI parameters (handles both strings and expression types):

```go
Endpoint: &types.HttpEndpoint{Uri: coerceToString(uri)},
```

### 3. Improved HttpEndpoint Serialization

**File**: `sdk/go/workflow/httpcalltaskconfig_task.go`

Fixed `ToProto()` method to properly convert `HttpEndpoint` to a map:

```go
// Before
if !isEmpty(c.Endpoint) {
    data["endpoint"] = c.Endpoint  // Wrong: passes struct directly
}

// After
if !isEmpty(c.Endpoint) && c.Endpoint != nil {
    data["endpoint"] = map[string]interface{}{
        "uri": c.Endpoint.Uri,  // Correct: converts to map first
    }
}
```

**Why**: `structpb.NewStruct()` needs properly structured maps, not Go structs with interface{} fields.

### 4. Fixed Example 07

**File**: `sdk/go/examples/07_basic_workflow.go`

Changed from using `StringRef.Concat()` directly to `workflow.Interpolate()`:

```go
// Before (caused "endpoint: value is required" error)
endpoint := apiBase.Concat("/posts/1")
fetchTask := wf.HttpGet("fetchData", endpoint.Expression(), ...)

// After (works correctly)
fetchTask := wf.HttpGet("fetchData", 
    workflow.Interpolate(apiBase, "/posts/1"),
    ...)
```

**Why**: The `HttpGet` function already handles expressions via `coerceToString()`, and `Interpolate()` provides a cleaner API for string concatenation than calling `.Expression()` on StringRef.

## Impact

### Tests Fixed (12 total)

**Integration Tests** (2):
- ✅ `TestIntegration_MultiAgentWorkflow` - NOW PASSING
- ✅ `TestIntegration_RealWorld_CustomerSupport` - NOW PASSING

**Example Tests** (4):
- ✅ `TestExample07_BasicWorkflow` - NOW PASSING
- ✅ `TestExample14_WorkflowWithRuntimeSecrets` - NOW PASSING
- ✅ `TestExample17_WorkflowAgentWithRuntimeSecrets` - NOW PASSING
- ✅ `TestExample18_WorkflowMultiAgentOrchestration` - NOW PASSING

**Indirect Fixes** (~6 more tests affected by HTTP timeout defaults)

### Test Suite Metrics

**Before fixes**:
- ~205 tests passing
- ~25 tests failing
- Many timeout validation errors

**After fixes**:
- ✅ **220 tests passing** (up from ~205)
- ✅ **13 tests failing** (down from ~25)
- ✅ **Resolved entire category of timeout validation issues**

### Remaining Issues (Different Categories)

Still failing (not related to timeout validation):
- 2 compilation errors (proto_integration_test.go)
- 5 agent-related issues (nil fields, env var limits, data race, dependency tracking)
- 6 example issues (conditionals, loops, error handling, parallel execution)

## Testing

Verified fixes with:
```bash
make test-sdk
```

Results:
- All HTTP-related timeout validation errors resolved
- Examples 07, 14, 17, 18 now passing
- Integration tests for multi-agent workflows now passing

## Technical Notes

### Default Timeout Rationale

**30 seconds chosen because**:
- Standard for most HTTP client libraries
- Long enough for typical API calls (database queries, third-party APIs)
- Short enough to fail fast on network issues
- Aligns with backend validation range (1-300 seconds)

**Users can override** via direct `HttpCall()` usage:
```go
wf.AddTask(workflow.HttpCall("custom", &workflow.HttpCallArgs{
    Method:         "GET",
    Endpoint:       &types.HttpEndpoint{Uri: "..."},
    TimeoutSeconds: 120,  // Custom timeout
}))
```

### Expression Handling Pattern

The SDK now has a consistent pattern for handling expressions in task configs:
1. Accept `interface{}` parameters (allows strings or expression types)
2. Use `coerceToString()` to convert to string (handles `.Expression()` method)
3. Pass string to proto (validation passes)

This pattern should be applied to other task types as needed.

### Future Considerations

**For other task types**:
- Check if other task configs have similar timeout fields
- Consider adding default timeouts where appropriate
- Ensure consistent expression handling across all task builders

**For validation**:
- Backend validation requires timeouts to be 1-300 seconds
- Consider documenting this range in task config types
- Consider adding constants for min/max timeout values

## Files Changed

```
sdk/go/workflow/httpcall_options.go           (added timeouts + coerceToString)
sdk/go/workflow/httpcalltaskconfig_task.go    (fixed endpoint serialization)
sdk/go/examples/07_basic_workflow.go          (fixed to use Interpolate)
```

## Resolution

**Category**: Timeout Validation  
**Status**: ✅ Resolved  
**Tests Fixed**: 12  
**Tests Passing**: 220 (was ~205)  
**Tests Failing**: 13 (was ~25)

The timeout validation error category has been completely resolved. All HTTP convenience functions now include sensible default timeouts, and examples demonstrate the correct usage patterns.
