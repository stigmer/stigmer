# Learning Log: Compile-Time Variable Resolution

**Date**: January 17, 2026  
**Feature**: Move context variable resolution from runtime to compile-time  
**Status**: ✅ Complete

---

## What Changed

Refactored the SDK to resolve `ctx.SetString()`, `ctx.SetInt()`, etc. variables at **synthesis time** instead of **runtime**.

### Before (Runtime Resolution)
1. SDK created `__stigmer_init_context` SET task with all context variables
2. User tasks used `${ $context.variableName }` JQ expressions
3. Workflow runner resolved variables during execution

### After (Compile-Time Resolution)
1. SDK stores variables in memory during context creation
2. During synthesis, `${variableName}` placeholders are replaced with actual values
3. No SET task generated - values baked directly into task configurations

---

## Implementation

### Files Created

**1. `internal/synth/interpolator.go`** - Variable interpolation logic
- `InterpolateVariables()`: Main entry point for interpolating variables in task configs
- `replaceVariablePlaceholders()`: Two-pass regex replacement
  - Pass 1: Complete value placeholders (`"${var}"`) - preserves types
  - Pass 2: Partial string placeholders (`${var}`) - unwraps string quotes

**2. `internal/synth/interpolator_test.go`** - Comprehensive tests
- String, int, bool, object, array interpolation
- Complete value vs partial string replacement
- Nested objects, special characters, missing variables
- All 12 test cases passing ✅

### Files Modified

**1. `internal/synth/workflow_converter.go`**
- `workflowSpecToProtoWithContext()`: Removed SET task injection logic
- `taskToProtoWithInterpolation()`: New function applying interpolation
- `taskToProto()`: Updated to call `taskToProtoWithInterpolation()`
- `createContextInitTask()`: Deprecated with error message

**2. `stigmer/context.go`**
- Updated documentation for `SetString()`, `SetInt()`, `SetBool()`, `SetSecret()`, `SetObject()`
- Clarified that variables are resolved at synthesis time, not runtime

**3. `stigmer/refs.go`**
- Updated `Ref` interface documentation
- Clarified distinction between compile-time (`${var}`) and runtime (`${ $context.var }`) resolution

### Documentation

**1. `COMPILE_TIME_VARIABLES.md`** - Comprehensive feature documentation
- Summary of the change
- How it works (architecture)
- Interpolation rules and examples
- Benefits (simpler manifests, faster execution, easier debugging)
- Migration guide
- Runtime vs compile-time variable comparison
- Limitations and future enhancements

---

## Key Learnings

### 1. Two-Pass Interpolation Strategy

**Challenge**: How to handle both complete value replacement and partial string replacement?

**Solution**: Two-pass regex approach:
```go
// Pass 1: Complete values - preserves types
"${retries}" → 3 (number, not "3")
"${enabled}" → true (bool, not "true")
"${config}" → {"host": "localhost"} (object)

// Pass 2: Partial strings - unwraps quotes
"${baseURL}/users" → "https://api.example.com/users"
```

**Why it works**:
- First pass catches standalone placeholders and preserves JSON types
- Second pass handles placeholders embedded in strings
- Order matters: must do complete values first

### 2. JSON Marshaling for Type Preservation

**Challenge**: How to ensure numbers stay numbers, bools stay bools when interpolating?

**Solution**: Use `json.Marshal()` for all values, then conditionally unwrap:
```go
valueJSON, _ := json.Marshal(value)
// For complete values: return as-is
// For partial strings: unwrap quotes if string
```

**Why it works**:
- `json.Marshal()` handles all Go types correctly
- Preserves JSON structure for objects and arrays
- Handles special characters and escaping automatically

### 3. Context Variable Storage Pattern

**Insight**: The existing `Ref` interface already had everything needed:
- `ToValue()` provides the actual value for synthesis
- `Expression()` generates JQ expressions for runtime (still needed for task outputs)
- No changes needed to context storage - just how we use it

**Realization**: The refactor was mostly about **when** we resolve variables, not **how** we store them.

### 4. Regex Patterns for Placeholders

**Complete value placeholder**: `"\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}"`
- Must be quoted
- Must be the entire value
- Preserves type

**Partial string placeholder**: `\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}`
- Can appear anywhere in string
- Unwraps string quotes
- Always produces string result

### 5. Deprecation Pattern for Old Code

Instead of deleting `createContextInitTask()`, we deprecated it with a clear error:
```go
func createContextInitTask(...) (*Task, error) {
    return nil, fmt.Errorf("createContextInitTask is deprecated - use compile-time interpolation instead")
}
```

**Why**: Makes it explicit if old code paths are accidentally triggered.

---

## Testing Strategy

### Unit Tests (interpolator_test.go)

**What we tested**:
1. String values (simple and with URLs)
2. Integer values (preserving number type)
3. Boolean values (preserving bool type)
4. Object values (nested structures)
5. Array values (slices)
6. Multiple variables in one config
7. Nested objects (endpoint > uri, headers > Authorization)
8. No variables (passthrough)
9. Empty context (no-op)
10. Missing variables (error handling)
11. Partial replacement (URL construction)
12. Special characters (passwords, query params)

