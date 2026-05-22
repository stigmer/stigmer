# Workflow Execution Worker Recovery and Per-Execution Routing Integration Tests

**Date**: May 22, 2026

## Summary

Added worker recovery in the desktop app's `WorkflowExecutionDetailPage` and created a new integration test suite (`test/integration-wfexec-routing/`) that validates per-execution Temporal task queue routing end-to-end. The worker recovery ensures that navigating to any in-flight workflow execution automatically registers a Temporal worker on the `wfexec:{id}` queue, fixing the case where executions get stuck after a runner crash or restart.

## Problem Statement

Workflow executions triggered from the desktop app were stuck indefinitely after a runner crash/restart. The runner starts in manager mode with zero workers and only creates them on-demand via IPC when `addWorkflowExecution(executionId)` is called. If that call fails (runner crashed, IPC pipe broken), the worker is never created and the child workflow task sits on the `wfexec:{id}` queue with zero pollers forever.

### Pain Points

- Workflow executions stuck in PENDING/IN_PROGRESS with no progress after runner crash
- No recovery mechanism when navigating to an existing execution detail page
- No integration test coverage for `STIGMER_WORKFLOW_ACTIVITY_ROUTING=execution` mode
- The `WorkflowExecutionDetailPage` only removed workers on terminal phase but never ensured they existed on mount

## Solution

Two-part fix: idempotent worker recovery in the detail page (ensures worker exists whenever viewing a non-terminal execution) and a new integration test suite that exercises the full per-execution routing path.

## Implementation Details

### Worker Recovery (WorkflowExecutionDetailPage)

Added a `useEffect` that calls `addWorkflowExecution(id)` whenever the page displays a non-terminal execution. The call is idempotent (`runner-manager.ts` returns early if the worker already exists), so it's safe to call on every mount.

### Integration Test Suite (test/integration-wfexec-routing/)

Created a new Go test module mirroring `test/integration-session-routing/` structure:

- **Tier 1 (routing_offline_test.go)**: Verifies Temporal workflow memo contains `runnerTaskQueue = wfexec:{executionId}` and that multiple executions get distinct queues
- **Tier 2 (dispatch_offline_test.go)**: Verifies the IPC runner manager picks up child workflows, tests idempotent add, worker removal stops polling, and independent execution isolation

All 6 tests pass: 2 memo verification + 4 dispatch verification.

### Runner Rebuild

Discovered that `dist/main.js` was stale (missing `addWorkflowExecution` IPC handler). Rebuilt the runner, which also fixes the desktop app's runner binary.

## Benefits

- Workflow executions self-heal when the user navigates to the detail page
- Handles runner restart, page refresh, direct URL navigation, and crash recovery
- Per-execution routing now has dedicated integration test coverage
- Regression protection for the routing path that was previously untested

## Impact

- **Desktop app**: Workflow executions resume automatically when viewing them after a runner crash
- **Integration tests**: New `test/integration-wfexec-routing/` catches routing misconfigurations early
- **Runner**: Rebuilt `dist/main.js` includes all IPC commands (was stale)

## Related Work

- Per-execution workflow queue routing (May 22, 2026 — earlier in session)
- Session routing integration tests (May 21, 2026)
- Unified runner architecture simplification (May 18-21, 2026)

---

**Status**: ✅ Production Ready
