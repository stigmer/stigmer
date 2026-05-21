---
name: Pre-Deploy Integration Test Plan
overview: Comprehensive pre-deployment integration test expansion plan covering backend integration tests (Go), Playwright E2E browser tests, and SDK unit tests across all critical user journeys -- from agent execution A-to-Z, workflow orchestration, resource CRUD, session management, to full UX verification of the web console.
todos:
  - id: phase-0-verify-prod
    content: "Phase 0 URGENT: Verify if workflow execution is broken in production (is old Go workflow-runner still deployed?)"
    status: pending
  - id: phase-0-layer1
    content: "Phase 0 Layer 1: Fix compilation -- replace testHarness.WorkflowRunner with testHarness.UnifiedRunner in ~25 test files"
    status: pending
  - id: phase-0-option-c-ts-hydration
    content: "Phase 0 Option C (TS): Build hydrate-workflow-execution activity in unified runner (gRPC reads, YAML from validation status, env merge, unit tests) -- GATING ITEM, 2-3 sessions"
    status: pending
  - id: phase-0-option-c-java
    content: "Phase 0 Option C (Java): Replace ExecuteWorkflow activity stub with stigmer/workflow/execute child workflow dispatch, drop :wf-orch suffix, adapt error handling -- 1 session"
    status: pending
  - id: phase-0-option-c-go
    content: "Phase 0 Option C (Go): Same child workflow pattern in invoke_workflow_impl.go (simpler, no pause/relay) -- 0.5-1 session"
    status: pending
  - id: phase-0-option-c-tests
    content: "Phase 0 Option C (Tests): Java workflow unit tests (Temporal TestWorkflowEnvironment), TS hydration activity tests -- 1 session"
    status: pending
  - id: phase-0-harness
    content: "Phase 0 Harness: Start second unified runner on workflow queue in suite_test.go, run all ~70 workflow tests end-to-end -- 1 session"
    status: pending
  - id: phase-0b
    content: "Phase 0b: Wire 65 orphaned Java tests into BUILD.bazel in stigmer-cloud (search 16 > tenancy 16 > agentic 22 > billing 8 > IAM 3)"
    status: pending
  - id: phase-0b-ci
    content: "Phase 0b CI: Add bazelw test step to stigmer-cloud deploy pipeline (.planton/pipeline.yaml)"
    status: pending
  - id: phase-1-1
    content: "Phase 1.1: Full conversation journey integration tests (5-turn, concurrent sessions, auto-session follow-up)"
    status: pending
  - id: phase-1-2
    content: "Phase 1.2: Execution lifecycle edge cases (cancel, recover, pause/resume, rapid fire)"
    status: pending
  - id: phase-1-3
    content: "Phase 1.3: Tool call verification tests (tool messages, file ops, MCP reconnection)"
    status: pending
  - id: phase-1-4
    content: "Phase 1.4: Streaming and real-time event verification tests"
    status: pending
  - id: phase-2-1
    content: "Phase 2.1: Session lifecycle CRUD tests"
    status: pending
  - id: phase-2-2
    content: "Phase 2.2: Agent CRUD tests (create, update, delete, pagination, cascade)"
    status: pending
  - id: phase-2-3
    content: "Phase 2.3: Workflow CRUD tests"
    status: pending
  - id: phase-2-4
    content: "Phase 2.4: MCP Server and Skill CRUD tests"
    status: pending
  - id: phase-3-1
    content: "Phase 3.1: Workflow execution A-to-Z journey tests"
    status: pending
  - id: phase-4-1
    content: "Phase 4.1: Playwright E2E - Session and execution user journey"
    status: pending
  - id: phase-4-2
    content: "Phase 4.2: Playwright E2E - Library pages (agents, MCP servers, skills)"
    status: pending
  - id: phase-4-3
    content: "Phase 4.3: Playwright E2E - Workflow management"
    status: pending
  - id: phase-4-4
    content: "Phase 4.4: Playwright E2E - Settings pages verification"
    status: pending
  - id: phase-4-5
    content: "Phase 4.5: Playwright E2E - Accessibility and responsive tests"
    status: pending
  - id: phase-4-6
    content: "Phase 4.6: Playwright E2E - Error state verification"
    status: pending
  - id: phase-5
    content: "Phase 5: SDK React component interaction tests (ExecutionViewer, SessionComposer)"
    status: pending
  - id: phase-6
    content: "Phase 6: Java service parity/contract tests in stigmer-cloud"
    status: pending
isProject: false
---

