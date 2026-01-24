# SDK Type System Fixes for Nested Tasks in Try/Fork/Catch Blocks

**Date**: January 24, 2026

## Summary

Fixed SDK type system issues preventing Try/Fork/Catch task blocks from working correctly. Created helper functions similar to `LoopBody()` for type-safe nested task definitions, updated broken examples to use the new API, and fixed conversion logic in `proto.go`. Identified remaining code generator issue that needs separate fix.

## Problem Statement

Three SDK example files (09, 10, 11) were failing tests due to type mismatches introduced by recent SDK code generation changes. The examples were using outdated API patterns with `[]map[string]interface{}` for nested tasks, but the generated types now expect strongly-typed structures like `[]*types.WorkflowTask`, `*types.CatchBlock`, and `[]*types.ForkBranch`.

### Pain Points

- **Compilation errors**: Examples 10 and 11 failed to compile due to type mismatches
  - `TryArgs.Tasks` field didn't exist (should be `Try`)
  - `CatchBlock` expected pointer type, got map slice
  - `ForkBranch` expected pointer slice, got map slice
  
- **Runtime errors**: Example 09 failed at synthesis with "proto: invalid type: *workflow.Task"

- **API inconsistency**: `LoopBody()` helper existed for For tasks, but no equivalent for Try/Fork/Catch

- **Poor developer experience**: No type-safe way to define nested tasks in Try/Fork/Catch blocks

## Solution

### 1. Created Helper Functions (Similar to LoopBody Pattern)

Created two new helper files following the established `LoopBody()` pattern:

**`sdk/go/workflow/try_helpers.go`**:
- `TryBody(tasks ...*Task)` - Converts SDK tasks to `[]*types.WorkflowTask` for Try blocks
- `CatchBody(errorVar string, tasks ...*Task)` - Creates `*types.CatchBlock` for error handling

**`sdk/go/workflow/fork_helpers.go`**:
- `ForkBranch(name string, tasks ...*Task)` - Creates a single `*types.ForkBranch`
- `ForkBranches(branches ...*types.ForkBranch)` - Combines branches into slice

These provide type-safe, compile-time checked nested task definitions without error-prone maps.

### 2. Updated Example Files

**Example 10** (`10_workflow_with_error_handling.go`):
```go
// Before (compilation error)
tryTask := wf.Try("attemptGitHubCall", &workflow.TryArgs{
    Tasks: []map[string]interface{}{...},  // Wrong field name, wrong type
    Catch: []map[string]interface{}{...},  // Wrong type
})

// After (type-safe)
tryTask := wf.Try("attemptGitHubCall", &workflow.TryArgs{
    Try: workflow.TryBody(
        wf.HttpGet("fetchPullRequest", url, headers),
    ),
    Catch: workflow.CatchBody("error",
        wf.Set("handleError", &workflow.SetArgs{...}),
    ),
})
```

Also updated Switch cases to use `[]*types.SwitchCase` with fluent API (`.Equals()`).

**Example 11** (`11_workflow_with_parallel_execution.go`):
```go
// Before (compilation error)
wf.Fork("fetchAllGitHubData", &workflow.ForkArgs{
    Branches: []map[string]interface{}{...},  // Wrong type
})

// After (type-safe)
wf.Fork("fetchAllGitHubData", &workflow.ForkArgs{
    Branches: workflow.ForkBranches(
        workflow.ForkBranch("fetchPullRequests",
            wf.HttpGet("getPulls", apiBase.Concat("/pulls"), headers),
        ),
        workflow.ForkBranch("fetchIssues", ...),
        workflow.ForkBranch("fetchCommits", ...),
    ),
})
```

### 3. Fixed Conversion Logic in proto.go

**Problem**: Conversion functions were storing struct pointers directly instead of converting to maps.

**Fixed functions**:
- `tryTaskConfigToMap()` - Now calls `workflowTaskToMap()` for each task
- `forkTaskConfigToMap()` - Now calls `forkBranchToMap()` for each branch
- `forTaskConfigToMap()` - Now calls `workflowTaskToMap()` for each task

**New helper functions**:
- `workflowTaskToMap(*types.WorkflowTask)` - Converts WorkflowTask to map[string]interface{}
- `forkBranchToMap(*types.ForkBranch)` - Converts ForkBranch to map[string]interface{}

These ensure nested tasks are properly serialized for protobuf conversion.

## Implementation Details

### Helper Function Design

The helper functions follow the established `LoopBody()` pattern:

1. **Accept SDK tasks** (`*Task`) as variadic parameters
2. **Convert to proto types** (`types.WorkflowTask`, `types.CatchBlock`, etc.)
3. **Extract config properly** via `taskToMap()` which handles all task types
4. **Return strongly-typed results** for compile-time safety

### Conversion Flow

```
SDK Task (*workflow.Task)
  ↓ TryBody/CatchBody/ForkBranch helpers
types.WorkflowTask / types.CatchBlock / types.ForkBranch
  ↓ tryTaskConfigToMap/forkTaskConfigToMap
map[string]interface{} with properly converted nested structures
  ↓ Generated ToProto() methods (JSON marshal/unmarshal)
google.protobuf.Struct
  ↓ Backend proto validation and execution
Validated proto messages
```

