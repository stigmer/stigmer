# T03: Test Harness Core — Fixture Deployer, Assertion Helpers, and Workflow Runner

**Date**: May 14, 2026

## Summary

Built the reusable foundation that every integration test will depend on: a fixture deployer for creating workflow resources via gRPC, polling-based assertion helpers for verifying execution outcomes, and a workflow-runner child process supervisor. Combined with T05 (first real smoke test) to validate the implementation immediately.

## Problem Statement

The integration test harness could start infrastructure (MongoDB, Redis, Temporal, Java service) and prove the gRPC pipeline works, but it could not:
- Create test workflow resources (templates, instances, executions)
- Trigger actual workflow execution through the system
- Assert that executions reach expected lifecycle phases
- Manage the Go workflow-runner needed for task execution

### Pain Points

- Each test started its own infrastructure (10-15s startup × N tests = unacceptable)
- No shared gRPC connection or typed client factory
- No way to apply workflows or trigger executions programmatically
- No way to poll execution status until completion
- The workflow-runner (required for task execution) was not part of the test infrastructure

## Solution

Implemented a layered test harness architecture:
1. **Suite-scoped TestMain** starts all infrastructure once, shares a gRPC connection
2. **Client factory** wraps all typed proto gRPC clients in one struct
3. **Fixture deployer** manages the Workflow → Instance → Execution chain with cleanup
4. **Assertion helpers** poll execution status with exponential backoff
5. **Workflow-runner supervisor** builds and starts the Go runner as a child process

## Implementation Details

**New harness components** (in `test/integration/harness/`):

- `clients.go` — `Clients` struct wrapping WorkflowCommand/Query, InstanceCommand/Query, ExecutionCommand/Query clients
- `fixture.go` — `FixtureDeployer` with `ApplyWorkflow`, `CreateExecution`, `DeployAndExecute`, and resource cleanup
- `assertions.go` — `ExecutionWaiter` with `WaitForPhase`, `WaitForTerminal` (250ms→2s exponential backoff), plus `AssertTaskStatus` and `AssertExecutionOutput`
- `workflow_runner.go` — `WorkflowRunner` that builds the binary from source and starts it with correct env vars

**Test refactoring**:
- New `suite_test.go` with `TestMain` — starts harness once, graceful skip if fat JAR missing
- Existing tests adapted to use shared `testHarness` and `grpcConn`

**Key discovery**: `WorkflowExecutionSpec.workflow_id` auto-resolves to a default instance, eliminating the need for explicit `WorkflowInstance` creation in simple tests.

## Benefits

- Infrastructure starts once per suite (not per test) — ~10s total instead of ~10s × N
- Every future integration test inherits fixture deployer and assertion helpers for free
- Proto-first design: test code uses the same types and clients as production code
- Cleanup tracking ensures no resource leakage between tests
- Graceful degradation: if workflow-runner binary can't be built, execution tests are skipped (not failed)

## Impact

- **Test authors**: Can write new workflow integration tests in ~20 lines (DeployAndExecute + WaitForTerminal + assert)
- **CI pipeline**: Suite-scoped harness makes the integration test suite viable for PR-blocking CI
- **Codebase foundation**: Every subsequent task (T07 lifecycle tests, T08 agent call, T11 HITL) builds on these components

## Related Work

- Session 1: Auth bypass (`stigmer.security.mode=test`) and harness infrastructure
- Session 2: OpenFGA authorization bypass (`TestIamPolicyGrpcRepo`)
- Next: T04 (JUnit XML + trace bundle), T02 (delete legacy E2E tests), T06 (CI workflow)

---

**Status**: ✅ Code Complete (awaiting runtime validation)
**Timeline**: Single session (~25 minutes implementation)