# Pre-Deployment Integration Test Expansion Plan

## Current State Summary

**What exists today:**

- **58 Go integration test files** (`test/integration/`) covering: smoke, agent execution (lifecycle, config, MCP, skills, sub-agents, HITL, attachments, billing, usage), workflow orchestration (30+ files), IAM/auth (platform client, API key, identity provider, invitation, FGA enforcement), seedpack workflows/MCP, SDK acceptance, cost benchmarks
- **5 session routing tests** (`test/integration-session-routing/`) covering: Temporal memo verification, runner IPC dispatch, provider-backed E2E, cloud control plane
- **53 SDK/React unit tests** + 8 SDK/TypeScript tests + 3 Ink tests covering: hooks, components, streaming, memoization, stores, converters, SDK clients
- **3 web client unit tests** (error boundary, home page, not-found)
- **17 Playwright E2E tests** (`test/e2e/`) across smoke (4) and functional (13) projects
- **Harness infrastructure** (33 files) with unified runner, fixture deployer, execution waiter, mock MCP/HTTP/JWKS/OAuth servers, benchmark helpers, auth helpers, OpenFGA, MinIO, Jaeger
- **stigmer-cloud**: 126 Java test files but only ~61 wired in BUILD.bazel; no integration/E2E tests

**What is NOT tested -- the critical gaps:**

---

## Phase 0: Fix Broken Workflow Execution Path (BLOCKER -- Must Do First)

Deep code analysis revealed a **three-layer failure** in the workflow integration tests. This is not a simple gate fix -- it's an architectural gap left by the unified runner migration.

### Layer 1: Compilation Error (hard blocker)

58 references to `testHarness.WorkflowRunner` across ~25 test files. The `WorkflowRunner` field was deleted from `TestHarness` (replaced with `UnifiedRunner`). These files **do not compile** under `-tags integration`. This means `make test-integration` **fails to build** any workflow execution tests.

**Files affected:** `workflow_lifecycle_test.go`, `workflow_data_test.go`, `workflow_control_flow_test.go`, `workflow_http_test.go`, `workflow_hitl_test.go`, `workflow_hitl_edge_cases_test.go`, `workflow_listen_test.go`, `workflow_listen_edge_cases_test.go`, `workflow_error_handling_test.go`, `workflow_for_each_advanced_test.go`, `workflow_fork_edge_cases_test.go`, `workflow_flow_control_advanced_test.go`, `workflow_budget_test.go`, `workflow_input_validation_test.go`, `workflow_continue_as_new_test.go`, `workflow_pipeline_test.go`, `workflow_sandbox_colocation_test.go`, `workflow_agent_call_test.go`, `workflow_cursor_call_test.go`, `workflow_llm_call_test.go`, `workflow_architect_test.go`, `workflow_seedpack_test.go`, `sdk_acceptance_test.go`, `replay_capture_test.go`.

### Layer 2: Queue Routing Mismatch

The unified runner in tests starts on queue `agent_execution_runner` ([suite_test.go:143](test/integration/suite_test.go)). But the Java workflow execution orchestrator dispatches the `ExecuteWorkflow` activity to a **completely different queue**: `workflow_execution_runner:wf-orch` (base queue `workflow_execution_runner` + suffix `:wf-orch`).

The queue architecture (from [WorkflowDispatchResult.java](backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/dispatch/WorkflowDispatchResult.java)):

- Base queue: `workflow_execution_runner` (env var `TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE`)
- Orchestration queue: `workflow_execution_runner:wf-orch`
- Execution queue: `workflow_execution_runner:wf-exec`

The unified runner polling `agent_execution_runner` will never receive workflow execution work.

### Layer 3: Activity vs Workflow Architecture Gap (CONFIRMED)

The Java orchestrator ([InvokeWorkflowExecutionWorkflowImpl.java](stigmer-cloud/backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/workflowexecution/temporal/workflow/InvokeWorkflowExecutionWorkflowImpl.java)) dispatches `ExecuteWorkflow` as a Temporal **activity** (line 142: `Workflow.newActivityStub(ExecuteWorkflowActivity.class, ...)`). The old Go workflow-runner implemented this activity. The unified TS runner registers `stigmer/workflow/execute` as a Temporal **workflow** but does **not** register an `ExecuteWorkflow` activity. There is no `ExecuteWorkflow` anywhere under `backend/services/runner/src/activities/`.

