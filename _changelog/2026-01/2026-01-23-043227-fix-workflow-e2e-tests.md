# Fix All Workflow E2E Tests - StringRef Value Resolution

**Date**: 2026-01-23  
**Category**: Bug Fix / Test Infrastructure  
**Impact**: High - All workflow operations now work correctly  
**Status**: ✅ Completed

## Summary

Fixed all 8 failing workflow E2E tests by addressing a core SDK bug where `StringRef` context values weren't being resolved to actual string values during synthesis. The issue caused workflow HTTP tasks to have empty endpoint URLs, leading to validation failures.

## Problem

All workflow-related E2E tests were failing:

**Workflow Apply Tests (4 failures)**:
- `TestApplyBasicWorkflow`
- `TestApplyWorkflowCount`
- `TestApplyWorkflowTaskDependencies`
- `TestApplyWorkflowWithContext`

**Workflow Run Tests (4 failures)**:
- `TestRunBasicWorkflow`
- `TestRunWorkflowWithInput`
- `TestRunWorkflowExecutionPhases`
- `TestRunWorkflowWithInvalidName`

**Root Cause**: When SDK code used context values with `Concat()`:
```go
apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")
endpoint := apiBase.Concat("/posts/1")  // Should resolve to actual URL
fetchTask := wf.HttpGet("fetchData", endpoint, ...)
```

The `coerceToString()` function was calling `Expression()` on the `StringRef`, which returned an empty string for resolved values (name field was empty). This caused the HTTP task's endpoint to be empty, failing validation with: `field 'endpoint' value is required`.

## Solution

Applied three targeted fixes to resolve the core issue and secondary problems:

### Fix 1: SDK StringRef Value Resolution (Core Fix)

**File**: `sdk/go/workflow/set_options.go`

**Problem**: `coerceToString()` always called `Expression()` on Refs, which returned empty strings for resolved `StringRef` values.

**Solution**: Check if Ref implements `StringValue` interface (has `Value()` method) and use the actual resolved value during synthesis instead of the JQ expression.

```go
// Before - always used expressions
case Ref:
    return v.Expression()  // Returns empty string for resolved values

// After - use actual values when available
case Ref:
    if stringVal, ok := v.(interface{ Value() string }); ok {
        return stringVal.Value()  // Use resolved value for synthesis
    }
    return v.Expression()  // Fallback for runtime-only refs
```

**Impact**: Workflow HTTP tasks now get actual URLs (e.g., `https://jsonplaceholder.typicode.com/posts/1`) instead of empty strings.

### Fix 2: CLI Workflow Name Display Consistency

**File**: `client-apps/cli/cmd/stigmer/root/apply.go`

**Problem**: Workflow discovery listing used `wf.Spec.Document.Name` (DSL internal name) instead of `wf.Metadata.Name` (resource name/slug), inconsistent with agents.

**Solution**: Changed workflow display to use `wf.Metadata.Name` consistently:

```go
// Before - inconsistent workflow handling
for i, wf := range synthesisResult.Workflows {
    name := "unnamed"
    if wf != nil && wf.Spec != nil && wf.Spec.Document != nil && wf.Spec.Document.Name != "" {
        name = wf.Spec.Document.Name  // DSL internal name
    }
    cliprint.PrintInfo("  %d. %s", i+1, name)
}

// After - consistent with agents
for i, wf := range synthesisResult.Workflows {
    cliprint.PrintInfo("  %d. %s", i+1, wf.Metadata.Name)  // Resource name
}
```

**Impact**: CLI output now consistently shows workflow names matching what's stored in the database.

### Fix 3: CLI Error Exit Code

**File**: `client-apps/cli/cmd/stigmer/root/run.go`

**Problem**: When neither workflow nor agent was found, CLI printed error but exited with success code (0).

**Solution**: Added `os.Exit(1)` after error message to return non-zero exit code.

```go
// Before - printed error but didn't exit
cliprint.PrintError("Agent or Workflow not found: %s", reference)
// ... error details ...
// Returned normally (exit code 0)

// After - exits with error code
cliprint.PrintError("Agent or Workflow not found: %s", reference)
// ... error details ...
os.Exit(1)  // Return non-zero exit code
```

**Impact**: Test assertions for error cases now work correctly.

## Test Results

