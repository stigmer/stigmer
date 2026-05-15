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
**Current Task**: Listen converter implemented, E2E validated — Phase 2 complete
**Status**: 25 tests green (23 existing + 2 listen); ready for Phase 3

## Session Progress (2026-05-15, Session 11 — E2E Validation + Listen Converter)

### Accomplished
- **Validated Session 10 signal routing fix end-to-end** — all 23 tests pass with rebuilt JAR (initial run failed because JAR predated the `relaySignal` commit)
- **Implemented `convertListenTask`** — replaced empty stub with proper proto-to-YAML converter mapping `ListenTaskConfig` to the CNCF Serverless Workflow SDK's discriminated union structure
- **Added 2 listen integration tests** — `TestWorkflowListen_SignalUnblocks` (single signal, mode "one") and `TestWorkflowListen_AllMode` (two signals, both must arrive)
- **Full signal pipeline validated** — listen tasks work end-to-end through: gRPC SendSignal → Java handler → relaySignal → inner Go workflow signal channel → zigflow listen task completes

### Key Finding: JAR Build Timing
The initial E2E run exposed that the fat JAR was built at 08:48 but the `relaySignal` commit was at 09:53. HITL tests timed out because the JAR didn't contain the relay method. Rebuilding the JAR resolved the issue — all 25 tests pass in ~57 seconds.

### Converter Design: Proto Mode → Zigflow Strategy
The proto uses a flat `{mode, signals[]}` representation while zigflow uses a discriminated union under `listen.to`:
- `mode:"one"` + 1 signal → zigflow `one` (single EventFilter)
- `mode:"one"` + N signals → zigflow `any` (complete on first arrival)
- `mode:"all"` → zigflow `all` (wait for every signal)

### Files Changed

**stigmer (OSS)** — modified (1 file):
- `backend/services/workflow-runner/pkg/converter/task_converters.go` — implemented `convertListenTask`

**stigmer (OSS)** — new (1 file):
- `test/integration/workflow_listen_test.go` — 2 listen integration tests (signal unblocks + all-mode)

## Session Progress (2026-05-15, Session 10 — Java Signal Routing Fix)

### Accomplished
- **Fixed Java signal routing for HITL and listen tasks** — the production blocker where signals sent via the gRPC API were silently dropped by the outer Java workflow
- **Added `relaySignal` `@SignalMethod`** to `InvokeWorkflowExecutionWorkflow` interface — generic signal forwarding from outer to inner workflow
- **Implemented relay logic** in `InvokeWorkflowExecutionWorkflowImpl` — stores `executionId` as instance field, uses `Workflow.newUntypedExternalWorkflowStub("workflow-exec-{id}")` to forward signals to the inner Go workflow
- **Updated `InvokeWorkflowExecutionWorkflowCreator.signalWithStart()`** — now routes through `relaySignal` so the outer workflow forwards to the inner workflow where signal channels live
- **Updated HITL integration tests** — removed direct Temporal SDK signal bypass, now uses `clients.ExecutionCommand.SubmitWorkflowTaskApproval()` gRPC API to exercise the full signal routing path
- **Removed `temporalclient` and `fmt` imports** from test file (no longer needed)

### Design Decision: No `Workflow.getVersion()` Needed
The plan suggested using `Workflow.getVersion()` for backward compatibility. After careful analysis:
- Adding a new `@SignalMethod` is additive — no existing event history replay is affected
- The `relaySignal` signal was never sent by old code, so it's never in any old event history
- Storing `executionId` as an instance field doesn't change command sequences
- Unnecessary versioning would add dead code complexity

### Key Architecture (Signal Flow After Fix)
```
User/API → Java Handler → SignalWithStart("relaySignal", [signalName, payload])
  → Outer Java Workflow (InvokeWorkflowExecution)
    → relaySignal() → Workflow.newUntypedExternalWorkflowStub("workflow-exec-{id}")
      → SignalExternalWorkflow(signalName, payload)
        → Inner Go Workflow (ExecuteServerlessWorkflow) → signal channel receives
```

### Files Changed

