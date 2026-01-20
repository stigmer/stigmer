# Changelog: Bracket Notation Support for Task References

## Summary

Fixed jq parsing errors when task names contain hyphens by using bracket notation for task references in generated expressions.

## Problem

Task names with hyphens (e.g., `fetch-pr`, `analyze-pr`) caused jq parsing errors:

```
error: function not defined: pr/0
```

This happened because `$context.fetch-pr.field` was interpreted as:
- `fetch` (variable) minus `pr(...)` (function call)

## Solution

Changed `TaskFieldRef.Expression()` to use **bracket notation** for task names:

**Before:**
```
${ $context.fetch-pr.diff_url }  ❌ Breaks jq parser
```

**After:**
```
${ $context["fetch-pr"].diff_url }  ✅ Valid jq syntax
```

## Changes Made

### 1. SDK Core Change

**File:** `sdk/go/workflow/task.go`

```go
// Expression returns the JQ expression for this field reference.
func (r TaskFieldRef) Expression() string {
    // Use bracket notation for task name to support hyphens and special characters
    // Reference format: ${ $context["task-name"].fieldName }
    return fmt.Sprintf("${ $context[\"%s\"].%s }", r.taskName, r.fieldName)
}
```

**Impact:** All task field references now use bracket notation, supporting any valid string as a task name.

### 2. Test Updates

**File:** `sdk/go/workflow/task_test.go`

Updated test expectations to match new bracket notation format:
- `TestField_AutoExport`
- `TestField_MultipleCallsIdempotent`

### 3. New Test Coverage

**File:** `sdk/go/workflow/task_bracket_test.go` (new)

Added comprehensive tests for bracket notation with:
- Hyphens in task names
- Multiple hyphens
- Mixed hyphens and underscores
- Underscores only

### 4. Documentation

**File:** `sdk/go/workflow/BRACKET_NOTATION.md` (new)

Complete documentation covering:
- Problem explanation
- Solution rationale
- Comparison with alternatives
- Examples and best practices
- Migration guide

## User Impact

### No Breaking Changes

This is a **non-breaking change**:
- Existing code continues to work
- Task names with underscores still work
- Only the generated expression syntax changes (semantically equivalent)

### New Capability

Users can now use hyphens in task names:

```go
// ✅ Now works perfectly!
fetchPR := pipeline.HttpGet("fetch-pr", ...)
fetchDiff := pipeline.HttpGet("fetch-diff", 
    fetchPR.Field("diff_url").Expression(),
)
```

### Reverted User Workaround

The original `main.go` in `stigmer-project` had to use underscores:
```go
fetchPR := pipeline.HttpGet("fetch_pr", ...)  // Workaround
```

Now restored to use natural hyphens:
```go
fetchPR := pipeline.HttpGet("fetch-pr", ...)  // Natural!
```

## Testing

All tests pass:
```bash
cd sdk/go/workflow
go test -v
# PASS
```

Specific test suites:
- `TestField*` - Field reference tests
- `TestBracketNotation*` - New bracket notation tests with hyphens

User project tested successfully:
```bash
cd stigmer-project
go run main.go
# ✅ Resources synthesized successfully!
```

## Design Rationale

### Why Bracket Notation?

**Compared to enforcing naming restrictions:**
- ❌ `fetchPR := pipeline.HttpGet("fetch_pr", ...)` - Forces artificial restrictions
- ✅ `fetchPR := pipeline.HttpGet("fetch-pr", ...)` - Users choose their style

**Compared to auto-sanitization:**
- ❌ Internal name differs from display name - confusing
- ✅ Bracket notation handles any string - no surprises

**Follows industry patterns:**
- JSON/jq standard: `obj["key-with-hyphens"]` is well-established
- Pulumi pattern: Separate display names from programmatic references
- Kubernetes convention: Resources often use kebab-case

### Principle of Least Astonishment

Users shouldn't need to remember arbitrary naming restrictions when standard JSON/jq syntax provides a solution.

## Files Modified

1. `sdk/go/workflow/task.go` - Core Expression() implementation
2. `sdk/go/workflow/task_test.go` - Updated test expectations
3. `sdk/go/workflow/task_bracket_test.go` - New comprehensive tests (NEW)
4. `sdk/go/workflow/BRACKET_NOTATION.md` - Complete documentation (NEW)
5. `stigmer-project/main.go` - Restored natural hyphen usage

## Backwards Compatibility

✅ **Fully backwards compatible**

All existing workflows continue to work:
- Task names with underscores: `fetch_pr` ✅
- Task names with camelCase: `fetchPR` ✅
- Task names with hyphens: `fetch-pr` ✅ (now fixed!)

The generated expressions use different syntax but are semantically equivalent:
- Old: `${ $context.fetch_pr.field }` (dot notation)
- New: `${ $context["fetch_pr"].field }` (bracket notation)

Both are valid jq and produce the same result.

## Next Steps

1. ✅ SDK change implemented and tested
2. ✅ Tests updated and passing
3. ✅ Documentation created
4. 🔄 Consider updating:
   - SDK examples to showcase hyphen support
   - Template generator to use hyphens by default
   - Quick-start guides to mention naming flexibility

## Questions & Support

For issues or questions about this change:
- See `BRACKET_NOTATION.md` for detailed documentation
- Check test suite in `task_bracket_test.go` for examples
- Open GitHub issue if you encounter problems

---

**Change Type:** Enhancement / Bug Fix
**Impact:** Non-breaking
**Status:** ✅ Complete and Tested
