# Fix Temporal Workflow Stuck-on-Failure (Task Retry Loop)

**Date**: May 25, 2026

## Summary

Fixed a fundamental issue where Temporal workflows became permanently stuck in an infinite task retry loop whenever an agent execution or workflow execution failed. The root cause was using bare `RuntimeException` (which Temporal treats as a code bug and retries forever) instead of `ApplicationFailure` (which terminates the workflow execution cleanly). Also fixed a concurrency race in the runner's fetch interceptor that could corrupt proxy headers when multiple activities run in parallel.

## Problem Statement

When triggering multiple workflows locally, some would sporadically become permanently stuck with the log message "If seen continuously the workflow might be stuck" and escalating retry attempts (`Attempt=2`, `Attempt=4`, `Attempt=5`...). The Temporal UI showed the workflow as `Running` with repeated `WorkflowTaskFailed` events, while MongoDB already showed `EXECUTION_FAILED` — a split-brain state.

### Pain Points

- Stuck workflows consumed resources indefinitely (unlimited default timeout)
- The Temporal UI showed `Running` while Stigmer showed `Failed` — confusing for operators
- Multiple concurrent local workflow triggers reliably reproduced the issue
- The `finally` block cleanup (billing finalization, ExecutionContext deletion) never committed to history — silently lost on every failure path
- The existing unit test passed despite the bug because it only verified side effects, not terminal state

## Solution

Three independent fixes addressing the full failure chain:

1. **Replace RuntimeException with ApplicationFailure** in both orchestrator workflows — the only change needed for Temporal to properly terminate workflow executions on business failures
2. **Remove duplicate `getVersion` calls** that triggered Temporal SDK bug #2810 (same changeId called twice in one task + exception = internal "runner-closed" error)
3. **Add AsyncLocalStorage to the fetch interceptor** so concurrent activities on the same runner process don't overwrite each other's execution ID proxy headers

## Implementation Details

### stigmer-cloud (Java backend)

| File | Change |
|------|--------|
| `InvokeAgentExecutionWorkflowImpl.java` | `throw new RuntimeException(...)` → `throw ApplicationFailure.newNonRetryableFailure(...)` at the main catch-block rethrow site; removed inline `getVersion("single-site-fail-external")` blocks from `executeCursorFlow` and `executeDeepAgentFlow` |
| `InvokeWorkflowExecutionWorkflowImpl.java` | `throw Workflow.wrap(new RuntimeException(...))` → `throw ApplicationFailure.newNonRetryableFailure(...)` at all three throw sites (ChildWorkflowFailure catch, generic Exception catch, legacy path) |
| `InvokeAgentExecutionWorkflowCursorTest.java` | Added `testExecutionFailed_WorkflowReachesTerminalState()` that asserts `WorkflowFailedException` is thrown and cleanup activities execute |

### stigmer (TypeScript runner)

| File | Change |
|------|--------|
| `fetch-interceptor.ts` | Added `AsyncLocalStorage`-backed `runWithExecutionContext()` for per-activity isolation; `replaceAuth()` now reads executionId from async context first |
| `execute-cursor/index.ts` | Wrapped activity body in `runWithExecutionContext()` to isolate concurrent executions |

## Benefits

- Workflow failures reach terminal `FAILED` state cleanly (matching Go OSS behavior)
- `finally` block activities (billing finalize, EC cleanup) are properly committed to Temporal history and execute
- No more split-brain between Temporal and MongoDB state
- Concurrent local workflow executions can no longer corrupt each other's proxy headers
- New test catches the exact class of bug that was previously invisible

## Impact

- All `InvokeAgentExecutionWorkflow` and `InvokeWorkflowExecutionWorkflow` instances that hit the failure path
- Cloud and local environments both benefit (local was more affected due to concurrency on single runner process)
- Existing stuck workflows must be terminated manually (they can never self-recover from the old code's non-determinism)
- No behavioral change for successful workflow executions

## Related Work

- Temporal SDK issue [#2810](https://github.com/temporalio/sdk-java/issues/2810): getVersion + RuntimeException interaction
- Go OSS equivalent pattern: `temporal.NewApplicationError(...)` at `invoke_workflow_impl.go:106`
- Prior fix attempt (same night): commits `5f8cad22`, `b0291e5a` addressed symptoms (double failExternalActivity, remote stubs) but not the root cause

---

**Status**: ✅ Production Ready
