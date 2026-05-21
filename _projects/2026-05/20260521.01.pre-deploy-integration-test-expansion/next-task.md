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
**Last Session**: 2026-05-21 — Workstream C Session 1 complete
**Current Task**: Workstream C Session 2 (tool call + streaming tests) or continue other workstreams
**Status**: Workstream A in progress (separate conversation). Workstream C Session 1 complete (21 tests delivered).

## Workstream Summary (Parallel Execution)

| Workstream | Sessions | Status | Blocked By |
|------------|----------|--------|------------|
| **A: TS Hydration Activity** | 2-3 | In progress (separate conversation) | Nothing (GATING ITEM) |
| **B: Java + Go Orchestrator Rewrite** | 3.5-5 | Not started | A |
| **C: Go Integration Tests (New)** | 3-4 | **Session 1 complete** (21 tests) | Nothing |
| **D: Playwright E2E (Structural)** | 2 | Not started | Nothing |
| **E: stigmer-cloud BUILD.bazel** | 2-3 | Not started | Nothing |
| **F: SDK Component Tests** | 1 | Not started | Nothing |

**Critical path**: A → B → B-tests (6-7 sessions). C/D/E/F can all run in parallel.

## Workstream C Session 1 Progress (2026-05-21)

### Delivered

3 new test files, 21 tests, 1,193 lines of Go:

**`test/integration/agent_crud_test.go`** (9 tests):
- Apply/Get/Delete lifecycle with default instance verification
- Apply upsert by (org, slug) semantics
- Status preservation across updates
- Instructions min_len=10 protovalidate enforcement
- MCP reference normalization (empty org filled)
- GetByReference slug resolution + error paths
- UpdateVisibility private→public→private
- Non-cascading delete (instances survive)
- Delete nonexistent

**`test/integration/session_lifecycle_test.go`** (9 tests):
- Create/Get/Delete lifecycle
- Default agent resolution when agent_instance_id empty
- Invalid agent instance behavioral discovery
- Offset-based List pagination (page_token as page number string)
- ListByAgent filtering (documents agent_instance_id field name mismatch)
- Atomic UpdateSubject + empty clears
- Metadata map round-trip via Update
- Delete nonexistent
- Delete does not cascade to executions (provider-backed)

**`test/integration/agent_execution_11_conversation_journey_test.go`** (3 tests):
- ListBySession execution count growth across 3 turns
- Concurrent session context isolation (code words ALPHA/BRAVO)
- Follow-up on auto-created session + ListBySession verification

### Key Discoveries

1. Session Create does NOT validate agent_instance_id existence — stores bogus IDs without error
2. ListByAgent `agent_id` field actually filters by `agent_instance_id` (proto/implementation mismatch)
3. ListByAgent ignores pagination fields despite proto definition
4. Session List uses offset-based pagination (page_token is string page number, not cursor)

### What's Next for Workstream C

- **Session 2**: Tool call structure verification, streaming event ordering (C.3 from master plan)
- **Session 3**: Remaining lifecycle edge cases not covered by existing _06 tests (C.2)

## Key Architectural Findings

1. **Workflow tests won't compile**: `testHarness.WorkflowRunner` field deleted, 58 references in ~25 files
2. **Queue mismatch**: Unified runner on `agent_execution_runner`, workflow dispatch to `workflow_execution_runner:wf-orch`
3. **Activity/workflow gap**: Java calls `ExecuteWorkflow` activity (deleted), unified runner registers `stigmer/workflow/execute` workflow
4. **65 unwired Java tests**: search (16), tenancy (16), agentic (22), billing (8), IAM (3)
5. **Playwright has no interactive infrastructure**: No auth, no API seeding, no helpers

## URGENT: Verify Production

Check if workflow execution is broken in production (old Go workflow-runner deleted from repo — is it still deployed?).

## Context for Resume

- Plan chat: Workstream C Session 1 conversation
- Detailed plan: `_projects/2026-05/20260521.01.pre-deploy-integration-test-expansion/tasks/T01_0_plan.md`
- Workstream C refined plan: `.cursor/plans/workstream_c_session_1_b49d913a.plan.md`
- Changelog: `_changelog/2026-05/2026-05-21-164333-workstream-c-agent-session-crud-conversation-tests.md`

## Key Files

**New test files (Workstream C Session 1)**:
- `test/integration/agent_crud_test.go`
- `test/integration/session_lifecycle_test.go`
- `test/integration/agent_execution_11_conversation_journey_test.go`

**Workflow execution (broken path)**:
- Java orchestrator: `stigmer-cloud/backend/services/stigmer-service/.../workflowexecution/temporal/workflow/InvokeWorkflowExecutionWorkflowImpl.java`
- Go orchestrator: `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows/invoke_workflow_impl.go`
- TS runner workflows: `backend/services/runner/src/workflows/index.ts`
- TS runner activities: `backend/services/runner/src/runner.ts`

**Test infrastructure**:
- Integration harness: `test/integration/harness/`
- Suite setup: `test/integration/suite_test.go`
- Unified runner: `test/integration/harness/unified_runner.go`
- Playwright config: `test/e2e/playwright.config.ts`

**stigmer-cloud BUILD**:
- Java tests: `stigmer-cloud/backend/services/stigmer-service/BUILD.bazel`
- Deploy pipeline: `stigmer-cloud/.planton/pipeline.yaml`

## Quick Commands

After loading context:
- "Continue Workstream C — Session 2 (tool call + streaming tests)" — Next C session
- "Start Workstream D — Playwright E2E" — Independent, structural tests
- "Start Workstream E — Wire BUILD.bazel" — Independent, stigmer-cloud
- "Start Workstream F — SDK tests" — Independent, smallest scope
- "Show project status" — Get overview of progress
- "Verify production workflow status" — Check if workflows work in prod

---

*This file provides direct paths to all project resources for quick context loading.*
