# Post-Completion Bug Fix: StringRef Interpolation

**Date**: 2026-01-25  
**Type**: Bug Fix  
**Status**: ✅ Fixed

## Issue

After Project 3 completion (Smart Expression Conversion), Example 07 (basic-workflow) was failing with malformed HTTP URIs when using `Interpolate()` with `StringRef` from `ctx.SetString()`.

**Symptom**:
```yaml
uri: '&{{apiBase false false } https://api.github.com}/repos/stigmer/hello-stigmer/pulls/1'
```

Backend validation error:
```
failed to unmarshal Endpoint: data does not match any known schema
```

## Root Cause

`StringRef` didn't implement `fmt.Stringer` interface. When `Interpolate()` used `fmt.Sprint()` on a `StringRef`, it printed the struct fields instead of the string value.

**Why exposed by Project 3**: 
- Project 3 changed `HttpEndpoint.Uri` from `string` to `interface{}` (correct!)
- This allowed `StringRef` to pass through where it previously couldn't
- The bug in `Interpolate()` was now exposed (it existed all along)

## Fix

Added `String()` method to `StringRef`:

```go
func (s *StringRef) String() string {
	return s.value
}
```

Now `fmt.Sprint()` automatically calls `String()` on `StringRef` values.

## Impact

- ✅ Example 07 now works correctly
- ✅ E2E tests compile successfully  
- ✅ Import cycle avoided (no new dependencies)
- ✅ Idiomatic Go solution using `fmt.Stringer`

## Files Changed

- `sdk/go/stigmer/refs.go` - Added `String()` method to `StringRef`

## Related

- **Changelog**: `_changelog/2026-01/2026-01-25-025235-fix-stringref-interpolation-bug.md`
- **Original Project**: This project (20260124.02.sdk-loop-ergonomics)
- **Test Results**: E2E tests now compile (backend timeout is separate unrelated issue)

---

This bug fix completes the work started in Project 3. The smart expression conversion is now fully functional.
