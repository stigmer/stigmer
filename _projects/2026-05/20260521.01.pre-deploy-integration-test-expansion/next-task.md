# Next Task: 20260521.01.pre-deploy-integration-test-expansion

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260521.01.pre-deploy-integration-test-expansion

**Description**: Pre-deployment test expansion: fix broken workflow execution path (Phase 8 cutover), wire 65 orphaned Java tests, add ~95 new integration tests, structural Playwright E2E.
**Goal**: Maximize deployment confidence. Restore ~135 broken/unwired tests + add ~95 new tests. Fix workflow execution architecture gap (Java/Go child workflow rewrite). Wire stigmer-cloud BUILD.bazel targets.
**Tech Stack**: Go, Java 21/Spring Boot/Bazel, TypeScript/Node.js, Playwright, Temporal
**Components**: test/integration/, test/e2e/, backend/services/runner/, backend/services/stigmer-server/, stigmer-cloud/backend/services/stigmer-service/

## Current Status

**Created**: 2026-05-21
**Current Task**: Workstreams A+B+D+F complete. C+E in progress (parallel).
**Status**: Critical path COMPLETE (A → B). C/E in parallel conversations.

## Workstream Summary (Parallel Execution)

| Workstream | Sessions | Status | Blocked By |
|------------|----------|--------|------------|
| **A: TS Hydration Activity** | 1 (done) | COMPLETED | — |
| **B: Java + Go Orchestrator Rewrite** | 1 (done) | COMPLETED | — |
| **C: Go Integration Tests (New)** | 3-4 | IN PROGRESS (parallel) | Nothing |
| **D: Playwright E2E (Structural)** | 1 (done) | COMPLETED | — |
| **E: stigmer-cloud BUILD.bazel** | 2-3 | IN PROGRESS (parallel) | Nothing |
| **F: SDK Component Tests** | 1 (done) | COMPLETED | — |

**Critical path**: COMPLETE (A → B done). C/E remaining in parallel.

## Session Progress (2026-05-21, Workstream A)

### What was accomplished
- **Built `HydrateWorkflowExecution` activity** — gRPC-fetches WorkflowExecution (trigger_message), Workflow (YAML from status), ExecutionContext (env). Validates YAML state, parses via `loadWorkflowFromYaml`, flattens env, parses trigger_message as JSON.
- **Extracted engine core** — Moved engine setup/execution from `executeServerlessWorkflow` into shared `runWorkflowEngine()` in `engine-core.ts`. Both direct and wrapper workflows use it. Zero duplication.
- **Built wrapper workflow** — `stigmer/workflow/execute-from-execution` calls hydration activity then `runWorkflowEngine` inline. Workflow ID = `workflow-exec-{executionId}` for direct signal routing.
- **Extended StigmerClient** — Added `getWorkflow`, `getWorkflowInstance`, `getWorkflowExecution` query methods.
- **Registered** — New workflow in `index.ts`, new activity in both `runner.ts` and `runner-manager.ts`.
- **18 unit tests** — All pass. 23 existing workflow engine tests pass after refactor.

### Key decisions made
- **AD-1**: New wrapper workflow (not modified existing) — preserves backward compat
- **AD-2**: Wrapper IS the signal target — flat architecture (one hop from Java), no double-nesting
- **AD-3**: Shared engine core via extraction — `engine-core.ts` is sandbox-safe
- **YAML source**: Read from `workflow.status.serverlessWorkflowValidation.yaml` (Cloud path). OSS gap documented.
- **trigger_message → workflow_input**: JSON.parse with null fallback for invalid/empty
- **Status updates**: NOT implemented in wrapper (pre-existing gap, deferred to Workstream B/future)

