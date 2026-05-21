# Workstream E: Workflow Sandbox Affinity — Tests + Validation

**Date**: May 21, 2026

## Summary

Filled all test coverage gaps for the cloud-side workflow sandbox affinity feature (Workstreams A-D). Wrote 31 new test cases across 6 test files, registered 5 missing BUILD.bazel targets, and fixed 5 pre-existing build/test issues. All 10 sandbox-related test suites now pass in CI.

## Problem Statement

Workstreams A-D implemented the cloud-side workflow sandbox affinity feature — sandbox provisioning, dispatch routing, agent override wiring, lifecycle cleanup hooks — across 15+ production files. While core infrastructure tests existed (provisioner, token service, dispatch service, orchestrator workflow), several newly introduced pipeline steps had no test coverage and three existing test files had no BUILD.bazel targets, making them invisible to CI.

### Gaps Identified

- DeprovisionWorkflowSandboxStep in cancel/terminate/delete handlers — untested
- EnsureWorkflowSandboxStep in recover handler — untested
- SessionDispatchService override routing (double-provisioning prevention) — untested
- DeprovisionWorkflowSandboxActivityImpl (retriable exception contract) — untested
- 3 test files had no BUILD.bazel targets (EnsureWorkflowSandboxStepTest, WorkflowExecutionDispatchServiceTest, InvokeWorkflowExecutionWorkflowImplTest)

## Solution

Systematic test coverage following the existing codebase patterns: JUnit 5 + Mockito, `@Nested` classes per pipeline step, `@DisplayName` for readable test names, `MockedStatic<Activity>` for Temporal activity implementations.

## Implementation Details

### New Test Files (2)

- **WorkflowExecutionDeleteHandlerTest** — 3 tests for DeprovisionWorkflowSandboxStep using `DeleteContextV2` + `context.getExistingResource()`. Documents that step runs AFTER DB delete (SessionDeleteHandler pattern).
- **DeprovisionWorkflowSandboxActivityImplTest** — 3 tests using `MockedStatic<Activity>`. Critical contract: exceptions propagate (NOT swallowed) so Temporal retries transient Daytona errors. This differs from DeleteExecutionContextActivity which swallows exceptions.

### Extended Test Files (4)

- **WorkflowExecutionCancelHandlerTest** — 4 tests: deprovision called with correct ID, always runs regardless of CTX_ALREADY_CANCELLED (idempotent safety net), exception swallowed (non-critical), isCritical==false.
- **WorkflowExecutionTerminateHandlerTest** — 4 tests: same contract. Documents that terminate handler's deprovision is the sole cleanup path (orchestrator finally does NOT run on terminate).
- **WorkflowExecutionRecoverHandlerTest** — 9 tests: CTX_ALREADY_RECOVERED skip, null-safe Boolean.TRUE.equals() gate, noop/LOCAL/global queue gates, provisioning success, recovery-specific UNAVAILABLE error message, environment verification, no-identity path.
- **SessionDispatchServiceTest** — 8 tests: null/empty override delegation, LOCAL target invariant (double-provisioning prevention), CURSOR/NATIVE harness preservation, null/missing session handling, routing mode bypass.

### BUILD.bazel Registration (5 targets)

- `:ensure_workflow_sandbox_step_test` — was on disk but invisible to CI
- `:workflow_execution_dispatch_service_test` — same
- `:invoke_workflow_execution_workflow_impl_test` — same (with `temporal_testing` dep)
- `:workflow_execution_delete_handler_test` — new
- `:deprovision_workflow_sandbox_activity_impl_test` — new

### Pre-existing Issues Fixed (5)

- `EnsureWorkflowSandboxStepTest` — wrong import path for RequestCallerIdentity + unnecessary stubbing in gate tests
- `DaytonaSandboxProvisionerTest` — ambiguous Daytona SDK `create()` overload
- `InvokeWorkflowExecutionWorkflowImplTest` — `EXECUTION_RUNNING` renamed to `EXECUTION_IN_PROGRESS`
- Cancel/Terminate handler tests — `WorkflowNotFoundException(null, null, null)` NPE
- Recover/Terminate handler tests — `save(any())` checked exception missing `throws`

## Benefits

- Every behavioral contract documented in production code Javadoc now has a corresponding test
- Critical design decisions are protected by tests (exception propagation vs swallowing, idempotent cleanup, double-provisioning prevention)
- 5 test targets registered in BUILD.bazel that were previously invisible to CI
- Pre-existing build issues fixed that were blocking the test suite

## Impact

- **stigmer-cloud**: 10 test files, 31 new test cases, 5 BUILD.bazel targets, 5 pre-existing fixes
- **Test coverage**: All handler lifecycle steps (cancel/terminate/delete/recover) now have sandbox cleanup/provisioning test coverage
- **CI**: 3 test files that existed but were invisible to CI are now registered and running

## Related Work

- Workstreams A-D: Cloud workflow sandbox affinity implementation (same project)
- `_changelog/2026-05/2026-05-21-180841-workflow-sandbox-affinity-architecture.md`: OSS foundation
- `_projects/2026-05/20260521.02.cloud-workflow-sandbox-affinity/tasks/T01_0_plan.md`: Full plan

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (~30 min implementation + debugging)
