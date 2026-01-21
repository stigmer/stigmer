# Fix: Temporal Error Checking Compilation Errors

**Date**: 2026-01-21  
**Type**: Bug Fix (Build Error)  
**Component**: Backend / Stigmer Server / Temporal Workflows  
**Impact**: Development (Build System)

## Problem

The Go workflow implementation (`invoke_workflow_impl.go`) had compilation errors preventing the build:

```
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go:126:14: undefined: workflow.IsScheduleToStartTimeoutError
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go:139:14: undefined: workflow.IsHeartbeatTimeoutError
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go:149:14: undefined: workflow.IsStartToCloseTimeoutError
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go:160:14: undefined: workflow.IsApplicationError
```

**Root Cause**: The code was calling error-checking functions that don't exist in the Temporal Go SDK:
- `workflow.IsScheduleToStartTimeoutError()` ❌
- `workflow.IsHeartbeatTimeoutError()` ❌
- `workflow.IsStartToCloseTimeoutError()` ❌

These functions don't exist in the `workflow` package. The previous implementation likely copied these from Java without verifying Go SDK APIs.

## Solution

### Changed Error Checking Approach

Instead of calling non-existent helper functions, use the proper Temporal Go SDK pattern:

**Before (Broken)**:
```go
if workflow.IsScheduleToStartTimeoutError(err) {
    // handle schedule to start timeout
}
```

**After (Working)**:
```go
var timeoutErr *temporal.TimeoutError
if errors.As(err, &timeoutErr) {
    switch timeoutErr.TimeoutType() {
    case enums.TIMEOUT_TYPE_SCHEDULE_TO_START:
        // handle schedule to start timeout
    case enums.TIMEOUT_TYPE_HEARTBEAT:
        // handle heartbeat timeout
    case enums.TIMEOUT_TYPE_START_TO_CLOSE:
        // handle start to close timeout
    }
}
```

### Added Required Imports

```go
import (
    "errors"  // Added for errors.As()
    "go.temporal.io/api/enums/v1"  // Added for TIMEOUT_TYPE_* constants
)
```

### Updated `wrapActivityError()` Function

The `wrapActivityError()` function in `invoke_workflow_impl.go` now:

1. **Uses `errors.As()`** to check if error is a `*temporal.TimeoutError`
2. **Calls `timeoutErr.TimeoutType()`** to get the specific timeout type
3. **Switches on timeout type constants** from the `enums` package:
   - `enums.TIMEOUT_TYPE_SCHEDULE_TO_START`
   - `enums.TIMEOUT_TYPE_HEARTBEAT`
   - `enums.TIMEOUT_TYPE_START_TO_CLOSE`
4. **Kept `temporal.IsApplicationError()`** (this function exists and works correctly)

## Files Changed

### Modified

```
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go
```

**Changes**:
- Added `"errors"` import
- Added `"go.temporal.io/api/enums/v1"` import
- Changed timeout error checks from `workflow.Is*TimeoutError()` to `errors.As()` with `timeoutErr.TimeoutType()` switch
- Preserved error messages and handling logic

## Technical Background

### Temporal Go SDK Error Handling

The Temporal Go SDK provides these error types in the `temporal` package:
- `*temporal.TimeoutError` - Activity or workflow timeouts
- `*temporal.ApplicationError` - Application-level failures
- `*temporal.CanceledError` - Cancellations
- `*temporal.PanicError` - Panics

**Correct pattern for timeout errors**:
```go
// Check if error is a timeout error
var timeoutErr *temporal.TimeoutError
if errors.As(err, &timeoutErr) {
    // Get which type of timeout occurred
    timeoutType := timeoutErr.TimeoutType()
    
    // timeoutType is one of:
    // - enums.TIMEOUT_TYPE_SCHEDULE_TO_START
    // - enums.TIMEOUT_TYPE_START_TO_CLOSE
    // - enums.TIMEOUT_TYPE_HEARTBEAT
    // - enums.TIMEOUT_TYPE_SCHEDULE_TO_CLOSE
}
```

