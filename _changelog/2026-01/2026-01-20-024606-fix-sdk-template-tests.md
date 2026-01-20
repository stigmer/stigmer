# Fix SDK Template Compilation Tests

**Date**: 2026-01-20 02:46:06  
**Category**: Test Infrastructure  
**Impact**: SDK Development

## Problem

The `TestTemplatesCompile` test suite in `sdk/go/templates/` was failing with module resolution errors when attempting to compile generated template code. This prevented validation that code templates used by `stigmer init` would actually compile for users.

### Test Failures

Three test cases were failing:
1. `TestTemplatesCompile/BasicAgent`
2. `TestTemplatesCompile/BasicWorkflow`
3. `TestTemplatesCompile/AgentAndWorkflow`

**Error symptoms**:
- Go mod tidy failing with "module does not contain package" errors
- Unable to resolve `github.com/stigmer/stigmer/sdk/go/agent`, `stigmer`, and `workflow` packages
- Additional failures for `github.com/stigmer/stigmer/apis/stubs/go` dependency resolution

## Root Causes

### 1. Incorrect SDK Module Path Calculation

**Location**: `sdk/go/templates/templates_test.go:87`

The test was calculating the SDK root path incorrectly:

```go
// WRONG: Goes up 3 directories from templates/ → main repo root
sdkRootPath, err := filepath.Abs("../../..")
```

This pointed the module replacement to `/Users/suresh/scm/github.com/stigmer/stigmer` (repo root) instead of `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/go` (SDK module root).

**Why this broke**:
- Test runs from `sdk/go/templates/` directory
- `../../..` navigates: `templates/` → `sdk/go/` → `sdk/` → repo root (3 levels up)
- But the SDK module is actually at `sdk/go/` (1 level up from `templates/`)
- Go tried to find `sdk/go/agent` package under repo root, which doesn't exist there

### 2. Missing API Stubs Module Replacement

The SDK depends on `github.com/stigmer/stigmer/apis/stubs/go`, which also needs a local path replacement. Without it:
- Go tried to download `apis/stubs/go` from remote (doesn't exist yet)
- Even with SDK path fixed, dependency resolution still failed

### 3. Template Code Type Error

**Location**: `sdk/go/templates/templates.go:221`

The `AgentAndWorkflow` template had a type mismatch:

```go
// WRONG: Field() returns TaskFieldRef, but Message() expects string
workflow.Message(fetchTask.Field("body"))
```

This caused compilation failure even when module paths were correct.

## Solution

### Fix 1: Correct SDK Module Path

```diff
- sdkRootPath, err := filepath.Abs("../../..")
+ sdkRootPath, err := filepath.Abs("..")
```

**Rationale**: From `templates/`, we only need to go up 1 directory to reach `sdk/go/` module root.

### Fix 2: Add API Stubs Replacement

```go
// Also need to replace apis/stubs/go which is a dependency of the SDK
apisStubsPath, err := filepath.Abs("../../../apis/stubs/go")
if err != nil {
    t.Fatalf("failed to get apis/stubs/go path: %v", err)
}

goModContent := fmt.Sprintf(`module test-project

go 1.25.0

require github.com/stigmer/stigmer/sdk/go v0.0.0

replace github.com/stigmer/stigmer/sdk/go => %s

replace github.com/stigmer/stigmer/apis/stubs/go => %s
`, sdkRootPath, apisStubsPath)
```

**Rationale**: The SDK's own `go.mod` has a relative replacement for `apis/stubs/go`. When tests create temporary go.mod files, they need to replicate this replacement with absolute paths.

### Fix 3: Convert TaskFieldRef to String Expression

```diff
- workflow.Message(fetchTask.Field("body")),
+ workflow.Message(fetchTask.Field("body").Expression()),
```

**Rationale**: `fetchTask.Field("body")` returns a `workflow.TaskFieldRef` type used for task chaining. The `workflow.Message()` function expects a string expression. The `.Expression()` method converts the field reference to its string representation.

## Changes

### Modified Files

1. **`sdk/go/templates/templates_test.go`**
   - Fixed SDK module path calculation (3 dirs up → 1 dir up)
   - Added `apis/stubs/go` module replacement with correct path
   - Updated comments for clarity

2. **`sdk/go/templates/templates.go`**
   - Added `.Expression()` call to convert TaskFieldRef to string in AgentAndWorkflow template

## Testing

**Before fix**:
```bash
$ cd sdk/go/templates && go test -v -run TestTemplatesCompile
FAIL (3/3 tests failed - module resolution errors)
```

**After fix**:
```bash
$ cd sdk/go/templates && go test -v -run TestTemplatesCompile
PASS
ok      github.com/stigmer/stigmer/sdk/go/templates    2.555s

✅ TestTemplatesCompile/BasicAgent - PASSING
✅ TestTemplatesCompile/BasicWorkflow - PASSING  
✅ TestTemplatesCompile/AgentAndWorkflow - PASSING
```

**All templates now compile successfully** when generated via `stigmer init`.

## Impact

### Positive Impact

**Development workflow**:
- Template tests now validate that generated code actually compiles
- Catches template bugs before users encounter them
- Ensures `stigmer init` generates working code

**CI/CD reliability**:
- SDK test suite passes completely (except 2 unrelated compile-time variable resolution tests)
- Template quality is automatically verified
- Regression protection for template changes

### No User Impact

- Internal test infrastructure fix only
- No changes to user-facing template content (except bug fix in AgentAndWorkflow)
- No SDK API changes
- No behavior changes

## Lessons Learned

### Test Path Calculation

**Key insight**: When tests create temporary projects with go.mod replacements, the replacement paths must be calculated relative to the test's working directory, not the repository root.

**Pattern**:
- Running from `A/B/C/test.go`
- Need to point to `A/B/module/`
- Use `filepath.Abs("..")` not `filepath.Abs("../../..")`

### Module Dependencies

**Key insight**: When using local module replacements, **all transitive dependencies** that also use replacements must be replicated.

**Pattern**:
```go
// Main module replacement
replace github.com/org/module => /path/to/module

// MUST ALSO include dependent module replacements
replace github.com/org/dependency => /path/to/dependency
```

Otherwise Go tries to fetch the dependency from remote, which may not exist.

## Related Tests

**Still failing (different issue)**:
- `TestExample07_BasicWorkflow` - compile-time variable resolution issue
- `TestCompileTimeVariableResolution` - compile-time variable resolution issue

These are unrelated to module structure and involve SDK synthesis logic for variable interpolation.

## Notes

This fix resolved the **Module Structure/Packaging** category of SDK test failures identified in the test run. The template tests now provide reliable validation that code generated by `stigmer init` will compile correctly for users.
