# Checkpoint: All Workflow E2E Tests Fixed

**Date**: 2026-01-23 04:32  
**Project**: 20260123.01.standardize-cli-apply-output  
**Phase**: Testing & Validation  
**Type**: Critical Bug Fix

## Context

While running E2E tests to validate the CLI apply tabular output feature, discovered that all 8 workflow-related E2E tests were failing. This represented a critical bug in the SDK's `StringRef` value resolution that affected all workflow operations.

## Problem Discovered

**Symptom**: All workflow tests failing with validation error:
```
field 'endpoint' value is required
```

**Root Cause**: SDK's `coerceToString()` function was calling `Expression()` on `StringRef` objects, which returned empty strings for resolved values instead of the actual string values. This caused workflow HTTP tasks to have empty endpoint URLs.

**Impact**:
- Workflows couldn't be deployed (validation failure)
- All workflow apply operations broken
- All workflow run operations broken
- 8 E2E tests failing

## Solution Implemented

Applied three targeted fixes:

### 1. Core Fix: SDK StringRef Value Resolution

**File**: `sdk/go/workflow/set_options.go`

Changed `coerceToString()` to check if `Ref` implements `StringValue` interface and use the actual resolved value:

```go
case Ref:
    // Check if this Ref has a resolved value (StringValue interface)
    if stringVal, ok := v.(interface{ Value() string }); ok {
        return stringVal.Value()  // Use resolved value for synthesis
    }
    return v.Expression()  // Fallback for runtime-only refs
```

**Why This Worked**: `StringRef.Concat()` creates resolved values when all parts are known at synthesis time, but stores the value with an empty `name` field. Calling `Expression()` on this returned empty string. The fix uses the `Value()` method to get the actual resolved string.

### 2. CLI Workflow Name Consistency

**File**: `client-apps/cli/cmd/stigmer/root/apply.go`

Fixed workflow discovery output to use `wf.Metadata.Name` instead of `wf.Spec.Document.Name`, making it consistent with agent handling.

### 3. Error Exit Code

**File**: `client-apps/cli/cmd/stigmer/root/run.go`

Added `os.Exit(1)` when resource not found, so CLI properly returns error exit code.

## Test Results

**Before**:
- 8 workflow tests failing
- 7 agent tests passing

**After**:
- All 15 tests passing (1 skipped)
- Test duration: 27.37s
- Zero failures

## Technical Insights

### StringRef Architecture

The SDK distinguishes between:
1. **Synthesis-time values** - Known when building workflow (use `Value()`)
2. **Runtime-only values** - Only available during execution (use `Expression()`)

The bug was treating synthesis-time values as runtime-only expressions.

### Smart Resolution in Concat()

When `StringRef.Concat()` detects all parts are known values (not runtime expressions), it:
1. Computes the concatenated result immediately
2. Stores it as a resolved value
3. Sets `name` to empty (not a context variable)
4. Returns a `StringRef` with the resolved value

This is called "SMART RESOLUTION" in the SDK comments - it optimizes away unnecessary runtime expression evaluation.

## Impact

**Immediate**:
- ✅ All workflow operations now work
- ✅ HTTP tasks with context URLs work correctly
- ✅ E2E test suite fully passing

**Long-term**:
- ✅ SDK `StringRef` value resolution properly tested
- ✅ Workflow functionality validated end-to-end
- ✅ Foundation for future workflow features

## Files Changed

```
M client-apps/cli/cmd/stigmer/root/apply.go
M client-apps/cli/cmd/stigmer/root/run.go
M sdk/go/workflow/set_options.go
```

## Lessons Learned

1. **Test First**: Running E2E tests immediately revealed critical bug
2. **Root Cause Analysis**: Focused on finding core issue (StringRef resolution) vs fixing symptoms
3. **Minimal Changes**: Three targeted fixes, each addressing specific aspect
4. **SDK Architecture**: Better understanding of synthesis vs runtime value handling

## Documentation

**Changelog**: `_changelog/2026-01/2026-01-23-043227-fix-workflow-e2e-tests.md`

## Next Steps

None required. Bug fully resolved. All tests passing. Ready for production use.

## Related

This bug fix was discovered while validating the tabular output feature but represents independent critical functionality fix.
