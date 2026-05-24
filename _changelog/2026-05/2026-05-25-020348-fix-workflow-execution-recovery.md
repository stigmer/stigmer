# Fix Workflow Execution Recovery

**Date**: May 25, 2026

## Summary

Replaced the broken Temporal ResetWorkflowExecution-based recovery mechanism with a terminate-and-re-trigger approach across both Cloud (Java) and OSS (Go) backends. Added ExecutionContext recreation during recovery so workflows have access to environment variables and secrets. Hardened the Go workflow orchestrator against the same RECORD_MARKER replay bug that was already fixed in the Java orchestrator.

## Problem Statement

When a user clicked "Recover" on a failed workflow execution, the UI updated (phase changed to IN_PROGRESS, buttons changed to Pause/Cancel) but the Temporal workflow was stuck in a Workflow Task Failed loop with zero pending activities. No actual progress was made.

### Pain Points

- Recovery appeared to succeed (UI updated) but the workflow never actually re-executed
- The Temporal workflow was stuck in an infinite Workflow Task Failed retry loop
- Users had no way to re-run failed workflows after fixing the underlying issue (e.g., fixing model configuration, rotating API keys)
- The `daily-notification-plan` workflow in TT Demo was permanently stuck after the model registry resolution fix

### Root Causes

1. **Wrong reset point**: Both backends found the last `WorkflowTaskCompleted` event, which was after the failure handling path. Resetting here replayed the failure handling and re-threw the same error.
2. **RECORD_MARKER replay bug (Go)**: The Go orchestrator used local activities for failure cleanup in the same workflow task as the child workflow failure, triggering a Temporal SDK state machine bug that caused Workflow Task Failed loops.
3. **ExecutionContext deleted before recovery**: The orchestrator's cleanup deleted the merged environment variables on all exit paths. Recovery never recreated them, so recovered workflows ran with empty environment.

## Solution

Replaced the Temporal `ResetWorkflowExecution` approach with a clean terminate-and-re-trigger strategy, added ExecutionContext recreation, and hardened the Go orchestrator.

## Implementation Details

### Cloud Java Backend (`stigmer-cloud`)

**`WorkflowExecutionRecoverHandler.java`**:
- Removed `FindResetPointStep` and `ResetTemporalWorkflowStep` (Temporal history scanning and reset API)
- Added `TerminateExistingWorkflowStep`: Terminates stuck/failed Temporal workflow (handles NOT_FOUND gracefully)
- Added `RecreateExecutionContextStep`: Re-resolves env from current WorkflowInstance env_refs + Workflow env declarations, deletes stale EC if present, creates fresh EC
- Added `StartNewWorkflowStep`: Starts fresh Temporal orchestrator via `InvokeWorkflowExecutionWorkflowCreator.create()` (same path as original create)
- Pipeline order: LoadExisting → Authorize → ValidateRecoverable → Terminate → RecreateEC → EnsureSandbox → StartNewWorkflow → UpdatePhase → Persist → PublishToRedis

### OSS Go Backend (`stigmer`)

**`recover.go`**: Updated pipeline to use `TerminateExistingWorkflow` + `RecreateExecutionContext` + `StartFreshWorkflow`

**`lifecycle_steps.go`**: Replaced `ResetTemporalWorkflowStep` with `TerminateExistingWorkflowStep` and `StartFreshWorkflowStep` that reuse the existing `WorkflowCreator`

**`recreate_execution_context_step.go`** (new): Dedicated step that re-resolves environment from WorkflowInstance + Workflow, handles stale/missing EC, creates fresh EC

**`invoke_workflow_impl.go`**: Hardened failure/cancel/cleanup paths with version gate `"remote-cleanup-stubs"`:
- v1: Uses `workflow.ExecuteActivity()` (remote) to avoid RECORD_MARKER replay bugs
- v0: Keeps existing local activity path for in-flight workflow replay safety
- Applies to `updateStatusOnFailure`, `updateStatusOnCancellation`, and `deleteExecutionContext`

**`worker_config.go`**: Updated comments to reflect activities serve both local and remote execution

### Proto Documentation

**`command.proto`**: Updated `recover` RPC documentation to accurately describe behavior — same execution ID, fresh workflow re-execution (not checkpoint resume), environment re-resolution, `runtime_env` limitation

### Integration Tests

**`workflow_execution_recover_test.go`**: Enhanced with explicit phase assertions, error-cleared verification, same-ID check, and added `TestWorkflowExecution_Recover_IdempotentDoubleRecover`

## Benefits

- Recovery actually works — failed workflows can be re-triggered after fixing the underlying issue
- Environment variables and secrets are available in recovered workflows (EC recreation)
- Go orchestrator no longer gets stuck in Workflow Task Failed loops on child failure
- Proto documentation accurately reflects recovery semantics
- Idempotent — calling recover multiple times is safe

## Impact

- All workflow execution recovery in both Cloud and OSS backends
- No breaking API changes — same `recover` RPC, same input/output contract
- Known limitation: `runtime_env` overrides from original execution are not preserved (stripped before persist)

## Related Work

- Model registry resolution fix (`_changelog/2026-05/2026-05-25-013038-fix-llm-call-model-registry-resolution.md`) — the upstream fix that recovery was intended to pick up
- Java orchestrator RECORD_MARKER fix (already applied via `remote-cleanup-stubs` version gate)
- Go agent orchestrator fix (already applied in `agentexecution/temporal/workflows/invoke_workflow_impl.go`)

---

**Status**: ✅ Production Ready
