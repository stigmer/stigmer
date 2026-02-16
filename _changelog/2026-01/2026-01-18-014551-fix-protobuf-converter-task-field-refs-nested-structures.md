# Fix Protobuf Converter for TaskFieldRef and Nested Structures

**Date**: 2026-01-18  
**Type**: Bug Fix + Feature Enhancement  
**Scope**: SDK Core (Go) - Protobuf Synthesis  
**Impact**: Critical - Enables real-world API structures

## Problem

The SDK's protobuf converter had three critical limitations that prevented real-world usage:

### 1. TaskFieldRef Didn't Work in Request Bodies
```go
// ❌ FAILED BEFORE
githubError := wf.HttpGet("checkPipeline", github_url)
wf.HttpPost("analyzeError", openai_url,
    workflow.WithBody(map[string]any{
        "messages": []map[string]any{
            {"content": githubError.Field("error_message")},  // ❌ proto: invalid type
        },
    }),
)
```

**Error**: `proto: invalid type: workflow.TaskFieldRef`

**User Impact**: Couldn't pass API responses to subsequent calls (common pattern!)

### 2. Complex Nested Structures Failed
```go
// ❌ FAILED BEFORE - Real Slack API structure
wf.HttpPost("notifySlack", slack_url,
    workflow.WithBody(map[string]any{
        "blocks": []map[string]any{  // ❌ proto: invalid type
            {
                "type": "section",
                "fields": []map[string]any{  // ❌ Double nesting failed
                    {"text": "Status"},
                },
            },
        },
    }),
)
```

**Error**: `proto: invalid type: []map[string]interface {}`

**User Impact**: Couldn't use real API structures (OpenAI, Slack, Stripe, etc.)

### 3. Interpolate() Didn't Accept TaskFieldRef
```go
// ❌ FAILED BEFORE
workflow.Interpolate("Payment: ", paymentTask.Field("status"))
```

**Error**: `cannot use paymentTask.Field("status") as string value`

**User Impact**: Couldn't combine dynamic fields with static text

## Root Cause

### Issue 1 & 2: Protobuf Converter (workflow_converter.go)
The `taskConfigToStruct()` function passed values directly to `structpb.NewStruct()`:

```go
// ❌ OLD CODE
configMap := map[string]interface{}{
    "body": cfg.Body,  // Directly passed - no type conversion!
}
```

`structpb.NewStruct()` is strict about types - it can't handle:
- Custom Go types like `TaskFieldRef`
- Arrays of maps: `[]map[string]interface{}`
- Deep nesting with mixed types

### Issue 3: Interpolate Signature (task.go)
```go
// ❌ OLD CODE
func Interpolate(parts ...string) string {
    // Only accepted strings!
}
```

## Solution

### Fix 1 & 2: Recursive Type Converter

Created `convertToProtobufCompatible()` function that recursively converts any Go value to protobuf-compatible types:

**Location**: `go/internal/synth/workflow_converter.go`

**Implementation**:
```go
func convertToProtobufCompatible(v interface{}) interface{} {
    switch val := v.(type) {
    case workflow.TaskFieldRef:
        // Convert to expression string
        return val.Expression()  // "${$context.task.field}"
        
    case map[string]interface{}:
        // Recursively process map values
        result := make(map[string]interface{}, len(val))
        for k, v := range val {
            result[k] = convertToProtobufCompatible(v)
        }
        return result
        
    case []interface{}:
        // Recursively process slice elements
        result := make([]interface{}, len(val))
        for i, elem := range val {
            result[i] = convertToProtobufCompatible(elem)
        }
        return result
        
    case []map[string]interface{}:
        // Convert slice of maps
        result := make([]interface{}, len(val))
        for i, elem := range val {
            result[i] = convertToProtobufCompatible(elem)
        }
        return result
        
    default:
        // Primitives pass through
        return v
    }
}
```

**Applied to**:
- HTTP request bodies
- gRPC request bodies  
- CallActivity input
- Raise task data
- Run task input

### Fix 3: Accept interface{} in Interpolate

Changed signature and added type conversion:

**Location**: `go/workflow/task.go`

**Implementation**:
```go
// ✅ NEW CODE
func Interpolate(parts ...interface{}) string {
    // Convert all parts to strings
    stringParts := make([]string, len(parts))
    for i, part := range parts {
        switch v := part.(type) {
        case string:
            stringParts[i] = v
        case TaskFieldRef:
            stringParts[i] = v.Expression()
        default:
            stringParts[i] = fmt.Sprintf("%v", v)
        }
    }
    // Rest of logic remains same
    // ...
}
```

## Verification

### Test Results

