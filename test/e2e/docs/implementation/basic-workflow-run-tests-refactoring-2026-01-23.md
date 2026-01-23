# Basic Workflow Run Tests Refactoring

**Date**: 2026-01-23
**Status**: ✅ Complete

## Summary

Refactored workflow run tests from Phase 1 smoke tests (that only verified execution record creation) to proper integration tests that wait for workflow execution completion and verify execution status (COMPLETED or FAILED).

## Motivation

The original workflow run tests were documented as "Phase 1 smoke tests" that:
- Used `--follow=false` flag
- Only verified that execution records were created
- Did NOT wait for execution completion
- Did NOT verify execution status (COMPLETED/FAILED)
- Had significant code duplication
- Did not follow the established agent run test pattern

This made them inconsistent with agent run tests, which properly wait for execution completion and validate final status.

## Changes Made

### 1. Updated Constants (`workflow_test_constants.go`)

**Added**:
```go
// Execution timeouts
WorkflowExecutionTimeoutSeconds = 60
```

### 2. Enhanced Helpers (`workflow_test_helpers.go`)

**Added new helper functions**:
- `WorkflowRunResult` - Result struct for run operations
- `RunWorkflowByName()` - Runs a workflow and returns execution info
- `extractExecutionIDFromOutput()` - Parses execution ID from CLI output
- `WaitForWorkflowExecutionCompletion()` - Polls until execution reaches terminal state
- `VerifyWorkflowExecutionCompleted()` - Verifies successful completion
- `VerifyRunOutputSuccess()` - Verifies run command output

**Pattern Matching Agent Tests**:
The workflow helpers now mirror the agent test helpers:
- `RunWorkflowByName()` ↔ `RunAgentByName()`
- `WaitForWorkflowExecutionCompletion()` ↔ `WaitForAgentExecutionCompletion()`
- `VerifyWorkflowExecutionCompleted()` ↔ `VerifyAgentExecutionCompleted()`

### 3. Refactored Test Files

**Before**: 1 monolithic file with 264 lines
```
basic_workflow_run_test.go (264 lines)
├── TestRunBasicWorkflow (94 lines)
├── TestRunWorkflowWithInput (67 lines) - duplicate of basic test
├── TestRunWorkflowWithInvalidName (16 lines)
└── TestRunWorkflowExecutionPhases (70 lines)
```

**After**: 3 focused files with clear responsibilities
```
basic_workflow_run_basic_test.go (43 lines)
├── TestRunBasicWorkflow - Main integration test with completion waiting

basic_workflow_run_invalid_test.go (27 lines)
├── TestRunWorkflowWithInvalidName - Error handling test

basic_workflow_run_phases_test.go (54 lines)
└── TestRunWorkflowExecutionPhases - Phase progression verification
```

### 4. Key Behavioral Changes

#### Before (Phase 1 Smoke Tests):
```go
// OLD - Just verify execution record created
runOutput, err := RunCLIWithServerAddr(
    serverPort,
    "run", "basic-data-fetch",
    "--follow=false", // Don't wait
)

// Extract execution ID
executionID := extractID(runOutput)

// Just verify it exists
executionExists, _ := WorkflowExecutionExistsViaAPI(serverPort, executionID)
s.True(executionExists)

// ❌ No waiting
// ❌ No status verification
// ❌ No completion validation
```

#### After (Full Integration Tests):
```go
// NEW - Full integration test with completion
applyResult := ApplyBasicWorkflow(t, serverPort)
runResult := RunWorkflowByName(t, serverPort, BasicWorkflowName)
VerifyRunOutputSuccess(t, runResult.Output, BasicWorkflowName)

// ✅ Wait for completion
execution := WaitForWorkflowExecutionCompletion(
    t, serverPort, runResult.ExecutionID, WorkflowExecutionTimeoutSeconds)

// ✅ Verify final status
VerifyWorkflowExecutionCompleted(t, execution)

// ✅ Handles COMPLETED, FAILED, and CANCELLED states
// ✅ Logs phase transitions
// ✅ Includes timeout protection
```