This is a **Phase 8 cutover gap** from the workflow-runner TS rewrite project. The TS rewrite project notes explicitly state: "Full-stack integration tests -- After Phase 8, update the Go integration harness to start the TS runner instead of Go." Phase 8 was never completed before the old Go workflow-runner was deleted in Session 14.

**This is not a test infrastructure problem -- it is a code architecture gap.** Workflow execution through the Java service (which is what production uses) cannot work with the unified runner today. The fix requires either:
- Adding an `ExecuteWorkflow` activity shim to the unified runner that bridges to the `stigmer/workflow/execute` workflow, OR
- Rewriting the Java `InvokeWorkflowExecutionWorkflowImpl` to start `stigmer/workflow/execute` as a child workflow instead of calling an activity

### Resolution Options (need collaborative decision)

**Option A -- Minimal test fix (compilation only, quick):**
1. Replace `testHarness.WorkflowRunner` with `testHarness.UnifiedRunner` in all workflow test files
2. Tests will compile but workflow executions will fail at runtime with "No worker available to execute activity" (ScheduleToStart timeout)
3. Value: makes the failure visible and diagnosable instead of hidden behind a compilation error

**Option B -- ExecuteWorkflow activity shim in unified runner (recommended):**
1. Fix compilation (Option A)
2. Add an `ExecuteWorkflow` activity to the unified TS runner that internally runs `stigmer/workflow/execute` workflow (the bridge between old activity contract and new workflow engine)
3. Start a second unified runner instance in `suite_test.go` on `workflow_execution_runner` queue (with `:wf-orch` suffix handling)
4. This is the cleanest fix that doesn't change the Java service

**Option C -- Rewrite Java orchestrator to use child workflows:**
1. Fix compilation (Option A)
2. Update `InvokeWorkflowExecutionWorkflowImpl.java` to start `stigmer/workflow/execute` as a Temporal child workflow instead of calling the `ExecuteWorkflow` activity
3. Remove the `:wf-orch` suffix logic
4. This is architecturally cleaner long-term but changes the production Java service -- higher risk for a pre-deploy change

**Decision: Option C.** Rewrite the Java orchestrator to start `stigmer/workflow/execute` as a Temporal child workflow. This is the architecturally correct solution. The Go OSS orchestrator needs the same change for parity. Estimation pending from deep-dive analysis.

---

## Phase 0b: Wire Orphaned Java Tests in stigmer-cloud (High ROI)

The stigmer-cloud repo has **~65 Java test files on disk that are NOT registered in BUILD.bazel**. They cover critical domains: agent execution approval, workflow execution lifecycle, project/org CRUD, search, OpenFGA writer, environment encryption, billing, sessions. These tests were written but never wired into the build.

**Fix:** Add `java_junit5_test` targets to [BUILD.bazel](stigmer-cloud/backend/services/stigmer-service/BUILD.bazel) for each orphaned test file. No new tests to write -- just wire existing ones.

**Note:** Some unwired tests may reference the deleted Runner domain or stale imports. Each fix reveals a gap. Budget extra time for fixing import/compilation issues in the unwired tests.

Additionally, the **stigmer-cloud CI deploy pipeline does not run tests** (`.planton/pipeline.yaml` goes straight from build to deploy). A `./bazelw test //backend/...` step should be added before image push.

---

## Phase 1: Agent Execution A-to-Z Integration Tests

These are the highest-priority gaps. The existing tests cover individual execution capabilities, but there is no true end-to-end journey test that validates the full lifecycle a real user would experience.

### 1.1 Full Conversation Journey Tests

New file: `test/integration/agent_execution_11_conversation_journey_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestAgentExecution_FullConversationJourney_5Turns` | Create agent, create session, send 5 sequential messages in same session, verify context retention across all turns, verify execution list grows, verify message history accumulates correctly |
| `TestAgentExecution_ConcurrentSessions` | Single agent, 3 simultaneous sessions, verify each maintains independent context |
| `TestAgentExecution_SessionPersistence_AcrossExecutions` | Create session, run execution, wait for completion, query session, verify session state is persisted and queryable, run second execution referencing same session |
| `TestAgentExecution_AgentIdOnly_AutoSession_ThenFollowUp` | Create execution with only agent_id (auto-session), capture auto-created session_id, send follow-up message to that session, verify conversation continuity |

### 1.2 Execution Lifecycle Edge Cases

