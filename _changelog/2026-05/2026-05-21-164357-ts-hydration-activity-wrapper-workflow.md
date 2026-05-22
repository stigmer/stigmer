# TS Hydration Activity and Wrapper Workflow for Workflow Execution

**Date**: May 21, 2026

## Summary

Built the bridge between the Java/Go orchestrators (which pass slim orchestration IDs) and the TS workflow engine (which expects a fully materialized input). Added a `HydrateWorkflowExecution` Temporal activity that gRPC-fetches workflow YAML, execution context, and trigger data, then parses and assembles the engine input. Added a `stigmer/workflow/execute-from-execution` wrapper workflow that hydrates then runs the engine inline. Extracted the engine core into a shared `runWorkflowEngine()` function to eliminate code duplication.

## Problem Statement

The old Go `workflow-runner` service (deleted May 21, 2026) implemented the `ExecuteWorkflow` Temporal activity that bridged slim orchestration coordinates to the CNCF Serverless Workflow engine. The unified TS runner replaced the Go runner but only registered `stigmer/workflow/execute` as a Temporal workflow expecting pre-materialized input. No code existed to hydrate slim IDs into that materialized input, leaving workflow execution broken through the Java/Go orchestrators.

### Pain Points

- Workflow execution through the Java service (production path) could not work with the unified TS runner
- ~70 workflow integration tests could not compile due to the deleted `WorkflowRunner` field
- The TS engine expected a fully parsed `WorkflowModel`, merged env map, and trigger payload — but received only execution/workflow/instance IDs

## Solution

Three-part bridge:

1. **HydrateWorkflowExecution activity** — Temporal activity (Node.js side) that fetches WorkflowExecution (for `trigger_message`), Workflow (for pre-validated YAML from `status.serverlessWorkflowValidation.yaml`), and ExecutionContext (for merged env). Validates YAML state, parses YAML via `loadWorkflowFromYaml`, flattens ExecutionContext data, and returns `ExecuteServerlessWorkflowInput`.

2. **`stigmer/workflow/execute-from-execution` wrapper workflow** — Temporal workflow (sandbox side) that calls the hydration activity then runs the engine inline via `runWorkflowEngine()`. The workflow ID is `workflow-exec-{executionId}`, making it the direct signal target for the Java orchestrator's `relaySignal()` — no double-nesting of child workflows.

3. **Shared engine core extraction** — Moved all engine setup (activity proxies, TaskExecutionContext assembly, state management, input/output resolution, task execution, metrics) from `executeServerlessWorkflow` into `runWorkflowEngine()` in `engine-core.ts`. Both the direct workflow and wrapper workflow call it. Zero duplication.

## Implementation Details

### New files

- **`activities/hydrate-workflow-execution.ts`** (~230 lines): Factory pattern matching `discover-mcp-server.ts`. Core `hydrateWorkflowExecution(input, client)` function separated for testing. Handles validation states (VALID/PENDING/INVALID/FAILED), NOT_FOUND errors, YAML parse failures, empty ExecutionContext, and trigger_message JSON parsing. Uses `ApplicationFailure.retryable()` for PENDING (validation in progress) and `ApplicationFailure.nonRetryable()` for permanent failures.

- **`workflows/engine-core.ts`** (~230 lines): Shared engine core with `runWorkflowEngine()`. All sandbox-safe: `proxyActivities`/`proxyLocalActivities` for eval/call/run proxies, `TaskExecutionContext` assembly wiring activity proxies to engine callbacks, `resolveInputFrom`/`resolveOutputAs` helpers.

- **`workflows/execute-from-execution.ts`** (~90 lines): Wrapper workflow with `ExecuteFromExecutionInput` type matching Java `InvokeWorkflowExecutionWorkflowInput` wire format (snake_case via `@JsonNaming(SnakeCaseStrategy.class)`). Calls hydration activity (2min timeout, 3 retries) then `runWorkflowEngine`.

- **`activities/__tests__/hydrate-workflow-execution.test.ts`** (~280 lines): 18 unit tests covering happy path, all validation states, env flattening with is_secret tracking, trigger_message JSON parsing (valid/invalid/empty/missing), gRPC NOT_FOUND errors, malformed YAML, workflow ID resolution from WorkflowInstance, and metadata assembly.

### Modified files

- **`client/stigmer-client.ts`**: Added `WorkflowQueryController`, `WorkflowInstanceQueryController`, `WorkflowExecutionQueryController` query clients with `getWorkflow()`, `getWorkflowInstance()`, `getWorkflowExecution()` methods
- **`workflows/execute-serverless-workflow.ts`**: Thinned to delegate to `runWorkflowEngine()` from `engine-core.ts`. Type exports (`ExecuteServerlessWorkflowInput`, `ExecutionMetadata`) preserved.
- **`workflows/index.ts`**: Added `stigmer/workflow/execute-from-execution` export
- **`runner.ts`** and **`runner-manager.ts`**: Registered `createHydrateWorkflowActivities` in `createAllActivities`
- **`__test-utils__/mock-client.ts`**: Added mock defaults for new client methods

## Benefits

- Unblocks Workstream B (Java/Go orchestrator rewrite to use child workflows)
- Preserves the slim-payload pattern — secrets stay out of Temporal workflow history
- Signal relay works without double-nesting (wrapper IS the signal target)
- Existing `stigmer/workflow/execute` workflow unchanged (backward compatible)
- Engine code shared, not duplicated

## Impact

| Component | Change |
|-----------|--------|
| TS runner activities | New `HydrateWorkflowExecution` activity registered |
| TS runner workflows | New `stigmer/workflow/execute-from-execution` workflow registered |
| StigmerClient | 3 new query methods for workflow resources |
| Engine code | Extracted into shared `engine-core.ts` |
| Tests | 18 new unit tests, 23 existing workflow tests pass |

## Related Work

- [Delete legacy runners, migrate integration harness](2026-05-21-153507-delete-legacy-runners-migrate-integration-harness.md) — Session 14 that deleted the Go workflow-runner
- [Desktop embedded runner execution target routing](2026-05-20-215359-desktop-embedded-runner-execution-target-routing.md) — Session 7 that established the unified runner architecture
- Pre-deploy integration test expansion project — `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/`

---

**Status**: Production Ready (activity + workflow registered; orchestrator rewrite in Workstream B)
**Timeline**: ~1.5 hours (single session)
