# Fix Duplicate Workflow Execution Name on Re-run

**Date**: May 22, 2026

## Summary

Fixed a bug where running the same workflow twice from the UI (web or desktop) failed with a duplicate slug error. The `useRunWorkflowFlow` hook generated a static execution name (`{workflowName} execution`) that produced the same slug on every run. Added timestamped names, unit tests for the hook, and a Playwright regression test.

## Problem Statement

When a user clicked "Run Workflow" on any workflow in the Stigmer UI, the execution was created with a fixed name like `"daily-notification-plan execution"`. The backend's `CheckDuplicateStep` correctly enforces org-scoped slug uniqueness, so any subsequent run of the same workflow was rejected with:

> `WorkflowExecution with slug 'daily-notification-plan-execution' already exists in org 'tt-demo'`

### Pain Points

- Users could not re-run workflows from the UI without first deleting the previous execution
- The error message was confusing — it sounded like a server bug rather than a naming collision
- Both the web app and desktop app were affected (they share the same React hook)
- Every other client (CLI, E2E tests, integration harness) already generated unique names

## Solution

Changed the execution name in `useRunWorkflowFlow` to include an ISO 8601 timestamp, producing names like `"daily-notification-plan 2026-05-22 12:30:00"`. This follows the platform convention where all clients generate unique execution names, while preserving human readability in the UI.

## Implementation Details

### Bug Fix (1 line)

`sdk/react/src/workflow/useRunWorkflowFlow.ts` — Changed static name to timestamped:

```typescript
// Before
name: `${workflowName} execution`,

// After
name: `${workflowName} ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
```

### Unit Tests (new file, 12 tests)

`sdk/react/src/workflow/__tests__/useRunWorkflowFlow.test.tsx` — First-ever tests for this critical hook:

- Unique name generation (fake timers prove two runs produce different names)
- Required/optional/secret env var validation
- Submit success and failure (duplicate error) paths
- Reset clears all form state
- Instance selection routing (`workflowId` vs `workflowInstanceId`)

### Playwright Regression Test (1 new test)

`test/e2e/tests/interactive/workflow-run-flow.spec.ts` — "running the same workflow twice creates two distinct executions": runs the same workflow twice consecutively, verifies both reach Completed, and asserts different execution URLs.

## Diagnostic Finding

The initial desktop app failure ("Failed" / "No tasks started") was traced via MongoDB query to a separate root cause: the Temporal orchestrator routed the execution through the legacy v0 activity path (`activityType='ExecuteWorkflow'`), which targeted the deleted Go `workflow-runner` pod. The old `workflow-runner` K8s deployment (running for 126 days) was cleaned up as part of this session.

## Benefits

- Users can now re-run any workflow from the UI without errors
- The `useRunWorkflowFlow` hook has comprehensive test coverage for the first time
- Regression test ensures this class of bug cannot recur
- Removed the obsolete `workflow-runner` deployment from production

## Impact

- **SDK**: `@stigmer/react` — all consumers (web app, desktop app) get the fix automatically
- **Production**: Cleaned up `workflow-runner` deployment in `stigmer-prod` namespace (freed cloud resources)
- **Local dev**: Identified and cleaned up 5 orphaned runner processes (freed ~2.4 GB RAM)

## Related Work

- Unified runner migration (replaced Go `workflow-runner` with TS `runner`)
- Temporal `child-workflow-migration` version gate in both Go and Java orchestrators

---

**Status**: ✅ Production Ready