**Why the helper functions don't exist**:
- The Temporal Go SDK uses standard Go error wrapping (`errors.As()`, `errors.Is()`)
- Timeout type is a property of `TimeoutError`, not a separate error type
- This is different from Java SDK which has separate exception classes

### Reference: Java vs Go Error Handling

**Java SDK** (from `stigmer-cloud`):
```java
// Java uses exception class names and message inspection
if (errorType.contains("ActivityTimeoutException") || errorMsg.contains("ScheduleToStart")) {
    // handle schedule to start timeout
}
```

**Go SDK** (correct approach):
```go
// Go uses type assertions and property inspection
var timeoutErr *temporal.TimeoutError
if errors.As(err, &timeoutErr) {
    switch timeoutErr.TimeoutType() {
    case enums.TIMEOUT_TYPE_SCHEDULE_TO_START:
        // handle schedule to start timeout
    }
}
```

## Testing

### Build Verification

```bash
make release-local
```

**Result**: ✅ Build completes successfully

```
Step 2: Building fresh binaries...
✓ CLI built: bin/stigmer

Step 3: Installing to ~/bin...
✓ Installed: /Users/suresh/bin/stigmer

✓ Release Complete!
```

### Runtime Verification

The error handling improvements will be tested when:
1. Agent-runner is not available (SCHEDULE_TO_START timeout)
2. Agent-runner crashes mid-execution (HEARTBEAT timeout)
3. Activity execution takes too long (START_TO_CLOSE timeout)
4. Activity returns application error (application error handling)

Each case now has specific error messages explaining what went wrong and how to troubleshoot.

## Impact

### Development Impact

**Before**: ❌ `make release-local` failed with compilation errors
**After**: ✅ Build succeeds

### Error Message Quality

The fix preserves all helpful error messages for debugging:

```go
// Schedule to start timeout message
"activity '%s' failed: No worker available to execute activity. " +
"This usually means:\n" +
"1. agent-runner service is not running\n" +
"2. agent-runner failed to start (check agent-runner logs for startup errors like import failures)\n" +
"3. agent-runner is not connected to Temporal\n" +
"Original error: %w"
```

### Polyglot Workflow Robustness

The improved error handling maintains the design goals from the original implementation:
- Clear distinction between different failure types
- Actionable troubleshooting guidance
- Context-rich error messages for debugging at 2 AM

## Related Work

This fix is part of the broader work documented in:
- `2026-01-21-230000-improve-error-propagation-in-temporal-workflows.md` - The original feature that introduced these error checks

The original changelog (230000) introduced the error wrapping logic, but used incorrect API calls. This fix corrects the implementation to use the proper Temporal Go SDK APIs.

## Lessons Learned

### Cross-Language API Differences

When implementing polyglot patterns (Go workflows + Python activities):

1. **Don't assume API parity**: Java SDK != Go SDK != Python SDK
2. **Verify SDK APIs**: Check official docs, not just intuition
3. **Test compilation early**: Don't wait for full implementation to verify APIs
4. **Use SDK examples**: Temporal's Go SDK examples show proper error handling patterns

### Go Error Handling Best Practices

1. **Use `errors.As()` for type assertions**: Standard Go 1.13+ error handling
2. **Check error properties**: `TimeoutError.TimeoutType()` vs separate error types
3. **Import enums correctly**: Timeout types come from `go.temporal.io/api/enums/v1`

## References

**Temporal Go SDK Documentation**:
- Error Handling: https://docs.temporal.io/develop/go/error-handling
- TimeoutError: https://pkg.go.dev/go.temporal.io/sdk/temporal#TimeoutError
- Error Checking: https://pkg.go.dev/go.temporal.io/sdk/temporal (IsApplicationError, etc.)

**Fixed File**:
- `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`

**Related Java Implementation** (for comparison):
- `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java`