**stigmer-cloud** — modified (3 files):
- `InvokeWorkflowExecutionWorkflow.java` — added `relaySignal(String, Object)` `@SignalMethod`
- `InvokeWorkflowExecutionWorkflowImpl.java` — implemented relay logic, added `executionId` field, updated Javadoc
- `InvokeWorkflowExecutionWorkflowCreator.java` — `signalWithStart()` now routes through `relaySignal`

**stigmer-cloud** — Javadoc updates (2 files):
- `WorkflowExecutionSubmitWorkflowTaskApprovalHandler.java` — documented relay routing
- `WorkflowExecutionSendSignalHandler.java` — documented relay routing

**stigmer (OSS)** — modified (1 file):
- `test/integration/workflow_hitl_test.go` — replaced direct Temporal signaling with gRPC API calls

## Session Progress (2026-05-15, Session 9 — CI Verification)

### Accomplished
- **Pushed `feat/bring-workflows-to-foreground` branch** to both `stigmer` and `stigmer-cloud` repos
- **Created draft PR** — https://github.com/stigmer/stigmer/pull/149
- **CI pipeline validated end-to-end** — `ci.integration-offline.yaml` runs successfully
  - Build Service JAR (Bazel): ~2m44s
  - Integration Tests (23 tests): ~2m38s
  - Total pipeline: ~5m30s
- **Diagnosed first CI failure** — `stigmer-cloud` test-mode security bypass was not on `main`; CI was checking out `main` by default
- **Fixed via `cloud_ref` input** — manual dispatch with `cloud_ref=feat/bring-workflows-to-foreground` succeeded

### Key Finding
- The CI workflow defaults `cloud_ref` to `main`. Until the stigmer-cloud test-mode changes are merged to `main`, PR-triggered runs will fail. Options:
  1. Merge stigmer-cloud feature branch to `main` first
  2. Temporarily hardcode the feature branch ref in the workflow
  3. Accept that PR runs require manual dispatch with `cloud_ref` until merge

### CI Run
- **Successful run**: https://github.com/stigmer/stigmer/actions/runs/25899168687
- **Failed run** (missing test-mode bypass): https://github.com/stigmer/stigmer/actions/runs/25898570315

## Next Steps
1. ~~**Resolve `cloud_ref` default**~~ — RESOLVED: `cloud_ref` can be passed at dispatch time, tests pass
2. **Phase 3**: Provider-backed canary tests (LLM, agent, cursor-runner) — requires API keys
3. ~~**Fix Java signal routing**~~ — RESOLVED: `relaySignal` implemented (Session 10)
4. ~~**Implement `listen` converter**~~ — RESOLVED: converter + 2 integration tests (Session 11)
5. ~~**Run E2E validation**~~ — RESOLVED: 25 tests green (Session 11)

## Session Progress (2026-05-15, Session 8 — Phase 2: Workflow Task Family & HITL Testing)

### Accomplished
- **Expanded test suite from 9 to 23 tests** — full zigflow task family coverage
- **T07**: Verified all 9 existing tests pass locally via `make test-integration`
- **T08**: Control flow (`switch_case`) and data tasks (`set_vars` chaining, `transform` with JQ)
- **T09**: Error handling (`try_catch`, `raise_error`, invalid config)
- **T10**: HTTP call with mock server (success + 500 error)
- **T11**: HITL approval flow (`wait` timer, `human_input` approve + reject via Temporal signals)
- **T12**: Multi-task pipeline (linear with switch routing, concurrent isolation, cleanup verification)
- **Fixed 5 production bugs** in converter and execution engine
- **Discovered signal routing gap** in Java service (documented, tests bypass via direct Temporal SDK)

### Key Findings
- ~~Java service sends signals to outer `InvokeWorkflowExecution` workflow, but `human_input` listener is in inner `ExecuteServerlessWorkflow` — no relay mechanism exists~~ **FIXED in Session 10**: `relaySignal` method added to outer workflow, tests updated to use gRPC API
- `convertListenTask` is a stub — `listen + sendSignal` tests require converter implementation first
- `ExecutionOutput` is consistently `nil` — output propagation may need investigation

### Files Changed

**stigmer (OSS)** — new (7 test files, 1 harness file):
- `test/integration/workflow_control_flow_test.go`
- `test/integration/workflow_data_test.go`
- `test/integration/workflow_error_handling_test.go`
- `test/integration/workflow_http_test.go`
- `test/integration/workflow_hitl_test.go`
- `test/integration/workflow_pipeline_test.go`
- `test/integration/harness/mock_http.go`

