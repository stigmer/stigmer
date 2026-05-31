# Version-Pinned Execution Graph Correctness

**Date**: May 31, 2026

## Summary

Fixed three structural bugs in the workflow versioning system that caused the "workflow definition may have changed" warning to appear even on newly created executions. The fixes ensure version-pinned graph rendering works correctly for all execution creation paths, prevent dangling audit references, and surface version resolution failures with honest UX messaging.

## Problem Statement

After the workflow versioning infrastructure was deployed, the execution graph viewer continued showing a stale mismatch warning ("The workflow definition may have changed since this execution ran") on executions that should have been version-pinned. The root causes were not a legacy-data issue but three structural bugs in the pinning pipeline.

### Pain Points

- Executions created with only `workflow_instance_id` (no `workflow_id` on spec) never got `workflowVersionHash` stamped — the pin step couldn't resolve the workflow
- Failed audit writes left dangling hash references that `getVersion` couldn't resolve, causing silent fallback to live workflow
- The frontend hook's bare `catch {}` masked all version fetch failures, showing a misleading "may have changed" warning instead of explaining what actually happened

## Solution

### Bug 1: Instance-Only Pin Resolution

Extended `PinWorkflowVersionStep` (both Go OSS and Java Cloud) to resolve `workflow_id` from the workflow instance when `spec.workflowId` is absent. This mirrors the runner's `resolveWorkflowId` pattern in `hydrate-workflow-execution.ts`.

**OSS Go**: Added `resolveWorkflowIDFromInstance()` method that loads the instance from the store and extracts `spec.workflowId`.

**Cloud Java**: Added `WorkflowInstanceRepo` dependency and `resolveWorkflowIdFromInstance()` private method.

### Bug 2: Audit-Hash Invariant Enforcement

Established the invariant: **if `workflow.status.versionHash` is set, the audit entry for that hash exists.**

**OSS Go**: `saveVersionAuditStep` now reverts the version hash (clears `status.VersionHash` and `metadata.version.Id`) if audit write fails. Pipeline order swapped so audit runs before persist.

**Cloud Java**: `ArchiveWorkflowVersionStep` no longer calls `context.setNewState()` on archival failure, so the workflow persists with its pre-update state (no new hash).

### Bug 3: Typed Frontend Error Handling

Replaced the bare `catch {}` in `useWorkflowExecutionGraph` with structured resolution:
- Added `versionFetchFailed: boolean` to the fetch result
- Added `versionResolutionFailed: boolean` to the hook return type
- Differentiated banner messages based on actual failure mode

### Legacy Execution Backfill

Added migration logic (Go bootstrap function + Java Mongock migration) to stamp `workflowVersionHash` on pre-versioning executions whose workflow has exactly one audit entry (deterministic case).

## Implementation Details

### Files Changed (OSS — `stigmer`)

- `backend/.../workflowexecution/controller/pin_workflow_version_step.go` — Added instance resolution with store lookup
- `backend/.../workflow/controller/version_steps.go` — `saveVersionAuditStep` reverts hash on failure
- `backend/.../workflow/controller/create.go` — Swapped audit before persist in pipeline
- `backend/.../workflow/controller/update.go` — Same pipeline reorder
- `backend/.../workflow/migration/bootstrap_execution_versions.go` — New: execution hash backfill
- `backend/.../workflow/migration/BUILD.bazel` — New source + dep
- `backend/.../workflowexecution/controller/BUILD.bazel` — Test file + deps
- `backend/.../workflowexecution/controller/pin_workflow_version_step_test.go` — New: 5 unit tests
- `sdk/react/src/workflow/useWorkflowExecutionGraph.ts` — Typed error handling + differentiated messages

### Files Changed (Cloud — `stigmer-cloud`)

- `backend/.../workflowexecution/request/step/PinWorkflowVersionStep.java` — Instance resolution via `WorkflowInstanceRepo`
- `backend/.../workflow/request/handler/steps/ArchiveWorkflowVersionStep.java` — Safe-degradation (no `setNewState` on failure)
- `backend/.../migrations/U20260530c_BackfillExecutionVersionHashes.java` — New: Mongock migration (order "037")

## Benefits

- **Correctness for all creation paths**: Instance-only executions now get version-pinned
- **No dangling references**: Audit-hash invariant prevents unresolvable version lookups
- **Honest UX**: Users see exactly what happened — "unable to load pinned version" vs "predates version tracking" vs no banner
- **Legacy cleanup**: Existing executions are backfilled where deterministically possible
- **Tested**: 5 unit tests covering the pin step's resolution logic and edge cases

## Impact

- All workflow execution creation paths (CLI, SDK, web editor, scheduled triggers)
- Both OSS (Go) and Cloud (Java) editions
- React SDK consumers via `useWorkflowExecutionGraph` hook
- Embedded `WorkflowExecutionGraph` component in third-party dashboards

## Related Work

- Workflow Versioning Infrastructure (2026-05-30-175736) — original versioning scaffolding
- Versioning Integration Fixes (2026-05-30-183501) — React SDK hook fixes
- Skill versioning (established the pattern)

---

**Status**: Production Ready
**Timeline**: Single session
