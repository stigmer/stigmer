# Next Task: 20260515.01.sp.agent-powered-workflow-generation

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260508.01.bring-workflows-to-foreground
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260508.01.bring-workflows-to-foreground
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/next-task.md`
**Spawned From Task**: T16

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260515.01.sp.agent-powered-workflow-generation

**Description**: Rewrite all workflow generation, refinement, and diagnosis flows from direct LLM calls to agent-powered sessions using the Cursor harness. The Workflow Architect agent uses MCP server connections and tool use for richer, more sophisticated workflow creation, replacing the current single-shot prompt approach.
**Goal**: Replace the current direct LLM RPCs (generateWorkflowFromPrompt, refineWorkflow, diagnoseWorkflowExecution) with a Workflow Architect agent that leverages the existing Cursor harness infrastructure, MCP server tool introspection, and streaming agent sessions to produce higher-quality workflows with full observability.
**Tech Stack**: Protobuf (APIs/schemas), Go (workflow-runner/Temporal workers), Java (stigmer-service), TypeScript/React (Web UI), Python (agent-runner/LangGraph), Temporal (durability), CNCF Serverless Workflow (DSL influence)
**Components**: Proto APIs (workflow/workflowexecution/workflowinstance/tasks), workflow-runner (Go/Temporal), stigmer-service (Java), Web UI (React — builder, execution viewer, dashboard), CLI (Go — workflow commands), agent-runner (Python — structured output support), model registry, artifact store

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260508.01.bring-workflows-to-foreground/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-05-15 10:05
**Current Task**: Tech debt resolved — all sub-project work complete
**Status**: Complete — ready for parent project Phase 4

## Session Progress (May 16, 2026 — Session 7: Tech Debt Sweep)

### Completed: Workflow Domain Tech Debt Sweep

Investigated all 7 accumulated tech debt items from Phases 0-3, resolved the 4 actionable
items, verified 1, and deferred 2 with documented rationale.

#### TD-2 + TD-3: TS SDK Codegen Fix
- **Root cause**: `tsImportMethodType` in `sdk_client_ts.go` blindly appended `/io_pb` for
  cross-package types instead of consulting `methodTypeFileMap`
- **Fix**: 4-line change — check `methodTypeFileMap[typeName]` before `/io_pb` fallback
- **Verified**: `make -C sdk/typescript codegen` produces correct `serverless/validation_pb` import
- TD-2 was already resolved — both RPCs were in the JSON schemas

#### TD-1: OSS Event Persistence
- SQLite migration (`schemaVersion5`): `workflow_execution_events` table
- Store interface: 3 new methods + `WorkflowExecutionEventRecord`
- `PersistEventsStep` in `update_status.go` pipeline (non-fatal)
- `GetEventLog` query handler (cursor-paginated)
- `SubscribeEvents` streaming handler (poll-based, 500ms)

#### TD-4: CheckBudgetWarnings
- Wrote from scratch in `budget_warnings.go` (147 lines, 7 warning scenarios)
- Wired into `ValidateWorkflow` Temporal activity as Step 4
- 9 unit tests passing, non-blocking warnings (state stays VALID)

#### TD-7: Search Indexing — Verified
- Code path correct: `IndexSearchStep` wired at step 9 of create pipeline
- Best-effort indexing is a platform-wide design choice, not workflow-specific

#### TD-5 + TD-6: Deferred
- TD-5: Agent-execution-scoped downloads already work; unified `artifact.v1` is a feature
- TD-6: Cannot verify without frontend code access

### Files Changed
- `tools/codegen/generator/sdk_client_ts.go` — **Modify** (cross-package import fix)
- `backend/libs/go/store/interface.go` — **Modify** (3 new methods + record type)
- `backend/libs/go/store/sqlite/store.go` — **Modify** (migration v5 + implementations)
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/update_status.go` — **Modify** (PersistEventsStep)
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/get_event_log.go` — **New**
- `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/subscribe_events.go` — **New**
- `backend/services/workflow-runner/pkg/validation/budget_warnings.go` — **New**
- `backend/services/workflow-runner/pkg/validation/budget_warnings_test.go` — **New**
- `backend/services/workflow-runner/pkg/validation/validate.go` — **Modify** (moved CheckBudgetWarnings)
- `backend/services/workflow-runner/pkg/validation/BUILD.bazel` — **Modify**
- `backend/services/workflow-runner/worker/activities/validate_workflow_activity.go` — **Modify**

### Verification
- `go build` + `go vet` — clean (libs, stigmer-server, workflow-runner)
- `go test ./backend/services/workflow-runner/pkg/validation/...` — 9/9 budget tests pass
- `tsc --noEmit` — clean (sdk/typescript)

## Next Steps

1. **Run E2E tests** — `make test-workflow-architect` with API keys
2. **Phase 4: Advanced Agentic Orchestration (T17)** — plan_and_execute, handoff, eval, batch, cache, code_execution, memory
3. **Future: Large YAML attachment** — for workflows > 300 lines

## Session Progress (May 16, 2026 — Session 6: E2E Integration Tests)

### Completed: Workflow Architect E2E Test Suite

Built a complete E2E integration test suite for the Workflow Architect agent-powered
flows (generate, refine, diagnose) using the existing test/integration infrastructure
with the real `mcp-server-stigmer` binary connected to the test Java service.

#### Harness Infrastructure (4 changes)
- **`BuildMcpServerStigmer(outputDir)`** — compiles the real `mcp-server-stigmer` binary
  in `TestMain`, following the `BuildTestMcpServer` pattern. Suite-scoped, failure is a warning.
- **`STIGMER_SERVER_ADDRESS`** env var added to both agent-runner and cursor-runner harnesses
  so MCP server subprocesses can connect back to the test Java service via gRPC.
- **`mcpServerStigmerBinary`** global in `suite_test.go` — build step runs alongside
  the test MCP server build.
- **`test-workflow-architect`** Makefile target — focused provider-backed test run with
  auto-key-fetch from Planton. Also added `TestWorkflowArchitect` to `test-providers` regex.

#### Workflow Architect Helpers (`harness/workflow_architect_helpers.go`)
- **`CreateStigmerMcpServer`** — creates McpServer resource pointing to real binary
- **`CreateWorkflowArchitectAgent`** — creates agent with real seedpack instructions
  (read from `seedpack/agents/workflow-architect.yaml` at test time) and full MCP tool list
- **`ExtractWorkflowYAML`** — Go port of `extract-workflow-yaml.ts` (scans AI messages
  for ` ```yaml ` blocks, returns last match from last AI message)