New file: `test/integration/agent_execution_12_lifecycle_edge_cases_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestAgentExecution_CancelMidExecution` | Start execution, cancel while RUNNING, verify reaches CANCELLED terminal state |
| `TestAgentExecution_Cancel_ThenRecoverFails` | Cancel execution, attempt recover, verify FAILED_PRECONDITION |
| `TestAgentExecution_FailedExecution_ThenRecover` | Force execution failure (malformed MCP config), verify FAILED state, recover, verify new execution starts |
| `TestAgentExecution_PauseResumeFlow` | Start execution, pause while RUNNING, verify PAUSED state, resume, verify resumes and completes |
| `TestAgentExecution_RapidFireMessages` | Send 3 messages to same session in rapid succession (before first completes), verify all complete and are ordered correctly |
| `TestAgentExecution_LongRunningExecution_Timeout` | Create execution with a prompt that should trigger many tool calls, verify timeout behavior |

### 1.3 Tool Call Verification Tests

New file: `test/integration/agent_execution_13_tool_calls_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestAgentExecution_ToolCall_VerifyToolCallMessages` | Execute with MCP tools, verify tool_call messages appear in execution status with correct structure (name, arguments, result) |
| `TestAgentExecution_ToolCall_MultipleToolsInSequence` | Agent uses multiple MCP tools in sequence, verify all tool calls are recorded |
| `TestAgentExecution_ToolCall_FileOperations` | Agent creates/reads/edits files in workspace via tools, verify file operations actually happened |
| `TestAgentExecution_MCPServer_Reconnection` | Start with mock MCP server, verify tool calls work, restart mock server mid-session, verify reconnection |

### 1.4 Streaming and Real-Time Verification

New file: `test/integration/agent_execution_14_streaming_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestAgentExecution_StreamingEvents_Ordering` | Use gRPC streaming API to watch execution, verify events arrive in correct order: CREATED -> RUNNING -> tool_calls -> messages -> COMPLETED |
| `TestAgentExecution_StreamingEvents_MessageAccumulation` | Stream execution events, verify messages accumulate (not replace) on each event |
| `TestAgentExecution_StreamingUsageSummary` | Verify streaming usage summary (token counts, cost) is populated on completion |

---

## Phase 2: Session & Resource CRUD Integration Tests

### 2.1 Session Lifecycle Tests

New file: `test/integration/session_lifecycle_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestSession_CreateGetDelete` | Full CRUD lifecycle for sessions |
| `TestSession_ListByAgentInstance` | Create multiple sessions for same agent instance, list, verify filtering |
| `TestSession_DeleteWithExecutionHistory` | Create session with completed executions, delete session, verify cascade behavior |
| `TestSession_UpdateHarness_Immutability` | Create session with harness, run execution (locks harness_state_id), attempt to change harness, verify FAILED_PRECONDITION |
| `TestSession_ExecutionTarget_Immutability` | Same as above for execution_target field |
| `TestSession_UpdateModel` | Create session, update model selection, verify persisted |

### 2.2 Agent CRUD Tests

New file: `test/integration/agent_crud_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestAgent_CreateGetUpdateDelete` | Full CRUD lifecycle |
| `TestAgent_CreateWithMCPServers` | Create agent with MCP server references, verify spec persisted correctly |
| `TestAgent_CreateWithSkills` | Create agent with skill references, verify spec persisted |
| `TestAgent_CreateWithSystemPrompt` | Verify system prompt is stored and used in execution |
| `TestAgent_List_Pagination` | Create 10+ agents, list with pagination, verify cursor-based pagination works |
| `TestAgent_DuplicateSlug_Rejected` | Create agent, create another with same slug in same org, verify ALREADY_EXISTS |
| `TestAgent_Delete_CascadesInstances` | Delete agent, verify instances are cascade-deleted |
| `TestAgent_DefaultAgentLabel` | Create agent with default label, verify it is resolvable via "default agent" API path |

### 2.3 Workflow CRUD Tests

New file: `test/integration/workflow_crud_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestWorkflow_CreateGetUpdateDelete` | Full CRUD lifecycle |
| `TestWorkflow_CreateFromYAML` | Apply workflow from YAML definition, verify spec parsed correctly |
| `TestWorkflow_List_Pagination` | Create 10+ workflows, test pagination |
| `TestWorkflow_InvalidYAML_Rejected` | Submit malformed YAML, verify descriptive validation error |
| `TestWorkflow_Update_VersionIncrement` | Update workflow, verify version incremented |

### 2.4 MCP Server & Skill CRUD Tests

