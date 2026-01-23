# Enhance Agent Run Tests with Completion Validation

**Date**: 2026-01-23  
**Type**: Test Enhancement  
**Scope**: E2E Testing (`test/e2e/basic_agent_run_test.go`)  
**Impact**: Test Quality Improvement - Better validation and failure detection

## Summary

Enhanced agent execution E2E tests to validate actual completion success rather than just smoke-testing execution creation. Tests now wait for executions to complete and verify they reach `EXECUTION_COMPLETED` state using industry-standard polling patterns with comprehensive logging.

## Problem

The existing agent run tests (`TestRunBasicAgent`, `TestRunFullAgent`) had several quality issues:

1. **Negative Assertions**: Tests checked execution was "not in FAILED state" rather than asserting expected success state
2. **Smoke Test Only**: Tests only verified execution records were created, not that agents actually executed successfully
3. **Inconsistent Validation**: `TestRunFullAgent` only checked existence via API, while `TestRunBasicAgent` had more comprehensive validation
4. **No Completion Waiting**: Tests used `--follow=false` and didn't wait for execution to complete

These limitations meant the tests could pass even if executions failed later, providing false confidence in the agent execution system.

## Changes Made

### 1. Enhanced TestRunBasicAgent

**Before**:
```go
// Verify execution is not in failed state
if execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
    s.Fail("Execution should not be in FAILED state...")
}
```

**After**:
```go
// Wait for execution to complete (60s timeout)
execution, err := s.waitForAgentExecutionCompletion(executionID, 60)
s.Require().NoError(err, "Execution should complete successfully")

// Verify execution completed successfully (positive assertion)
s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution.Status.Phase,
    "Execution should complete successfully")
```

**Changes**:
- Added polling logic to wait for completion
- Changed from negative check (not FAILED) to positive assertion (COMPLETED)
- Timeout-based waiting with 1-second polling interval
- Comprehensive logging of phase transitions

### 2. Enhanced TestRunFullAgent

**Before**:
```go
// Only checked existence
executionExists, err := AgentExecutionExistsViaAPI(s.Harness.ServerPort, executionID)
s.True(executionExists, "Execution should exist when queried via API")
```

**After**:
```go
// Same comprehensive validation as TestRunBasicAgent
execution, err := s.waitForAgentExecutionCompletion(executionID, 60)
s.Require().NoError(err, "Execution should complete successfully")

s.Equal(agentexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, execution.Status.Phase,
    "Execution should complete successfully")
```

**Changes**:
- Brought validation to same level as TestRunBasicAgent
- Full execution object retrieval instead of just existence check
- Waits for completion and verifies success state
- Validates agents with optional fields (description, iconURL) execute correctly

### 3. Added Polling Helper Method

Created `waitForAgentExecutionCompletion()` helper with industry-standard patterns:

```go
func (s *E2ESuite) waitForAgentExecutionCompletion(executionID string, timeoutSeconds int) (*agentexecutionv1.AgentExecution, error) {
    timeout := time.After(time.Duration(timeoutSeconds) * time.Second)
    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()
    
    // Poll every second until terminal state
    for {
        select {
        case <-timeout:
            return nil, fmt.Errorf("timeout after %d seconds", timeoutSeconds)
        case <-ticker.C:
            execution, err := GetAgentExecutionViaAPI(...)
            
            // Log phase transitions
            if currentPhase != lastPhase {
                s.T().Logf("[Poll %d] Phase transition: %s → %s", ...)
            }
            
            // Check for terminal states
            switch currentPhase {
            case EXECUTION_COMPLETED:
                return execution, nil
            case EXECUTION_FAILED:
                // Log error messages
                return execution, fmt.Errorf("execution failed")
            case EXECUTION_CANCELLED:
                return execution, fmt.Errorf("execution cancelled")
            }
        }
    }
}
```

**Features**:
- Configurable timeout (60 seconds for agent tests)
- 1-second polling interval
- Phase transition logging for debugging
- Terminal state detection (COMPLETED, FAILED, CANCELLED)
- Error message extraction on failure
- Helpful progress logging

### 4. Updated Test Documentation

Updated test comments to reflect the new validation approach:

**Before**: "Does NOT wait for actual execution (requires Temporal + agent-runner)"  
**After**: "Wait for execution to complete" and "Verify execution completed successfully"

## Service Registration Issue Found and Resolved

During testing, discovered a service naming mismatch:

**Issue**: Agent executions were failing with:
```
unknown service ai.stigmer.agentic.agentinstance.v1.AgentInstanceQueryService
```

