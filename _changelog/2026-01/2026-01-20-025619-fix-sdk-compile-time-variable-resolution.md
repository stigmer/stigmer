# Fix: SDK Compile-Time Variable Resolution

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: SDK (Go)  
**Impact**: Critical - Fixes incorrect runtime expression generation

---

## Summary

Fixed a critical bug in the Stigmer SDK where context variables with known values were being treated as runtime expressions instead of being resolved at compile-time during synthesis. This caused resolved URLs, configuration values, and other compile-time known strings to appear as empty expressions in generated workflow manifests.

## Problem

When using context variables in the SDK:

```go
ctx := stigmer.NewContext()
apiURL := ctx.SetString("apiURL", "https://api.example.com")
endpoint := apiURL.Concat("/users")  // Should resolve to "https://api.example.com/users"
```

**Expected Behavior** (documented):
- Context variables with known values resolve at compile-time
- `.Concat()` on known values produces the final string
- Workflow manifest contains: `"https://api.example.com/users"`

**Actual Behavior** (broken):
- Context variables treated as runtime references
- `.Concat()` generated runtime JQ expressions
- Workflow manifest contained empty strings or malformed expressions

**Test Failures**:
- `TestExample07_BasicWorkflow` - URL resolution returned empty string
- `TestCompileTimeVariableResolution` - Expected resolved URL, got empty string

## Root Cause

**Issue 1**: `StringRef.Concat()` logic incorrectly identified "known" values

```go
// ❌ WRONG: Only unnamed literals were considered "known"
allKnown := !s.isComputed && s.name == ""

// This meant:
// - Literals (name == "") → known ✅
// - Context variables (name != "") → unknown ❌ WRONG
```

**Issue 2**: `toExpression()` type check order prioritized `Ref` interface over `StringValue` interface

```go
// ❌ WRONG ORDER: Ref checked before StringValue
case Ref:
    return v.Expression()  // Returns empty string for resolved refs
case StringValue:
    return v.Value()       // Never reached for StringRef
```

Both context variables AND resolved literals implement `Ref` interface, but calling `Expression()` on a resolved StringRef (no name, no computed expression) returns an empty string.

## Solution

### Fix 1: Updated `StringRef.Concat()` Logic

Changed the "known" detection to include context variables with concrete values:

```go
// ✅ CORRECT: Non-computed refs (both literals and context vars) are known
allKnown := !s.isComputed

// This means:
// - Literals (name == "", isComputed = false) → known ✅
// - Context variables (name != "", isComputed = false) → known ✅
// - Computed expressions (isComputed = true) → unknown ✅
```

**File**: `sdk/go/stigmer/refs.go`

**Rationale**: Context variables created via `ctx.SetString()` have concrete values known at synthesis time. Only computed expressions (like task field references) should remain unresolved.

### Fix 2: Reordered Type Checks in `toExpression()`

Moved value interface checks before `Ref` interface check:

```go
// ✅ CORRECT ORDER: Check value interfaces first
case StringValue:
    return v.Value()       // Returns the actual value
case IntValue:
    return fmt.Sprintf("%d", v.Value())
case BoolValue:
    return fmt.Sprintf("%t", v.Value())
case Ref:
    return v.Expression()  // Only for runtime references (TaskFieldRef, etc.)
```

**File**: `sdk/go/workflow/ref_helpers.go`

**Rationale**: This allows resolved StringRefs to return their actual values instead of calling `Expression()` which returns empty strings for resolved literals.

## Files Changed

**Core SDK Fixes**:
- `sdk/go/stigmer/refs.go` - Fixed `StringRef.Concat()` compile-time resolution logic
- `sdk/go/workflow/ref_helpers.go` - Reordered type checks in `toExpression()`

**Test Updates** (11 tests updated to match correct behavior):
- `sdk/go/workflow/ref_integration_test.go` - 9 tests updated
- `sdk/go/stigmer/refs_test.go` - 2 tests updated  
- `sdk/go/stigmer/context_test.go` - 1 test updated

## Test Results

**Before Fix**:
- `TestExample07_BasicWorkflow` - ❌ FAIL (URI value: "")
- `TestCompileTimeVariableResolution` - ❌ FAIL (URI value: "")
- 9 integration tests - ❌ FAIL (expected runtime expressions, got values)

**After Fix**:
- `TestExample07_BasicWorkflow` - ✅ PASS (URI: "https://jsonplaceholder.typicode.com/posts/1")
- `TestCompileTimeVariableResolution` - ✅ PASS (URI: "https://api.example.com/v1/users")  
- All SDK tests (1780+ tests) - ✅ PASS

## Impact

### User Impact

**Before**: Workflows with context variables wouldn't work correctly
```yaml
# Generated manifest (broken)
endpoint:
  uri: ""  # Empty string!
```

**After**: Context variables resolve properly
```yaml
# Generated manifest (fixed)
endpoint:
  uri: "https://api.example.com/users"  # Resolved!
```

### API Impact

✅ **No Breaking Changes** - The tests that failed were testing incorrect behavior. The fix aligns implementation with documented behavior:

> "The variable is resolved at synthesis time (compile-time) by interpolating ${variableName} placeholders in task configurations with the actual value."  
> — `sdk/go/stigmer/context.go` line 76

## Design Decisions

### Why Context Variables Should Resolve at Compile-Time

1. **Documented Behavior**: Context variables are explicitly documented as compile-time resolved
2. **Performance**: Avoid runtime JQ evaluation when values are already known
3. **Simplicity**: Users expect `apiURL.Concat("/users")` to produce the final string
4. **Distinction**: Separates compile-time values from runtime task outputs
   - Context variables (`ctx.SetString`) → Compile-time
   - Task field references (`task.Field()`) → Runtime

### Runtime vs Compile-Time References

**Compile-Time** (resolved during synthesis):
- Context variables: `ctx.SetString("apiURL", "https://api.example.com")`
- Literals: `"hello"`
- Concatenations of known values: `apiURL.Concat("/users")`

**Runtime** (evaluated during workflow execution):
- Task field references: `fetchTask.Field("title")`  
- Computed expressions: `baseURL.Concat(fetchTask.Field("path"))`

The fix ensures these are handled correctly by checking `isComputed` flag rather than just `name`.

## Testing

Verified comprehensive test coverage:
- ✅ Compile-time resolution with context variables
- ✅ Compile-time resolution with string concatenation
- ✅ Compile-time resolution with multiple parts
- ✅ Type preservation (numbers, booleans)
- ✅ Runtime secrets still work (placeholders preserved)
- ✅ Task field references still work (runtime JQ)
- ✅ All SDK examples pass
- ✅ All 1780+ SDK unit tests pass

## Migration

**No migration needed** - This is a bug fix that aligns implementation with documented behavior. Users who worked around the bug may need to remove workarounds, but normal usage now works as expected.

## Related

- **Issue**: Tests `TestExample07_BasicWorkflow` and `TestCompileTimeVariableResolution` were failing
- **Documentation**: SDK context variable documentation already stated correct compile-time behavior
- **Pattern**: Aligns with Pulumi-style compile-time variable interpolation pattern

---

**Conclusion**: Critical SDK bug fix that enables proper compile-time variable resolution as documented. All tests pass and workflow manifests now generate correctly with resolved values instead of empty strings.
