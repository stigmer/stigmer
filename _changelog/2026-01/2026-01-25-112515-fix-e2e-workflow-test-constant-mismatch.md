# Fix E2E Workflow Test Constant Mismatch

**Date**: 2026-01-25  
**Type**: Bug Fix  
**Scope**: E2E Tests  
**Impact**: Test reliability  

## Summary

Fixed E2E test failures in `TestApplyBasicWorkflow` and `TestApplyWorkflowTaskDependencies` caused by mismatched task name constants. The test constants referenced an outdated task name (`fetchData`) while the SDK example had been updated to use `fetchPullRequest`.

## Problem

Running `make test-e2e` revealed 2 failing tests:

1. **TestApplyBasicWorkflow** (line 269-275 in test output)
   - Error: "Workflow should have fetchData task from SDK example"
   - Actual task name in workflow: `fetchPullRequest`
   - Expected task name in test: `fetchData`

2. **TestApplyWorkflowTaskDependencies** (line 679-688 in test output)
   - Error: "fetchData task should exist from SDK example"
   - Same root cause: constant mismatch

## Root Cause Analysis

The SDK example at `test/e2e/testdata/examples/07-basic-workflow/main.go` creates a task named `fetchPullRequest` (line 67):

```go
fetchTask := wf.HttpGet("fetchPullRequest",
    workflow.Interpolate(apiBase, "/repos/stigmer/hello-stigmer/pulls/1"),
    ...
)
```

However, the test constants file `test/e2e/workflow_test_constants.go` still referenced the old name (line 20):

```go
BasicWorkflowFetchTask   = "fetchData"  // ❌ Outdated
```

This mismatch occurred because:
- The SDK example was updated to use a more descriptive task name (`fetchPullRequest` instead of `fetchData`)
- The test constants were not updated to match the change
- The tests were validating against the outdated constant name

## Solution

Updated the test constant to match the actual SDK example task name:

**File**: `test/e2e/workflow_test_constants.go`

```diff
-   BasicWorkflowFetchTask   = "fetchData"
+   BasicWorkflowFetchTask   = "fetchPullRequest"
```

## Verification

After the fix:
- ✅ `TestApplyBasicWorkflow` passes - correctly verifies task named `fetchPullRequest`
- ✅ `TestApplyWorkflowTaskDependencies` passes - finds both tasks by correct names
- ✅ Test output shows: `✓ Tasks verified: [fetchPullRequest processResponse]`
- ✅ Test logs show: `✓ Found tasks: fetchPullRequest, processResponse`

## Impact

**Before**:
- 2 E2E tests failing due to constant mismatch
- False negative: tests rejected valid workflow deployment
- Exit code 2 from `make test-e2e`

**After**:
- E2E workflow apply tests passing
- Tests correctly validate against actual SDK example
- Test constants synchronized with SDK examples

## Files Changed

- `test/e2e/workflow_test_constants.go` - Updated `BasicWorkflowFetchTask` constant

## Test Results

Test suite summary after fix:
- **Total**: 26 tests
- **Passed**: 22 (was 20)
- **Failed**: 2 (was 4) - remaining failures are agent execution issues (separate issue)
- **Skipped**: 1

The 2 workflow apply test failures were resolved. Remaining failures are related to agent execution connection issues, which is a separate problem from this constant mismatch.

## Learnings

1. **Test-Example Synchronization**: When SDK examples are updated, corresponding test constants must be updated in sync
2. **Test Coverage Value**: E2E tests caught this mismatch, validating that tests properly verify SDK examples
3. **Clear Error Messages**: Test assertions clearly indicated which task name was expected vs actual
4. **Single Point of Truth**: Task names are defined in constants (`workflow_test_constants.go`) to make updates easier

## Related

- Project: `_projects/2026-01/20260122.05.e2e-integration-testing/`
- SDK Example: `test/e2e/testdata/examples/07-basic-workflow/main.go`
- Test Constants: `test/e2e/workflow_test_constants.go`
- Failing Tests: `TestApplyBasicWorkflow`, `TestApplyWorkflowTaskDependencies`
