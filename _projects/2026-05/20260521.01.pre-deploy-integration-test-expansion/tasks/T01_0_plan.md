# Task T01: Pre-Deploy Integration Test Expansion — Master Plan

**Created**: 2026-05-21 16:03
**Status**: PENDING REVIEW
**Type**: Feature Development (multi-phase, multi-repo)
**Estimated Effort**: 17-22 sessions (~2-3 hours each)

⚠️ **This plan requires your review before execution**

## Executive Summary

This project restores ~135 broken/unwired tests and adds ~95 new tests to maximize deployment confidence. It also completes the Phase 8 cutover from the workflow-runner TS rewrite (Java/Go orchestrator child workflow dispatch).

## Parallel Execution Map

The work divides into **6 workstreams** that can run in parallel. The only dependency is that Workstream A (TS hydration activity) must complete before Workstream B (Java/Go orchestrator rewrite) can finish.

```
                              ┌──────────────────────────────┐
                              │  WORKSTREAM A (GATING)       │
                              │  TS Hydration Activity       │
                              │  2-3 sessions                │
                              └──────────┬───────────────────┘
                                         │ unblocks
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
        ▼                                ▼                                │
┌───────────────────┐  ┌───────────────────────────┐                     │
│  WORKSTREAM B     │  │  WORKSTREAM B'            │                     │
│  Java Orchestrator│  │  Go Orchestrator          │                     │
│  Rewrite          │  │  Rewrite                  │                     │
│  1 session        │  │  0.5-1 session            │                     │
└───────┬───────────┘  └──────────┬────────────────┘                     │
        │                         │                                       │
        └────────┬────────────────┘                                       │
                 ▼                                                        │
        ┌───────────────────┐                                             │
        │  WORKSTREAM B     │                                             │
        │  Tests + Harness  │                                             │
        │  2 sessions       │                                             │
        └───────────────────┘                                             │
                                                                          │
                                                                          │
   ═══════════════════ INDEPENDENT (run in parallel) ═════════════════════
                                                                          │
┌───────────────────┐  ┌───────────────────┐  ┌────────────────────────┐ │
│  WORKSTREAM C     │  │  WORKSTREAM D     │  │  WORKSTREAM E          │ │
│  Go Integration   │  │  Playwright E2E   │  │  stigmer-cloud         │ │
│  Tests (New)      │  │  (Structural)     │  │  BUILD.bazel Wiring    │ │
│  3-4 sessions     │  │  2 sessions       │  │  2-3 sessions          │ │
└───────────────────┘  └───────────────────┘  └────────────────────────┘ │
                                                                          │
┌───────────────────┐                                                     │
│  WORKSTREAM F     │                                                     │
│  SDK Component    │                                                     │
│  Tests            │                                                     │
│  1 session        │                                                     │
└───────────────────┘

Timeline with max parallelism:
  Day 1-2: Start A + C + D + E + F simultaneously
  Day 2-3: A completes → start B + B'
  Day 3-4: B + B' complete → B tests + harness validation
  Day 4:   All workstreams converge → full suite green
```

**With 6 parallel agents, the critical path is ~6-7 sessions (A → B → B-tests), while C/D/E/F all finish within that window.**

---

## Workstream A: TS Hydration Activity (GATING — 2-3 sessions)

**Repo**: `stigmer` (OSS)
**Path**: `backend/services/runner/`

The unified TS runner's `stigmer/workflow/execute` workflow expects a fully materialized `ExecuteServerlessWorkflowInput` (parsed CNCF DSL model, merged env/secrets). The deleted Go `ExecuteWorkflow` activity did this hydration. We need to build it in TypeScript.

### A.1 — Hydration Activity Implementation (2 sessions)

New directory: `backend/services/runner/src/activities/hydrate-workflow-execution/`

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | `HydrateWorkflowExecution` activity: accepts slim IDs (execution_id, workflow_instance_id, org_id), gRPC-fetches WorkflowExecution → WorkflowInstance → Workflow, reads pre-generated YAML from `workflow.status.serverless_workflow_validation.yaml`, merges ExecutionContext env/secrets, returns `ExecuteServerlessWorkflowInput` | ~200-300 |
| `index.test.ts` | Unit tests: mock gRPC calls, verify YAML parsing, env merge, error cases | ~150-200 |

Register in `runner.ts` `createAllActivities()`.

### A.2 — Wrapper Workflow (optional, 0.5 session)