**stigmer (OSS)** — modified (6 files):
- `backend/services/workflow-runner/pkg/converter/task_converters.go` — switch/raise/nested converters
- `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go` — error return handling
- `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_do.go` — pre-execution event flush
- `test/integration/harness/assertions.go` — AssertAllTaskStatuses
- `test/integration/go.mod` + `go.sum` — added Temporal SDK

## Next Steps
1. **Commit & push** — all Phase 2 work on `feat/bring-workflows-to-foreground`
2. **Verify CI in practice** — push to PR and observe workflow run
3. **Phase 3**: Provider-backed canary tests (LLM, agent, cursor-runner) — requires API keys
4. **Fix Java signal routing** — add relay in `InvokeWorkflowExecutionWorkflowImpl`
5. **Implement `listen` converter** — enable signal-based tests

## Session Progress (2026-05-14, Session 7 — T06 CI Workflow)

### Accomplished
- **Created `.github/workflows/ci.integration-offline.yaml`** — two-job CI workflow for integration tests
- **Job 1 (Build Service JAR)**: Checks out stigmer-cloud (private repo), builds fat JAR with Bazel, uploads as workflow artifact
- **Job 2 (Integration Tests)**: Downloads JAR, sets up Go/Java 21/Temporal CLI/gotestsum, runs `make test-integration`, publishes JUnit XML report
- **Cross-repo auth**: Created fine-grained PAT (`STIGMER_CLOUD_TOKEN`) with read-only access to `stigmer/stigmer-cloud`, stored as GitHub Actions secret
- **Caching strategy**: `bazel-contrib/setup-bazel@0.19.0` with disk cache + repository cache, plus BuildBuddy remote cache from `.bazelrc`
- **Silent-skip guard**: Asserts JUnit XML contains non-zero test count when tests pass (catches `os.Exit(0)` with no tests)
- **Test reporting**: `dorny/test-reporter@v3` renders per-test pass/fail annotations on PRs
- **Path-filtered triggers**: Only runs on backend/test/apis/go.work/Makefile changes + weekly schedule + manual dispatch

### Key Findings
- `stigmer-cloud` is a private repo — default `GITHUB_TOKEN` cannot check it out; needed a fine-grained PAT
- Deploy keys are disabled for `stigmer-cloud` (org-level policy)
- BuildBuddy remote cache is configured under `common` in `.bazelrc` with `--noremote_upload_local_results` — CI gets read-only cache hits for free
- `temporalio/setup-temporal@v0` is the official GitHub Action for Temporal CLI installation (cleaner than `go install`)
- `dorny/test-reporter` is at v3 (Node 24, March 2026)

### Decisions Made
- **Build from source** for the cloud JAR (over published artifacts or image extraction) — self-contained, always tests against latest `main`, replaceable seam via job isolation
- **Path-filtered triggers** (over run-on-all-PRs) — integration tests are expensive; skip for docs/web/CLI-only changes
- **Fine-grained PAT** for cross-repo access (over GitHub App or deploy key) — deploy keys disabled, GitHub App requires web UI setup
- **30-day retention** for test result artifacts; **1-day retention** for ephemeral JAR artifact

### Files Changed

**stigmer (OSS)** — new (1 file):
- `.github/workflows/ci.integration-offline.yaml` — CI workflow for offline integration tests

**GitHub Actions Secrets** — new (1 secret):
- `STIGMER_CLOUD_TOKEN` — fine-grained PAT for `stigmer/stigmer-cloud` read-only checkout

## Next Steps
1. **Verify CI in practice**: Push to a PR branch and observe the workflow run end-to-end
2. **Monitor Bazel build times**: If cold builds exceed 5 min, consider enabling BuildBuddy remote cache write or pre-building the JAR
3. **Future: Publish JAR from stigmer-cloud CI**: Replace Job 1 with a download step when cloud publishes standalone JAR artifacts

## Session Progress (2026-05-14, Session 6 — T04 JUnit XML Output)

