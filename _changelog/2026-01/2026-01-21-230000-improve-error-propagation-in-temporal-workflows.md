# Improve error propagation in Temporal workflows for agent execution

**Date:** 2026-01-21  
**Type:** Enhancement  
**Component:** Temporal workflows, agent-runner  
**Impact:** High - All errors now visible to users, not just in logs

## Problem

When the agent-runner binary failed to start (e.g., due to the multipart import error fixed in the previous PR), the error was only visible in agent-runner logs. Users would see a generic timeout error instead of the actual problem.

**Error Flow (Before):**
1. agent-runner fails to start due to import error
2. Error logged to agent-runner logs only
3. Temporal workflow waits for activity
4. Workflow times out after `ScheduleToStartTimeout`
5. User sees: "Activity timeout" (not helpful)
6. User must check agent-runner logs to find actual error

This meant that critical startup errors like missing dependencies were invisible to users unless they had access to backend logs.

## Solution

Implemented comprehensive error propagation strategy to ensure **all errors are visible to users**, regardless of where they occur in the execution lifecycle.

### 1. Enhanced Startup Error Logging

**File:** `backend/services/agent-runner/main.py`

Added structured, detailed error logging for startup failures:

```python
except Exception as e:
    logger.error(f"❌ Fatal error in worker: {e}", exc_info=True)
    logger.error("=" * 80)
    logger.error("STARTUP FAILURE: Activity Registration Error")
    logger.error("=" * 80)
    logger.error(f"Error: {e}")
    logger.error("Common causes:")
    logger.error("  - Missing Python dependencies (import errors)")
    logger.error("  - Temporal connection failure")
    logger.error("  - Activity implementation errors")
    logger.error("This error will prevent the worker from processing any activities.")
    logger.error("Check the stack trace above for the exact import or initialization error.")
    logger.error("=" * 80)
    sys.exit(1)
```

**Benefits:**
- Clear, structured error messages
- Common causes listed for quick diagnosis
- Easy to search logs with `STARTUP FAILURE` keyword
- Makes it obvious this is a blocking error

### 2. Activity Heartbeats

**File:** `backend/services/agent-runner/worker/activities/execute_graphton.py`

Added heartbeat mechanism to detect worker crashes:

```python
# Send activity heartbeat every 5 events
if events_processed - last_heartbeat_sent >= heartbeat_interval:
    try:
        activity.heartbeat({
            "events_processed": events_processed,
            "messages": len(status_builder.current_status.messages),
            "tool_calls": len(status_builder.current_status.tool_calls),
            "phase": status_builder.current_status.phase,
        })
        last_heartbeat_sent = events_processed
    except Exception as e:
        activity_logger.debug(f"Heartbeat failed (event {events_processed}): {e}")
```

**Benefits:**
- Temporal knows the activity is alive and making progress
- If worker crashes, Temporal detects it within 30 seconds (instead of waiting for full timeout)
- Heartbeat payload includes progress information for debugging
- Enables distinction between "worker crashed" vs "activity timeout"

### 3. Activity Timeout Configuration

**File:** `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/execute_graphton.go`

Added comprehensive timeout configuration with heartbeat support:

```go
options := workflow.ActivityOptions{
    TaskQueue:              taskQueue,
    StartToCloseTimeout:    10 * time.Minute, // Max execution time
    ScheduleToStartTimeout: 1 * time.Minute,  // Max wait for worker
    HeartbeatTimeout:       30 * time.Second,  // Activity must send heartbeat every 30s
    RetryPolicy: &temporal.RetryPolicy{
        MaximumAttempts:    1, // No retries (agent execution not idempotent)
        InitialInterval:    10 * time.Second,
        BackoffCoefficient: 2.0,
    },
}
```

**Timeout Strategy:**
- `ScheduleToStartTimeout`: Detects when worker is not available (1 minute)
- `HeartbeatTimeout`: Detects when worker crashes mid-execution (30 seconds)
- `StartToCloseTimeout`: Prevents runaway executions (10 minutes)
- `MaximumAttempts: 1`: Prevents duplicate agent executions

### 4. Workflow Error Wrapping

**File:** `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`

Added `wrapActivityError()` function to provide user-friendly error messages:

```go
func (w *InvokeAgentExecutionWorkflowImpl) wrapActivityError(activityName string, err error) error {
    // SCHEDULE_TO_START timeout: Worker not available
    if workflow.IsScheduleToStartTimeoutError(err) {
        return fmt.Errorf(
            "activity '%s' failed: No worker available to execute activity. "+
            "This usually means:\n"+
            "1. agent-runner service is not running\n"+
            "2. agent-runner failed to start (check agent-runner logs for startup errors)\n"+
            "3. agent-runner is not connected to Temporal\n"+
            "Original error: %w",
            activityName, err,
        )
    }
    
    // HEARTBEAT timeout: Worker died mid-execution
    if workflow.IsHeartbeatTimeoutError(err) {
        return fmt.Errorf(
            "activity '%s' failed: Activity stopped sending heartbeat (worker may have crashed). "+
            "Check agent-runner logs for errors. "+
            "Original error: %w",
            activityName, err,
        )
    }
    
    // ... handles other timeout types ...
}
```

