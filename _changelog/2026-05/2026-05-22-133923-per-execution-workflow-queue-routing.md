# Per-Execution Workflow Queue Routing for Desktop App

**Date**: May 22, 2026

## Summary

Enabled per-session and per-execution queue routing so the desktop app's embedded runner can handle both agent sessions and workflow executions. Previously, the server routed all work to the shared `stigmer_runner` queue which the desktop runner never polled. This change activates the existing per-session/per-execution routing code paths and extends the runner-manager with workflow execution support.

## Problem Statement

The desktop embedded runner creates Temporal workers on `session:{id}` queues for agent executions and now `wfexec:{id}` queues for workflow executions. However, both the Go and Java servers defaulted to `global` routing (`STIGMER_ACTIVITY_ROUTING=global`, `STIGMER_WORKFLOW_ACTIVITY_ROUTING=global`), which routes all work to the shared `stigmer_runner` queue. The desktop runner never polls that queue, so both agent and workflow executions were broken on the desktop app.

### Pain Points

- Workflow executions from the desktop app showed "Failed" / "No tasks started" because no runner polled `stigmer_runner`
- Agent sessions created via the desktop's `addSession()` were creating workers on `session:{id}` queues that the server never routed work to
- A shared global queue (`stigmer_runner`) breaks tenant isolation -- any runner polling it could see any user's execution data

## Solution

Three-layer change: activate server routing flags, relax the per-execution dispatch condition to work for LOCAL target (not just CLOUD), and extend the desktop runner-manager with workflow execution support.

## Implementation Details

### Server dispatch (Go + Java)

Removed the `execution_target == CLOUD` gate from `ResolveWorkflowTaskQueue` (Go) and `WorkflowExecutionDispatchService.resolve` (Java). When `STIGMER_WORKFLOW_ACTIVITY_ROUTING=execution`, per-execution queues (`wfexec:{id}`) are now used regardless of execution target. For CLOUD, cloud sandboxes provision the runner. For LOCAL, the desktop runner-manager creates the worker.

### Runner-Manager (TypeScript)

- Added `addWorkflowExecution(executionId)` / `removeWorkflowExecution(executionId)` to `StigmerRunnerManager` interface
- Workers created on `wfexec:{executionId}` queues (mirroring the `session:{id}` pattern)
- Added `createWorkflowEventActivities` to the shared activity pool (was missing vs static runner)
- Extracted `createWorkerOnQueue()` helper to eliminate duplication
- Updated `shutdown()` to clean up both session and workflow execution workers

### IPC Protocol (TypeScript + Rust)

Extended the stdin/stdout JSON IPC protocol and Tauri commands with `addWorkflowExecution` / `removeWorkflowExecution` commands, mirroring the existing `addSession` / `removeSession` pattern.

### Desktop UI (React)

- `WorkflowDetailPage`: calls `addWorkflowExecution(executionId)` in `handleRunSuccess` (fire-and-forget)
- `WorkflowExecutionDetailPage`: watches execution phase and calls `removeWorkflowExecution(id)` when terminal phase is reached
- Extended `useEmbeddedRunner` and `EmbeddedRunnerContext` with workflow execution methods

### Integration Test Harness (Go)

- Added `WorkflowActivityRouting` field to `ServiceConfig` and `workflowActivityRouting()` helper
- Added `AddWorkflowExecution` / `RemoveWorkflowExecution` to `UnifiedRunnerManager` for future per-execution routing tests
- Existing tests continue to use `global` routing (no disruption)

## Benefits

- Desktop app can now execute both agent sessions and workflow executions locally without a separate CLI daemon runner
- Per-execution isolation prevents cross-tenant data leakage on shared Temporal clusters
- Unified routing model between cloud (sandbox-provisioned) and local (desktop-managed) execution targets

## Impact

- **Desktop app**: Workflow executions now work end-to-end when the embedded runner is active
- **Server (Go + Java)**: Per-execution routing now works for LOCAL target, not just CLOUD
- **Production**: Routing flags set in Kustomize overlays (local + prod); `.env` regenerated via Planton
- **Integration tests**: Harness extended but existing tests unaffected (still use global routing)

## Related Work

- Unified runner migration (May 18-21, 2026)
- Desktop embedded runner and session routing (May 20, 2026)
- Cloud workflow sandbox affinity (May 21, 2026)
- Fix duplicate workflow execution name (earlier in this session)
- Cleanup of legacy `workflow-runner` K8s deployment (earlier in this session)

---

**Status**: ✅ Production Ready