### Accomplished
- **Wired gotestsum** via `make test-integration` target producing JUnit XML + JSON event logs
- **Deterministic service log paths**: Java service and workflow-runner logs now write to `.test-output/logs/` instead of random temp dirs
- Added `OutputDir` to harness `Config` with `INTEGRATION_TEST_OUTPUT_DIR` env var override
- Added `LogPath()` to `JavaService` and `WorkflowRunner`, `LogDir()`/`LogPaths()` to `TestHarness`
- Used `$(abspath ...)` in Makefile to resolve CWD mismatch between Make (repo root) and Go test binary (package dir)
- Validated end-to-end: all 9 tests pass, output directory populated correctly
- Committed: `d6425a577` on `feat/bring-workflows-to-foreground`

### Key Findings
- Go test binaries run with CWD set to the package directory (`test/integration/`), not the repo root — relative paths in env vars need absolute resolution
- `gotestsum` is not a Go library dependency — it wraps `go test -json` externally, keeping the test module clean

### Files Changed

**stigmer (OSS)** — modified (5 files):
- `Makefile` — added `test-integration` target with gotestsum
- `test/integration/harness/harness.go` — OutputDir config, LogDir/LogPaths methods
- `test/integration/harness/service.go` — LogDir field, LogPath method
- `test/integration/harness/workflow_runner.go` — LogDir field, LogPath method
- `test/integration/suite_test.go` — wire OutputDir/LogDir through

**stigmer (OSS)** — new (1 file):
- `test/integration/.gitignore` — ignore `.test-output/`

## Session Progress (2026-05-14, Session 5 — T02 Legacy E2E Deletion)

### Accomplished
- **Deleted `test/e2e/` entirely**: 140 files, ~23,000 lines of dead code removed
- Removed `./test/e2e` from `go.work`
- Ran `go work sync` + `go mod tidy` — all 10 workspace modules build cleanly
- Verified: no Makefile, CI, docs, or production code references to `test/e2e`
- Committed: `44a980134` on `feat/bring-workflows-to-foreground`

### Key Findings
- The legacy suite had **140** files on disk (not 76 as originally estimated) — the `.gitignore` excluded `testdata/examples/` from git tracking but they were present on disk
- No build system or CI wiring existed for the legacy suite — `GO_MODULES` in the Makefile never included it, and no GitHub Actions workflow referenced it
- The only live reference outside the suite was `go.work`
- Historical artifacts (`_changelog/`, `_projects/`) left untouched as documentation record

### Files Changed

**stigmer (OSS)** — deleted:
- `test/e2e/` — entire directory tree (140 files)

**stigmer (OSS)** — modified:
- `go.work` — removed `./test/e2e` workspace member
- Various `go.mod`/`go.sum` across workspace modules — `go work sync` + `go mod tidy` cleanup

## Next Steps
1. **T06: CI Workflow** — create `.github/workflows/ci.integration-offline.yaml` (consumes `make test-integration` output)

## Session Progress (2026-05-14, Session 4 — Runtime Validation)

### Accomplished
- **All 4 integration tests pass end-to-end**: infra, service, smoke, workflow lifecycle
- Fixed 6 runtime bugs discovered during incremental validation of the full pipeline
- Full pipeline validated: Go test → Testcontainers → Java fat JAR → Temporal → Go workflow-runner → zigflow execution → gRPC callbacks → assertion

### Bugs Fixed (6 total)

1. **Missing `IdentityAccount` seed data**: Java service's `RequestPipeline` tried to resolve actor info for `test-identity-account-id` from MongoDB but nothing existed. Created `IntegrationTestDataSeeder.java` (stigmer-cloud) to seed a minimal IdentityAccount on startup when `stigmer.security.mode=test`.

2. **Protobuf `version` field type mismatch**: The seeder initially set `metadata.version` to integer `1`, but the proto defines it as a nested `ApiResourceMetadataVersion` message. Removed the field (optional, not needed for test).

3. **Temporal workflow deadlock (Java)**: `InvokeWorkflowExecutionWorkflowImpl` used `Workflow.newDetachedCancellationScope(...).run()` for the pause monitor, which blocked the main workflow thread before `activityScope.run()` could execute. Fixed by using `Async.procedure()` for concurrent execution.