New file: `test/integration/mcp_skill_crud_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestMCPServer_CreateGetDelete` | Full lifecycle |
| `TestMCPServer_ConnectAndListTools` | Create MCP server, connect, list tools, verify tool list populated |
| `TestSkill_CreateGetDelete` | Full lifecycle |

---

## Phase 3: Workflow Execution A-to-Z Tests

### 3.1 Full Workflow Journey Tests

New file: `test/integration/workflow_journey_test.go`

| Test Case | Description |
|-----------|-------------|
| `TestWorkflow_CreateDeployRunComplete` | Create workflow, deploy (apply), trigger execution, wait for completion -- full lifecycle |
| `TestWorkflow_RunWithInputVariables` | Workflow with input schema, provide variables at run time, verify they flow through to tasks |
| `TestWorkflow_FailedTask_ErrorPropagation` | Workflow with intentionally failing task, verify error propagates to execution status with descriptive message |
| `TestWorkflow_Cancel_MidExecution` | Start workflow execution, cancel mid-run, verify reaches terminal state |
| `TestWorkflow_ListExecutions_FilterByStatus` | Run multiple workflow executions, list with status filter, verify filtering works |

---

## Phase 4: Playwright E2E Browser Tests

**Current state (verified):** The existing 17 Playwright tests are purely structural -- they verify page loads, headings, element presence. There is **no auth fixture** (no login flow), **no API seeding** (tests rely on whatever data the backend happens to have), **no shared page objects or helpers**, and **no way to run interactive tests against a cloud deployment** (CI runs functional specs against `app.stigmer.ai` but without login, most are meaningless).

The Playwright setup **does not start the backend** -- it only auto-starts the Next.js web dev server. A developer must manually run `stigmer server` (or the Java service) for functional tests to see any data. Some locators use `data-testid="resource-card"` which does not exist in the SDK components (cards use `role="listitem"`).

**Infrastructure needed before adding interactive E2E tests (Phase 4.0):**

New file: `test/e2e/fixtures/index.ts`

