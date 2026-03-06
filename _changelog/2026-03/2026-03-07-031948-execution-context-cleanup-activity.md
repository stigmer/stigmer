# ExecutionContext Cleanup Activity (T04)

**Date**: March 7, 2026

## Summary

Implemented the ExecutionContext cleanup activity that completes the ExecutionContext lifecycle: creation during execution setup (T02), runtime use by runners, and now deletion when the workflow finishes. The activity uses `workflow.NewDisconnectedContext` for cancellation-safe secret cleanup and is shared by both AgentExecution and WorkflowExecution workflows. A critical production bug in the Java Cloud codebase -- where the cleanup activity was defined but never registered -- was also fixed.

## Problem Statement

After T01-T03 established ExecutionContext creation (with fully-merged environment including secrets), workflow input slimming, and runtime_env stripping, the lifecycle had a gap: ExecutionContexts were never cleaned up after execution completed. This meant sensitive data (merged environment variables including secrets) persisted indefinitely in the store.

### Pain Points

- ExecutionContext resources containing secrets lingered in the store after execution completion
- No cleanup on workflow success, failure, or cancellation
- Java Cloud had `DeleteExecutionContextActivity` defined but **not registered** in either worker config -- a silent production bug where the `finally` block cleanup call was a no-op
- OSS Go had no cleanup implementation at all

## Solution

Created a shared `DeleteExecutionContextActivity` as a local Temporal activity in the `executioncontext` domain (used by both AE and WE workflows). The activity uses the store-direct pattern consistent with existing local activities, and is called at all workflow exit points using `workflow.NewDisconnectedContext` for cancellation safety.

## Implementation Details

### New Activity (OSS Go)

- **Package**: `executioncontext/temporal/activities/`
- **Pattern**: Store-direct (like `LoadAgentExecution`, `UpdateExecutionStatus`)
- **Lookup**: `store.FindByField("spec.executionId", executionID)` to locate the EC by execution ID
- **Delete**: `store.DeleteResource(kind, resourceID)` to remove it
- **Idempotent**: No-op if ExecutionContext doesn't exist (already deleted or never created)
- **Best-effort**: Logs errors but never returns them -- TTL-based backup handles orphans
- **Security-aware**: Logs variable count, never variable names or values

### Workflow Integration (OSS Go)

- Added `deleteExecutionContext()` private method to both AE and WE workflow implementations
- Uses `workflow.NewDisconnectedContext(ctx)` so cleanup runs even if the workflow was cancelled
- Called at **both** exit points (success and failure) in `Run()`, after all other operations complete
- Retry policy: 3 attempts, 2s initial interval, 30s schedule-to-close timeout

### Java Cloud Bug Fix

- `DeleteExecutionContextActivityImpl` was a `@Component` with repository access, called in workflow `finally` blocks
- But it was **never registered** in `AgentExecutionTemporalWorkerConfig` or `WorkflowExecutionTemporalWorkerConfig`
- Added constructor injection and `registerActivitiesImplementations(...)` in both worker configs

### BUILD.bazel

- New BUILD.bazel for `executioncontext/temporal/activities/` package
- Fixed missing `load_execution.go` in AE activities BUILD.bazel (pre-existing T03 issue)
- Added EC activities dependency to 4 BUILD.bazel files (AE temporal, AE workflows, WE temporal, WE workflows)

### T05 Follow-up Documentation

Documented a comprehensive follow-up task for cancellation safety across all cleanup operations. The key insight: `completeExternalActivity` has dual failure semantics (must-succeed on success path, best-effort on failure path) that make a blanket `NewDisconnectedContext` + `defer` restructuring architecturally dangerous. T05 proposes a cancellation-aware three-path design (success, failure, cancellation) as the recommended approach.

## Benefits

- **Security**: ExecutionContext (containing secrets) is now cleaned up when the workflow finishes
- **Cancellation safety**: Cleanup runs even when workflows are cancelled, preventing secret leakage
- **Production bug fix**: Java Cloud's `DeleteExecutionContextActivity` now actually executes
- **Idempotency**: Safe to retry, safe against race conditions
- **Defense in depth**: TTL-based backup handles orphaned contexts if the activity fails
- **Shared implementation**: Single activity used by both AE and WE workflows (no duplication)

## Impact

- **Both AE and WE workflows** in OSS Go now clean up ExecutionContexts on completion
- **Java Cloud** cleanup activity now actually runs (was silently failing)
- **No breaking changes** -- unlike T03's workflow input change, T04 is purely additive
- **No existing behavior altered** -- cleanup is added to existing exit points, existing cleanup operations untouched

## Related Work

- **T01**: Downstream clients (Environment query, ExecutionContext command)
- **T02**: CreateExecutionContextStep (pipeline step for EC creation)
- **T03**: Slim workflow input and runtime_env stripping
- **T05**: Comprehensive cancellation safety for all cleanup operations (documented, ready for future session)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (T04 implementation)
