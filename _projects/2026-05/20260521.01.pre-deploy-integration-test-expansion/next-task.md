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
**Current Task**: Workstream A complete. Workstream B next.
**Status**: Gating item (Workstream A) completed. B is unblocked. C/D/E/F can start in parallel.

## Workstream Summary (Parallel Execution)

| Workstream | Sessions | Status | Blocked By |
|------------|----------|--------|------------|
| **A: TS Hydration Activity** | 1 (done) | COMPLETED | — |
| **B: Java + Go Orchestrator Rewrite** | 3.5-5 | Not started (UNBLOCKED) | — |
| **C: Go Integration Tests (New)** | 3-4 | Not started | Nothing |
| **D: Playwright E2E (Structural)** | 2 | Not started | Nothing |
| **E: stigmer-cloud BUILD.bazel** | 2-3 | Not started | Nothing |
| **F: SDK Component Tests** | 1 | Not started | Nothing |

**Critical path**: B → B-tests (3.5-5 sessions remaining). C/D/E/F can all run in parallel now.

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

## Key Architectural Findings

1. **Workflow tests won't compile**: `testHarness.WorkflowRunner` field deleted, 58 references in ~25 files
2. **Queue mismatch**: Unified runner on `agent_execution_runner`, workflow dispatch to `workflow_execution_runner:wf-orch`
3. ~~**Activity/workflow gap**: Java calls `ExecuteWorkflow` activity (deleted), unified runner registers `stigmer/workflow/execute` workflow~~ **RESOLVED by Workstream A** — wrapper workflow bridges this gap
4. **65 unwired Java tests**: search (16), tenancy (16), agentic (22), billing (8), IAM (3)
5. **Playwright has no interactive infrastructure**: No auth, no API seeding, no helpers

## URGENT: Verify Production

Check if workflow execution is broken in production (old Go workflow-runner deleted from repo — is it still deployed?).

## Context for Resume

- Workstream A changelog: `_changelog/2026-05/2026-05-21-164357-ts-hydration-activity-wrapper-workflow.md`
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
- "Start Workstream B — Java + Go orchestrator rewrite" — Next on critical path (UNBLOCKED)
- "Start Workstream C — New Go integration tests" — Independent, can start immediately
- "Start Workstream D — Playwright E2E" — Independent, structural tests
- "Start Workstream E — Wire BUILD.bazel" — Independent, stigmer-cloud
- "Start Workstream F — SDK tests" — Independent, smallest scope
- "Show project status" — Get overview of progress
- "Verify production workflow status" — Check if workflows work in prod

---

*This file provides direct paths to all project resources for quick context loading.*