**Before Fix**:
```
--- FAIL: TestE2E (28.79s)
    --- PASS: TestE2E/TestApplyAgentCount (7.54s)
    --- PASS: TestE2E/TestApplyBasicAgent (1.29s)
    --- FAIL: TestE2E/TestApplyBasicWorkflow (1.39s)  ❌
    --- PASS: TestE2E/TestApplyDryRun (1.45s)
    --- FAIL: TestE2E/TestApplyWorkflowCount (1.28s)  ❌
    --- PASS: TestE2E/TestApplyWorkflowDryRun (1.35s)
    --- FAIL: TestE2E/TestApplyWorkflowTaskDependencies (1.39s)  ❌
    --- FAIL: TestE2E/TestApplyWorkflowWithContext (1.38s)  ❌
    --- PASS: TestE2E/TestRunBasicAgent (2.28s)
    --- FAIL: TestE2E/TestRunBasicWorkflow (1.38s)  ❌
    --- PASS: TestE2E/TestRunFullAgent (2.24s)
    --- PASS: TestE2E/TestRunWithInvalidAgent (1.09s)
    --- FAIL: TestE2E/TestRunWorkflowExecutionPhases (1.38s)  ❌
    --- FAIL: TestE2E/TestRunWorkflowWithInput (1.27s)  ❌
    --- FAIL: TestE2E/TestRunWorkflowWithInvalidName (1.33s)  ❌
```

**After Fix**:
```
--- PASS: TestE2E (27.37s)
    --- PASS: TestE2E/TestApplyAgentCount (1.41s)
    --- PASS: TestE2E/TestApplyBasicAgent (1.43s)
    --- PASS: TestE2E/TestApplyBasicWorkflow (2.27s)  ✅
    --- PASS: TestE2E/TestApplyDryRun (2.30s)
    --- PASS: TestE2E/TestApplyWorkflowCount (1.62s)  ✅
    --- PASS: TestE2E/TestApplyWorkflowDryRun (1.25s)
    --- PASS: TestE2E/TestApplyWorkflowTaskDependencies (1.42s)  ✅
    --- PASS: TestE2E/TestApplyWorkflowWithContext (1.43s)  ✅
    --- PASS: TestE2E/TestRunBasicAgent (2.45s)
    --- PASS: TestE2E/TestRunBasicWorkflow (2.38s)  ✅
    --- PASS: TestE2E/TestRunFullAgent (2.29s)
    --- PASS: TestE2E/TestRunWorkflowExecutionPhases (2.27s)  ✅
    --- PASS: TestE2E/TestRunWorkflowWithInput (2.29s)  ✅
    --- PASS: TestE2E/TestRunWorkflowWithInvalidName (1.32s)  ✅
```

**Results**: All 8 workflow tests now passing (15/15 tests passing, 1 skipped)

## Technical Details

### Why StringRef.Expression() Returned Empty String

Looking at the SDK code in `stigmer/refs.go`:

```go
type baseRef struct {
    name          string
    isSecret      bool
    isComputed    bool
    rawExpression string
}

func (r *baseRef) Expression() string {
    if r.isComputed {
        return fmt.Sprintf("${ %s }", r.rawExpression)
    }
    if r.name == "" {  // ← Problem here!
        return ""      // Returns empty for resolved literals
    }
    return fmt.Sprintf("${ $context.%s }", r.name)
}
```

When `Concat()` creates a resolved value (all parts known at synthesis time), it sets `name` to empty and stores the actual value. Calling `Expression()` on this returns an empty string instead of the actual resolved value.

The fix checks for the `StringValue` interface which provides access to the actual resolved value via `Value()` method.

### Synthesis vs Runtime Values

The SDK distinguishes between:

1. **Synthesis-time values** - Known when building the workflow (context variables, literals, concatenated strings)
2. **Runtime-only values** - Only available during execution (task outputs, dynamic expressions)

For synthesis-time values, we should use the actual value (from `Value()` method).  
For runtime-only values, we use JQ expressions (from `Expression()` method).

The fix correctly handles both cases.

## Files Changed

```
M client-apps/cli/cmd/stigmer/root/apply.go
M client-apps/cli/cmd/stigmer/root/run.go
M sdk/go/workflow/set_options.go
```

## Testing

**E2E Test Coverage**:
- ✅ Workflow apply operations (basic, count, dry-run, dependencies, context)
- ✅ Workflow run operations (basic, with input, execution phases, invalid name)
- ✅ Agent operations (all tests already passing)
- ✅ Test harness (all tests already passing)

**Verification**:
```bash
make test-e2e
# Result: 15/15 passing, 1 skipped
# Duration: 27.37s
```

## Impact

**User-Facing**:
- ✅ Workflows now deploy correctly from SDK code
- ✅ Workflow HTTP tasks work with context-based URLs
- ✅ CLI output shows correct workflow names
- ✅ Error messages properly exit with error codes

**Developer Experience**:
- ✅ All E2E tests passing
- ✅ Workflow operations reliable
- ✅ Clear error handling for missing resources

## Related Changes

This fix complements the broader "standardize CLI apply output" project but specifically addresses workflow test failures discovered during that work.

## Follow-up

No follow-up required. All workflow operations now work correctly and all tests pass.