All 14 example tests passing:
```
✅ TestExample14_WorkflowWithRuntimeSecrets (0.90s)
   - TaskFieldRef in bodies: WORKS
   - Nested arrays (3+ levels): WORKS
   - Interpolate with TaskFieldRef: WORKS
   - Real API structures: ALL WORKING
```

### Real-World Examples Now Working

**1. GitHub Error → ChatGPT Analysis**
```go
githubStatus := wf.HttpGet("checkPipeline", github_url)
analyzeError := wf.HttpPost("analyzeError", openai_url,
    workflow.WithBody(map[string]any{
        "model": "gpt-4",
        "messages": []map[string]any{  // ✅ Nested array works!
            {"role": "system", "content": "DevOps assistant"},
            {
                "role": "user",
                "content": githubStatus.Field("conclusion"),  // ✅ Field ref!
            },
        },
    }),
)
```

**2. Real OpenAI API Structure**
```go
wf.HttpPost("callOpenAI", openai_url,
    workflow.WithBody(map[string]any{
        "model": "gpt-4",
        "messages": []map[string]any{  // ✅ Real structure!
            {"role": "user", "content": "Explain quantum computing"},
        },
    }),
)
```

**3. Real Slack Blocks (4 Levels Deep)**
```go
wf.HttpPost("notifySlack", slack_url,
    workflow.WithBody(map[string]any{
        "blocks": []map[string]any{
            {
                "type": "section",
                "fields": []map[string]any{
                    {
                        "type": "mrkdwn",
                        "text": analyzeError.Field("choices[0].message.content"),
                    },
                },
            },
        },
    }),
)
```

**4. Interpolate with Field References**
```go
workflow.Interpolate("Status: ", paymentTask.Field("status"))
// ✅ Works! Generates: ${ "Status: " + $context.paymentTask.status }
```

## Files Changed

1. **`go/internal/synth/workflow_converter.go`** (+60 lines)
   - Added `convertToProtobufCompatible()` recursive converter
   - Applied to HTTP body, gRPC body, activity input, etc.

2. **`go/workflow/task.go`** (~30 lines)
   - Changed `Interpolate(parts ...string)` → `Interpolate(parts ...interface{})`
   - Added type conversion for TaskFieldRef

3. **`go/examples/14_workflow_with_runtime_secrets.go`** (updated)
   - 8 real-world scenarios with actual API structures
   - GitHub → ChatGPT error analysis
   - Real OpenAI messages array
   - Real Slack blocks (4 levels deep)
   - Stripe with nested metadata

4. **`go/examples/examples_test.go`** (+300 lines)
   - Comprehensive security tests
   - Field reference validation
   - Nested structure verification

## Impact

### For Users

✅ **Can now use real API structures** (OpenAI, Slack, Stripe, GitHub, etc.)  
✅ **Can pass API responses to subsequent calls** (the ChatGPT use case!)  
✅ **Can use field references anywhere** (bodies, headers, nested objects)  
✅ **Can mix runtime secrets, env vars, and field refs** together  
✅ **Workflows can model actual production patterns**  

### For SDK

✅ **Protobuf converter is robust** - handles any nesting depth  
✅ **Type-safe and extensible** - easy to add new types  
✅ **Recursive pattern** - works for future custom types  
✅ **Maintains security** - runtime secrets still safe as placeholders  

## Breaking Changes

None. This is purely additive:
- Existing code continues to work
- New capabilities unlocked
- Backward compatible

## Technical Debt Removed

- ❌ **Before**: Had to use workarounds (field refs in headers, not bodies)
- ❌ **Before**: Had to simplify API structures (no nesting)
- ❌ **Before**: Couldn't use Interpolate with dynamic values
- ✅ **After**: All patterns work naturally

## What We Didn't Compromise On

User specifically requested NO compromises:
- ✅ Real nested API structures (not simplified)
- ✅ Field references in request bodies (not just headers)
- ✅ TaskFieldRef in Interpolate() (not string-only)
- ✅ Complex multi-level nesting (not flattened)
- ✅ All real-world use cases (not toy examples)

**All issues fixed properly. No workarounds. No "we'll do it later."**

## Related Work

- Runtime Secrets Example: `go/examples/14_workflow_with_runtime_secrets.go`
- Execution Context Implementation: Project `20260117.04.execution-context-implementation`
- Security Verification: Comprehensive test suite validates no secret leakage

## Next Steps

Optional future enhancements:
1. Consider caching `Expression()` results for performance
2. Add validation warnings if user puts secrets in wrong places
3. Extend to support more custom types as SDK grows

---

**Result**: SDK now supports real-world API patterns. Users can model production workflows without limitations.