## Metrics

### File Organization
| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Test Files | 1 | 3 | +2 files |
| Largest File | 264 lines | 54 lines | -79% |
| Total Lines | 264 | 124 | -53% |
| Duplicated Code | ~70 lines | 0 lines | -100% |

### Code Quality
| Metric | Before | After |
|--------|--------|-------|
| Magic Strings | Many | 0 (all constants) |
| Max Function Size | 94 lines | 43 lines |
| Code Duplication | Significant | None |
| Helper Functions | 0 | 6 new helpers |

### Test Coverage
| Aspect | Before | After |
|--------|--------|-------|
| Execution Creation | ✅ | ✅ |
| Execution Completion | ❌ | ✅ |
| Status Validation | ❌ | ✅ |
| Phase Transitions | Partial | ✅ Full |
| Error States | ❌ | ✅ |
| Timeout Protection | ❌ | ✅ |

## Test Behavior Details

### 1. TestRunBasicWorkflow (Main Integration Test)

**Steps**:
1. Apply workflow from SDK example
2. Run workflow by name
3. Verify run output
4. Wait for execution completion (up to 60s)
5. Verify execution completed successfully

**Execution Flow**:
```
Apply Workflow
    ↓
Run Workflow (creates execution)
    ↓
Poll Execution Status (every 1s)
    ↓
PENDING → IN_PROGRESS → COMPLETED
    ↓
Verify Final Status = COMPLETED
```

**New Capabilities**:
- ✅ Waits for actual execution completion
- ✅ Logs phase transitions (PENDING → COMPLETED)
- ✅ Verifies COMPLETED status
- ✅ Fails if execution enters FAILED or CANCELLED state
- ✅ Times out after 60 seconds if stuck

### 2. TestRunWorkflowWithInvalidName (Error Handling)

**Purpose**: Verify proper error handling for non-existent workflows

**Behavior**:
- Attempts to run `non-existent-workflow`
- Expects command to fail with error
- Validates error message

### 3. TestRunWorkflowExecutionPhases (Phase Progression)

**Purpose**: Validate execution lifecycle state machine

**Steps**:
1. Apply workflow
2. Run workflow
3. Verify initial phase is PENDING
4. Wait for completion (observing transitions)
5. Verify final phase is COMPLETED
6. Log full phase progression

**Phase Verification**:
```
Initial: EXECUTION_PENDING
    ↓
Transition: PENDING → IN_PROGRESS (logged)
    ↓
Transition: IN_PROGRESS → COMPLETED (logged)
    ↓
Final: EXECUTION_COMPLETED (verified)
```

## Helper Function Details

### WaitForWorkflowExecutionCompletion

**Purpose**: Poll execution status until terminal state reached

**Behavior**:
- Polls every 1 second
- Logs phase transitions
- Returns on COMPLETED (success)
- Fails test on FAILED or CANCELLED
- Times out after configurable seconds

**Terminal States Handled**:
- `EXECUTION_COMPLETED` → Returns execution (success)
- `EXECUTION_FAILED` → Fails test with error messages
- `EXECUTION_CANCELLED` → Fails test
- Timeout → Fails test with last known phase

**Example Log Output**:
```
Waiting for workflow execution to complete (timeout: 60s)...
   [Poll 1] Phase transition: UNKNOWN → EXECUTION_PENDING
   [Poll 3] Phase transition: EXECUTION_PENDING → EXECUTION_IN_PROGRESS
   [Poll 15] Phase transition: EXECUTION_IN_PROGRESS → EXECUTION_COMPLETED
   ✓ Workflow execution completed successfully after 15 polls
```

### RunWorkflowByName

**Purpose**: Execute workflow and return execution info

**Returns**: `WorkflowRunResult` containing:
- `ExecutionID` - Unique execution identifier
- `Output` - Complete CLI output

**Validation**:
- Ensures run command succeeds
- Extracts execution ID from output
- Logs execution creation

### VerifyWorkflowExecutionCompleted