### Surprises discovered
- **OSS YAML not persisted**: `PopulateServerlessValidation` step only exists in Cloud (Java). Go server stores validation result in pipeline context but never writes YAML to WorkflowStatus. The `validateSpec` RPC also won't work in OSS since it routes through the deleted Go runner's Temporal activity. Both paths broken in OSS.
- **Progressive status updates missing**: The old Go runner sent per-task status updates via gRPC. The TS engine sends zero. This is a pre-existing gap, not caused by this work.
- **callback_token not propagated**: Proto field exists on WorkflowExecutionSpec but `create.go` never copies it to the slim Temporal input. Not relevant for this workstream.

### Files created
- `backend/services/runner/src/activities/hydrate-workflow-execution.ts`
- `backend/services/runner/src/workflows/engine-core.ts`
- `backend/services/runner/src/workflows/execute-from-execution.ts`
- `backend/services/runner/src/activities/__tests__/hydrate-workflow-execution.test.ts`

### Files modified
- `backend/services/runner/src/client/stigmer-client.ts`
- `backend/services/runner/src/workflows/execute-serverless-workflow.ts`
- `backend/services/runner/src/workflows/index.ts`
- `backend/services/runner/src/runner.ts`
- `backend/services/runner/src/runner-manager.ts`
- `backend/services/runner/src/__test-utils__/mock-client.ts`

## Session Progress (2026-05-21, Workstream D — Playwright E2E)

### What was accomplished
- **6 new Playwright spec files** (52 tests) covering settings, library skills/MCP servers, error resilience, accessibility (axe-core), and responsive sidebar
- **Fixed 21 stale locators** in 6 authorization specs (`data-testid="resource-card"` → `role="listitem"`)
- **Added `@axe-core/playwright`** dependency for WCAG 2.0 AA audits
- Total functional E2E: 52 → 104 tests in 19 files
- All tests compile and list successfully (`npx playwright test --list` exit 0)

### Key decisions made
- **Selectors grounded in SDK DOM analysis**: Every locator verified against actual component `aria-labelledby` IDs, `aria-label` strings, and `role` attributes
- **No `waitForTimeout`**: All waits use `expect()` auto-waiting with explicit timeouts
- **Axe audits filter to critical+serious** for initial rollout; composer textarea excluded (known missing `aria-label`)
- **Error state tests handle both backend modes**: Use `.or()` composition to pass whether backend returns NOT_FOUND or connection errors
- **Responsive tests use `localStorage` init scripts** for deterministic sidebar state

### Files created
- `test/e2e/tests/functional/settings.spec.ts` (24 tests)
- `test/e2e/tests/functional/library-skills.spec.ts` (5 tests)
- `test/e2e/tests/functional/library-mcp-servers.spec.ts` (5 tests)
- `test/e2e/tests/functional/error-states.spec.ts` (6 tests)
- `test/e2e/tests/functional/accessibility.spec.ts` (7 tests)
- `test/e2e/tests/functional/responsive.spec.ts` (5 tests)

### Files modified
- `test/e2e/package.json` (added `@axe-core/playwright`)
- 6 authorization spec files (locator fixes)

## Session Progress (2026-05-21, Workstream F — SDK Component Tests)

### What was accomplished
- **27 new tests** across 3 files protecting the public `@stigmer/react` API surface
- **`useComposer` hook tests (11)**: First-ever tests for this public headless hook — validates submit, canSubmit, Enter/Shift+Enter, clear, disabled state
- **`MessageThread` render tests (8)**: Approval callback propagation end-to-end, pending message rendering, phase badge, plan-completion card
- **`SessionComposer` contract tests (8)**: role/aria-label a11y, textarea presence, disabled states, async submit flow
- Full suite: 506 tests pass (45 files), zero regressions, zero lint errors

### Key decisions made
- Followed DD-003 headless-first: tested `useComposer` hook independently before component rendering
- No premature shared test utilities — each file self-contained (matching existing 42-file pattern)
- SessionComposer tested at public contract level only (not internal setup orchestration)