If needed for clean child workflow dispatch: add `stigmer/workflow/execute-from-execution` workflow type in `workflows/index.ts` that calls the hydration activity as a local activity, then runs the existing engine. This keeps secrets out of the outer Java workflow history.

**Prerequisite**: None — can start immediately.
**Blocks**: Workstream B (Java/Go orchestrator rewrite).

---

## Workstream B: Java + Go Orchestrator Rewrite (3.5-5 sessions)

### B.1 — Java Orchestrator (1 session)

**Repo**: `stigmer-cloud`
**Path**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/`

| File | Change |
|------|--------|
| `workflow/InvokeWorkflowExecutionWorkflowImpl.java` | Replace `ExecuteWorkflowActivity` activity stub with child workflow stub (`Workflow.newChildWorkflowStub` or `newUntypedChildWorkflowStub`). Workflow type: `stigmer/workflow/execute` (or `stigmer/workflow/execute-from-execution`). Task queue: base queue from memo (drop `:wf-orch` suffix). Preserve `workflow-exec-{executionId}` as child workflow ID for signal relay. Adapt error wrapping for `ChildWorkflowFailure`. |
| `activity/ExecuteWorkflowActivity.java` | Delete (no longer needed) |
| `WorkflowExecutionTemporalWorkflowTypes.java` | Add child workflow type constant |
| `WorkflowExecutionTemporalWorkerConfig.java` | Update comments |
| `workflow/InvokeWorkflowExecutionWorkflowCreator.java` | Memo: stop passing suffixed queues |
| `dispatch/WorkflowDispatchResult.java` | Remove `:wf-orch` / `:wf-exec` suffix constants (or deprecate) |
| `dispatch/WorkflowExecutionDispatchService.java` | Simplify — no suffix derivation needed |

### B.2 — Go Orchestrator (0.5-1 session)

**Repo**: `stigmer` (OSS)
**Path**: `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/`

| File | Change |
|------|--------|
| `workflows/invoke_workflow_impl.go` | Replace `ExecuteWorkflow` activity stub with child workflow execution. Use `workflow.ExecuteChildWorkflow` with type `stigmer/workflow/execute-from-execution`, task queue from memo, workflow ID `workflow-exec-{executionId}`. |
| `activities/execute_workflow.go` | Delete activity interface (replaced by child workflow) |
| `worker_config.go` | Update comments |
| `config.go` | Simplify queue config if suffix no longer needed |

### B.3 — Tests + Harness (2 sessions)

| Work | Details |
|------|---------|
| **Java workflow unit test** | New `InvokeWorkflowExecutionWorkflowImplTest.java` using Temporal `TestWorkflowEnvironment`. Tests: child workflow start, cancel cleanup, signal relay mock. Pattern: copy from `InvokeAgentExecutionWorkflowSignalTest.java`. |
| **Integration harness** | In `test/integration/suite_test.go`: start a second `UnifiedRunnerStatic` on `workflow_execution_runner` queue. Update `TestHarness` struct if needed. |
| **Fix compilation** | Replace `testHarness.WorkflowRunner` with `testHarness.UnifiedRunner` in ~25 workflow test files (mechanical find-and-replace). |
| **Validation** | Run `make test-integration` — all ~70 workflow tests should compile and pass. |

**Prerequisite**: Workstream A must complete first.
**Blocks**: Nothing (all other workstreams are independent).

---

## Workstream C: New Go Integration Tests (3-4 sessions)

**Repo**: `stigmer` (OSS)
**Path**: `test/integration/`
**Prerequisite**: None — uses existing harness, existing unified runner on `agent_execution_runner`.

### C.1 — Conversation Journey Tests (1 session)

New file: `test/integration/agent_execution_11_conversation_journey_test.go`

| Test | Offline/Provider | Description |
|------|-----------------|-------------|
| `TestAgentExecution_FullConversationJourney_5Turns` | Provider | 5 sequential messages, verify context retention, execution list growth, message accumulation |
| `TestAgentExecution_ConcurrentSessions` | Provider | 3 simultaneous sessions on same agent, verify independent context |
| `TestAgentExecution_SessionPersistence_AcrossExecutions` | Provider | Create session, run execution, query session, run second execution, verify state |
| `TestAgentExecution_AgentIdOnly_AutoSession_ThenFollowUp` | Provider | Auto-session creation then follow-up on captured session_id |

### C.2 — Lifecycle Edge Cases (1 session)

New file: `test/integration/agent_execution_12_lifecycle_edge_cases_test.go`

| Test | Offline/Provider | Description |
|------|-----------------|-------------|
| `TestAgentExecution_CancelMidExecution` | Provider | Start, cancel while RUNNING, verify CANCELLED state |
| `TestAgentExecution_Cancel_ThenRecoverFails` | Offline | Cancel, attempt recover, verify FAILED_PRECONDITION |
| `TestAgentExecution_FailedExecution_ThenRecover` | Offline | Force failure (malformed MCP), verify FAILED, recover |
| `TestAgentExecution_PauseResumeFlow` | Provider | Pause while RUNNING, verify PAUSED, resume, verify completion |
| `TestAgentExecution_RapidFireMessages` | Provider | 3 messages in rapid succession, verify ordering |

### C.3 — Tool Call + Streaming Verification (1 session)

New file: `test/integration/agent_execution_13_tool_calls_test.go`

| Test | Offline/Provider | Description |
|------|-----------------|-------------|
| `TestAgentExecution_ToolCall_VerifyStructure` | Provider | Execute with MCP, verify tool_call messages have name/arguments/result |
| `TestAgentExecution_ToolCall_MultipleSequential` | Provider | Multiple MCP tools in sequence, verify all recorded |
| `TestAgentExecution_MCPServer_ConnectionFailure` | Offline | Unreachable MCP server, verify descriptive error |

New file: `test/integration/agent_execution_14_streaming_test.go`

| Test | Offline/Provider | Description |
|------|-----------------|-------------|
| `TestAgentExecution_StreamingEvents_Ordering` | Provider | gRPC subscribe, verify event ordering (CREATED → RUNNING → COMPLETED) |
| `TestAgentExecution_StreamingUsageSummary` | Provider | Verify usage summary populated on completion |

### C.4 — Session + Resource CRUD (1 session)

New file: `test/integration/session_lifecycle_test.go`

| Test | Offline/Provider | Description |
|------|-----------------|-------------|
| `TestSession_CreateGetDelete` | Offline | Full CRUD lifecycle |
| `TestSession_ListByAgentInstance` | Offline | Multiple sessions, list, verify filtering |
| `TestSession_UpdateHarness_Immutability` | Provider | Lock harness via execution, verify change rejected |
| `TestSession_ExecutionTarget_Immutability` | Provider | Same for execution_target |
| `TestSession_UpdateModel` | Offline | Update model, verify persisted |

New file: `test/integration/agent_crud_test.go`

| Test | Offline/Provider | Description |
|------|-----------------|-------------|
| `TestAgent_CreateGetUpdateDelete` | Offline | Full CRUD |
| `TestAgent_CreateWithMCPServers` | Offline | MCP refs persisted |
| `TestAgent_List_Pagination` | Offline | 10+ agents, cursor pagination |
| `TestAgent_DuplicateSlug_Rejected` | Offline | Same slug → ALREADY_EXISTS |
| `TestAgent_DefaultAgentLabel` | Offline | Default label → resolvable |

---

## Workstream D: Structural Playwright E2E (2 sessions)

**Repo**: `stigmer` (OSS)
**Path**: `test/e2e/tests/functional/`
**Prerequisite**: None — structural tests don't need backend changes.

### D.1 — Settings + Error States (1 session)

New file: `test/e2e/tests/functional/settings.spec.ts`

All 12 settings pages: verify page loads, heading visible, no error boundary. Pattern: `goto → waitForLoadState → assert heading/list/empty state`.

New file: `test/e2e/tests/functional/error-states.spec.ts`

Invalid routes, invalid IDs → verify error UI not crash.

### D.2 — Library Pages + Accessibility (1 session)

New file: `test/e2e/tests/functional/library-agents.spec.ts`

Agent list: heading, search, cards/empty, create button, detail tabs.

New file: `test/e2e/tests/functional/library-skills.spec.ts`
New file: `test/e2e/tests/functional/library-mcp-servers.spec.ts`

Same pattern for skills and MCP servers.

New file: `test/e2e/tests/functional/accessibility.spec.ts`

axe-core audits on home, dashboard, library agents, session pages. Keyboard navigation through sidebar.

---

## Workstream E: stigmer-cloud BUILD.bazel Wiring (2-3 sessions)

**Repo**: `stigmer-cloud`
**Path**: `backend/services/stigmer-service/BUILD.bazel`
**Prerequisite**: None.

### E.1 — Search Domain (0.5 session)

Wire 16 test files: `SearchHandlerTest`, `MongoSearchQueryStoreTest`, `SearchableResourceRegistryTest`, `SearchCriteriaTest`, `SearchPagedResultTest`, 11 extractor tests. Clean, self-contained — highest confidence batch.

### E.2 — Tenancy Domain (0.5 session)

Wire 16 test files: 6 project handlers, 2 project repo/service, 1 ActualState, 7 organization tests. May need import fixes for renamed/deleted resources.

### E.3 — Agentic Domain (1 session)

Wire 22 test files: 9 agent execution, 5 workflow execution handlers, 2 session handlers, 4 environment/execution context, 4 agent/skill/MCP, 1 sandbox token. Higher risk — may reference deleted Runner types.

### E.4 — Billing + IAM (0.5 session)

Wire 8 billing (temporal/reservation/ledger) + 3 IAM (OpenFGA writer) tests.

### E.5 — CI Pipeline Gate (0.5 session)

Add `./bazelw test //backend/...` step to `.planton/pipeline.yaml` before image push. Verify all wired tests pass.