4. **Polyglot serialization mismatch (Java→Go)**: Java `InvokeWorkflowExecutionWorkflowInput` was serialized with camelCase (`executionId`) but Go struct expected snake_case (`execution_id`). Added `@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)` to the Java record.

5. **Protobuf `oneof` deserialization failure**: `FlushEventsActivity` used `[]*WorkflowExecutionEvent` in a plain Go struct, which Temporal's default JSON converter couldn't round-trip (oneof fields are Go interfaces). Rewrote to pre-serialize events with `protojson` as `[][]byte`.

6. **Missing task status for inline tasks**: The `ProgressReportingInterceptor` only tracked Temporal activities, not inline tasks like `set_vars`. Also, it was reporting `FlushEventsActivity` as a user-facing task. Fixed by: (a) adding `FlushEventsActivity` to the interceptor skip list, (b) adding a `taskMap` to `DoTaskBuilder` that accumulates `WorkflowTask` entries from events, (c) including the task status snapshot in every `FlushEventsActivity` call.

### Key Decisions Made
- **protojson encoding for Temporal boundary**: Protobuf messages with `oneof` fields must be serialized with `protojson` before crossing Temporal's data converter boundary; `encoding/json` cannot handle Go interface types
- **Task status via event-driven snapshot**: The `DoTaskBuilder` maintains a cumulative task status map derived from emitted events, sent alongside each event flush — this fills the gap for inline tasks that the interceptor can't see
- **IntegrationTestDataSeeder pattern**: Conditional `@PostConstruct` seeder that runs only in test mode — clean pattern for bootstrapping test data without polluting production paths

### Files Changed

**stigmer (OSS)** — modified (4 files):
- `backend/services/workflow-runner/pkg/executor/temporal_workflow.go` — updated `flushLifecycleEvents` for new `NewFlushEventsInput` signature
- `backend/services/workflow-runner/pkg/interceptors/progress_interceptor.go` — added `FlushEventsActivity` to skip list
- `backend/services/workflow-runner/pkg/zigflow/tasks/flush_events_activity.go` — rewrote with protojson encoding + task status snapshots
- `backend/services/workflow-runner/pkg/zigflow/tasks/task_builder_do.go` — added task status tracking via `taskMap` + `kindToTaskType` mapper

**stigmer-cloud** — modified/new (3 files):
- `InvokeWorkflowExecutionWorkflowImpl.java` — fixed Async.procedure deadlock
- `InvokeWorkflowExecutionWorkflowInput.java` — added @JsonNaming for snake_case serialization
- `IntegrationTestDataSeeder.java` — NEW: seeds test IdentityAccount in test mode

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

## Next Steps (Bottom)
1. ~~**Resolve `cloud_ref` default**~~ — RESOLVED: `cloud_ref` can be passed at dispatch time
2. **Phase 3**: Provider-backed canary tests (T13/T14 from plan) — requires API keys
3. ~~**Fix Java signal routing**~~ — RESOLVED: `relaySignal` relay implemented (Session 10)
4. ~~**Implement `listen` converter**~~ — RESOLVED: converter + 2 integration tests (Session 11)
5. **Future: Publish JAR from stigmer-cloud CI** — replace Job 1 with a download step
6. ~~**Run E2E validation**~~ — RESOLVED: 25 tests green including HITL + listen signal routing (Session 11)

## Context for Resume
- All 25 integration tests pass: infra (3), service health, smoke gRPC, lifecycle, control flow, data (2), error handling (3), HITL (3), HTTP (2), listen (2), pipeline (3)
- Full signal pipeline validated end-to-end: gRPC API → Java handler → relaySignal → inner Go workflow → zigflow task completion
- Phase 2 is complete — all offline task families covered including listen tasks
- Phase 3 (provider-backed canaries) is the next milestone — requires API keys
- JAR must be rebuilt after stigmer-cloud changes: `./bazelw build //backend/services/stigmer-service:stigmer_service_fatjar`
- Fat JAR path: `/Users/suresh/scm/github.com/stigmer/stigmer-cloud/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar`
- Test command: `STIGMER_SERVICE_JAR=<jar_path> make test-integration`

## Quick Commands

After loading context:
- "Continue with T06" - Create CI workflow
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
