# Fix Worker Shutdown Error Message Propagation

**Date**: May 31, 2026

## Summary

Fixed a race condition where worker shutdown during ExecuteCursor produced an empty or raw Temporal error message instead of a user-friendly "runner worker was shut down" message. The fix adds a direct shutdown signal check in the runner (bypassing a heartbeat timing race) and defense-in-depth fallback error extraction on the Java workflow side.

## Problem Statement

When `RemoveWorkflowExecution` fires while ExecuteCursor is actively streaming, the agent execution reaches `EXECUTION_FAILED` but the `error` field is either empty or contains a raw Temporal SDK message (`"Worker is shutting down and this activity did not complete in time"`). Users see a cryptic infrastructure message instead of the actionable "Execution interrupted: runner worker was shut down. Retry or resume."

### Pain Points

- Empty error field: the Java workflow's catch block sent only `phase=FAILED` with no error, assuming the runner already persisted one — that assumption breaks when the gRPC connection tears down during shutdown
- Raw Temporal message: a race condition in the heartbeat timer caused the runner to misclassify worker shutdown as a pause, then the Temporal drain timeout overwrote the runner's CancelledFailure with its own generic message
- Integration test `TestWfExecDispatch_RemoveDuringExecuteCursor` was permanently skipped (missing `CURSOR_API_KEY`) and could not verify the fix from the May 30 premature-shutdown session

## Solution

Three-layer defense-in-depth:

1. **Runner shutdown signal race fix** — check the `AbortSignal` directly alongside the heartbeat flag, eliminating the TOCTOU race between `shutdownController.abort()` and the heartbeat timer's `CancelledFailure` detection
2. **Java workflow fallback error** — extract a meaningful error from the `ActivityFailure` exception chain when the runner's gRPC persist fails, producing consistent user-facing messages
3. **Merge logic hardening** — change the error merge in `UpdateExecutionStatusActivityImpl` to "first non-empty wins" so the runner's rich error (when it does persist) is never overwritten by the Java fallback

## Implementation Details

### Layer 1: Runner shutdown signal race fix (`execute-cursor/index.ts`)

The heartbeat timer fires every 30 seconds. When `removeWorkflowExecution` calls `shutdownController.abort()` followed immediately by `worker.shutdown()`, the heartbeat may detect the Temporal `CancelledFailure` (from worker drain) before the `AbortSignal` microtask propagates. This causes it to set `cancelled = true` instead of `workerShutdown = true`, misclassifying shutdown as pause.

Fixed by checking the shutdown signal directly after the stream ends:

```typescript
const isShutdown = periodicHeartbeat.workerShutdown || (shutdownSignal?.aborted ?? false);
if (isShutdown) {
  pauseDetected = false;
} else if (periodicHeartbeat.cancelled) {
  pauseDetected = true;
}
workerShutdownDetected = isShutdown;
```

### Layer 2: Java workflow fallback error (`InvokeAgentExecutionWorkflowImpl.java`)

Added `extractActivityFailureMessage()` that unwraps `ActivityFailure` → `CanceledFailure` to detect worker shutdown from the exception message. The catch block now includes a fallback error in the status update:

```java
String fallbackError = extractActivityFailureMessage(e);
AgentExecutionStatus failedStatus = AgentExecutionStatus.newBuilder()
    .setPhase(ExecutionPhase.EXECUTION_FAILED)
    .setError(fallbackError)
    .build();
```

Detection handles both the runner's custom message (`"worker shutdown"`) and Temporal's drain message (`"shutting down"`).

### Layer 3: Error merge hardening (`UpdateExecutionStatusActivityImpl.java`, `AgentExecutionUpdateStatusHandler.java`)

Changed the error merge from "overwrite if incoming non-empty" to "first non-empty wins":

```java
if (!statusUpdates.getError().isEmpty() && statusBuilder.getError().isEmpty()) {
    statusBuilder.setError(statusUpdates.getError());
}
```

This preserves the runner's rich error when its gRPC persist succeeds, while allowing the Java fallback to fill the gap when it fails. Applied consistently in both the Temporal activity path and the gRPC handler path.

## Benefits

- Users always see a meaningful, actionable error message on worker shutdown
- The race condition between AbortSignal propagation and heartbeat CancelledFailure detection is eliminated
- Runner's rich error messages are never overwritten by less-specific Java fallback messages
- Integration test `TestWfExecDispatch_RemoveDuringExecuteCursor` now passes with live Cursor API key

## Impact

- **Desktop app users**: Clear "runner worker was shut down. Retry or resume." message instead of empty or cryptic errors
- **Integration test coverage**: The previously-skipped test now validates the full shutdown → error propagation → assertion chain
- **Operational visibility**: Worker shutdown events are distinguishable from pause and heartbeat timeout in both the error field and runner logs

## Related Work

- [`2026-05-30-194915-fix-premature-worker-shutdown-stale-react-state.md`](_changelog/2026-05/2026-05-30-194915-fix-premature-worker-shutdown-stale-react-state.md) — The parent fix that introduced the three-layer defense; this session resolves the remaining error propagation gap discovered during integration testing

---

**Status**: Production Ready
**Timeline**: Single session