### Type Safety Improvements

**Before**:
```go
Branches: []map[string]interface{}{  // No compile-time checks
    {
        "name": "branch1",
        "tasks": []interface{}{  // No type safety
            map[string]interface{}{"httpCall": ...},  // Error-prone
        },
    },
}
```

**After**:
```go
Branches: workflow.ForkBranches(  // Type-safe
    workflow.ForkBranch("branch1",  // Compile-time checked
        wf.HttpGet("task1", url, headers),  // IDE autocomplete
    ),
)
```

## Benefits

### For SDK Users

- ✅ **Type safety**: Compile-time checking for nested task definitions
- ✅ **IDE support**: Autocomplete and refactoring for nested tasks
- ✅ **Consistency**: Same pattern across For/Try/Fork/Catch (all use helper functions)
- ✅ **Clarity**: Explicit function names (`TryBody`, `CatchBody`, `ForkBranch`) vs magic maps

### For SDK Maintainers

- ✅ **Proper conversion**: Nested tasks correctly converted to maps for protobuf
- ✅ **No manual edits to generated code**: All fixes in hand-written files
- ✅ **Extensible**: Easy to add more helpers for future task types

### Example Code Quality

- ✅ **Examples now demonstrate best practices**: Using type-safe helpers
- ✅ **Examples compile cleanly**: No type mismatch errors
- ✅ **Examples are maintainable**: Changes to types won't break examples as easily

## Impact

### Fixed Test Failures

**Type system changes** category - 3 out of 15 test failures addressed:
- ❌ TestExample09_WorkflowWithLoops - **Partially fixed** (conversion works, code generator issue remains)
- ❌ TestExample10_WorkflowWithErrorHandling - **Partially fixed** (uses new API, code generator issue remains)
- ❌ TestExample11_WorkflowWithParallelExecution - **Partially fixed** (uses new API, code generator issue remains)

### Remaining Work

**Code Generator Issue** (needs separate fix):

The generated `ToProto()` methods in files like `trytaskconfig.go`, `forktaskconfig.go`, `fortaskconfig.go` use JSON marshaling which fails during validation:

```
Error: proto: (line 1:38): invalid value for enum field kind: "SET"
```

**Root cause**: Generated code JSON-marshals `[]*types.WorkflowTask` which contains `Kind` field with string values like "SET", "HTTP_CALL". When proto validation unmarshals this JSON, it expects fully-qualified enum names like "WORKFLOW_TASK_KIND_SET".

**Proper fix location**: `tools/codegen/generator/main.go` and `tools/codegen/proto2schema/main.go`

**What needs to change**:
- Generated ToProto methods should use direct map conversion (like our hand-written helpers)
- OR generated types should use the proto enum type instead of string for Kind field
- OR validation should be skipped for nested tasks

### Files Modified

```
M  sdk/go/examples/10_workflow_with_error_handling.go  (API updated)
M  sdk/go/examples/11_workflow_with_parallel_execution.go  (API updated)
M  sdk/go/workflow/proto.go  (conversion helpers added)
A  sdk/go/workflow/try_helpers.go  (new helper functions)
A  sdk/go/workflow/fork_helpers.go  (new helper functions)
```

### SDK API Improvement

The SDK now has a consistent, type-safe API for all control flow constructs:

| Control Flow | Helper Function | Returns |
|--------------|----------------|---------|
| **Loops** | `LoopBody(fn)` | `[]*types.WorkflowTask` |
| **Try blocks** | `TryBody(tasks...)` | `[]*types.WorkflowTask` |
| **Catch blocks** | `CatchBody(errorVar, tasks...)` | `*types.CatchBlock` |
| **Fork branches** | `ForkBranch(name, tasks...)` | `*types.ForkBranch` |
| **Fork args** | `ForkBranches(branches...)` | `[]*types.ForkBranch` |

All follow the same pattern: accept SDK tasks, return proto-compatible types.

## Related Work

- Initial Options pattern implementation (recent SDK changes)
- `LoopBody()` helper function (established pattern we followed)
- TaskFieldRef fluent API (`.Equals()`, `.Contains()`, etc.)

## Next Steps

To fully resolve the test failures:

1. **Fix code generator** (`tools/codegen/generator/main.go`):
   - Update ToProto generation for array fields of type `[]*types.WorkflowTask`
   - Use direct map conversion instead of JSON marshaling
   - OR use proper enum types instead of strings for Kind field

2. **Regenerate SDK code**: Run `make protos` to regenerate with fixed templates

3. **Verify all tests pass**: Run `make test-sdk` to confirm

**Estimated effort**: 1-2 hours to fix code generator + test

---

**Status**: ✅ Partially Complete (helper functions working, examples updated, code generator fix documented)

**Impact**: Medium - Improves SDK type safety and example quality, but tests still fail until code generator is fixed
