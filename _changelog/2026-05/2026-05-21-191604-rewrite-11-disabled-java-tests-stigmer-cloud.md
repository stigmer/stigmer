# Rewrite 11 @Disabled Java Tests in stigmer-cloud

**Date**: May 21, 2026

## Summary

Rewrote and re-enabled all 11 `@Disabled` Java test classes in `stigmer-cloud/backend/services/stigmer-service/`. These tests were disabled during Workstream E (BUILD.bazel wiring) due to API drift from production refactors. The rewrite restores 228 test methods across 5,955 lines, covering workflow execution lifecycle handlers, agent execution approval pipelines, Temporal workflow orchestration, environment merge/encryption services, and project reconciliation.

## Problem Statement

During the pre-deploy test expansion (Workstream E), 65 orphaned Java tests were wired into BUILD.bazel. 11 test classes could not compile due to deep API drift from prior refactors: renamed types (`Caller` → `RequestCallerIdentity`, `MethodMetadata` → `RequestMethodMetadata`), removed protos (`AgentExecutionMetadata`), changed context APIs (`setAttribute`/`getAttribute` → typed `Context.Key` `put`/`get`), refactored constructor signatures, and renamed result accessors.

### Pain Points

- 11 test classes at class-level `@Disabled` — zero coverage for critical handler pipelines
- 6 of the 11 were gutted to empty stubs (test bodies deleted to compile)
- Production handlers (cancel, terminate, recover, approval) had no unit test protection
- Environment merge/encryption pipeline changes were untested
- API drift accumulated silently — stale `@Disabled` reasons masked the real issues

## Solution

Systematic batch rewrite: analyze each production handler's current API, recover original test bodies from git (`49cd3128^`), adapt all imports/types/assertions to the current codebase, and re-enable.

## Implementation Details

### Batch 1 — Quick Wins (stale @Disabled, APIs already matched)
- **EnvironmentEncryptionIntegrationTest** (9 tests): `@Disabled` reason was stale — production `EncryptSecretValues` does call `setNewState()`. Removed annotation only.
- **NotifyParentActivitiesImplTest** (8 tests): Signal name/params already matched `child_approval_required` constant. Removed annotation only.

### Batch 2 — Workflow Execution Handler Pipeline
- **WorkflowExecutionCancelHandlerTest** (31 tests): APIs matched — removed annotation only.
- **WorkflowExecutionTerminateHandlerTest** (31 tests): Full rewrite from git recovery. Adapted: `Caller` → `RequestCallerIdentity`, builder-pattern context construction, typed `Context.Key`, `getGrpcStatus()`/`getErrorMessage()`.
- **WorkflowExecutionRecoverHandlerTest** (20 tests): Same rewrite pattern. Covers LoadExisting, ValidateRecoverable (5 phase gates), UpdatePhase (error clearing), Persist, PublishToRedis.

### Batch 3 — Agent Execution Tests
- **InvokeAgentExecutionWorkflowSignalTest** (5 tests): Full rewrite. `AgentExecution` proto input → `InvokeAgentExecutionWorkflowInput` record, removed `GenerateSessionSubjectActivity`, updated activity signatures.
- **InvokeAgentExecutionWorkflowCursorTest** (5 tests): Removed annotation — body was already compatible.
- **AgentExecutionSubmitApprovalHandlerTest** (44 tests): Full rewrite from 1612-line git original. Replaced `AgentExecutionMetadata` references with `ApiResourceMetadata` + `AgentExecutionStatus`. Context.Key API, `approvalGateResolved` signal.
- **WorkflowExecutionSubmitApprovalHandlerTest** (19 tests): Full rewrite. `ForwardToChildStep` in-process delegation to `AgentExecutionSubmitApprovalHandler`.

### Batch 4 — Domain Service Tests
- **EnvironmentMergeServiceTest** (26 tests): Full rewrite. Constructor `(EnvironmentRepo, EnvironmentSecretService)` → `(EnvironmentQueryGrpcRepo)`. `merge()` 3-arg → 2-arg. `filterByEnvSpec` → `filterByDeclaredKeys` with `EnvFilterResult`.
- **ProjectApplyHandlerTest** (30 tests): Rewritten for `ProjectReconciliationService` constructor addition and `reconcileAndEnrichResponse()` override.

### Production Code Changes (minimal)
- 4 handler files: Context.Key visibility changed from `private` to package-visible for same-package test access (consistent with existing `WorkflowExecutionCancelHandler` pattern):
  - `WorkflowExecutionTerminateHandler.java`
  - `WorkflowExecutionRecoverHandler.java`
  - `AgentExecutionSubmitApprovalHandler.java`
  - `WorkflowExecutionSubmitApprovalHandler.java`

## Benefits

- **228 test methods re-enabled** across 11 files protecting critical handler pipelines
- Zero `@Disabled` test classes remaining in the codebase
- Handler pipeline step coverage: LoadExisting, Authorize, Validate, Temporal interaction, UpdatePhase, Persist, PublishToRedis
- Approval flow coverage: phase gates, idempotency, billing checks, signal dispatch
- Environment merge coverage: priority ordering, gRPC error handling, secret fetching, key filtering

## Impact

- **Test suite**: 126 tests (from Workstream E) + 228 re-enabled = full coverage restored
- **Deployment confidence**: All handler pipelines now have unit test protection
- **Maintenance**: Future API changes will break tests immediately instead of silently accumulating drift

## Related Work

- Workstream E changelog: `_changelog/2026-05/2026-05-21-181820-wire-orphaned-java-tests-stigmer-cloud-build-bazel.md`
- Project: `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/`

---

**Status**: Production Ready
**Timeline**: ~1 hour
