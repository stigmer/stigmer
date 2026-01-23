# Fix HTTP Task Timeout Validation in Workflow SDK Tests

**Date**: January 23, 2026

## Summary

Fixed test failures in the Workflow SDK by adding proper timeout values to HTTP task configurations. Two tests were failing due to missing `timeout_seconds` values, which violated proto validation constraints requiring values between 1-300 seconds.

## Problem Statement

Running `make test` revealed two failing tests in the `github.com/stigmer/stigmer/sdk/go/workflow` package:

### Pain Points

- `TestWorkflowToProto_AllTaskTypes` was failing with validation error: "timeout_seconds: value must be greater than or equal to 1 and less than or equal to 300"
- `TestWorkflowToProto_TaskExport` was failing with the same validation error
- HTTP task configurations were not setting `TimeoutSeconds`, causing the field to default to `0`
- Proto validation constraints (`buf.validate`) were correctly enforcing the 1-300 second range

## Solution

Added explicit `TimeoutSeconds: 30` values to all HTTP task configurations in the failing tests to satisfy proto validation constraints.

## Implementation Details

### Proto Validation Rules

Located in `apis/ai/stigmer/agentic/workflow/v1/tasks/http_call.proto`:

```proto
message HttpCallTaskConfig {
  // ... other fields ...
  
  // Request timeout in seconds (optional, default: 30).
  int32 timeout_seconds = 5 [(buf.validate.field).int32 = {
    gte: 1
    lte: 300
  }];
}
```

### Test Fixes

**File**: `sdk/go/workflow/proto_integration_test.go`

**1. TestWorkflowToProto_AllTaskTypes** (line ~217):
```go
// Before
{
    Name: "httpTask",
    Kind: TaskKindHttpCall,
    Config: &HttpCallTaskConfig{
        Method: "GET",
        URI:    "https://api.example.com",
    },
}

// After
{
    Name: "httpTask",
    Kind: TaskKindHttpCall,
    Config: &HttpCallTaskConfig{
        Method:         "GET",
        URI:            "https://api.example.com",
        TimeoutSeconds: 30,
    },
}
```

**2. TestWorkflowToProto_TaskExport** (line ~374):
```go
// Before
{
    Name: "task1",
    Kind: TaskKindHttpCall,
    Config: &HttpCallTaskConfig{
        Method: "GET",
        URI:    "https://api.example.com",
    },
    ExportAs: "${.}",
}

// After
{
    Name: "task1",
    Kind: TaskKindHttpCall,
    Config: &HttpCallTaskConfig{
        Method:         "GET",
        URI:            "https://api.example.com",
        TimeoutSeconds: 30,
    },
    ExportAs: "${.}",
}
```

## Benefits

- ✅ **TestWorkflowToProto_TaskExport** now passes completely
- ⚠️ **TestWorkflowToProto_AllTaskTypes** timeout error resolved (now reveals a different pre-existing Switch task schema issue)
- HTTP task examples in tests now demonstrate proper timeout configuration
- Tests align with proto validation constraints

## Validation Constraints Across Task Types

### HTTP Call Tasks
- **Range**: 1-300 seconds (5 minutes max)
- **Field**: `timeout_seconds`
- **Location**: `apis/ai/stigmer/agentic/workflow/v1/tasks/http_call.proto`

### Agent Call Tasks
- **Range**: 1-3600 seconds (1 hour max)
- **Field**: `timeout` (note: different name)
- **Location**: `apis/ai/stigmer/agentic/workflow/v1/tasks/agent_call.proto`

### GRPC Call Tasks
- **No timeout validation** currently defined

## Impact

### Test Suite
- Reduced test failures from 2 to 1 (50% reduction)
- Remaining failure unrelated to timeout validation

### Developer Experience
- Tests now use realistic timeout values (30 seconds)
- Clear example of how to properly configure HTTP tasks
- Proto validation working as designed to catch configuration errors early

## Remaining Issues

`TestWorkflowToProto_AllTaskTypes` now shows a different error:
```
failed to convert task switchTask: failed to unmarshal JSON to proto: 
proto: (line 1:12): unknown field "condition"
```

This is a **separate schema mismatch** between the SDK's Switch task structure (uses `"condition"`) and the proto definition (expects `"name"` and `"when"` fields). This pre-existed the timeout validation fix.

## Related Work

- Proto validation rules defined in `apis/ai/stigmer/agentic/workflow/v1/tasks/*.proto`
- Buf validate constraints ensuring proper configuration
- Workflow SDK test suite validation improvements

---

**Status**: ✅ Completed
**Files Modified**: 1
**Tests Fixed**: 1 fully passing, 1 partially fixed