- **`AssertHasYAMLBlock`** / **`AssertHasAnyToolCall`** — assertion helpers for LLM output

#### Offline Tests (`workflow_validate_test.go`) — 4 tests
- `TestValidateSpec_ValidWorkflow` — valid set_vars workflow returns VALID
- `TestValidateSpec_InvalidTaskKind` — bad task kind returns non-VALID
- `TestValidateSpec_MissingDocument` — missing document section caught
- `TestValidateSpec_EmptySpec` — empty spec handled gracefully (no panic)

#### Agent E2E Tests (`workflow_architect_test.go`) — 5 tests
- `TestWorkflowArchitect_Generate` (cross-harness) — core generate flow with MCP tool assertions
- `TestWorkflowArchitect_GenerateAndApply` (native) — generate + apply as real Workflow resource
- `TestWorkflowArchitect_Refine` (native) — two-turn refinement in same session
- `TestWorkflowArchitect_DiagnoseExecution` (native) — create failing workflow, diagnose with agent
- `TestWorkflowArchitect_MCPToolAccess` (native) — smoke test for `get_task_kind_registry` tool

#### Verification
- `go build -tags integration ./test/integration/...` — clean
- `go vet -tags integration ./test/integration/...` — clean

### Key Decisions
- **Real mcp-server-stigmer** (not mock) — tests the full MCP → gRPC → backend pipeline
- **Seedpack instructions at test time** — reads from YAML file for production fidelity
- **Structural assertions for LLM non-determinism** — asserts completion, tool usage, YAML
  presence, and validity; never asserts exact content or tool order