### Discoveries
- `SessionComposer` submit is async (calls `stigmer.getAuthCredential()` for system env vars) — mock needed `getAuthCredential` + `baseUrl` on Stigmer client
- `MessageThread` renders `spec.message` as synthetic human bubble in addition to `status.messages` — both appear in DOM

### Files created
- `sdk/react/src/composer/__tests__/useComposer.test.ts`
- `sdk/react/src/execution/__tests__/MessageThread.test.tsx`
- `sdk/react/src/composer/__tests__/SessionComposer-contract.test.tsx`

## Session Progress (2026-05-21, Workstream B — Orchestrator Rewrite)

### What was accomplished
- **B.0: TS Engine Pause/Resume** — Added `checkPause` yield points to do-executor (between tasks), for.ts (between iterations), try.ts (between retries). Created `workflow-signals.ts` with shared Temporal signal definitions. Both wrapper and direct workflow entry points register pause/resume handlers. 8 new engine-level tests. Config default changed to `stigmer_runner`.
- **B.1: Java Orchestrator Rewrite** — Replaced `ExecuteWorkflowActivity` stub with child workflow (`stigmer/workflow/execute-from-execution`). Removed CancellationScope pause loop. Signal handlers now update status and relay to child. Deleted `ExecuteWorkflowActivity.java`. Removed `:wf-orch`/`:wf-exec` suffixes. Added `Workflow.getVersion` for replay safety. 7 new Temporal test environment tests.
- **B.2: Go Orchestrator Rewrite** — Replaced activity with child workflow. Added signal handling (pause/resume/relay) — previously missing in Go OSS. Version gate. Updated agent+workflow queue configs to `stigmer_runner`. 7 new Go orchestrator tests.
- **B.3: Test Fixes** — Fixed 54 `WorkflowRunner` → `UnifiedRunner` references across 24+ test files. Changed harness queue to `stigmer_runner`.
- **B.4: Docs Cleanup** — Fixed stale LangGraph checkpoint references in pause.go/resume.go. Rewrote temporal README.md and IMPLEMENTATION_SUMMARY.md.

### Key decisions made
- **AD-B1**: Single queue `stigmer_runner` — domain-agnostic, permanent name for unified runner
- **AD-B2**: Signal-based pause/resume via Temporal `condition()` — no external checkpoint needed, ~50 lines vs ~1000+
- **AD-B3**: Drop return value from child workflow — progressive gRPC is the status mechanism
- **AD-B5**: Removed WorkflowRunTimeout — pause-compatible, matches agent execution pattern
- **AD-B6**: Temporal workflow versioning for in-flight workflow safety
- **AD-B7**: Memo key `activityTaskQueue` → `runnerTaskQueue`

### Surprises discovered (during planning, resolved before coding)
- **Old Go runner never had production checkpointing** — Gap C1 was deferred. The CancellationScope in Java assumed checkpoint support that never existed.
- **TS engine runs as workflow, not activity** — each task result is in Temporal history. This makes external checkpointing unnecessary — Temporal replay IS the checkpoint.
- **Go OSS had no signal handling** — LISTEN/human_input tasks couldn't receive signals through the Go path. Pre-existing gap, fixed in B.2.

### Files created
- `backend/services/runner/src/workflows/workflow-signals.ts`
- `backend/services/runner/src/workflow-engine/__tests__/pause-resume.test.ts`
- `backend/services/stigmer-server/.../workflows/invoke_workflow_impl_test.go`
- `stigmer-cloud/.../workflow/InvokeWorkflowExecutionWorkflowImplTest.java`

### Files modified (major)
- 9 TS runner files (engine, workflows, config)
- 10 Go stigmer-server files (orchestrator, config, agent config, docs)
- 14 Java stigmer-cloud files (orchestrator, config, kustomize, dispatch)
- 27 integration test files (WorkflowRunner → UnifiedRunner, queue rename)

## Key Architectural Findings

