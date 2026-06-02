# Fix: Workflow executions orphaned when run against a non-default instance

**Date**: June 2, 2026

## Summary

Workflow executions triggered against a specific (non-default) workflow instance were persisted with only `spec.workflow_instance_id` and an empty `spec.workflow_id`. Because every workflow-scoped query matches executions by exact equality on those two spec fields, such executions became invisible on the workflow's Overview and Executions views — even though they ran successfully. This change makes `spec.workflow_id` an always-populated invariant by resolving it from the execution's instance at creation time, in the OSS Go control plane (with the matching Cloud fix tracked separately).

## Problem Statement

A user reported a workflow whose Overview kept showing "No executions yet" despite many recent runs. Inspection of the live data revealed the workflow had two instances (a default and a second one), and runs against the second instance carried `spec.workflow_instance_id` only — `spec.workflow_id` was never set.

The workflow detail views (`ListByWorkflow`, `GetExecutionSummary`) filter with the Workflow ID and match an execution only when `spec.workflow_id == <id>` OR `spec.workflow_instance_id == <id>`. They never resolve a workflow to its set of instances. As a result, every execution created against a non-default instance was orphaned from all workflow-level views.

### Pain Points

- A workflow's Overview and Executions tabs silently omitted real runs, with no error — just an empty state.
- The gap depended on *how* the run was triggered (default vs. selected instance), making it confusing and hard to reproduce.
- The execution data itself was correct and reachable by ID; only the workflow-scoped *association* was missing.

## Solution

Enforce the invariant **"every persisted `WorkflowExecution` carries `spec.workflow_id`"** at write time. A workflow instance's parent workflow is immutable, so denormalizing `workflow_id` onto the execution cannot drift, while keeping the existing flat-equality read queries fast and unchanged.

A new pipeline step resolves and stamps `spec.workflow_id` from the execution's instance immediately after instance resolution. Because the create pipeline already guarantees `spec.workflow_instance_id` is set by that point (via `CreateDefaultInstanceIfNeeded`), the resolution is always possible for valid executions.

## Implementation Details

- New step `normalizeWorkflowRefStep` in `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/normalize_workflow_ref_step.go`.
  - Skips when `spec.workflow_id` is already set (never overwrites an explicit value).
  - Loads the instance referenced by `spec.workflow_instance_id` and sets `spec.workflow_id` from `instance.spec.workflow_id`.
  - Best-effort: when the instance cannot be loaded or has no `workflow_id`, it logs a warning and continues, preserving prior creation behavior rather than rejecting the request.
- Wired into `buildCreatePipeline()` in `create.go`, positioned after `CreateDefaultInstanceIfNeeded` and before `PinWorkflowVersion`, so downstream steps and persistence see the normalized spec.
- Read paths (`ListByWorkflow`, `GetExecutionSummary`) are intentionally left unchanged — they become correct once the data satisfies the invariant.
- The client is intentionally not changed: the server owns the invariant, so the CLI, web/desktop SDK, and any future caller all benefit without per-client wiring.
- Unit tests in `normalize_workflow_ref_step_test.go` cover: instance-only resolution, no-op when `workflow_id` is already set, and best-effort skips when the instance is missing or absent.

## Benefits

- Workflow Overview and Executions views now include runs from every instance of the workflow.
- The fix is server-side and client-agnostic, so it holds across CLI, web, and desktop.
- No read-path complexity or per-query instance resolution; queries stay simple and fast.

## Impact

- Affects how `WorkflowExecution` records are created in the OSS control plane. All new executions are self-describing (both instance and workflow IDs present).
- Pre-existing OSS local databases that already contain instance-only executions are not rewritten by this change; future runs are correct. A backfill for existing OSS data is deferred (the OSS migration package is currently unwired and does not compile against the present store interface — repairing that harness is tracked as separate follow-up).

## Related Work

- The matching Cloud (Java) fix — an equivalent `NormalizeExecutionWorkflowRefStep` in the create handler plus a Mongock backfill migration for existing data — lives in the `stigmer-cloud` repository and is committed there.
- Builds on the workflow versioning work that introduced `PinWorkflowVersionStep` and the instance-resolution pattern this step reuses.

---

**Status**: ✅ Production Ready (OSS write-path)
**Timeline**: Single session — investigation (live data), dual-edition implementation, and tests