**Error Messages Now Distinguish:**
- Worker not available (not running or failed to start)
- Worker crashed mid-execution (stopped sending heartbeats)
- Activity execution timeout (took too long)
- Application errors (from Python activity)

## Error Flow (After)

### Startup Failure:
1. agent-runner fails to start due to import error
2. Detailed error logged to agent-runner logs (with `STARTUP FAILURE` banner)
3. Temporal workflow waits for activity
4. Workflow times out with `ScheduleToStartTimeout` (1 minute)
5. `wrapActivityError()` detects timeout type and creates helpful message
6. User sees: "No worker available. This usually means: agent-runner failed to start (check logs for import errors)"
7. Execution status updated to FAILED with error details

### Worker Crash:
1. Activity starts executing
2. Activity sends heartbeats every 5 events
3. Worker crashes (e.g., out of memory)
4. Temporal detects missing heartbeat (30 seconds)
5. `wrapActivityError()` detects heartbeat timeout
6. User sees: "Activity stopped sending heartbeat (worker may have crashed). Check agent-runner logs."
7. Execution status updated to FAILED with error details

## Error Categories

| Error Type | Detection Method | Time to Detect | User Message |
|-----------|------------------|----------------|--------------|
| Worker startup failure | ScheduleToStartTimeout | 1 minute | "agent-runner failed to start (check logs)" |
| Worker crash mid-execution | HeartbeatTimeout | 30 seconds | "Activity stopped sending heartbeat" |
| Activity execution timeout | StartToCloseTimeout | 10 minutes | "Activity execution timed out" |
| Application error | Activity return value | Immediate | Actual error from Python |
| System error (init) | Top-level catch in Python | Immediate | "System error: [details]" |

## Files Modified

```
backend/services/agent-runner/main.py
backend/services/agent-runner/worker/activities/execute_graphton.py
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/execute_graphton.go
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities/ensure_thread.go
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go
docs/architecture/error-propagation.md (new)
```

## Verification

To verify the improvements:

### Test 1: Worker Startup Failure
```bash
# Simulate import error in agent-runner
# Add `raise ImportError("test")` at top of worker.py
./dist/agent-runner

# Expected:
# - Detailed startup failure logged
# - User sees: "No worker available... check logs for startup errors"
```

### Test 2: Worker Crash During Execution
```bash
# Simulate crash mid-execution
# Add `os.kill(os.getpid(), signal.SIGKILL)` after 10 events
./dist/agent-runner

# Expected:
# - Heartbeat stops
# - Timeout detected in 30 seconds (not 10 minutes)
# - User sees: "Activity stopped sending heartbeat (worker crashed)"
```

### Test 3: Activity Execution Error
```bash
# Simulate execution error
# Add `raise ValueError("test error")` in execute_graphton.py

# Expected:
# - Error caught by handler
# - Status updated to FAILED
# - User sees: "❌ Error: Execution failed: test error"
```

## Impact

**Before:**
- ❌ Startup errors only in logs
- ❌ Generic "timeout" errors for users
- ❌ No distinction between error types
- ❌ Long wait times (up to 10 minutes) to detect worker crashes
- ❌ Users can't troubleshoot without backend access

**After:**
- ✅ All errors visible to users
- ✅ Helpful, actionable error messages
- ✅ Clear distinction between error types
- ✅ Fast detection of worker crashes (30 seconds)
- ✅ Users can self-serve troubleshooting with error messages
- ✅ Operators can search logs efficiently (`STARTUP FAILURE` keyword)

## Related Issues

- Fixes the visibility issue for multipart import error (previous PR)
- Aligns agent execution error handling with workflow execution
- Implements best practices from Temporal documentation

## Documentation

Added comprehensive documentation:
- `docs/architecture/error-propagation.md` - Complete error propagation strategy
  - Error categories and flows
  - Architecture diagrams
  - Implementation details
  - Testing strategies
  - Best practices

## Future Improvements

1. **Pre-flight health checks** - Check if worker is healthy before starting workflow (fail fast)
2. **Structured error codes** - Add error codes (E001, E002, etc.) for better categorization
3. **Error recovery strategies** - Implement automatic recovery for transient errors
4. **Metrics and alerts** - Add metrics for error types and alert on patterns

---

*This enhancement ensures that errors like the multipart import issue are immediately visible to users through proper error propagation, not just buried in backend logs.*
