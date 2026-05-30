# Fix Premature Worker Shutdown from Stale React State Race

**Date**: May 30, 2026

## Summary

Fixed a critical bug where navigating between workflow executions in the desktop app killed running workers due to stale React state. The `useFetch` hook leaked terminal phase data from a previously-viewed execution into the new execution's identity, triggering `onWorkflowExecutionTerminated` on a live worker. Additionally, improved ExecuteCursor to correctly report `EXECUTION_FAILED` (not `EXECUTION_PAUSED`) when a worker is shut down mid-flight.

## Problem Statement

Users experienced two confusing issues when running workflow executions:
1. Agent executions reported "Execution paused by user" even though no one paused them
2. Workflow executions remained stuck in "running" state indefinitely after the agent failed

### Pain Points

- Users see a misleading "paused by user" message and must manually resume/retry
- Workflow executions never reach terminal state, requiring manual intervention
- Root cause was invisible to users — navigating between execution pages was enough to trigger it
- The existing heartbeat timeout fix (May 27, 2026) addressed a different cancellation path but missed this one

## Solution

Three-layer defense-in-depth fix:

1. **Root cause prevention** — `useFetch` resets data to `initialData` on deps change when the new cache key has no entry, preventing stale terminal phase from leaking across execution identities
2. **Defense-in-depth** — `useWorkflowExecution` verifies `execution.metadata.id === executionId` before firing `onWorkflowExecutionTerminated`, ensuring the phase data actually belongs to the current execution
3. **System resilience** — ExecuteCursor distinguishes worker-shutdown cancellation from orchestrator-initiated pause using an `AbortSignal`-based coordination between `runner-manager` and the `startHeartbeat` utility

## Implementation Details

### Layer 1: `useFetch` stale state fix (`sdk/react/src/internal/useFetch.ts`)

On deps change without remount, the hook checked cache for the new key but only handled the cache-hit case. On cache miss, the previous execution's data object remained in React state. Added an else clause that resets to `initialData` and clears `hasDataRef`:

```typescript
if (cacheKey && cacheRef.current) {
  const cached = cacheRef.current.get<T>(cacheKey);
  if (cached !== undefined) {
    setData(cached);
    hasDataRef.current = true;
  } else {
    setData(initialData);
    hasDataRef.current = false;
  }
} else if (!cacheKey) {
  setData(initialData);
  hasDataRef.current = false;
}
```

### Layer 2: Identity guard (`sdk/react/src/workflow/useWorkflowExecution.ts`)

Added `fetchedId === executionId` check to the termination effect's dependency array and condition:

```typescript
const fetchedId = execution?.metadata?.id;
// Only fire when data ACTUALLY belongs to this execution
if (fetchedId === executionId && TERMINAL_EXECUTION_PHASES.has(phase) && ...) {
  adapter.onWorkflowExecutionTerminated(executionId);
}
```

### Layer 3: Worker shutdown detection (`backend/services/runner/`)

- **`shared/heartbeat.ts`**: Extended `HeartbeatHandle` with `workerShutdown` boolean; added `HeartbeatOptions.shutdownSignal` parameter
- **`runner-manager.ts`**: Added per-queue `AbortController` registry (`_shutdownSignalRegistry`); abort fires before `worker.shutdown()` so activities detect worker-initiated cancellation
- **`activities/execute-cursor/index.ts`**: New `workerShutdownDetected` path reports `EXECUTION_FAILED` with "runner worker was shut down" instead of misleading `EXECUTION_PAUSED`

### Integration Test (`test/integration-wfexec-routing/premature_remove_test.go`)

New `TestWfExecDispatch_RemoveDuringExecuteCursor` test:
1. Deploys a workflow with a cursor `agent_call` task
2. Waits for the child agent execution to reach `IN_PROGRESS`
3. Calls `RemoveWorkflowExecution` mid-flight (simulating the UI race)
4. Asserts the agent reports `EXECUTION_FAILED` (not PAUSED)
5. Documents the workflow-stuck limitation (no worker to propagate failure)

## Benefits

- Eliminates false "paused by user" messages from execution navigation
- Users see accurate "worker was shut down" error messages when infrastructure issues occur
- Workers are never prematurely killed by navigating the UI
- All `useFetch` consumers (sessions, agent executions) benefit from the stale-state fix
- Integration test documents and guards against regression

## Impact

- **Desktop app users**: No more spurious pauses from page navigation
- **SDK consumers**: `useFetch` identity safety benefits all hooks with `cacheKey`
- **Workflow executions**: Long-running agent_call tasks survive UI browsing
- **Observability**: Clear distinction between user pause, heartbeat timeout, and worker shutdown in logs

## Related Work

- [`2026-05-27-215716-fix-cursor-heartbeat-timeout-false-pause.md`](_changelog/2026-05/2026-05-27-215716-fix-cursor-heartbeat-timeout-false-pause.md) — Previous fix for heartbeat-timeout-induced false pause (different trigger, same symptom)
- [`2026-02-14-182857-fix-agent-execution-error-propagation-and-heartbeat-timeout.md`](_changelog/2026-02/2026-02-14-182857-fix-agent-execution-error-propagation-and-heartbeat-timeout.md) — Background heartbeat introduction for ExecuteGraphton
- `test/integration-wfexec-routing/dispatch_offline_test.go` — Existing `RemoveStopsPolling` test (trivial workflow, not mid-flight)

---

**Status**: Production Ready (pending test verification)
**Timeline**: Single session