- **API seeding fixture**: A Playwright fixture that uses `request` (Playwright's built-in HTTP client) to create test resources via the gRPC-web or REST API before tests run, and clean up after
- **Auth storage state**: For cloud-targeted runs, a `globalSetup` that performs OIDC login and saves `storageState` for reuse across tests
- **Page helpers**: Reusable navigation helpers (`gotoFirstResource()`, `waitForStreamingComplete()`, `submitMessage()`) that encapsulate the common locator patterns
- **Env profile**: Normalize `STIGMER_E2E_CLOUD` vs local-OSS behavior so tests degrade gracefully

Without this infrastructure, interactive Playwright tests will be fragile and environment-dependent.

### 4.1 Session & Execution User Journey (DEFERRED -- post-deploy)

Interactive browser tests that send real messages, verify streaming, and check conversation flow require Playwright infrastructure that does not exist today (auth fixtures, API seeding, backend startup). These are deferred until the E2E infrastructure is built.

**For pre-deploy:** The equivalent coverage comes from Go integration tests in Phase 1.1 (conversation journey) and Phase 1.4 (streaming verification) which exercise the same gRPC API the web console uses, using the mature integration harness.

### 4.2 Library Pages - Resource Management

New file: `test/e2e/tests/functional/library-agents.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `agent list page renders and is searchable` | Navigate to `/library/agents`, verify heading, search input, card/table view |
| `create new agent flow` | Click "Create agent", fill form (name, system prompt), submit, verify redirect to detail page |
| `agent detail page shows all tabs` | Navigate to agent detail, verify Overview/Instances/Executions tabs |
| `agent detail shows system prompt` | Verify system prompt visible in overview tab |
| `edit agent system prompt` | Navigate to editor tab, modify prompt, save, verify updated |
| `delete agent with confirmation` | Open agent detail, trigger delete, confirm dialog, verify redirected to list, agent gone |

New file: `test/e2e/tests/functional/library-mcp-servers.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `MCP server list page renders` | Navigate to `/library/mcp-servers`, verify heading, cards/empty state |
| `create MCP server flow` | Click create, fill form, submit, verify created |
| `MCP server detail shows connection status` | Navigate to detail, verify connection info visible |

New file: `test/e2e/tests/functional/library-skills.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `skills list page renders` | Navigate to `/library/skills`, verify heading, cards/empty state |
| `create skill flow` | Click create, fill form, submit, verify created |

### 4.3 Workflow Management E2E

New file: `test/e2e/tests/functional/workflow-management.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `create workflow from editor` | Navigate to create workflow, enter YAML, save, verify created |
| `run workflow from detail page` | Navigate to workflow detail, click Run, verify execution starts, verify execution appears in executions tab |
| `workflow execution detail shows task DAG` | Navigate to workflow execution detail, verify DAG/task visualization renders |
| `workflow execution shows task statuses` | Verify each task shows correct status (completed/failed/running) |

### 4.4 Settings Pages Verification

New file: `test/e2e/tests/functional/settings.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `settings page renders with all sections` | Navigate to `/settings`, verify all settings sections visible |
| `API keys page loads` | Navigate to `/settings/api-keys`, verify list/empty state |
| `create API key flow` | Click create, fill form, verify key shown (and warning about one-time display) |
| `environments page loads` | Navigate to `/settings/environments`, verify list |
| `members page loads` | Navigate to `/settings/members`, verify member list |
| `org profile page loads and is editable` | Navigate to `/settings/org-profile`, verify form fields |
| `billing page loads` | Navigate to `/settings/billing`, verify renders without error |
| `usage page loads` | Navigate to `/settings/usage`, verify renders |
| `identity providers page loads` | Navigate to `/settings/identity-providers`, verify list |
| `platform clients page loads` | Navigate to `/settings/platform-clients`, verify list |
| `invitations page loads` | Navigate to `/settings/invitations`, verify list |
| `OAuth apps page loads` | Navigate to `/settings/oauth-apps`, verify list |

### 4.5 Responsive & Accessibility Smoke Tests

New file: `test/e2e/tests/functional/accessibility.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `home page passes axe-core checks` | Run axe-core accessibility audit on home page |
| `dashboard passes axe-core checks` | Same for dashboard |
| `library agents page passes axe-core` | Same for agents list |
| `session page passes axe-core` | Same for session view |
| `keyboard navigation through sidebar` | Tab through sidebar items, verify focus visible, enter activates navigation |
| `keyboard navigation in session composer` | Tab to composer, type, Shift+Enter for newline, Enter to submit |

New file: `test/e2e/tests/functional/responsive.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `mobile viewport renders sidebar collapsed` | Set viewport to mobile, verify sidebar collapses to hamburger menu |
| `tablet viewport renders appropriately` | Set viewport to tablet, verify layout adapts |

### 4.6 Error State Verification

New file: `test/e2e/tests/functional/error-states.spec.ts`

| Test Case | Description |
|-----------|-------------|
| `404 page renders correctly` | Navigate to non-existent route, verify 404 UI |
| `invalid execution ID shows error` | Navigate to `/executions/nonexistent`, verify error state (not crash) |
| `invalid session ID shows error` | Navigate to `/sessions/nonexistent`, verify error state |
| `invalid workflow slug shows error` | Navigate to `/library/workflows/org/nonexistent`, verify error state |
| `network error shows retry option` | Simulate offline (intercept API calls), verify error banners with retry |

---

## Phase 5: SDK React Component Tests

### 5.1 Execution Viewer Component Tests

New file: `sdk/react/src/execution/__tests__/ExecutionViewer.test.tsx`

| Test Case | Description |
|-----------|-------------|
| `renders loading state` | Mount ExecutionViewer with pending execution, verify skeleton/loading UI |
| `renders completed execution with messages` | Mount with mock completed execution data, verify messages rendered |
| `renders tool calls with collapsible panels` | Verify tool calls render, click to expand, verify args/result visible |
| `renders HITL approval gate` | Mock execution with pending approval, verify approval UI visible |
| `handles streaming updates without full re-render` | Verify memo correctness -- only active row re-renders during streaming |

### 5.2 Session Composer Component Tests

New file: `sdk/react/src/composer/__tests__/SessionComposer-interaction.test.tsx`

| Test Case | Description |
|-----------|-------------|
| `submits message on Enter` | Simulate Enter key, verify submit callback fires |
| `Shift+Enter inserts newline` | Simulate Shift+Enter, verify textarea grows |
| `disables submit during execution` | Set loading state, verify submit disabled |
| `model selector is accessible` | Verify model dropdown is keyboard navigable |
| `harness selector renders options` | Verify harness selector shows available options |

---

## Phase 6: Cross-Service Contract Tests (stigmer-cloud)

### 6.1 Java Service Parity Tests

These verify that the Java cloud service produces identical behavior to the Go OSS server on core operations.

Location: `stigmer-cloud/backend/services/stigmer-service/` (Java/Bazel tests)

| Test Area | Tests to Add |
|-----------|-------------|
| Session dispatch parity | Verify `SessionDispatchService.resolve()` produces same task queues as Go `ResolveActivityTaskQueue` for all routing modes |
| Execution target immutability | Verify `ValidateExecutionTargetImmutabilityStep` matches Go behavior |
| Agent execution lifecycle | Verify lifecycle transitions (PENDING -> RUNNING -> COMPLETED/FAILED/CANCELLED) are identical |
| Error codes | Verify same gRPC error codes for same failure scenarios |
| Sandbox provisioning | Integration test for `DaytonaSandboxProvisioner` with mock Daytona SDK |

---

## Implementation Priority

```
BLOCKERS (Do First -- Restore Existing Coverage):
  Phase 0 Layer 1  - Fix workflow test compilation (WorkflowRunner -> UnifiedRunner)
  Phase 0 Layer 2-3 - Rewrite Java + Go orchestrators to use child workflows (Option C)
  Phase 0 Test harness - Start second unified runner + verify workflow tests pass
  Phase 0b - Wire 65 orphaned Java tests in stigmer-cloud BUILD.bazel

Priority 1 (Pre-Deploy Critical -- New Tests):
  Phase 1.1 - Conversation journey tests (offline + provider variants)
  Phase 1.2 - Lifecycle edge cases (offline)
  Phase 4.6 - Playwright error state verification (structural)

Priority 2 (High Confidence):
  Phase 1.3 - Tool call verification (offline with mock MCP)
  Phase 1.4 - Streaming verification (offline gRPC subscribe)
  Phase 2.1 - Session lifecycle CRUD (offline)
  Phase 4.2 - Playwright library pages (structural)
  Phase 4.4 - Playwright settings pages (structural)

Priority 3 (Comprehensive Coverage):
  Phase 2.2 - Agent CRUD (offline)
  Phase 2.3 - Workflow CRUD (offline)
  Phase 3.1 - Workflow journey tests (offline + provider)
  Phase 4.3 - Playwright workflow management (structural)
  Phase 4.5 - Playwright accessibility (axe-core)

Priority 4 (Polish):
  Phase 2.4 - MCP/Skill CRUD (offline)
  Phase 5.1 - SDK Execution viewer tests
  Phase 5.2 - SDK Composer interaction tests
  Phase 6.1 - Cross-service parity (Java + Go consistency)
```

## Key Implementation Notes

- **Phase 0 is the single highest-ROI task.** It restores ~70 existing workflow tests with a mechanical find-and-replace on the gate check. The unified runner already registers `stigmer/workflow/execute`. This should take under 1 hour.
- **Phase 0b is pure BUILD.bazel wiring.** ~65 Java tests already exist on disk. Adding `java_junit5_test` targets is mechanical. Some tests may fail and need fixes (stale imports after runner deletion), but each fix reveals a gap.
- **Integration tests** extend the existing harness in [test/integration/harness/](test/integration/harness/). Use `AgentFactory`, `AgentExecutionWaiter`, `MockHTTP`, `McpHttpServer`. No new infrastructure needed.
- **Playwright E2E tests** use the existing [test/e2e/](test/e2e/) setup with `playwright.config.ts`. New test files follow the existing smoke/functional project split. For tests that need data (agent exists, workflow exists), use `test.beforeAll` to seed via API or gracefully skip.
- **SDK tests** use the existing `vitest` setup in `sdk/react/vitest.config.ts`. Note: `@stigmer/theme` has Vitest wired but **zero tests** -- this is a gap but lower priority than functional coverage.
- **All provider-backed tests** (tests needing real LLM API keys) should be gated behind `CURSOR_API_KEY` or similar env vars and runnable via `make test-integration-providers`.
- **Offline tests** (no API keys) should be the majority -- use mock MCP servers and assertions on gRPC responses, not LLM prose content.
- **Desktop app has no Playwright E2E at all.** Adding desktop E2E is out of scope for this plan (requires Tauri test harness, different toolchain), but worth noting as a future gap.
- **stigmer-cloud CI deploy pipeline does not run tests.** Consider adding `./bazelw test //backend/...` to `.planton/pipeline.yaml` as a pre-deploy gate -- but this is an ops decision, not a test-writing task.

## Estimated Scope

| Category | Work | Test Impact | Estimated Effort |
|----------|------|-------------|------------------|
| Phase 0 Layer 1: Fix compilation | Replace `WorkflowRunner` in ~25 files | ~70 tests compile | 1 session |
| Phase 0 Option C: TS hydration activity | New `hydrate-workflow-execution` activity in unified runner (gRPC reads, YAML from validation status, env merge) | Unblocks both Java and Go orchestrators | 2-3 sessions |
| Phase 0 Option C: Java orchestrator rewrite | Replace activity stub with child workflow dispatch, drop `:wf-orch` suffix, error handling | Workflow execution works with unified runner via Java | 1 session |
| Phase 0 Option C: Go orchestrator rewrite | Same child workflow pattern in `invoke_workflow_impl.go` (simpler, no pause/relay) | OSS parity | 0.5-1 session |
| Phase 0 Option C: Tests | Java workflow unit tests (Temporal TestWorkflowEnvironment), TS hydration tests | Prevent regressions | 1 session |
| Phase 0 Harness: Second runner + validation | Start runner on workflow queue, run all workflow tests | ~70 tests pass at runtime | 1 session |
| Phase 0b: Wire Java tests + CI gate | BUILD.bazel targets for 65 files, fix compilation issues, pipeline step | ~65 tests run in CI | 2-3 sessions |
| Go Integration - New (Phase 1-3) | ~10 new test files, ~40 tests (offline + provider variants) | Conversations, CRUD, streaming, tool calls | 3-4 sessions |
| Playwright E2E (Phase 4) | ~6 new spec files, ~30 structural tests | Settings, library, error states, accessibility | 2 sessions |
| SDK React (Phase 5) | ~2 new test files, ~10 tests | Component interaction coverage | 1 session |
| Java Parity (Phase 6) | ~3 new test files, ~10 tests | Cross-service consistency | 1-2 sessions |
| **Total** | **~30 new files + ~30 modified, ~900-1400 LOC** | **~230 tests (135 restored + ~95 new)** | **~17-22 sessions** |

**Critical path:** The TS hydration activity (2-3 sessions) is the single gating item -- it unblocks both Java and Go orchestrator rewrites. The sequencing is: TS hydration first, then Java child workflow swap (1 session), then Go parity (0.5-1 session), then integration E2E validation (1 session). Total Option C MVP: **5-7 sessions**. Pause/resume parity deferred (needs TS checkpoint support, +2-3 sessions if needed later).

**Parallelization:** Layer 1 compilation fix, Phase 0b (Java BUILD.bazel wiring), and all new Go integration tests (Phase 1-3) can proceed in parallel with the Option C work since they don't depend on workflow execution.

## Open Questions for Discussion (Must Resolve Before Implementation)

### 1. Workflow execution architecture gap -- CONFIRMED, decision made

**Decision: Option C.** Rewrite the Java `InvokeWorkflowExecutionWorkflowImpl` (and Go equivalent) to start `stigmer/workflow/execute` as a Temporal child workflow instead of calling the deleted `ExecuteWorkflow` activity. This eliminates the `:wf-orch` suffix complexity and aligns both orchestrators with the unified runner's architecture.

**Risk assessment:** If workflow execution is broken in production today (not just in tests), this is a P0 bug. The old Go workflow-runner was deleted from the repo -- if it's also been removed from the production deployment, workflow execution may already be broken. **This needs immediate verification before we begin implementation.**

### 2. Playwright E2E strategy -- DECIDED

**Decision: (c) -- Go integration first, structural Playwright now, interactive Playwright later.** The Go integration harness is mature and covers most "fewer surprises" scenarios. For Playwright, we add structural tests for uncovered pages (settings, agents, skills, error states) using the existing pattern. Interactive Playwright tests (send a message, create an agent) are deferred until E2E infrastructure (auth, seeding, helpers) is built -- that's a post-deploy investment.

### 3. Provider-gated test strategy -- DECIDED

**Decision: Maximize offline tests, gate on providers only when an LLM response is structurally required.** For each new test, design the offline variant first (mock MCP, assert gRPC flow/lifecycle/status transitions). Only add a provider-gated variant when the test specifically needs to verify LLM response quality or end-to-end execution with real model output. Tests will document their gate explicitly in the test name (e.g., `TestAgentExecution_MultiTurn` for offline, `TestAgentExecution_MultiTurn_Provider` for LLM-backed).

### 4. stigmer-cloud BUILD.bazel wiring -- IN SCOPE

**Decision: Wire all 65 orphaned tests.** Batch by domain: search (16) first (clean, self-contained), then tenancy (16), then agentic (22), then billing temporal (8), then IAM/OpenFGA (3). Fix compilation issues as they surface. Add a `./bazelw test` step to the CI deploy pipeline.