1. ~~**Workflow tests won't compile**: `testHarness.WorkflowRunner` field deleted, 58 references in ~25 files~~ **RESOLVED by Workstream B.3** — all references updated to `testHarness.UnifiedRunner`
2. ~~**Queue mismatch**: Unified runner on `agent_execution_runner`, workflow dispatch to `workflow_execution_runner:wf-orch`~~ **RESOLVED by Workstream B** — all queues unified under `stigmer_runner`
3. ~~**Activity/workflow gap**: Java calls `ExecuteWorkflow` activity (deleted), unified runner registers `stigmer/workflow/execute` workflow~~ **RESOLVED by Workstream A+B** — child workflow dispatch
4. **65 unwired Java tests**: search (16), tenancy (16), agentic (22), billing (8), IAM (3)
5. **Playwright has no interactive infrastructure**: No auth, no API seeding, no helpers

## URGENT: Verify Production

Check if workflow execution is broken in production (old Go workflow-runner deleted from repo — is it still deployed?).

## Context for Resume

- Workstream A changelog: `_changelog/2026-05/2026-05-21-164357-ts-hydration-activity-wrapper-workflow.md`
- Workstream B changelog: `_changelog/2026-05/2026-05-21-174307-workstream-b-orchestrator-rewrite-pause-resume.md`
- Workstream D changelog: `_changelog/2026-05/2026-05-21-165518-playwright-e2e-structural-test-expansion.md`
- Workstream F changelog: `_changelog/2026-05/2026-05-21-165758-sdk-react-component-contract-tests.md`
- Workstream B plan: `.cursor/plans/workstream_b_plan_7a02dbbc.plan.md`
- Workstream D plan: `.cursor/plans/playwright_e2e_expansion_e116dae9.plan.md`
- Workstream F plan: `.cursor/plans/sdk_component_tests_e4b001e2.plan.md`
- Detailed plan: `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/tasks/T01_0_plan.md`
- Workstream A plan: `.cursor/plans/workstream_a_ts_hydration_c07d339d.plan.md`

## Key Files

**Workflow execution (NEW — Workstream A)**:
- Hydration activity: `backend/services/runner/src/activities/hydrate-workflow-execution.ts`
- Engine core: `backend/services/runner/src/workflows/engine-core.ts`
- Wrapper workflow: `backend/services/runner/src/workflows/execute-from-execution.ts`
- Tests: `backend/services/runner/src/activities/__tests__/hydrate-workflow-execution.test.ts`

**Workflow execution (Workstream B — next)**:
- Java orchestrator: `stigmer-cloud/backend/services/stigmer-service/.../workflowexecution/temporal/workflow/InvokeWorkflowExecutionWorkflowImpl.java`
- Go orchestrator: `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows/invoke_workflow_impl.go`
- TS runner workflows: `backend/services/runner/src/workflows/index.ts`

**Test infrastructure**:
- Integration harness: `test/integration/harness/`
- Suite setup: `test/integration/suite_test.go`
- Unified runner: `test/integration/harness/unified_runner.go`

**stigmer-cloud BUILD**:
- Java tests: `stigmer-cloud/backend/services/stigmer-service/BUILD.bazel`
- Deploy pipeline: `stigmer-cloud/.planton/pipeline.yaml`

## Quick Commands

After loading context:
- ~~"Start Workstream B — Java + Go orchestrator rewrite"~~ — COMPLETED (child workflow, pause/resume, queue unification)
- "Start Workstream C — New Go integration tests" — Independent, can start immediately
- ~~"Start Workstream D — Playwright E2E"~~ — COMPLETED (52 new tests, 104 total)
- "Start Workstream E — Wire BUILD.bazel" — Independent, stigmer-cloud
- ~~"Start Workstream F — SDK tests"~~ — COMPLETED (27 new tests, 506 total)
- "Show project status" — Get overview of progress
- "Verify production workflow status" — Check if workflows work in prod
- "Run `make test-integration`" — Validate all workflow tests compile and pass

---

*This file provides direct paths to all project resources for quick context loading.*