- **Cross-harness for Generate only** — reduces cost; parity proven by existing 23+ tests
- **Env inheritance for MCP** — `STIGMER_SERVER_ADDRESS` propagated via runner env to
  child MCP processes (Plan B: `McpServerSpec.Env` if inheritance doesn't work)

### Files Changed
- `test/integration/harness/workflow_architect_helpers.go` — **New** (188 lines)
- `test/integration/workflow_validate_test.go` — **New** (160 lines)
- `test/integration/workflow_architect_test.go` — **New** (280 lines)
- `test/integration/harness/mcp_helpers.go` — **Modify** (added `BuildMcpServerStigmer`)
- `test/integration/suite_test.go` — **Modify** (added `mcpServerStigmerBinary` + build step)
- `test/integration/harness/agent_runner.go` — **Modify** (added `STIGMER_SERVER_ADDRESS`)
- `test/integration/harness/cursor_runner.go` — **Modify** (added `STIGMER_SERVER_ADDRESS`)
- `test/integration/Makefile` — **Modify** (added `test-workflow-architect` + updated regex)

## Next Steps

1. **Run the tests** — `make test-workflow-architect` with API keys to validate end-to-end
2. **Verify MCP env propagation** — confirm `STIGMER_SERVER_ADDRESS` reaches the MCP server process
3. **Future: Large YAML attachment** — for workflows > 300 lines
4. ~~**Future: Codegen tool fix**~~ — ✅ RESOLVED in Session 7 tech debt sweep

## Session Progress (May 15, 2026 — Session 5)

### Completed: Batch 5 — SDK + Frontend — Diagnose (WorkflowRepairCard)
- Created `useDiagnoseExecutionFlow` behavior hook following the refine pattern
  - Auto-starts on mount (AD-B5-002) — no intermediate "Diagnose with AI" state
  - Multi-turn session: first turn creates Session, follow-ups reuse it (AD-B5-003)
  - YAML extraction via `extractWorkflowYaml()` — presence = definition fix, absence = runtime error
  - Phase model: `idle | starting | streaming | complete | ready | error`
  - `diagnose()` + `sendFollowUp()` + `acceptFix()` + `discardFix()` + `reset()`
  - Referentially stable returns (DD-010), framework-agnostic (DD-004)
- Rewrote `WorkflowRepairCard` from single-shot loading card to conversational streaming panel
  - `MessageThread` for all turns (completed + active execution)
  - Result strip with diff preview and "Apply Fix" / "Discard" buttons
  - Runtime error notice when no YAML fix is suggested
  - Follow-up composer pinned to bottom
  - Self-contained: calls `useDiagnoseExecutionFlow` internally (AD-B5-004)
  - Props contract preserved (AD-B5-005)
- Updated `WorkflowExecutionViewer` layout: aside expands to `w-[40%] min-w-[360px] max-w-[500px]` when diagnosis active (AD-B5-001)
- Deleted stub `useDiagnoseExecution.ts`, updated barrel exports in `index.ts` and root `index.ts`
- Wired `org` (via `useActiveOrgSlug()`) + `onNavigateToWorkflowEditor` in web `WorkflowExecutionDetailPage`
- Wired `onNavigateToWorkflowEditor` in desktop `WorkflowExecutionDetailPage`
- Verification: `tsc --noEmit` clean across all 4 packages; ESLint passes on all changed files

### Key Decisions
- **AD-B5-001: 40% split layout** — diagnosis panel replaces sidebar panels (not nested below)
- **AD-B5-002: Auto-start** — agent begins immediately when panel opens (clear user intent)
- **AD-B5-003: Multi-turn session** — same Session for follow-ups
- **AD-B5-004: Self-contained card** — hook called internally, but also exported for headless use
- **AD-B5-005: Props contract stable** — same interface as before, internal rewrite

### Files Changed
- `sdk/react/src/workflow/useDiagnoseExecutionFlow.ts` — **New** (256 lines)
- `sdk/react/src/workflow/WorkflowRepairCard.tsx` — **Rewrite** (348 → 320 lines)
- `sdk/react/src/workflow/WorkflowExecutionViewer.tsx` — **Modify** (layout conditional)
- `sdk/react/src/workflow/useDiagnoseExecution.ts` — **Deleted**
- `sdk/react/src/workflow/index.ts` — **Update** exports
- `sdk/react/src/index.ts` — **Update** re-exports
- `client-apps/web/src/domain/workflow/WorkflowExecutionDetailPage.tsx` — **Modify** (org + navigation)
- `client-apps/desktop/src/pages/workflow/WorkflowExecutionDetailPage.tsx` — **Modify** (navigation)

## Session Progress (May 15, 2026 — Session 4)

### Completed: Batch 4 — SDK + Frontend — Refine (WorkflowRefinePanel)
- Rewrote `useRefineWorkflowFlow` from stub to agent-powered behavior hook
  - Lazy session creation, multi-turn execution within a single Session
  - Smart YAML delivery: captured at send-time via ref, only included when changed (`lastSentYamlRef`)
  - YAML extraction via `extractWorkflowYaml()`, YAML-absence detects clarifying questions
  - Phase model: `idle | starting | streaming | complete | ready | error`
  - Referentially stable returns (DD-010), framework-agnostic (DD-004)
- Rewrote `WorkflowRefinePanel` from spinner/history layout to conversational UI
  - `MessageThread` for all turns (completed executions + active stream)
  - `ResultStrip` with diff preview and accept/discard (appears when YAML extracted)
  - Composer pinned to bottom, enabled in idle/ready/complete/error phases
  - Empty state, starting indicator, streaming status in header
- Updated barrel exports: removed `RefineWorkflowFlowResult`, `RefinementHistoryEntry`; added `RefinePhase`
- Updated root `sdk/react/src/index.ts` re-exports to match
- `WorkflowEditorView` required zero changes (props contract preserved, AD-B4-004)
- Both client-app detail pages unchanged (DD-016 parity confirmed)
- Verification: `tsc --noEmit` clean across all 4 packages; lint passes (pre-existing errors only in untouched files)
- Commit: `d6d606384` — `feat(sdk): replace workflow refine stub with agent-powered refinement flow`

### Key Decisions
- **AD-B4-001: Separate hook** — dedicated `useRefineWorkflowFlow`, not shared with generate (different lifecycle)
- **AD-B4-002: Session-per-panel-instance** — no generation session reuse (simpler, standalone-capable)
- **AD-B4-003: Conversational UI with MessageThread** — replaces spinner+history layout
- **AD-B4-004: Props interface preservation** — `WorkflowRefinePanelProps` unchanged, zero `WorkflowEditorView` changes
- **RD-2: YAML captured at send-time** — ref-based, not reactive; only included when changed
- **RD-3: YAML-absence = clarifying question** — no special detection, phase transitions to `ready`
- **RD-4: Inline YAML for V1** — attachment-based delivery tracked as future optimization for large workflows

### Files Changed
- `sdk/react/src/workflow/useRefineWorkflowFlow.ts` — **Rewrite** (72 → 261 lines)
- `sdk/react/src/workflow/WorkflowRefinePanel.tsx` — **Rewrite** (387 → 310 lines)
- `sdk/react/src/workflow/index.ts` — **Update** exports
- `sdk/react/src/index.ts` — **Update** re-exports

## Session Progress (May 15, 2026 — Session 3)

### Completed: Batch 3 — SDK + Frontend — Generate (WorkflowArchitectDialog)
- Regenerated TS proto stubs (`make -C apis ts-stubs`) — removed deleted LLM RPCs, added `validateSpec`
- Regenerated TS SDK client (`make -C sdk/typescript codegen`) — `WorkflowClient` updated
- Fixed codegen import bug: `serverless/io_pb` → `serverless/validation_pb` for `ServerlessWorkflowValidation`
- Cleaned stale type exports from `@stigmer/sdk` barrel (`GenerateFromPromptInput`, `RefineWorkflowClientInput`, `DiagnoseExecutionInput`, etc.)
- Stubbed `useRefineWorkflowFlow` and `useDiagnoseExecution` with descriptive runtime errors (Batch 4/5 placeholders)
- Created `extract-workflow-yaml.ts` — pure utility extracting last YAML fenced block from `AgentExecution` messages
- Created `useWorkflowArchitectFlow` — behavior hook composing `useCreateSession` + `useCreateAgentExecution` + `useExecutionStream`/`ConversationStore` + YAML extraction + `workflow.apply()`
- Created `WorkflowArchitectDialog` — three-phase styled component (Input → Streaming with `MessageThread` → Result with YAML preview)
- Updated barrel exports in `workflow/index.ts` and root `index.ts`
- Wired `WorkflowArchitectDialog` in both web and desktop `WorkflowListPage` (DD-016 parity)
- Deleted `useGenerateWorkflowFlow.ts` (7KB) and `WorkflowGenerateDialog.tsx` (16KB)
- Verification: `tsc --noEmit` passes clean across all 4 packages (sdk/typescript, sdk/react, client-apps/web, client-apps/desktop)

### Key Decisions
- **Dialog with embedded streaming** — kept the dialog UX (user stays on workflow list) instead of navigating to a full session page; agent messages stream inside the dialog via `MessageThread`
- **Reuse full streaming infra** — `useExecutionStream` + `ConversationStore` + `StreamController` (DD-009) — no custom streaming
- **Convention-based YAML extraction** — scan last AI message for fenced ````yaml` block; `null` if not found (surfaces as extraction-failed state)
- **Session persists for refinement** — generate creates a real Session so Batch 4 can reuse it for conversational context
- **Batch 4/5 stubs, not deletions** — stubbed hooks with runtime errors to keep barrel exports stable; will be replaced in Batches 4-5
- **Drop-in prop replacement** — `WorkflowArchitectDialogProps` matches `WorkflowGenerateDialogProps` exactly, making console wiring a one-line import swap

### Surprises Discovered
- TS SDK codegen had not been run after Batch 1A proto teardown — `sdk/typescript/src/gen/workflow.ts` still had `generateFromPrompt`, `refine`, `diagnoseExecution`
- TS proto stubs (`apis/stubs/ts`) were also stale — needed `make -C apis ts-stubs` before TS SDK codegen would produce correct output
- Codegen import bug: generated `serverless/io_pb` import path but actual stub is `serverless/validation_pb` — manually fixed in generated file
- Pre-existing Bazel/Gazelle issue blocks `make -C apis build` (Go stubs fail) — workaround: run `make -C apis ts-stubs` directly

## Session Progress (May 15, 2026 — Session 2)

### Completed: Batch 2 — Workflow Architect MCP Tools + Seedpack Agent
- Added `validateSpec` RPC to `WorkflowCommandController` proto (Workflow → ServerlessWorkflowValidation)
- Implemented Go handler in stigmer-server (thin 2-step pipeline reusing existing Temporal validation)
- Implemented Java handler in stigmer-cloud (`WorkflowValidateSpecHandler` with `CustomOperationHandlerV2`)
- Added 5 new MCP tools to `mcp-server-stigmer` (total: 11 → 16):
  - `get_task_kind_registry` — full 19-kind registry with schemas
  - `get_task_kind` — single task kind descriptor by name
  - `validate_workflow_yaml` — YAML → proto → `validateSpec` RPC
  - `get_workflow_execution` — execution status for diagnosis
  - `get_workflow_execution_events` — event log for deep diagnosis
- Created `seedpack/agents/workflow-architect.yaml` system agent with Generate/Refine/Diagnose modes
- Fixed pre-existing seedpack test filename mismatch
- Codegen: `make codegen` (OSS) + `make protos` (Cloud) + SDK codegen + MCP server stubs
- Verification: buf lint, go build, go vet, go test — all clean

### Key Decisions
- **Server-side validation via Temporal** — `validate_workflow_yaml` calls `validateSpec` RPC which reuses the same Temporal validation pipeline as create/update (single source of truth)
- **YAML-to-proto parsing in MCP server** — YAML → map → JSON → protojson with task kind enum mapping (19-entry lookup table)
- **No new proto for task kind registry** — tool calls existing `TaskKindRegistryQueryController.getTaskKindRegistry()` gRPC RPC
- **Agent follows seedpack pattern** — same `stigmer.ai/system: "true"` label, `mcp-server-stigmer` reference, `enabled_tools` subset

## Session Progress (May 15, 2026 — Session 1)

### Completed: Batch 1A — Proto Cleanup + Backend Teardown
- Removed 3 gRPC RPCs and 6 protobuf messages from the workflow API (`io.proto`, `command.proto`)
- Deleted Go LLM HTTP client (`pkg/llmclient/`, 1,057 lines), 3 Go controller files (795 lines)
- Cleaned `workflow_controller.go` (removed LLM fields/setters) and `server.go` (removed LLM wiring)
- Deleted Java `generation/` directory and 3 Java handler files in stigmer-cloud
- Regenerated all stubs across both repos; verified builds clean (go build, go vet, proto lint)
- Net removal: ~3,800 lines across stigmer, significant deletions in stigmer-cloud

### Key Decisions
- **Kept `taskkindregistry` HTTP handler** — serves frontend workflow editor independently
- **SDK codegen is separate** — requires `make -C sdk/go codegen` in addition to top-level `make codegen`
- **No frontend changes needed** — SDK/React/Console deletion targets never existed

## Next Steps

1. **End-to-end testing** — Seed `workflow-architect` agent, test the full generate + refine + diagnose flows with a running Stigmer instance
2. **Future: Large YAML attachment** — For workflows > 300 lines, use `useAttachments` + `uploadAttachment()` to deliver YAML as a file instead of inlining in message context
3. **Future: Codegen tool fix** — Fix `serverless/io_pb` → `serverless/validation_pb` import path in TS SDK codegen

## Context for Resume

- **All 5 batches complete**: 1A (teardown), 2 (MCP tools + agent), 3 (Generate), 4 (Refine), **5 (Diagnose)**
- The `WorkflowArchitectDialog` is wired in both web and desktop consoles
- The `WorkflowRefinePanel` is wired inside `WorkflowEditorView` — opens in the right 40% pane via the toolbar "Refine" button
- The `WorkflowRepairCard` is wired inside `WorkflowExecutionViewer` — expands to 40% panel when diagnosis active
- `useDiagnoseExecutionFlow` composes the same infrastructure as refine (session + execution + stream + extract)
- Web console now sources `org` from `useActiveOrgSlug()` — diagnosis button appears on failed executions
- Both consoles wire `onNavigateToWorkflowEditor` for the "Apply Fix" → editor navigation
- TS proto stubs and TS SDK are regenerated and clean — `validateSpec` added, LLM methods removed
- Codegen import bug exists: `serverless/io_pb` → `serverless/validation_pb` fix is manual in `sdk/typescript/src/gen/workflow.ts` — will be overwritten on next codegen run (needs codegen tool fix)
- Pre-existing Bazel/Gazelle issue blocks `make -C apis build` — use `make -C apis ts-stubs` directly
- Changelogs: `_changelog/2026-05/2026-05-15-132017-workflow-architect-refine-panel.md`, `_changelog/2026-05/2026-05-15-162734-agent-powered-workflow-diagnosis.md`

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-05/20260515.01.sp.agent-powered-workflow-generation/next-task.md`

## Quick Commands

After loading context:
- "Continue with T01" - Resume the current task
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
