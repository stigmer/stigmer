# Fix E2E Workflow Test Constant Mismatch

**Date**: 2026-01-25  
**Status**: ✅ Complete  
**Type**: Bug Fix  
**Impact**: Test Reliability  

## Summary

Fixed 2 failing E2E tests (`TestApplyBasicWorkflow` and `TestApplyWorkflowTaskDependencies`) by updating test constants to match the actual SDK example task names. The test constants referenced an outdated task name (`fetchData`) while the SDK example had been updated to use `fetchPullRequest`.

## Problem

Running `make test-e2e` revealed test failures:

```
=== RUN   TestE2E/TestApplyBasicWorkflow
    workflow_test_helpers.go:102: 
    Error:      	Should be true
    Test:       	TestE2E/TestApplyBasicWorkflow
    Messages:   	Workflow should have fetchData task from SDK example

=== RUN   TestE2E/TestApplyWorkflowTaskDependencies
    basic_workflow_apply_dependencies_test.go:34: fetchData task should exist from SDK example
```

## Root Cause

**SDK Example Task Name** (`test/e2e/testdata/examples/07-basic-workflow/main.go` line 67):
```go
fetchTask := wf.HttpGet("fetchPullRequest",  // ← Actual task name
    workflow.Interpolate(apiBase, "/repos/stigmer/hello-stigmer/pulls/1"),
    ...
)
```

**Test Constant** (`test/e2e/workflow_test_constants.go` line 20):
```go
BasicWorkflowFetchTask   = "fetchData"  // ← Outdated constant
```

The SDK example was updated to use a more descriptive name, but the test constants were not synchronized.

## Solution

Updated the constant to match the actual SDK example:

```diff
# test/e2e/workflow_test_constants.go
-	BasicWorkflowFetchTask   = "fetchData"
+	BasicWorkflowFetchTask   = "fetchPullRequest"
```

## Verification

After the fix:
- ✅ `TestApplyBasicWorkflow` passes
- ✅ `TestApplyWorkflowTaskDependencies` passes  
- ✅ Test output shows: `✓ Tasks verified: [fetchPullRequest processResponse]`
- ✅ Test logs show: `✓ Found tasks: fetchPullRequest, processResponse`

## Impact

**Before**:
- 2/26 E2E tests failing due to constant mismatch
- False negative: tests rejected valid workflow deployment
- Tests passing: 20/26

**After**:
- Workflow apply tests passing
- Tests correctly validate against actual SDK example
- Tests passing: 22/26 (2 fewer failures)
- Remaining failures are agent execution connection issues (separate problem)

## Files Changed

- `test/e2e/workflow_test_constants.go` - Updated `BasicWorkflowFetchTask` constant from `"fetchData"` to `"fetchPullRequest"`

## Learning

**Test-Example Synchronization**: When SDK examples are updated, corresponding test constants must be updated in sync. This type of mismatch can be caught early by:
1. Running E2E tests after SDK example changes
2. Code review focusing on test constant updates
3. Consider extracting task names from SDK examples programmatically (future improvement)

## Related Files

- SDK Example: `test/e2e/testdata/examples/07-basic-workflow/main.go`
- Test Constants: `test/e2e/workflow_test_constants.go`
- Test Helpers: `test/e2e/workflow_test_helpers.go`
- Failing Tests:
  - `test/e2e/basic_workflow_apply_core_test.go`
  - `test/e2e/basic_workflow_apply_dependencies_test.go`

## Test Results

```bash
$ make test-e2e
# Before fix
--- FAIL: TestE2E/TestApplyBasicWorkflow (0.43s)
--- FAIL: TestE2E/TestApplyWorkflowTaskDependencies (0.44s)
Total: 20 passed, 4 failed, 1 skipped

# After fix
--- PASS: TestE2E/TestApplyBasicWorkflow (0.43s)
--- PASS: TestE2E/TestApplyWorkflowTaskDependencies (0.44s)
Total: 22 passed, 2 failed, 1 skipped
```

## Next Steps

Remaining test failures are related to agent execution connection issues:
- `TestRunBasicAgent` - "Execution failed: All connection attempts failed"
- `TestRunFullAgent` - Same error

These are separate from the workflow test issues and require investigation into agent-runner connectivity.