---

## Workstream F: SDK React Component Tests (1 session)

**Repo**: `stigmer` (OSS)
**Path**: `sdk/react/src/`
**Prerequisite**: None.

New file: `sdk/react/src/execution/__tests__/ExecutionViewer.test.tsx`

| Test | Description |
|------|-------------|
| `renders loading state` | Pending execution → skeleton UI |
| `renders completed execution` | Mock data → messages rendered |
| `renders tool calls collapsible` | Expand/collapse panels |
| `renders HITL approval gate` | Pending approval → approval UI |

New file: `sdk/react/src/composer/__tests__/SessionComposer-interaction.test.tsx`

| Test | Description |
|------|-------------|
| `submits message on Enter` | Enter key → submit callback |
| `Shift+Enter inserts newline` | Textarea grows |
| `disables submit during execution` | Loading → disabled |
| `harness selector renders` | Options visible |

---

## Urgency: Verify Production Status

**Before starting any workstream**, verify whether workflow execution works in production:

```bash
# Check if old Go workflow-runner is still deployed
planton get service stigmer-cloud/workflow-runner
# Or check kustomize overlays for workflow-runner deployment
```

If the old Go workflow-runner binary was removed from production deployment, **workflow execution is already broken in production** — making Workstream A+B a P0 fix, not just a testing concern.

