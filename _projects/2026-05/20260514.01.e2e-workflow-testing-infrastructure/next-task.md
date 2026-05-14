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
**Current Task**: OpenFGA Authorization Bypass — COMPLETE
**Status**: In Progress (auth + authz bypass done, moving to T03)

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
1. **T03: Test Harness Core** — complete the full harness with fixture deployer, assertion helpers, trace bundle output
2. **T05: First real smoke test** — apply a workflow via gRPC, trigger execution, assert COMPLETED
3. **T02: Delete Legacy E2E Tests** — remove `test/e2e/` (76 files) and clean up Makefile/CI references

## Context for Resume
- Both authentication AND authorization are now bypassed in test mode — the full handler pipeline works
- The smoke test proves it: workflow Get returns `NotFound` (correct) instead of `INTERNAL` (OpenFGA failure)
- All Bazel builds succeed, all 62 unit tests pass, all 3 integration tests pass
- The Go test harness in `test/integration/` is ready for fixture deployer and assertion helpers

## Quick Commands

After loading context:
- "Continue with T03" - Build the full test harness
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