**Investigation**:
- Proto definition: `service AgentInstanceQueryController` ✅
- Generated stubs (stigmer OSS): `AgentInstanceQueryController` ✅  
- Server registration: `RegisterAgentInstanceQueryControllerServer` ✅
- Python agent-runner stubs: Correct ✅

**Root Cause**: Running Agent Runner docker container was using old code from before the proto service was renamed from `AgentInstanceQueryService` → `AgentInstanceQueryController`.

**Resolution**: Restarted Agent Runner docker container to pick up updated proto stubs.

**Verification**: Stigmer OSS repo is self-contained and all stubs are correct:
- Go stubs: Use `AgentInstanceQueryController` service name
- Python stubs: Use `AgentInstanceQueryControllerStub` class
- All local to `github.com/stigmer/stigmer/apis/stubs/`

## Test Results

### Before Enhancement
Tests passed but only verified:
- Execution record created
- Execution not immediately in FAILED state
- Could miss failures that occurred during/after execution

### After Enhancement
```
=== RUN   TestE2E/TestRunBasicAgent
✓ Agent deployed with ID: agt-01kfm5fmnheppmmhdjzg93mxns
✓ Execution created with ID: aex-01kfm854gch49ss25dgp6e4a70
   [Poll 1] Phase transition: EXECUTION_PHASE_UNSPECIFIED → EXECUTION_IN_PROGRESS
   [Poll 22] Phase transition: EXECUTION_IN_PROGRESS → EXECUTION_COMPLETED
   ✓ Execution completed successfully after 22 polls
✅ Test Passed! Final phase: EXECUTION_COMPLETED

=== RUN   TestE2E/TestRunFullAgent
✓ code-reviewer-pro agent deployed with ID: agt-01kfm5fmp91wakfqzjwys35js0
✓ Execution created with ID: aex-01kfm85tfsf700f06mkhv64sdc
   [Poll 1] Phase transition: EXECUTION_PHASE_UNSPECIFIED → EXECUTION_IN_PROGRESS
   [Poll 3] Phase transition: EXECUTION_IN_PROGRESS → EXECUTION_COMPLETED
   ✓ Execution completed successfully after 3 polls
✅ Full Agent Run Test Passed! Final phase: EXECUTION_COMPLETED
```

Tests now validate:
- ✅ Agent deployment successful
- ✅ Execution record created
- ✅ Execution progresses through phases (PENDING → IN_PROGRESS → COMPLETED)
- ✅ Execution completes successfully (not just "not failed")
- ✅ Phase transitions logged for debugging
- ✅ Agents with optional fields execute correctly

## Benefits

1. **Stronger Validation**: Tests verify actual execution success, not just creation
2. **Early Failure Detection**: Tests fail immediately if execution doesn't complete successfully
3. **Better Debugging**: Phase transition logging helps diagnose issues
4. **Consistent Standards**: Both tests use same comprehensive validation
5. **Industry Standards**: Polling pattern with timeout is standard practice for async operations
6. **Real E2E Coverage**: Tests validate end-to-end agent execution flow

## Testing

Ran all agent run tests successfully:
```bash
go test -v -tags=e2e ./test/e2e -run TestE2E -testify.m "^(TestRunBasicAgent|TestRunFullAgent)$"
```

Results:
- TestRunBasicAgent: PASSED (22.49s) - Execution completed after 22 polls
- TestRunFullAgent: PASSED (3.50s) - Execution completed after 3 polls
- TestRunWithAutoDiscovery: SKIPPED (planned for Phase 2)

## Technical Details

**Files Modified**:
- `test/e2e/basic_agent_run_test.go`:
  - Updated `TestRunBasicAgent` to wait for completion
  - Updated `TestRunFullAgent` to match validation level
  - Added `waitForAgentExecutionCompletion()` helper method
  - Added imports: `fmt`, `time`

**No Breaking Changes**: Tests still validate the same functionality, just more thoroughly.

## Related Work

This enhancement aligns with the E2E testing strategy documented in:
- `test/e2e/docs/getting-started/test-strategy.md` - Wait-for-completion pattern
- ADR (if exists) for test validation standards

## Future Improvements

Potential enhancements for future iterations:
- [ ] Configurable polling interval (currently 1 second)
- [ ] Exponential backoff for polling
- [ ] Test execution timeout as configurable fixture
- [ ] Add streaming logs test (with `--follow=true`)
- [ ] Implement `TestRunWithAutoDiscovery` (currently skipped)

---

**Change Type**: Test Enhancement (Internal Quality Improvement)  
**User Impact**: None (internal test improvements only)  
**Breaking Changes**: None  
**Migration Required**: None