---

## Summary Table

| Workstream | Sessions | Can Parallelize With | Blocked By |
|------------|----------|---------------------|------------|
| **A: TS Hydration** | 2-3 | C, D, E, F | Nothing (start immediately) |
| **B: Java + Go Rewrite** | 1.5-2 | C, D, E, F | A |
| **B: Tests + Harness** | 2 | C, D, E, F | B |
| **C: Go Integration Tests** | 3-4 | A, B, D, E, F | Nothing |
| **D: Playwright E2E** | 2 | A, B, C, E, F | Nothing |
| **E: BUILD.bazel Wiring** | 2-3 | A, B, C, D, F | Nothing |
| **F: SDK Component Tests** | 1 | A, B, C, D, E | Nothing |
| **Total** | 17-22 | — | — |
| **Critical path** | 6-7 | — | A → B → B-tests |

## Deferred (Post-Deploy)

- Pause/resume parity for workflow execution (+2-3 sessions, needs TS checkpoint)
- Progressive status reporting parity (+1-2 sessions, old Go interceptor not in TS)
- Interactive Playwright E2E (auth fixtures, API seeding, backend startup — infrastructure investment)
- Desktop Playwright E2E (requires Tauri test harness)

---

## Review Process

**What happens next**:
1. **You review this plan** — especially the parallel execution map and workstream scoping
2. **Provide feedback** — any workstream to re-scope, re-prioritize, or remove?
3. **I'll revise** — create T01_2_revised_plan.md if needed
4. **You approve** — execution begins, one workstream per agent session
5. **To resume any session**: drag `next-task.md` into chat

**Please consider**:
- Is the parallel execution map correct? Can you run 6 agents simultaneously?
- Should Workstream A (TS hydration) start before verifying production status?
- Any workstream to cut or defer?
- Priority order if running sequentially instead of parallel?
