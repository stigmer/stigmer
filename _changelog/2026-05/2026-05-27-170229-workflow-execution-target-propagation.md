# Workflow Execution Target Propagation

**Date**: May 27, 2026

## Summary

Wired `executionTarget` through the full workflow execution pipeline — from the desktop UI create call, through the Java Temporal slim input, into the TS runner's environment, and onto child agent sessions. This ensures the desktop app's workflow executions route to the local runner instead of silently provisioning a Daytona cloud sandbox with old code.

## Problem Statement

Workflow executions triggered from the desktop app were dispatched to Daytona cloud sandboxes running a 4-day-old Docker image (`ghcr.io/stigmer/runner:main-67477c0`, built May 23). The sandbox image lacked all structured output fixes from May 24-27, causing persistent "Agent did not return structured output" failures that no amount of local runner rebuilding could fix.

### Pain Points

- `useRunWorkflowFlow.ts` never passed `executionTarget` to the create RPC — the workflow execution spec had `EXECUTION_TARGET_UNSPECIFIED` (0)
- The Java service resolved UNSPECIFIED to CLOUD (the cloud edition default), provisioning a Daytona sandbox for every workflow execution
- The `InvokeWorkflowExecutionWorkflowInput` slim record did not carry `executionTarget`, so even if the server resolved it, the TS runner had no way to propagate it to child agent sessions
- Child agent sessions created by `call-agent.ts` (workflow-to-agent calls) also lacked `executionTarget`, causing them to independently resolve to CLOUD
- Session-based agent executions (direct UI runs) worked correctly because `useCreateSession.ts` already passed `executionTarget` — the asymmetry between sessions and workflow executions was the root cause

## Solution

Three-layer fix that mirrors the session execution target pattern:

1. **UI → Server**: `useRunWorkflowFlow.ts` now passes `contextTarget` (from `StigmerProvider`) as `executionTarget` on the workflow execution create call, exactly as `useCreateSession.ts` does for sessions.

2. **Server → Runner**: `InvokeWorkflowExecutionWorkflowInput` now carries `executionTarget` (resolved by the dispatch service). All 4 call sites (create, signal, approval, recover) pass the resolved target.

3. **Runner → Child Sessions**: The TS runner reads `execution_target` from `ExecutionMetadata`, propagates it through `state.env.__stigmer_execution_target`, and `call-agent.ts` sets it on every child session spec — ensuring child agent executions inherit the parent workflow's execution target.

## Implementation Details

### stigmer (OSS) — 4 files

- `sdk/react/src/workflow/useRunWorkflowFlow.ts`: Added `executionTarget: contextTarget ? toProtoExecutionTarget(contextTarget) : undefined` to the create call
- `backend/services/runner/src/workflows/execute-serverless-workflow.ts`: Added `execution_target?: number` to `ExecutionMetadata`
- `backend/services/runner/src/workflows/engine-core.ts`: Propagates `metadata.execution_target` into `state.env.__stigmer_execution_target`
- `backend/services/runner/src/activities/call-agent.ts`: Reads `__stigmer_execution_target` from `runtimeEnv`, resolves to `ExecutionTarget` enum, sets on child session spec

### stigmer-cloud — 5 files

- `InvokeWorkflowExecutionWorkflowInput.java`: Added `executionTarget` field to record, updated `fromExecution` factory signature
- `WorkflowExecutionCreateHandler.java`: Passes `dispatch.executionTarget()` to `fromExecution`
- `WorkflowExecutionSendSignalHandler.java`: Same
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandler.java`: Same
- `WorkflowExecutionRecoverHandler.java`: Same

## Benefits

- Desktop app workflow executions route to the local embedded runner, not a stale cloud sandbox
- Child agent executions inherit the parent workflow's execution target, maintaining routing consistency
- The pattern mirrors session execution target propagation — consistent architecture

## Impact

- **Desktop users**: Workflow executions now use the local runner with current code instead of a Daytona sandbox with potentially stale code
- **Cloud users**: No change — CLOUD target continues to provision sandboxes as before
- **Platform builders**: The `executionTarget` prop on `StigmerProvider` now governs both session and workflow execution routing uniformly

---

**Status**: Production Ready
**Timeline**: Single session
