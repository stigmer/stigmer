# fix(sdk/stigmer): StringRef now properly converts to string in Interpolate()

**Date**: 2026-01-25  
**Type**: Bug Fix  
**Component**: SDK Go (`sdk/go/stigmer/refs.go`)  
**Impact**: Critical - Fixes workflow URI generation with context variables

## Problem

Example 07 (basic-workflow) was failing with malformed HTTP endpoint URIs when using `Interpolate()` with `StringRef` values from `ctx.SetString()`.

**Error observed**:
```yaml
uri: '&{{apiBase false false } https://api.github.com}/repos/stigmer/hello-stigmer/pulls/1'
```

**Expected**:
```yaml
uri: 'https://api.github.com/repos/stigmer/hello-stigmer/pulls/1'
```

Backend validation failed with:
```
failed to unmarshal Endpoint: data does not match any known schema
```

## Root Cause

The `Interpolate()` function uses `fmt.Sprint()` to convert parts to strings:

```go
func Interpolate(parts ...interface{}) string {
    result := ""
    for _, part := range parts {
        result += fmt.Sprint(part)  // ❌ Prints struct fields without String()
    }
    return result
}
```

`StringRef` did not implement the `fmt.Stringer` interface, so `fmt.Sprint()` printed the internal struct representation: `&{name isSecret isComputed rawExpression}` instead of the actual string value.

## Why This Was Exposed

Project 3 (Smart Expression Conversion - Jan 24) changed `HttpEndpoint.Uri` from `string` to `interface{}` to accept expressions. This was correct and intentional.

**Before**: Type system prevented passing `StringRef` to functions expecting `string`  
**After**: `interface{}` accepts `StringRef`, but malformed string reached backend

The bug existed in `Interpolate()` all along, but was masked by compile-time type checking.

## Solution

Added `String()` method to `StringRef` to implement `fmt.Stringer` interface:

```go
// String implements fmt.Stringer interface for StringRef.
// This allows StringRef to be used directly in string concatenation and fmt.Sprint().
// Returns the resolved string value.
func (s *StringRef) String() string {
	return s.value
}
```

Now `fmt.Sprint()` automatically calls `String()` on `StringRef` values, returning the actual string value instead of struct representation.

## Changes

**File**: `sdk/go/stigmer/refs.go`
- Added `String()` method to `StringRef` struct

## Impact

- ✅ **E2E tests pass**: Example 07 workflow compiles and synthesizes correctly
- ✅ **Import cycle avoided**: Solution doesn't introduce dependencies
- ✅ **Idiomatic Go**: Uses standard `fmt.Stringer` interface pattern
- ✅ **Defense in depth**: Works for ANY type with `String()` method
- ✅ **Backward compatible**: Existing code continues to work

## Testing

Verified that `Interpolate()` now correctly handles:
- String literals: `"https://api.github.com"`
- StringRef from context: `ctx.SetString("apiBase", "https://api.github.com")`
- Mixed interpolation: `Interpolate(apiBase, "/repos/", repoName, "/pulls")`

E2E test compilation now succeeds (previous import cycle error resolved).

## Related Work

- **Project 3** (Jan 24): Smart Expression Conversion - Changed `HttpEndpoint.Uri` to `interface{}`
- **ADR-012** (pending): Expression field handling across SDK

## Future Considerations

Other Ref types (`TaskFieldRef`, etc.) may benefit from implementing `String()` if they need to work with `fmt.Sprint()` or similar formatting functions.

---

**Size**: Medium (1 file, 1 method, but critical bug fix affecting all workflows using context interpolation)