**Result**: 12/12 tests passing ✅

### Integration Approach

No integration tests yet, but the path forward:
1. Create a workflow with context variables
2. Call `stigmer.Run()` to synthesize
3. Parse the generated `workflow-manifest.pb`
4. Verify:
   - No `__stigmer_init_context` task
   - Variables interpolated in task configs
   - Types preserved correctly

---

## Challenges & Solutions

### Challenge 1: Double-Quoted Strings

**Problem**: `"${baseURL}"` was becoming `""https://api.example.com""` (double-quoted)

**Root Cause**: Replacing the entire placeholder including quotes with JSON-marshaled value (which adds its own quotes)

**Solution**: Two-pass approach - match complete values first, then partial strings

### Challenge 2: Type Preservation

**Problem**: `"${retries}"` was becoming `"3"` (string) instead of `3` (number)

**Root Cause**: Simple string replacement doesn't understand JSON types

**Solution**: 
- Detect complete value placeholders
- Use `json.Marshal()` to get proper JSON representation
- Return as-is (preserving type)

### Challenge 3: Mixed Compile-Time and Runtime Variables

**Problem**: How to support both `${apiURL}` (compile-time) and `${ $context.userId }` (runtime)?

**Solution**: 
- `${variableName}` → compile-time (simple placeholder)
- `${ $context.fieldName }` → runtime (JQ expression with space after `${`)
- Different patterns, no conflicts

---

## Architecture Insights

### Separation of Concerns

The refactor reinforced good separation:

1. **Context (`stigmer/context.go`)**: Variable storage and lifecycle
2. **Refs (`stigmer/refs.go`)**: Type-safe variable references
3. **Interpolator (`internal/synth/interpolator.go`)**: Compile-time resolution
4. **Converter (`internal/synth/workflow_converter.go`)**: Manifest generation

Each layer has a clear responsibility.

### Pulumi-Style Pattern

This change aligns with Pulumi's approach:
- Variables defined in code (`ctx.SetString()`)
- Resolved at "deployment" time (synthesis)
- Output manifests are deterministic and debuggable

**Key difference**: Pulumi has `Output<T>` for async/computed values. We might need something similar for runtime task outputs in the future.

---

## Future Enhancements

### 1. Variable Validation

Add compile-time validation:
```go
// Detect unused variables
// Detect missing variables (referenced but not defined)
// Type checking (warn if using string where number expected)
```

### 2. Variable Dependencies

Support variables referencing other variables:
```go
baseURL := ctx.SetString("baseURL", "https://api.example.com")
fullURL := ctx.SetString("fullURL", "${baseURL}/users")  // Resolve baseURL first
```

### 3. Secret Masking

Hide secret values in debug output and manifests:
```yaml
task_config:
  headers:
    Authorization: "Bearer ***REDACTED***"  # Don't expose secrets
```

### 4. Runtime Variable Bridge

Bridge between compile-time and runtime variables:
```go
// Use task output as compile-time variable for subsequent synthesis
userId := fetchUser.Field("id")
ctx.SetString("currentUserId", userId.Value())  // Wait for task execution?
```

This would require async synthesis or multi-stage compilation.

---

## Code Quality

### Strengths

✅ Comprehensive test coverage (12 test cases)  
✅ Clear separation of concerns  
✅ Well-documented code with examples  
✅ Deprecation handling for old code paths  
✅ Type safety preserved throughout  

### Areas for Improvement

🔸 Add integration tests with actual workflow synthesis  
🔸 Add benchmarks for interpolation performance  
🔸 Consider adding variable validation/linting  
🔸 Document limitations more prominently  

---

## Metrics

**Lines of Code**:
- New: ~180 (interpolator.go + tests)
- Modified: ~50 (context.go, refs.go, workflow_converter.go docs)
- Total: ~230 lines

**Test Coverage**:
- Interpolator: 12 test cases, all passing
- Integration: None yet (manual testing needed)

**Performance**:
- No benchmarks yet
- Expected improvement: No runtime SET task + JQ evaluation

**Documentation**:
- `COMPILE_TIME_VARIABLES.md`: Comprehensive guide (400+ lines)
- Inline code comments: Updated throughout
- Learning log: This document

---

## Conclusion

This refactor successfully moved variable resolution from runtime to compile-time, aligning the SDK with infrastructure-as-code best practices. The implementation is clean, well-tested, and maintains backward compatibility from a user perspective (same API, different behavior).

**Key Takeaway**: Sometimes the biggest architectural improvements don't require changing APIs - just changing **when** things happen.

---

**Next Steps**:
1. ✅ Implement interpolation logic
2. ✅ Update synthesis pipeline
3. ✅ Add comprehensive tests
4. ✅ Document the change
5. ⏭️ Add integration tests
6. ⏭️ Update examples to showcase compile-time variables
7. ⏭️ Consider variable validation tooling

**Status**: Ready for review and merge 🚀
