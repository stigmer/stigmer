# Fix Workflow Approval Handler Test Compilation

**Date**: May 22, 2026

## Summary

Fixed a build-breaking compilation failure in `WorkflowExecutionSubmitApprovalHandlerTest` that was causing the entire stigmer-cloud CI pipeline to fail (1 build failure, 134 tests skipped).

## Problem Statement

The CI pipeline for stigmer-cloud was failing after the per-execution workflow queue routing commit (`8cd3af5b`). The `workflow_execution_submit_approval_handler_test` target failed to build, blocking all other test targets.

### Pain Points

- CI completely blocked — 134 tests skipped due to shared library build failure
- The test referenced a non-existent class (`ai.stigmer.apiauthorization.model.AuthorizationResult`)
- Missing transitive dependency (`io_grpc_grpc_stub`) not caught during initial test authoring

## Solution

Two targeted fixes to restore CI:

1. **Correct the authorization result type** — Replace the phantom `AuthorizationResult` import with `ai.stigmer.utils.step.StepResult`, the actual return type of `RequestAuthorizationService.authorize()`
2. **Add missing Bazel dependency** — Add `@maven//:io_grpc_grpc_stub` to the test target for `StreamObserver` usage in the `ForwardToChildStep` test

## Implementation Details

**File 1**: `WorkflowExecutionSubmitApprovalHandlerTest.java`
- Replaced `import ai.stigmer.apiauthorization.model.AuthorizationResult` → `import ai.stigmer.utils.step.StepResult`
- Changed `AuthorizationResult authResult = mock(AuthorizationResult.class)` → `StepResult authResult = mock(StepResult.class)` in both authorization test methods
- No behavioral change — `StepResult.isValid()` matches the method signature the handler already calls

**File 2**: `BUILD.bazel`
- Added `@maven//:io_grpc_grpc_stub` to the `workflow_execution_submit_approval_handler_test` deps list

## Benefits

- CI pipeline restored — all 135 test targets can build and run again
- No production code changes required; issue was purely in test scaffolding

## Impact

- **stigmer-cloud CI**: Unblocked
- **Production**: No change — the handler code was already correct

## Related Work

- [Per-Execution Workflow Queue Routing](2026-05-22-133923-per-execution-workflow-queue-routing.md) — the feature commit that preceded this test failure

---

**Status**: ✅ Production Ready