**Purpose**: Assert execution reached COMPLETED state

**Checks**:
- Execution object exists
- Status field populated
- Phase equals EXECUTION_COMPLETED

## SDK Sync Strategy

All constants match SDK example `07_basic_workflow.go`:
- Workflow name: `basic-data-fetch`
- Test fixture: `testdata/examples/07-basic-workflow/`
- Task names: `fetchData`, `processResponse`

Test fixture is automatically copied from SDK example by `sdk_fixtures_test.go`.

## Removed Tests

**TestRunWorkflowWithInput** was removed because:
- It was a duplicate of TestRunBasicWorkflow
- Same workflow, same behavior
- Only difference was a comment about input parameters
- Input parameter testing can be added as a separate test when `--input` flag is implemented

## Consistency with Agent Tests

The workflow run tests now follow the exact same pattern as agent run tests:

| Aspect | Agent Tests | Workflow Tests | Match? |
|--------|-------------|----------------|--------|
| Constants File | ✅ | ✅ | ✅ |
| Helpers File | ✅ | ✅ | ✅ |
| Separate Test Files | ✅ | ✅ | ✅ |
| Wait for Completion | ✅ | ✅ | ✅ |
| Verify Final Status | ✅ | ✅ | ✅ |
| Log Phase Transitions | ✅ | ✅ | ✅ |
| Timeout Protection | ✅ | ✅ | ✅ |
| Error State Handling | ✅ | ✅ | ✅ |

## Engineering Standards Compliance

### File Size ✅
- All files under 250 lines
- Largest file: 54 lines (target: 50-150)

### Function Size ✅
- All functions under 50 lines
- Largest function: 43 lines (target: 20-40)

### No Magic Strings ✅
- All values defined as constants
- Constants match SDK example
- Clear, descriptive names

### No Duplication ✅
- Common code extracted to helpers
- Single source of truth for each operation
- Reusable across tests

### Single Responsibility ✅
- Each file tests one aspect
- Each helper has one purpose
- Clear separation of concerns

## Testing

All tests verified to pass:
```bash
cd test/e2e
go test -v -tags=e2e -run "TestE2E/TestRunBasicWorkflow"
go test -v -tags=e2e -run "TestE2E/TestRunWorkflowWithInvalidName"
go test -v -tags=e2e -run "TestE2E/TestRunWorkflowExecutionPhases"
```

## Future Enhancements

Potential additions (not in scope for this refactoring):
1. Test with `--input` flag when implemented
2. Test workflow with multiple executions in parallel
3. Test cancelling a running workflow execution
4. Test workflow execution with dependencies
5. Test workflow execution output/results verification

## Related Files

**Modified**:
- `test/e2e/workflow_test_constants.go` - Added execution timeout constant
- `test/e2e/workflow_test_helpers.go` - Added run helpers

**Created**:
- `test/e2e/basic_workflow_run_basic_test.go` - Main integration test
- `test/e2e/basic_workflow_run_invalid_test.go` - Error handling
- `test/e2e/basic_workflow_run_phases_test.go` - Phase progression

**Deleted**:
- `test/e2e/basic_workflow_run_test.go` - Replaced by refactored tests

## Success Criteria

All criteria met ✅:
- [x] Removed `--follow=false` flag
- [x] Tests wait for execution completion
- [x] Tests verify execution status (COMPLETED/FAILED)
- [x] Pattern matches agent run tests
- [x] No code duplication
- [x] All constants extracted
- [x] Helper functions created
- [x] Files under 250 lines
- [x] Functions under 50 lines
- [x] Clear documentation
- [x] All tests passing

## Conclusion

The workflow run tests have been successfully transformed from Phase 1 smoke tests to full integration tests that:
1. Wait for actual execution completion
2. Verify final execution status
3. Handle all terminal states (COMPLETED, FAILED, CANCELLED)
4. Follow the same pattern as agent run tests
5. Comply with all engineering standards

These tests now provide genuine integration test coverage for the workflow execution lifecycle, not just smoke testing of execution record creation.
