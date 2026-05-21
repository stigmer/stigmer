# Execution Test Confidence: Lifecycle Coverage Expansion

**Date**: May 21, 2026

## Summary

Added 48 new tests across Go integration and Java unit layers to close the largest test coverage gaps for agent execution and workflow execution lifecycle control. Workflow execution had zero E2E tests for cancel/terminate/pause/resume/recover -- now has 11. Agent execution had weak recover assertions and missing terminate edge cases -- fixed and expanded.

## Problem Statement

Agent execution and workflow execution are the two pillars of Stigmer. After the unified runner migration and sandbox affinity implementation, the production code was complete but the test validation layer had critical gaps:

- Workflow execution lifecycle control (cancel, terminate, pause/resume, recover) had zero end-to-end integration tests despite being user-facing APIs
- Agent execution recover test asserted on the wrong execution ID (original instead of new recovered execution)
- Agent execution terminate had no idempotency or terminal-phase rejection tests
- `StripActivityTaskQueueStep` (security stripping for sandbox affinity) had no unit tests
- `WorkflowExecutionCreateHandler.StartWorkflowStep` had no unit tests
- Agent execution cancel and terminate handlers (Java) had zero unit tests despite workflow equivalents having full coverage

## Solution

Systematic test coverage following existing codebase patterns -- Go integration tests mirror `agent_execution_06_lifecycle_control_test.go`, Java unit tests follow the `@Nested` per-step pattern from `WorkflowExecutionCancelHandlerTest`.

## Implementation Details

### Go Integration Tests (stigmer repo)

**`workflow_execution_lifecycle_test.go`** (new, 8 tests):
- Cancel, CancelIdempotent, CancelTerminalFails
- Terminate, TerminateIdempotent
- Pause, PauseAndResume, PauseTerminalFails
- Three reusable workflow fixtures: `blockingWorkflow` (60s wait), `fastWorkflow` (single set_vars), `multiStepWorkflow` (8 steps + mid-wait)

**`workflow_execution_recover_test.go`** (new, 3 tests):
- Recover_AfterFailure (raise_error -> FAILED -> Recover -> re-enters IN_PROGRESS)
- RecoverNonFailedFails (COMPLETED -> Recover = FAILED_PRECONDITION)
- RecoverOnCancelledFails (CANCELLED -> Recover = FAILED_PRECONDITION)

**`agent_execution_06_lifecycle_control_test.go`** (modified, 2 new + 1 fix):
- Fixed `TestAgentExecution_Recover` to extract and wait on the new recovered execution ID
- Added `TestAgentExecution_TerminateIdempotent`
- Added `TestAgentExecution_TerminateTerminalFails`

### Java Unit Tests (stigmer-cloud repo)

**`StripActivityTaskQueueStepTest.java`** (new, 5 tests):
- External caller stripped, sandbox token preserved, workflow_sandbox token preserved, machine account preserved, empty queue no-op

**`StartWorkflowStepTest.java`** (new, 4 tests):
- Dispatch resolution + workflow creator called with correct input, dispatch failure returns INTERNAL, creator failure returns INTERNAL

**`AgentExecutionCancelHandlerTest.java`** (new, 13 tests):
- LoadExisting (found, not found, criticality)
- ValidateCancellable (6 phase variants including PAUSED, WAITING_FOR_APPROVAL, idempotency)
- CancelTemporalWorkflow (success, WorkflowNotFoundException, WorkflowServiceException)
- PublishToRedis (swallows errors, non-critical)

**`AgentExecutionTerminateHandlerTest.java`** (new, 13 tests):
- ValidateTerminatable (6 phase variants -- broader than cancel, includes CANCELLED)
- TerminateTemporalWorkflow (success with reason, default reason, WorkflowNotFoundException, WorkflowServiceException)
- PublishToRedis (swallows errors, non-critical)

**`BUILD.bazel`** (modified): 4 new `java_junit5_test` targets wired.

## Benefits

- Workflow execution lifecycle now has E2E parity with agent execution (11 integration tests vs 0 before)
- Agent recover test now validates the actual recovered execution, not the original failed one
- Security-critical `StripActivityTaskQueueStep` has positive and negative test coverage
- Agent handler Java unit tests now cover the two highest-risk lifecycle handlers (Cancel + Terminate)

## Impact

- **stigmer**: 3 files (2 new, 1 modified), 13 new Go integration tests
- **stigmer-cloud**: 5 files (4 new, 1 modified), 35 new Java unit tests, 4 BUILD.bazel targets
- **Total**: 48 new tests closing the largest lifecycle control coverage gaps

## Related Work

- `_changelog/2026-05/2026-05-21-211255-workstream-e-workflow-sandbox-tests.md`: Workstream E sandbox tests (predecessor)
- `_changelog/2026-05/2026-05-21-190955-agent-execution-pause-resume-fix.md`: Agent pause/resume fix
- `_changelog/2026-05/2026-05-21-174307-workstream-b-orchestrator-rewrite-pause-resume.md`: Orchestrator rewrite
- `.cursor/plans/execution_test_confidence_e0556d98.plan.md`: Full plan

---

**Status**: Production Ready
**Timeline**: 1 session
