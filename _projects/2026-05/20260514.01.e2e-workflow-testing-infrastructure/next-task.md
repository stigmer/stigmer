# Next Task: 20260514.01.e2e-workflow-testing-infrastructure

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260514.01.e2e-workflow-testing-infrastructure

**Description**: Build a production-grade end-to-end integration testing infrastructure for Stigmer's workflow orchestration platform, targeting the Stigmer Cloud Java service with Postgres, Temporal, and both agent harnesses (LangGraph + Cursor SDK).
**Goal**: Create a layered integration test suite that proves the full workflow execution pipeline works end-to-end: Stigmer Cloud service → Temporal → workflow-runner → agent-runner/cursor-runner → results, with proper isolation, reporting, and CI wiring.
**Tech Stack**: Go (test harness, workflow-runner), Java (Stigmer Cloud service), TypeScript (cursor-runner, Cursor SDK), Python (agent-runner, LangGraph), Postgres (Testcontainers), Temporal, GitHub Actions, JUnit XML, OpenTelemetry
**Components**: test/e2e (rewrite), backend/services/cursor-runner, backend/services/agent-runner, backend/services/workflow-runner, stigmer-cloud/backend/services/stigmer-service, CI workflows (.github/workflows), secrets management

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
Check for the most recent checkpoint file:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/checkpoints/
```

### 2. Current Task
Review the current task status and plan:
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/tasks/
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/design-decisions/
```
Review architectural and strategic choices made for this project.

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/coding-guidelines/
```
Check project-specific patterns and conventions established.

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/wrong-assumptions/
```
Review misconceptions discovered to avoid repeating them.

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/dont-dos/
```
Check anti-patterns and failed approaches to avoid.

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint (if any) from `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/checkpoints/`
2. [ ] Check current task status in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/tasks/`
3. [ ] Review any new design decisions in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/design-decisions/`
4. [ ] Check coding guidelines in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/coding-guidelines/`
5. [ ] Review lessons learned in `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/wrong-assumptions/` and `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-05/20260514.01.e2e-workflow-testing-infrastructure/dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-14 10:02
**Current Task**: T03 Test Harness Core — COMPLETE
**Status**: In Progress (T03+T05 code complete, ready for runtime validation)

## Session Progress (2026-05-14, Session 3)

### Accomplished
- Implemented T03 Test Harness Core: fixture deployer, assertion helpers, workflow-runner supervisor
- Combined T03 + T05 into a single implementation pass
- Refactored from per-test harness to suite-scoped TestMain (start infra once, share across all tests)
- Built `harness/clients.go` — typed gRPC client factory for all workflow services
- Built `harness/fixture.go` — FixtureDeployer with ApplyWorkflow, CreateExecution, cleanup tracking
- Built `harness/assertions.go` — ExecutionWaiter with polling-based phase/terminal waiters
- Built `harness/workflow_runner.go` — Go workflow-runner binary build + child process supervisor
- Wrote `workflow_lifecycle_test.go` — first real E2E test (set_vars task → assert COMPLETED)
- Discovered `WorkflowExecutionSpec.workflow_id` shortcut that auto-resolves to default instance
- All code compiles cleanly (`go build`, `go vet` pass)

### Key Decisions Made
- **Suite-scoped harness via TestMain**: Start MongoDB/Redis/Temporal/Java/Runner once; share across tests
- **Thin fixture deployer**: Proto types are the domain types; no custom abstraction layer
- **Polling-first assertions**: Streaming subscription deferred to T07 when actually needed
- **Workflow-runner confirmed required**: Java service dispatches ExecuteWorkflow activity to Go runner task queues
- **workflow_id shortcut**: WorkflowExecution.spec.workflow_id auto-creates default instance; simplifies basic tests

### Files Changed

**stigmer (OSS)** — new:
- `test/integration/suite_test.go` — TestMain, suite-scoped harness
- `test/integration/harness/clients.go` — typed gRPC client factory
- `test/integration/harness/fixture.go` — FixtureDeployer
- `test/integration/harness/assertions.go` — ExecutionWaiter + assertion helpers
- `test/integration/harness/workflow_runner.go` — workflow-runner child process supervisor
- `test/integration/workflow_lifecycle_test.go` — first real smoke test

**stigmer (OSS)** — modified:
- `test/integration/harness/harness.go` — added WorkflowRunner field, updated Stop()
- `test/integration/infra_test.go` — uses suite-scoped testHarness
- `test/integration/service_test.go` — uses shared grpcConn
- `test/integration/smoke_test.go` — uses shared grpcConn
- `test/integration/go.mod` — added google/uuid, protobuf deps

## Session Progress (2026-05-14, Session 2)

### Accomplished
- Resolved OpenFGA authorization blocker — the last gap preventing real gRPC operations
- Created `TestIamPolicyGrpcRepo` — permit-all `IamPolicyGrpcRepo` implementation for test mode
- Made `IamPolicyGrpcRepoImpl` conditional on `stigmer.security.mode=production` (matchIfMissing=true)
- Verified VendorOAuthReconciler is safe (vendor credentials not configured in test mode → FGA write path never reached)
- All 62 Bazel unit tests pass, all 3 integration tests pass
- Smoke test now returns `NotFound` for non-existent workflow (previously returned `INTERNAL` from OpenFGA)

### Key Decisions Made
- **Replace repo, not handlers**: `IamPolicyGrpcRepo` is the single bottleneck — replacing the impl covers all 50+ handlers without modifying any
- **MongoDB-backed list operations**: `listAuthorizedResourceIds` queries MongoDB for all document IDs of the resource kind (collection name = `ApiResourceKind.name()` by convention), so list handlers work correctly
- **No OpenFGA Testcontainer needed**: Permit-all bypass is standard for testing services with IAM; OpenFGA can be added later for IAM-specific tests

### Files Changed

**stigmer-cloud**:
- `IamPolicyGrpcRepoImpl.java` — added `@ConditionalOnProperty` (production-only)
- `TestIamPolicyGrpcRepo.java` — NEW: permit-all IamPolicyGrpcRepo for test mode

## Session Progress (2026-05-14, Session 1)

### Accomplished
- Completed full architecture spike (S1-S8) for E2E testing infrastructure
- Investigated Java service auth/profiles — discovered Auth0/OpenFGA cannot be disabled without code changes
- Implemented `stigmer.security.mode=test` conditional auth bypass in stigmer-cloud (4 files modified, 1 new file)
- Built Go test harness with Testcontainers (MongoDB + Redis) and Temporal dev server bootstrap
- Java service starts in test mode and responds to gRPC health checks — **~8 seconds total startup**
- Smoke test proves full gRPC pipeline: Go client → gRPC → Spring Boot handler → MongoDB → response

### Key Decisions Made
- **Auth bypass**: Test Spring profile (`stigmer.security.mode=test`) following Stripe's `@ConditionalOnProperty` pattern
- **Service startup**: Fat JAR as child process (not Docker image — GHCR has no `latest` tag, tags are git revision only)
- **InProcessMachineAccountTokenInjectorInterceptor**: Changed from `@RequiredArgsConstructor` to `ObjectProvider<MachineAccountJwtProvider>` for graceful degradation
- **GrpcRequestContextBuilderInterceptor**: Added `InterceptorContextHolder.hasContext()` skip for test mode

### Surprises Resolved
1. MongoDB `char[]` password binding fails with empty string → used `SPRING_DATA_MONGODB_URI` override
2. R2/S3 stores unconditionally scanned → included R2 profiles with dummy env vars
3. Stripe `@ConditionalOnProperty` fires on empty default → provided dummy key
4. `security.authentication.*` properties needed despite auth bypass → included `auth0` profile with dummy values
5. `GrpcRequestContextBuilderInterceptor` overwrites test caller identity → added context-already-set skip

### Files Changed

**stigmer (OSS)**:
- `test/integration/` — NEW: Go test harness module (7 files)
- `go.work` — added `test/integration` module

**stigmer-cloud**:
- `GrpcSecurityConfigBase.java` — added `@ConditionalOnProperty` (production-only)
- `MachineAccountJwtProvider.java` — added `@ConditionalOnProperty` (production-only)
- `HttpSecurityConfig.java` — added `@ConditionalOnProperty` (production-only)
- `InProcessMachineAccountTokenInjectorInterceptor.java` — changed to `ObjectProvider` for graceful degradation
- `GrpcRequestContextBuilderInterceptor.java` — added context-already-set skip
- `IntegrationTestSecurityConfig.java` — NEW: permit-all security + synthetic test caller identity

## Next Steps
1. **Runtime validation** — build the fat JAR and run `go test -tags=integration -v -timeout=5m ./...` to validate the full pipeline
2. **Org bootstrap** — if the runtime test reveals org-creation issues, add org bootstrap to fixture deployer
3. **T04: JUnit XML + Trace Bundle Output** — wire gotestsum, collect service logs on failure
4. **T02: Delete Legacy E2E Tests** — remove `test/e2e/` (76 files) and clean up Makefile/CI references
5. **T06: CI Workflow** — create `.github/workflows/ci.integration-offline.yaml`

## Context for Resume
- T03 code is complete — fixture deployer, assertion helpers, workflow-runner supervisor, and the first E2E test all compile
- The code has NOT been runtime-tested yet — need to build the fat JAR and run the integration tests
- The `DeployAndExecute` convenience method uses `spec.workflow_id` (auto-resolves to default instance) — no explicit WorkflowInstance creation needed for simple tests
- The workflow-runner is started as a child process via `go build` from `backend/services/workflow-runner/`
- Org bootstrap question remains empirical — discovered at first `apply()` call runtime
- Runner startup is non-blocking (no port to wait on — it's a Temporal worker that polls)

## Quick Commands

After loading context:
- "Continue with T03" - Build the full test harness
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
